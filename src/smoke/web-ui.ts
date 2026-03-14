import { execFile, spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { chromium, type Page } from "playwright";
import { attemptCleanup } from "../core/cleanup.js";
import { errorMessage } from "../core/errors.js";
import { Orchestrator, type RunWorker, type RunWorkerContext } from "../core/orchestrator.js";
import { ensureDir, resetDir } from "../core/utils.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { repoRoot, runsRootDir, trackerDir } from "./_common.js";

const execFileAsync = promisify(execFile);
const webUrl = "http://127.0.0.1:3333";
const artifactsDir = join(repoRoot, ".piphony", "artifacts", "web-ui-smoke");
const createdIdentifier = "LOCAL-450";
const createdTitle = "Pull-based workflow smoke";
const boardShot = join(artifactsDir, "board.png");
const runsShot = join(artifactsDir, "runs.png");

class WebUiSmokeWorker implements RunWorker {
  readonly name = "implementation";

  constructor(private readonly tracker: ReturnType<typeof createLocalTrackerAdapter>) {}

  async execute(context: RunWorkerContext) {
    await this.tracker.applyMutation(context.workItem.identifier, {
      type: "comment",
      author: "agent",
      body: "Plan\n\n- Picked up by the deterministic web smoke worker.",
    });
    await sleep(300);

    await this.tracker.applyMutation(context.workItem.identifier, {
      type: "transition",
      state: "in_progress",
    });
    await this.tracker.applyMutation(context.workItem.identifier, {
      type: "comment",
      author: "agent",
      body: "Progress\n\n- Implemented the smoke-path work item.",
    });
    await sleep(300);

    await this.tracker.applyMutation(context.workItem.identifier, {
      type: "comment",
      author: "agent",
      body: "Review handoff\n\n- Ready for human review.",
    });
    await this.tracker.applyMutation(context.workItem.identifier, {
      type: "transition",
      state: "human_review",
    });

    return {
      summary: `Issue ${context.workItem.identifier} has been processed`,
      output: `Handled ${context.workItem.identifier}`,
    };
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/\u001b\(B/g, "");
}

async function runShell(command: string, options?: { cwd?: string; timeoutMs?: number }): Promise<string> {
  const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
    cwd: options?.cwd ?? repoRoot,
    timeout: options?.timeoutMs ?? 120_000,
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

async function waitForLocatorText(input: {
  page: Page;
  testId: string;
  includes: string[];
  timeoutMs?: number;
}): Promise<string> {
  const timeoutMs = input.timeoutMs ?? 180_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = (await input.page.getByTestId(input.testId).textContent().catch(() => null)) ?? "";
    if (input.includes.every((needle) => text.includes(needle))) {
      return text;
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for locator text: ${input.testId}`);
}

async function waitForBodyText(input: {
  page: Page;
  includes: string[];
  timeoutMs?: number;
}): Promise<string> {
  const timeoutMs = input.timeoutMs ?? 180_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = (await input.page.locator("body").textContent().catch(() => null)) ?? "";
    if (input.includes.every((needle) => text.includes(needle))) {
      return text;
    }
    await sleep(1_500);
  }
  throw new Error(`Timed out waiting for body text: ${input.includes.join(", ")}`);
}

async function seedUiState(): Promise<void> {
  await resetDir(runsRootDir);
  await rm(trackerDir, { recursive: true, force: true });
  await ensureDir(trackerDir);
  await mkdir(artifactsDir, { recursive: true });
}

async function killExistingWebServer(): Promise<void> {
  await attemptCleanup("smoke.web_ui.kill_web_server", () => runShell("pkill -f 'vite --config apps/web/vite.config.ts' >/dev/null 2>&1 || [ $? -eq 1 ]", { timeoutMs: 10_000 }).then(() => undefined));
}

async function killExistingOrchestrator(): Promise<void> {
  await attemptCleanup("smoke.web_ui.kill_orchestrator", () => runShell("pkill -f 'tsx src/cli/orchestrator-watch.ts' >/dev/null 2>&1 || [ $? -eq 1 ]", { timeoutMs: 10_000 }).then(() => undefined));
}

function startWebServer() {
  return spawn("npm", ["run", "web:dev"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
}

await seedUiState();
await killExistingWebServer();
await killExistingOrchestrator();

const adapter = createLocalTrackerAdapter(trackerDir);
const orchestrator = new Orchestrator({
  tracker: adapter,
  worker: new WebUiSmokeWorker(adapter),
  runsRootDir,
  pollIntervalMs: 500,
  instanceId: "web-ui-smoke",
});

let stopPolling = false;
const pollLoop = (async () => {
  while (!stopPolling) {
    await orchestrator.pollOnce().catch((error) => {
      console.error("web_ui_smoke_orchestrator_error", errorMessage(error));
    });
    await sleep(1_000);
  }
})();

const server = startWebServer();

try {
  await waitForHttp(webUrl);

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(webUrl, { waitUntil: "networkidle", timeout: 120_000 });

    await page.getByTestId("toggle-create-issue").click();
    await page.getByTestId("create-issue-identifier").fill(createdIdentifier);
    await page.getByTestId("create-issue-title").fill(createdTitle);
    await page.getByTestId("create-issue-description").fill("Created from the browser smoke to prove the Symphony-style workflow: create issue, transition to Todo, let the orchestrator claim it, observe tracker comments, and finish in Human Review.");
    await page.getByTestId("submit-create-issue").click();

    await waitForLocatorText({
      page,
      testId: "board-column-backlog",
      includes: [createdIdentifier],
      timeoutMs: 30_000,
    });

    await page.getByTestId(`issue-card-${createdIdentifier}`).click();
    await page.waitForSelector("[data-testid='issue-inspector']", { timeout: 30_000 });
    await waitForLocatorText({
      page,
      testId: "issue-inspector",
      includes: [createdIdentifier],
      timeoutMs: 30_000,
    });

    await page.getByTestId("transition-to-todo").click();
    await waitForLocatorText({
      page,
      testId: "board-column-todo",
      includes: [createdIdentifier],
      timeoutMs: 30_000,
    });

    await page.screenshot({ path: boardShot, fullPage: true });

    await waitForBodyText({
      page,
      includes: ["Plan", "Progress", "Review handoff"],
      timeoutMs: 60_000,
    });

    await waitForLocatorText({
      page,
      testId: "board-column-human_review",
      includes: [createdIdentifier],
      timeoutMs: 60_000,
    });

    await page.locator("[data-testid='issue-inspector'] button").first().click();

    await page.getByRole("link", { name: /runs/i }).click();
    await page.waitForSelector("[data-testid='worker-status-panel']", { timeout: 30_000 });
    await waitForBodyText({
      page,
      includes: [createdIdentifier, `Issue ${createdIdentifier} has been processed`],
      timeoutMs: 60_000,
    });

    await page.screenshot({ path: runsShot, fullPage: true });

    const runCard = await page.locator('[data-testid^="run-card-"]').first().getAttribute("data-testid");

    console.log(JSON.stringify({ ok: true, url: webUrl, issue: createdIdentifier, runCard, screenshots: [boardShot, runsShot] }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  stopPolling = true;
  await pollLoop;
  server.kill("SIGTERM");
}
