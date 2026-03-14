/**
 * Validation Gate Extension
 *
 * Automatically runs validation after mutating agent runs and feeds failures back
 * to the agent. Prevents false "done" states by ensuring the canonical
 * validation suites pass before work is treated as complete.
 *
 * Disable via: PIPHONY_VALIDATION_GATE=0
 * Deterministic auto-fix retries: 3
 * Artifacts: .piphony/validation/<timestamp>/
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  analyzeValidationResult,
  DETERMINISTIC_VALIDATION_COMMANDS,
  LIVE_VALIDATION_COMMANDS,
  type ExternalDependencyBlocker,
  type ValidationCommandSpec,
  type ValidationLaneKind,
  type ValidationResultClassification,
} from "../../src/validation/validation-gate.ts";

interface ValidationState {
  validationInProgress: boolean;
  retryCount: number;
  lastValidatedAgentRun: number;
}

interface ValidationResult {
  lane: ValidationLaneKind;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  classification: ValidationResultClassification;
  skipped: boolean;
  skipReason?: string;
  blocker?: ExternalDependencyBlocker;
}

interface ValidationSummary {
  timestamp: string;
  agentRun: number;
  passed: boolean;
  artifactDir: string;
  results: ValidationResult[];
}

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

function formatCommandLog(result: ValidationResult): string {
  return [
    `Lane: ${result.lane}`,
    `Command: ${result.command}`,
    `Exit Code: ${result.exitCode}`,
    `Classification: ${result.classification}`,
    ...(result.skipped ? [`Skipped: true`, `Skip Reason: ${result.skipReason ?? "unknown"}`] : []),
    ...(result.blocker === undefined
      ? []
      : [
          `External Blocker: ${result.blocker.code}`,
          `Blocker Headline: ${result.blocker.headline}`,
          `Escalation Hint: ${result.blocker.escalationHint}`,
        ]),
    "",
    "STDOUT:",
    result.stdout,
    "",
    "STDERR:",
    result.stderr,
    "",
  ].join("\n");
}

function excerpt(result: ValidationResult, maxChars = 1000): string {
  const raw = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n\n").trim();
  if (raw === "") {
    return "(no output)";
  }
  if (raw.length <= maxChars) {
    return raw;
  }
  return `${raw.slice(0, maxChars)}\n... (truncated)`;
}

async function runValidationCommand(pi: ExtensionAPI, commandSpec: ValidationCommandSpec, artifactDir: string): Promise<ValidationResult> {
  const logName = commandSpec.command.replace(/^npm\s+run\s+/, "").replace(/:/g, "-");
  const execution = await pi.exec("bash", ["-lc", commandSpec.command], { timeout: 300_000 });
  const stdout = execution.stdout ?? "";
  const stderr = execution.stderr ?? "";
  const analysis = analyzeValidationResult({
    lane: commandSpec.lane,
    exitCode: execution.code ?? -1,
    stdout,
    stderr,
  });

  const result: ValidationResult = {
    lane: commandSpec.lane,
    command: commandSpec.command,
    exitCode: execution.code ?? -1,
    stdout,
    stderr,
    classification: analysis.classification,
    skipped: analysis.signal.skipped,
    ...(analysis.signal.skipReason === undefined ? {} : { skipReason: analysis.signal.skipReason }),
    ...(analysis.blocker === undefined ? {} : { blocker: analysis.blocker }),
  };

  await writeArtifact(artifactDir, `${logName}.log`, formatCommandLog(result));
  return result;
}

async function runValidationLane(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  lane: ValidationLaneKind,
  commands: readonly ValidationCommandSpec[],
  artifactDir: string,
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  for (const command of commands) {
    ctx.ui.setStatus("validation-gate", `Running ${lane} validation: ${command.command}...`);
    const result = await runValidationCommand(pi, command, artifactDir);
    results.push(result);
    if (result.classification !== "passed") {
      break;
    }
  }

  return results;
}

async function runValidationSuite(pi: ExtensionAPI, ctx: ExtensionContext, agentRun: number): Promise<ValidationSummary> {
  const artifactDir = await createArtifactDir();
  const deterministicResults = await runValidationLane(pi, ctx, "deterministic", DETERMINISTIC_VALIDATION_COMMANDS, artifactDir);
  const failedDeterministic = deterministicResults.find((result) => result.classification !== "passed");
  const liveResults = failedDeterministic === undefined
    ? await runValidationLane(pi, ctx, "live", LIVE_VALIDATION_COMMANDS, artifactDir)
    : [];
  const results = [...deterministicResults, ...liveResults];

  const summary: ValidationSummary = {
    timestamp: new Date().toISOString(),
    agentRun,
    passed: results.length > 0 && results.every((result) => result.classification === "passed"),
    artifactDir,
    results,
  };

  await writeArtifact(artifactDir, "summary.json", `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function formatFixableFailureMessage(summary: ValidationSummary, failure: ValidationResult, retryCount: number): string {
  const logName = failure.command.replace(/^npm\s+run\s+/, "").replace(/:/g, "-");
  return [
    EXTENSION_MARKER,
    "",
    `## ${failure.lane === "deterministic" ? "Deterministic" : "Live"} Validation Failed`,
    "",
    `Validation failed after a mutating agent run. Artifact directory: ${summary.artifactDir}`,
    "",
    `### ${failure.command}`,
    `- Lane: ${failure.lane}`,
    `- Exit code: ${failure.exitCode}`,
    `- Classification: ${failure.classification}`,
    `- Log: ${summary.artifactDir}/${logName}.log`,
    "- Output excerpt:",
    "```",
    excerpt(failure),
    "```",
    "",
    "## Action Required",
    "",
    "Do NOT stop, do NOT claim completion, and do NOT report success yet.",
    "This task is only complete once the validation gate passes.",
    "Fix the underlying repo issue and continue working until validation reruns cleanly.",
    `Retry ${retryCount}/${MAX_RETRIES}. Remaining retries: ${MAX_RETRIES - retryCount}.`,
  ].join("\n");
}

function formatFollowUpPrompt(summary: ValidationSummary, failure: ValidationResult, retryCount: number): string {
  return [
    formatFixableFailureMessage(summary, failure, retryCount),
    "Proceed to fix this validation failure now. Keep working until the validation gate passes, and only then report completion.",
  ].join("\n\n");
}

function formatExternalBlockMessage(summary: ValidationSummary, failure: ValidationResult): string {
  const blockerHeadline = failure.blocker?.headline ?? "External validation dependency is unavailable";
  const escalationHint = failure.blocker?.escalationHint
    ?? "Ask the user to restore the external dependency, then rerun the live validation suite.";
  const logName = failure.command.replace(/^npm\s+run\s+/, "").replace(/:/g, "-");

  return [
    EXTENSION_MARKER,
    "",
    "## Live Validation Blocked By External Dependency",
    "",
    `The deterministic repo guard is green, but live validation could not complete because an external dependency failed. Artifact directory: ${summary.artifactDir}`,
    "",
    `### ${failure.command}`,
    `- Lane: ${failure.lane}`,
    `- Exit code: ${failure.exitCode}`,
    `- Classification: ${failure.classification}`,
    ...(failure.skipped ? [`- Skip reason: ${failure.skipReason ?? "unknown"}`] : []),
    ...(failure.blocker === undefined ? [] : [`- External blocker: ${failure.blocker.code}`, `- Blocker summary: ${blockerHeadline}`]),
    `- Log: ${summary.artifactDir}/${logName}.log`,
    "- Output excerpt:",
    "```",
    excerpt(failure),
    "```",
    "",
    "## Action Required",
    "",
    "Do NOT keep changing code or rerunning the same fix loop for this failure.",
    "This looks like provider/auth/quota/capacity weather, not a deterministic repo regression.",
    escalationHint,
    "Escalate this blocker to the user and wait for further instructions.",
  ].join("\n");
}

function formatExternalBlockPrompt(summary: ValidationSummary, failure: ValidationResult): string {
  const blockerHeadline = failure.blocker?.headline ?? "External live validation dependency unavailable";
  const escalationHint = failure.blocker?.escalationHint
    ?? "Please ask the user to restore the external dependency and rerun validate:main.";
  return [
    EXTENSION_MARKER,
    "Validation is blocked by an external transient dependency, not a code issue you can fix from this repo.",
    `Blocked command: ${failure.command}`,
    `Blocker: ${blockerHeadline}`,
    `Artifact directory: ${summary.artifactDir}`,
    "Stop making code changes for this validation failure.",
    "Tell the user you are blocked and need human intervention or a later rerun.",
    escalationHint,
  ].join("\n");
}

function formatSuccessMessage(summary: ValidationSummary): string {
  const deterministicPassed = summary.results.filter((result) => result.lane === "deterministic" && result.classification === "passed").length;
  const livePassed = summary.results.filter((result) => result.lane === "live" && result.classification === "passed").length;
  return [
    "## Validation Gate Passed",
    "",
    `Validated successfully after a mutating agent run. Artifact directory: ${summary.artifactDir}`,
    "",
    `Deterministic commands passed: ${deterministicPassed}`,
    `Live commands passed: ${livePassed}`,
  ].join("\n");
}

function formatRetryLimitMessage(summary: ValidationSummary, failure: ValidationResult, retryCount: number): string {
  return [
    EXTENSION_MARKER,
    "",
    "## Validation Retry Limit Reached",
    "",
    `Validation still failed after ${retryCount} automatic retry attempt(s).`,
    `Failed command: ${failure.command}`,
    `Lane: ${failure.lane}`,
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

function findFirstNonPassingResult(summary: ValidationSummary): ValidationResult | undefined {
  return summary.results.find((result) => result.classification !== "passed");
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
    ctx.ui.notify("Validation gate enabled (deterministic + live lanes)", "info");
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

  pi.on("tool_call", async (event) => {
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
      const failure = findFirstNonPassingResult(summary);

      if (summary.passed || failure === undefined) {
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

      if (failure.classification === "external_transient") {
        writeState(pi, {
          ...latestState,
          validationInProgress: false,
          retryCount: 0,
        });
        ctx.ui.setStatus("validation-gate", undefined);
        ctx.ui.notify("Validation gate blocked by external dependency", "warning");
        pi.sendMessage({
          customType: MESSAGE_TYPE,
          content: formatExternalBlockMessage(summary, failure),
          display: true,
        });
        maybeSendFollowUp(pi, ctx, formatExternalBlockPrompt(summary, failure));
        return;
      }

      const nextRetryCount = latestState.retryCount + 1;
      writeState(pi, {
        ...latestState,
        validationInProgress: false,
        retryCount: nextRetryCount,
      });

      if (nextRetryCount < MAX_RETRIES) {
        ctx.ui.setStatus("validation-gate", undefined);
        ctx.ui.notify(`Validation gate failed (${nextRetryCount}/${MAX_RETRIES})`, "warning");
        pi.sendMessage({
          customType: MESSAGE_TYPE,
          content: formatFixableFailureMessage(summary, failure, nextRetryCount),
          display: true,
        });
        maybeSendFollowUp(pi, ctx, formatFollowUpPrompt(summary, failure, nextRetryCount));
        return;
      }

      ctx.ui.setStatus("validation-gate", undefined);
      ctx.ui.notify("Validation gate failed: retry limit reached", "error");
      pi.sendMessage({
        customType: MESSAGE_TYPE,
        content: formatRetryLimitMessage(summary, failure, nextRetryCount),
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
