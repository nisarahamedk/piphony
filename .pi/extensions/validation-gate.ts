/**
 * Validation Gate Extension
 *
 * Automatically runs validation after mutating agent runs and feeds failures back
 * to the agent. Prevents false "done" states by ensuring the canonical
 * validation suite passes before work is treated as complete.
 *
 * Disable via: PIPHONY_VALIDATION_GATE=0
 * Max auto-fix retries: 3
 * Artifacts: .piphony/validation/<timestamp>/
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface ValidationState {
  validationInProgress: boolean;
  retryCount: number;
  lastValidatedAgentRun: number;
}

interface ValidationResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  skipped: boolean;
  skipReason?: string;
}

interface ValidationSummary {
  timestamp: string;
  agentRun: number;
  passed: boolean;
  retryCount: number;
  artifactDir: string;
  results: ValidationResult[];
}

const VALIDATION_COMMANDS = [
  "npm run typecheck",
  "npm test",
  "npm run build:extension",
  "npm run smoke:web",
  "npm run smoke:stack",
  "npm run smoke:observability",
  "npm run smoke:tracker-local",
  "npm run smoke:session-control",
] as const;

const MAX_RETRIES = 3;
const DISABLE_ENV_VAR = "PIPHONY_VALIDATION_GATE";
const STATE_ENTRY_TYPE = "validation-gate-state";
const EXTENSION_MARKER = "[VALIDATION_GATE_FEEDBACK]";
const MESSAGE_TYPE = "validation-gate";

const MUTATING_BASH_PATTERNS = [
  /^npm\s+install(?:\s|$)/i,
  /^npm\s+i(?:\s|$)/i,
  /^yarn\s+add(?:\s|$)/i,
  /^pnpm\s+add(?:\s|$)/i,
  /^rm\s+/i,
  /^mv\s+/i,
  /^cp\s+/i,
  /^mkdir\s+/i,
  /^touch\s+/i,
  /^git\s+(checkout|apply|cherry-pick|merge|rebase|reset)(?:\s|$)/i,
  /^echo\s+.*>/,
  /^cat\s+.*>/,
  /^chmod\s+/i,
  /^chown\s+/i,
  /^curl\b.*-X\s+(POST|PUT|DELETE|PATCH)\b/i,
] as const;

function isDisabled(): boolean {
  return process.env[DISABLE_ENV_VAR] === "0";
}

function isMutatingBash(command: string): boolean {
  return MUTATING_BASH_PATTERNS.some((pattern) => pattern.test(command.trim()));
}

function defaultState(): ValidationState {
  return {
    validationInProgress: false,
    retryCount: 0,
    lastValidatedAgentRun: -1,
  };
}

function readState(ctx: ExtensionContext): ValidationState {
  const entries = ctx.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "custom" && entry.customType === STATE_ENTRY_TYPE) {
      return { ...defaultState(), ...(entry.data as Partial<ValidationState>) };
    }
  }
  return defaultState();
}

function writeState(pi: ExtensionAPI, state: ValidationState): void {
  pi.appendEntry(STATE_ENTRY_TYPE, state);
}

function resetStaleState(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const state = readState(ctx);
  if (!state.validationInProgress) {
    return;
  }
  writeState(pi, {
    ...state,
    validationInProgress: false,
  });
}

async function createArtifactDir(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(process.cwd(), ".piphony", "validation", timestamp);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeArtifact(dir: string, name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content, "utf8");
  return path;
}

function extractStructuredJson(raw: string): unknown | undefined {
  const lines = raw.trim().split(/\r?\n/);
  for (let start = lines.length - 1; start >= 0; start -= 1) {
    const candidate = lines.slice(start).join("\n").trim();
    if (!candidate.startsWith("{")) {
      continue;
    }
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try earlier start line
    }
  }
  return undefined;
}

function parseExpectedSkip(raw: string): { skipped: boolean; skipReason?: string } {
  const parsed = extractStructuredJson(raw);
  if (parsed === undefined || parsed === null || typeof parsed !== "object") {
    return { skipped: false };
  }
  const record = parsed as Record<string, unknown>;
  if (record.ok === true && record.skipped === true) {
    return {
      skipped: true,
      skipReason: typeof record.reason === "string" ? record.reason : "skipped",
    };
  }
  return { skipped: false };
}

function formatCommandLog(command: string, result: ValidationResult): string {
  return [
    `Command: ${command}`,
    `Exit Code: ${result.exitCode}`,
    ...(result.skipped ? [`Skipped: true`, `Skip Reason: ${result.skipReason ?? "unknown"}`] : []),
    "",
    "STDOUT:",
    result.stdout,
    "",
    "STDERR:",
    result.stderr,
    "",
  ].join("\n");
}

function excerpt(result: ValidationResult, maxChars = 800): string {
  const raw = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n\n").trim();
  if (raw === "") {
    return "(no output)";
  }
  if (raw.length <= maxChars) {
    return raw;
  }
  return `${raw.slice(0, maxChars)}\n... (truncated)`;
}

async function runValidationCommand(pi: ExtensionAPI, command: string, artifactDir: string): Promise<ValidationResult> {
  const logName = command.replace(/^npm\s+run\s+/, "").replace(/:/g, "-");
  const execution = await pi.exec("bash", ["-lc", command], { timeout: 300_000 });
  const stdout = execution.stdout ?? "";
  const stderr = execution.stderr ?? "";
  const combinedOutput = [stdout, stderr].filter(Boolean).join("\n");
  const exitCode = execution.code ?? -1;
  const skip = parseExpectedSkip(combinedOutput);

  const result: ValidationResult = {
    command,
    exitCode,
    stdout,
    stderr,
    skipped: exitCode === 0 && skip.skipped,
    ...(skip.skipReason === undefined ? {} : { skipReason: skip.skipReason }),
  };

  await writeArtifact(artifactDir, `${logName}.log`, formatCommandLog(command, result));
  return result;
}

async function runValidationSuite(pi: ExtensionAPI, ctx: ExtensionContext, agentRun: number): Promise<ValidationSummary> {
  const artifactDir = await createArtifactDir();
  const results: ValidationResult[] = [];

  for (const command of VALIDATION_COMMANDS) {
    ctx.ui.setStatus("validation-gate", `Running ${command}...`);
    const result = await runValidationCommand(pi, command, artifactDir);
    results.push(result);
    if (result.exitCode !== 0 && !result.skipped) {
      break;
    }
  }

  const summary: ValidationSummary = {
    timestamp: new Date().toISOString(),
    agentRun,
    passed: results.every((result) => result.exitCode === 0 || result.skipped),
    retryCount: 0,
    artifactDir,
    results,
  };

  await writeArtifact(artifactDir, "summary.json", `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function formatFailureMessage(summary: ValidationSummary, retryCount: number): string {
  const failures = summary.results.filter((result) => result.exitCode !== 0 && !result.skipped);
  let message = `${EXTENSION_MARKER}\n\n`;
  message += "## Validation Failed\n\n";
  message += `Validation failed after a mutating agent run. Artifact directory: ${summary.artifactDir}\n\n`;

  for (const failure of failures) {
    const logName = failure.command.replace(/^npm\s+run\s+/, "").replace(/:/g, "-");
    message += `### ${failure.command}\n`;
    message += `- Exit code: ${failure.exitCode}\n`;
    message += `- Log: ${summary.artifactDir}/${logName}.log\n`;
    message += "- Output excerpt:\n```\n";
    message += excerpt(failure);
    message += "\n```\n\n";
  }

  message += "## Action Required\n\n";
  message += "Do NOT stop, do NOT claim completion, and do NOT report success yet.\n";
  message += "This task is only complete once the validation gate passes.\n";
  message += "Fix these failures and continue working until validation reruns cleanly.\n";
  message += `Retry ${retryCount}/${MAX_RETRIES}. Remaining retries: ${MAX_RETRIES - retryCount}.\n`;
  return message;
}

function formatFollowUpPrompt(summary: ValidationSummary, retryCount: number): string {
  return `${formatFailureMessage(summary, retryCount)}\nProceed to fix the validation failures now. Keep working until the validation gate passes, and only then report completion.`;
}

function formatSuccessMessage(summary: ValidationSummary): string {
  const passed = summary.results.filter((result) => result.exitCode === 0).length;
  const skipped = summary.results.filter((result) => result.skipped).length;
  let message = "## Validation Gate Passed\n\n";
  message += `Validated successfully after a mutating agent run. Artifact directory: ${summary.artifactDir}\n\n`;
  message += `Commands passed: ${passed}`;
  if (skipped > 0) {
    message += `, skipped: ${skipped}`;
  }
  message += ".\n";

  const skippedResults = summary.results.filter((result) => result.skipped);
  if (skippedResults.length > 0) {
    message += "\n### Expected skips\n";
    for (const result of skippedResults) {
      message += `- ${result.command}: ${result.skipReason ?? "skipped"}\n`;
    }
  }

  return message;
}

function formatRetryLimitMessage(summary: ValidationSummary, retryCount: number): string {
  return [
    `${EXTENSION_MARKER}`,
    "",
    "## Validation Retry Limit Reached",
    "",
    `Validation still failed after ${retryCount} automatic retry attempt(s).`,
    `Artifact directory: ${summary.artifactDir}`,
    "Human intervention is now required.",
  ].join("\n");
}

function maybeSendFollowUp(pi: ExtensionAPI, ctx: ExtensionContext, content: string): void {
  if (ctx.isIdle()) {
    pi.sendUserMessage(content);
    return;
  }
  pi.sendUserMessage(content, { deliverAs: "followUp" });
}

export default function validationGate(pi: ExtensionAPI) {
  if (isDisabled()) {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify("Validation gate disabled (PIPHONY_VALIDATION_GATE=0)", "info");
    });
    return;
  }

  let currentAgentMutated = false;
  let agentRunCounter = 0;

  pi.on("session_start", async (_event, ctx) => {
    resetStaleState(pi, ctx);
    ctx.ui.notify("Validation gate enabled", "info");
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") {
      return;
    }

    const state = readState(ctx);
    if (state.retryCount === 0 && !state.validationInProgress) {
      return;
    }

    writeState(pi, {
      ...state,
      retryCount: 0,
      validationInProgress: false,
    });
  });

  pi.on("agent_start", async () => {
    currentAgentMutated = false;
    agentRunCounter += 1;
  });

  pi.on("tool_call", async (event, _ctx) => {
    if (event.toolName === "edit" || event.toolName === "write") {
      currentAgentMutated = true;
      return;
    }

    if (event.toolName === "bash" && event.input && typeof event.input === "object") {
      const input = event.input as { command?: unknown };
      if (typeof input.command === "string" && isMutatingBash(input.command)) {
        currentAgentMutated = true;
      }
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!currentAgentMutated) {
      return;
    }

    const state = readState(ctx);
    if (state.validationInProgress) {
      return;
    }

    writeState(pi, {
      ...state,
      validationInProgress: true,
    });

    ctx.ui.setStatus("validation-gate", "Running validation gate...");

    try {
      const summary = await runValidationSuite(pi, ctx, agentRunCounter);
      const latestState = readState(ctx);

      if (summary.passed) {
        writeState(pi, {
          ...latestState,
          validationInProgress: false,
          retryCount: 0,
          lastValidatedAgentRun: agentRunCounter,
        });

        ctx.ui.setStatus("validation-gate", undefined);
        ctx.ui.notify("Validation gate passed", "info");
        pi.sendMessage({
          customType: MESSAGE_TYPE,
          content: formatSuccessMessage(summary),
          display: true,
        });
        return;
      }

      const nextRetryCount = latestState.retryCount + 1;
      writeState(pi, {
        ...latestState,
        validationInProgress: false,
        retryCount: nextRetryCount,
      });

      if (nextRetryCount < MAX_RETRIES) {
        const failureMessage = formatFailureMessage(summary, nextRetryCount);
        ctx.ui.setStatus("validation-gate", undefined);
        ctx.ui.notify(`Validation gate failed (${nextRetryCount}/${MAX_RETRIES})`, "warning");
        pi.sendMessage({
          customType: MESSAGE_TYPE,
          content: failureMessage,
          display: true,
        });
        maybeSendFollowUp(pi, ctx, formatFollowUpPrompt(summary, nextRetryCount));
        return;
      }

      ctx.ui.setStatus("validation-gate", undefined);
      ctx.ui.notify("Validation gate failed: retry limit reached", "error");
      pi.sendMessage({
        customType: MESSAGE_TYPE,
        content: formatRetryLimitMessage(summary, nextRetryCount),
        display: true,
      });
    } catch (error) {
      const latestState = readState(ctx);
      writeState(pi, {
        ...latestState,
        validationInProgress: false,
      });
      ctx.ui.setStatus("validation-gate", undefined);
      ctx.ui.notify(`Validation gate error: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  });
}
