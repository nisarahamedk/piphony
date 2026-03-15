import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type BrowserContext, type Page } from "playwright";
import { attemptCleanup } from "../core/cleanup.js";
import { createOnboardedOpenclawsseumProject, pickAvailablePort } from "./fixture-project.js";
import { repoRoot } from "./_common.js";
import { runSmokeShell, startSmokeDevStack, stopSmokeProcess, waitForHttp } from "./harness.js";
const suffix = Date.now().toString().slice(-6);
const createdIdentifier = `LOCAL-${suffix}`;
const createdTitle = `True stack CoS smoke ${suffix}`;
const cosUserKeyValue = `stack-smoke-${suffix}`;
const cosUserKey = ["user", cosUserKeyValue];
const issueToken = "STACK-ISSUE:";
const plannedTitle = `Stack smoke follow-up ${suffix}`;
const planToken = "STACK-PLANNED:";
const extensionDir = join(repoRoot, "apps", "extension", "dist");

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

async function waitForExtensionReply(input: {
  page: Page;
  includes: string[];
  expectedMessageCount: number;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = input.timeoutMs ?? 240_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const [rawMessages, rawStatus, count] = await Promise.all([
      input.page.getByTestId("extension-messages").textContent().catch(() => null),
      input.page.getByTestId("extension-status").textContent().catch(() => null),
      input.page.locator("[data-testid^='extension-message-']").count(),
    ]);
    const messages = rawMessages ?? "";
    const status = rawStatus ?? "";
    if (input.includes.every((needle) => messages.includes(needle)) && count === input.expectedMessageCount) {
      return;
    }
    if (/(usage limit|rate limit|under heavy load|temporarily unavailable|capacity)/i.test(status)) {
      throw new Error(`Extension assistant blocked: ${status}`);
    }
    if (/^error:/i.test(status.trim())) {
      throw new Error(`Extension assistant failed: ${status}`);
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for extension reply: ${input.includes.join(", ")}`);
}

async function configureExtensionRuntime(page: Page, input: { endpoint: string; userKeyValue: string }): Promise<void> {
  await page.evaluate(async ({ endpoint, userKeyValue }) => {
    await chrome.storage.local.set({
      "piphony.cosEndpoint": endpoint,
      "piphony.cosUserKey": userKeyValue,
    });
  }, input);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("[data-testid='extension-panel']", { timeout: 30_000 });
}

async function launchExtensionBrowser(): Promise<{ context: BrowserContext; userDataDir: string; extensionId: string }> {
  const userDataDir = await mkdtemp(join(tmpdir(), "piphony-extension-browser-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });
  const extensionId = await resolveExtensionId(context);
  return { context, userDataDir, extensionId };
}

async function resolveExtensionId(context: BrowserContext): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    for (const worker of context.serviceWorkers()) {
      const match = worker.url().match(/^chrome-extension:\/\/([^/]+)\//);
      if (match?.[1]) {
        return match[1];
      }
    }
    await sleep(1_000);
  }
  throw new Error("Failed to resolve extension id from browser service workers");
}

await runSmokeShell("npm run build:extension", { timeoutMs: 300_000 });
const fixture = await createOnboardedOpenclawsseumProject();
const webPort = await pickAvailablePort();
const cosPort = await pickAvailablePort();
const webUrl = `http://127.0.0.1:${webPort}`;
const cosEndpoint = `http://127.0.0.1:${cosPort}/api/rivet`;
const cosHealthUrl = `http://127.0.0.1:${cosPort}/health`;
const stack = startSmokeDevStack({ projectRoot: fixture.projectRoot, webPort, cosPort });

try {
  await waitForHttp(webUrl);
  await waitForHttp(cosHealthUrl);

  const { context, userDataDir, extensionId } = await launchExtensionBrowser();
  try {
    const webPage = await context.newPage();
    await webPage.goto(webUrl, { waitUntil: "networkidle", timeout: 120_000 });

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
    await webPage.waitForURL(new RegExp(`[?&]issue=${createdIdentifier}$|[?&]issue=${createdIdentifier}[&#]`), { timeout: 30_000 });
    await webPage.getByTestId("transition-to-todo").click();

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await extensionPage.waitForSelector("[data-testid='extension-panel']", { timeout: 30_000 });
    await configureExtensionRuntime(extensionPage, { endpoint: cosEndpoint, userKeyValue: cosUserKeyValue });
    await waitForLocatorText({
      page: extensionPage,
      testId: "extension-context-kind",
      includes: [`Issue: local/${createdIdentifier}`],
      timeoutMs: 120_000,
    });
    await waitForLocatorText({
      page: extensionPage,
      testId: "extension-status",
      includes: ["idle"],
      timeoutMs: 60_000,
    });

    await extensionPage.getByTestId("extension-input").fill(
      `Use the current issue page context tools. Start exactly with '${issueToken}' and include the exact issue identifier on this page.`,
    );
    await extensionPage.getByTestId("extension-send").click();
    await waitForExtensionReply({
      page: extensionPage,
      includes: [issueToken, createdIdentifier],
      expectedMessageCount: 2,
      timeoutMs: 240_000,
    });

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
    await webPage.waitForURL((url) => !url.searchParams.has("issue") && !url.searchParams.has("issueId"), { timeout: 30_000 });
    await extensionPage.bringToFront();
    await waitForLocatorText({
      page: extensionPage,
      testId: "extension-context-kind",
      includes: ["Board: local"],
      timeoutMs: 60_000,
    });
    await waitForLocatorText({
      page: extensionPage,
      testId: "extension-status",
      includes: ["idle"],
      timeoutMs: 60_000,
    });

    await extensionPage.getByTestId("extension-input").fill(
      `Use the board overview and create exactly one backlog follow-up ticket titled '${plannedTitle}'. Reply starting exactly with '${planToken}' and include the exact title.`,
    );
    await extensionPage.getByTestId("extension-send").click();
    await waitForExtensionReply({
      page: extensionPage,
      includes: [planToken, plannedTitle],
      expectedMessageCount: 4,
      timeoutMs: 240_000,
    });
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
    await attemptCleanup("smoke.stack_ui.browser.close", () => context.close());
    await attemptCleanup("smoke.stack_ui.user_data_dir.remove", () => rm(userDataDir, { recursive: true, force: true }));
  }
} finally {
  await attemptCleanup("smoke.stack_ui.stack.stop", () => stopSmokeProcess(stack));
  await attemptCleanup("smoke.stack_ui.fixture.cleanup", () => fixture.cleanup());
}
