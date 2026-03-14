import { execFile, spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { Type } from "@sinclair/typebox";
import { createClient } from "rivetkit/client";
import { chromium, type Page } from "playwright";
import { ActiveRunRegistry } from "../core/active-run-registry.js";
import { attemptCleanup } from "../core/cleanup.js";
import { errorMessage } from "../core/errors.js";
import { Orchestrator, type RunWorker, type RunWorkerContext } from "../core/orchestrator.js";
import { ensureDir, resetDir } from "../core/utils.js";
import { createChiefOfStaffRegistry } from "../cos/actor.js";
import { createLocalChiefOfStaffServices } from "../cos/local-services.js";
import { startChiefOfStaffServer } from "../cos/server.js";
import type { ChiefOfStaffMessage } from "../cos/actor.js";
import { inspectRun } from "../observability/index.js";
import { createPiSessionController } from "../pi/runner.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { resetTrackerState } from "../tracker/local/harness.js";
import { repoRoot, runsRootDir, trackerDir } from "./_common.js";

const execFileAsync = promisify(execFile);
const webUrl = "http://127.0.0.1:3333";
const cosPort = 6521;
const cosEndpoint = `http://127.0.0.1:${cosPort}/api/rivet`;
const artifactsDir = join(repoRoot, ".piphony", "artifacts", "extension-web-smoke");
const issueIdentifier = "LOCAL-980";
const issueContextToken = "ISSUE-CONTEXT:";
const steerToken = "EXTENSION-STEER-OK";
const plannedTitle = "CoS planned board follow-up";
const cosUserKey = `extension-web-smoke-${Date.now()}`;

class ExtensionSteerableWorker implements RunWorker {
  readonly name = "extension-steerable-worker";

  constructor(private readonly tracker: ReturnType<typeof createLocalTrackerAdapter>) {}

  async execute(context: RunWorkerContext) {
    const controller = await createPiSessionController({
      cwd: repoRoot,
      agentType: "chief_of_staff",
      modelPreference: "minimax/MiniMax-M2.5",
      thinkingLevel: "off",
      sessionDir: join(context.runArtifacts.runDir, "sessions"),
      customTools: [
        {
          name: "hold_for_smoke",
          label: "hold_for_smoke",
          description: "Hold execution for 45 seconds so extension-side steering can land on an active worker session.",
          parameters: Type.Object({}),
          execute: async () => {
            await sleep(45_000);
            return {
              content: [{ type: "text", text: "held for extension smoke" }],
              details: { heldMs: 45_000 },
            };
          },
        },
      ],
    });
    context.activeRunRegistry?.attachControl(context.run.runId, controller);
    try {
      const result = await controller.runPrompt([
        "You must call hold_for_smoke immediately before replying.",
        "You may receive steering or follow-up messages while that tool runs.",
        `When finished, reply with one sentence starting exactly with 'Extension worker complete for ${context.workItem.identifier}:' and include any received steering guidance literally.`,
      ].join("\n"));
      await this.tracker.applyMutation(context.workItem.identifier, { type: "transition", state: "in_progress" });
      await this.tracker.applyMutation(context.workItem.identifier, { type: "transition", state: "human_review" });
      return { summary: result.output, output: result.output };
    } finally {
      await controller.dispose();
    }
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/\u001b\(B/g, "");
}

async function runShell(command: string, timeoutMs = 120_000): Promise<string> {
  const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
    cwd: repoRoot,
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stripAnsi([stdout.toString(), stderr.toString()].filter(Boolean).join("\n").trim());
}

async function waitForHttp(url: string, attempts = 180): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(1_000);
  }
  throw new Error(`service_not_ready:${url}`);
}

async function killExistingWebServer(): Promise<void> {
  await attemptCleanup("smoke.extension_web.kill_web_server", () => runShell("pkill -f 'vite --config apps/web/vite.config.ts'", 10_000).then(() => undefined));
}

async function killExistingOrchestratorWatch(): Promise<void> {
  await attemptCleanup("smoke.extension_web.kill_orchestrator", () => runShell("pkill -f 'tsx src/cli/orchestrator-watch.ts'", 10_000).then(() => undefined));
}

function startWebServer() {
  return spawn("npm", ["run", "web:dev"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
}

async function waitForActiveRun(registry: ActiveRunRegistry, identifier: string): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const entry = registry.getByIdentifier(identifier);
    if (entry?.control !== undefined) {
      return entry.run.runId;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for active run: ${identifier}`);
}

async function waitForCompletedRunToken(runId: string, token: string): Promise<string> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      const run = await inspectRun(runsRootDir, runId);
      const haystacks = [
        run.transcript,
        run.summary === undefined ? undefined : JSON.stringify(run.summary),
        JSON.stringify(run.status),
        JSON.stringify(run.events),
      ].filter((value): value is string => typeof value === "string");
      if (run.status.status === "completed" && haystacks.some((value) => value.includes(token))) {
        return run.runId;
      }
    } catch (error) {
      console.error("extension_web_run_inspection_failed", { runId, message: errorMessage(error) });
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for completed run token: ${token}`);
}

async function waitForAssistantMessage(input: {
  handle: any;
  afterIndex: number;
  predicate: (message: ChiefOfStaffMessage) => boolean;
  timeoutMs?: number;
}): Promise<ChiefOfStaffMessage> {
  const timeoutMs = input.timeoutMs ?? 180_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const history = await input.handle.getHistory();
    if (Array.isArray(history)) {
      const next = history.slice(input.afterIndex).find((message: ChiefOfStaffMessage) => message.role === "assistant" && input.predicate(message));
      if (next !== undefined) {
        return next;
      }
    }
    await sleep(1_000);
  }
  throw new Error("Timed out waiting for assistant response");
}

async function waitForLocatorText(input: {
  page: Page;
  testId: string;
  includes: string[];
  timeoutMs?: number;
}): Promise<string> {
  const timeoutMs = input.timeoutMs ?? 60_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = (await input.page.getByTestId(input.testId).textContent().catch(() => null)) ?? "";
    if (input.includes.every((needle) => text.includes(needle))) {
      return text;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for locator text: ${input.testId}`);
}

async function waitForBodyText(input: {
  page: Page;
  includes: string;
  timeoutMs?: number;
}): Promise<string> {
  const timeoutMs = input.timeoutMs ?? 60_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = (await input.page.locator("body").textContent().catch(() => null)) ?? "";
    if (text.includes(input.includes)) {
      return text;
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for body text: ${input.includes}`);
}

await resetDir(runsRootDir);
await rm(trackerDir, { recursive: true, force: true });
await ensureDir(trackerDir);
await mkdir(artifactsDir, { recursive: true });
await resetTrackerState({ trackerDir });
await killExistingWebServer();
await killExistingOrchestratorWatch();

const adapter = createLocalTrackerAdapter(trackerDir);
await adapter.store.createIssue({ identifier: issueIdentifier, title: "Extension steering target", state: "todo" });

const activeRunRegistry = new ActiveRunRegistry();
const orchestrator = new Orchestrator({
  tracker: adapter,
  worker: new ExtensionSteerableWorker(adapter),
  runsRootDir,
  activeRunRegistry,
  pollIntervalMs: 500,
  instanceId: "extension-web-smoke",
});

let stopPolling = false;
const pollLoop = (async () => {
  while (!stopPolling) {
    await orchestrator.pollOnce().catch((error) => {
      console.error("orchestrator poll failed", error);
    });
    await sleep(1_000);
  }
})();

const sessionRootDir = join(artifactsDir, "cos-sessions");
await ensureDir(sessionRootDir);
const cosRegistry = createChiefOfStaffRegistry({
  cwd: repoRoot,
  sessionRootDir,
  services: createLocalChiefOfStaffServices({ trackerDir, runsRootDir, activeRunRegistry }),
});
const cosServer = await startChiefOfStaffServer({ registry: cosRegistry, port: cosPort });
const webServer = startWebServer();

try {
  await waitForHttp(webUrl);
  await waitForHttp(`http://127.0.0.1:${cosPort}/health`);
  const extensionRunId = await waitForActiveRun(activeRunRegistry, issueIdentifier);

  const client = createClient<any>({ endpoint: cosEndpoint }) as any;
  const handle = client.chiefOfStaff.getOrCreate(["user", cosUserKey]) as any;

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`${webUrl}/?extension=1&cosEndpoint=${encodeURIComponent(cosEndpoint)}&cosUserKey=${encodeURIComponent(cosUserKey)}`, {
      waitUntil: "networkidle",
      timeout: 120_000,
    });

    await page.waitForSelector("[data-testid='extension-panel']", { timeout: 30_000 });
    await waitForLocatorText({
      page,
      testId: "extension-context-kind",
      includes: ["Board: local"],
      timeoutMs: 30_000,
    });

    await page.click(`[data-testid='issue-card-${issueIdentifier}']`);
    await page.waitForSelector("[data-testid='issue-inspector']", { timeout: 30_000 });
    await waitForLocatorText({
      page,
      testId: "extension-context-kind",
      includes: [`Issue: local/${issueIdentifier}`],
      timeoutMs: 30_000,
    });

    const beforeSteerHistory = (await handle.getHistory()).length;
    await page.getByTestId("extension-input").fill(
      `Use piphony_get_issue_context for ${issueIdentifier}. If there is an active run, you must immediately call piphony_steer_run so the worker's final answer literally includes ${steerToken}. Then reply with 'STEER-SENT' and mention the run id you targeted.`,
    );
    await page.getByTestId("extension-send").click();

    await waitForAssistantMessage({
      handle,
      afterIndex: beforeSteerHistory,
      predicate: (message) => message.content.includes("STEER-SENT"),
      timeoutMs: 180_000,
    });

    const steeredRunId = await waitForCompletedRunToken(extensionRunId, steerToken);

    const beforeIssueHistory = (await handle.getHistory()).length;
    await page.getByTestId("extension-input").fill(
      `Use piphony_get_issue_context to confirm the exact issue identifier on this page. Start your answer with '${issueContextToken}' and include the identifier verbatim.`,
    );
    await page.getByTestId("extension-send").click();

    const issueReply = await waitForAssistantMessage({
      handle,
      afterIndex: beforeIssueHistory,
      predicate: (message) => message.content.includes(issueContextToken) && message.content.includes(issueIdentifier),
      timeoutMs: 180_000,
    });

    await waitForLocatorText({
      page,
      testId: "extension-messages",
      includes: [issueContextToken, issueIdentifier],
      timeoutMs: 30_000,
    });

    await page.locator("[data-testid='issue-inspector'] button").first().click();
    await waitForLocatorText({
      page,
      testId: "extension-context-kind",
      includes: ["Board: local"],
      timeoutMs: 30_000,
    });

    const beforePlanHistory = (await handle.getHistory()).length;
    await page.getByTestId("extension-input").fill(
      `Use piphony_get_board_overview and piphony_create_issue to create exactly one backlog follow-up ticket titled '${plannedTitle}'. After creating it, reply with 'PLANNED:' and include the exact title.`,
    );
    await page.getByTestId("extension-send").click();

    const planReply = await waitForAssistantMessage({
      handle,
      afterIndex: beforePlanHistory,
      predicate: (message) => message.content.includes("PLANNED:") && message.content.includes(plannedTitle),
      timeoutMs: 240_000,
    });

    await waitForBodyText({
      page,
      includes: plannedTitle,
      timeoutMs: 60_000,
    });

    await page.screenshot({ path: join(artifactsDir, "extension-web-smoke.png"), fullPage: true });

    console.log(JSON.stringify({
      ok: true,
      boardContext: true,
      issueContext: issueReply.content,
      plannedTitle,
      planReply: planReply.content,
      issueIdentifier,
      steeredRunId,
      screenshot: join(artifactsDir, "extension-web-smoke.png"),
    }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  stopPolling = true;
  await pollLoop;
  await attemptCleanup("smoke.extension_web.cos_server.close", () => cosServer.close());
  webServer.kill("SIGTERM");
}

process.exit(0);
