import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type BrowserContext, type Page } from "playwright";
import { repoRoot } from "./_common.js";

const execFileAsync = promisify(execFile);
const webUrl = "http://127.0.0.1:3333";
const cosHealthUrl = "http://127.0.0.1:6521/health";
const suffix = Date.now().toString().slice(-6);
const createdIdentifier = `LOCAL-${suffix}`;
const createdTitle = `True stack CoS smoke ${suffix}`;
const issueToken = "STACK-ISSUE:";
const plannedTitle = `Stack smoke follow-up ${suffix}`;
const planToken = "STACK-PLANNED:";
const extensionDir = join(repoRoot, "apps", "extension", "dist");

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
  const timeoutMs = input.timeoutMs ?? 240_000;
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

async function waitForExtensionMessageCount(page: Page, expected: number, timeoutMs = 60_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const count = await page.locator("[data-testid^='extension-message-']").count();
    if (count === expected) {
      return;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for extension message count: ${expected}`);
}

async function killExistingStack(): Promise<void> {
  await runShell("pkill -f 'tsx src/cli/dev-stack.ts'", 10_000).catch(() => undefined);
  await runShell("pkill -f 'vite --config apps/web/vite.config.ts'", 10_000).catch(() => undefined);
  await runShell("pkill -f 'tsx src/cli/orchestrator-watch.ts'", 10_000).catch(() => undefined);
}

function startDevStack() {
  return spawn("npm", ["run", "dev:stack"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
}

async function launchExtensionBrowser(): Promise<{ context: BrowserContext; userDataDir: string }> {
  const userDataDir = await mkdtemp(join(tmpdir(), "piphony-extension-browser-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });
  return { context, userDataDir };
}

await runShell("npm run build:extension", 300_000);
await killExistingStack();
const stack = startDevStack();

try {
  await waitForHttp(webUrl);
  await waitForHttp(cosHealthUrl);

  const { context, userDataDir } = await launchExtensionBrowser();
  try {
    const webPage = await context.newPage();
    await webPage.goto(webUrl, { waitUntil: "networkidle", timeout: 120_000 });
    let extensionId = "";
    for (let attempt = 0; attempt < 60 && extensionId === ""; attempt += 1) {
      extensionId = await webPage.locator("html").getAttribute("data-piphony-extension-id") ?? "";
      if (extensionId !== "") {
        break;
      }
      await sleep(1_000);
    }
    if (extensionId === "") {
      throw new Error("Failed to resolve extension id from content script");
    }

    await webPage.getByTestId("toggle-create-issue").click();
    await webPage.getByTestId("create-issue-identifier").fill(createdIdentifier);
    await webPage.getByTestId("create-issue-title").fill(createdTitle);
    await webPage.getByTestId("create-issue-description").fill("Create via the real stack smoke, transition to todo, let the implementation worker process it, then use the real browser extension surface in-context.");
    await webPage.getByTestId("submit-create-issue").click();

    await waitForLocatorText({
      page: webPage,
      testId: "board-column-backlog",
      includes: [createdIdentifier],
      timeoutMs: 30_000,
    });

    await webPage.getByTestId(`issue-card-${createdIdentifier}`).click();
    await webPage.waitForSelector("[data-testid='issue-inspector']", { timeout: 30_000 });
    await webPage.getByTestId("transition-to-todo").click();

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await extensionPage.waitForSelector("[data-testid='extension-panel']", { timeout: 30_000 });
    await waitForLocatorText({
      page: extensionPage,
      testId: "extension-context-kind",
      includes: [`Issue: local/${createdIdentifier}`],
      timeoutMs: 120_000,
    });

    await extensionPage.getByTestId("extension-input").fill(
      `Use the current issue page context tools. Start exactly with '${issueToken}' and include the exact issue identifier on this page.`,
    );
    await extensionPage.getByTestId("extension-send").click();
    await waitForLocatorText({
      page: extensionPage,
      testId: "extension-messages",
      includes: [issueToken, createdIdentifier],
      timeoutMs: 180_000,
    });
    await waitForExtensionMessageCount(extensionPage, 2, 60_000);

    await webPage.bringToFront();
    await waitForBodyText({
      page: webPage,
      includes: ["Plan", "Progress", "Review handoff"],
      timeoutMs: 240_000,
    });
    await waitForLocatorText({
      page: webPage,
      testId: "board-column-human_review",
      includes: [createdIdentifier],
      timeoutMs: 240_000,
    });

    await webPage.locator("[data-testid='issue-inspector'] button").first().click();
    await extensionPage.bringToFront();
    await waitForLocatorText({
      page: extensionPage,
      testId: "extension-context-kind",
      includes: ["Board: local"],
      timeoutMs: 60_000,
    });

    await extensionPage.getByTestId("extension-input").fill(
      `Use the board overview and create exactly one backlog follow-up ticket titled '${plannedTitle}'. Reply starting exactly with '${planToken}' and include the exact title.`,
    );
    await extensionPage.getByTestId("extension-send").click();
    await waitForLocatorText({
      page: extensionPage,
      testId: "extension-messages",
      includes: [planToken, plannedTitle],
      timeoutMs: 240_000,
    });
    await waitForExtensionMessageCount(extensionPage, 4, 60_000);
    await waitForBodyText({
      page: webPage,
      includes: [plannedTitle],
      timeoutMs: 60_000,
    });

    console.log(JSON.stringify({
      ok: true,
      stack: true,
      extensionId,
      issueIdentifier: createdIdentifier,
      plannedTitle,
      url: webUrl,
    }, null, 2));
  } finally {
    await context.close().catch(() => undefined);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
} finally {
  stack.kill("SIGTERM");
}
