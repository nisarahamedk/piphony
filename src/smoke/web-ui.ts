import { execFile, spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ensureDir, resetDir } from "../core/utils.js";
import { repoRoot, runsRootDir, trackerDir } from "./_common.js";

const execFileAsync = promisify(execFile);
const webUrl = "http://127.0.0.1:3333";
const artifactsDir = join(repoRoot, ".piphony", "artifacts", "web-ui-smoke");

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/\u001b\(B/g, "");
}

function normalizeBrowserValue(raw: string): string {
  const trimmed = stripAnsi(raw).trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "string" ? parsed : trimmed;
  } catch {
    return trimmed;
  }
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
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`service_not_ready:${url}`);
}

async function seedUiState(): Promise<void> {
  await resetDir(runsRootDir);
  await rm(trackerDir, { recursive: true, force: true });
  await ensureDir(trackerDir);
  await mkdir(artifactsDir, { recursive: true });
}

async function killExistingWebServer(): Promise<void> {
  await runShell("pkill -f 'vite --config apps/web/vite.config.ts'", { timeoutMs: 10_000 }).catch(() => undefined);
}

function startWebServer() {
  return spawn("npm", ["run", "web:dev"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
}

function startOrchestratorWatch() {
  return spawn("npm", ["run", "orchestrator:watch"], {
    cwd: repoRoot,
    env: { ...process.env, PIPHONY_POLL_INTERVAL_MS: "2000" },
    stdio: "inherit",
  });
}

async function runAgentBrowser(session: string, args: string[], timeoutMs = 120_000): Promise<string> {
  const { stdout, stderr } = await execFileAsync("agent-browser", ["--session", session, ...args], {
    cwd: repoRoot,
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stripAnsi([stdout.toString(), stderr.toString()].filter(Boolean).join("\n").trim());
}

async function browserEval(session: string, expression: string, timeoutMs = 120_000): Promise<string> {
  return runAgentBrowser(session, ["eval", expression], timeoutMs);
}

async function waitForBrowserCondition(input: {
  session: string;
  expression: string;
  expected: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<string> {
  const timeoutMs = input.timeoutMs ?? 180_000;
  const intervalMs = input.intervalMs ?? 2_500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = normalizeBrowserValue(await browserEval(input.session, input.expression));
    if (value === input.expected) {
      return value;
    }
    await runAgentBrowser(input.session, ["wait", String(intervalMs)]);
  }

  throw new Error(`Timed out waiting for browser condition: ${input.expression}`);
}

await seedUiState();
await killExistingWebServer();

const session = `piphony-web-smoke-${Date.now()}`;
const createdIdentifier = "LOCAL-450";
const createdTitle = "UI driven workflow smoke";
const boardShot = join(artifactsDir, "board.png");
const runsShot = join(artifactsDir, "runs.png");
const orchestrator = startOrchestratorWatch();
const server = startWebServer();

try {
  await waitForHttp(webUrl);
  await runAgentBrowser(session, ["open", webUrl]);
  await runAgentBrowser(session, ["wait", "4500"]);

  await browserEval(session, `document.querySelector(\"[data-testid='toggle-create-issue']\")?.click(); 'opened'`);
  await runAgentBrowser(session, ["wait", "600"]);

  const formSet = await browserEval(
    session,
    `const setValue=(selector,value)=>{const el=document.querySelector(selector); if(!el) return false; const prototype=el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const descriptor=Object.getOwnPropertyDescriptor(prototype,'value'); descriptor?.set?.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;}; JSON.stringify({identifier:setValue(\"[data-testid='create-issue-identifier']\",'${createdIdentifier}'), title:setValue(\"[data-testid='create-issue-title']\",'${createdTitle}'), description:setValue(\"[data-testid='create-issue-description']\",'Created from the browser smoke to prove the full UI-driven workflow: create issue, start run, watch comments, and finish in agent review.')})`,
  );
  if (!normalizeBrowserValue(formSet).includes("true")) {
    throw new Error(`Expected create issue form fields to update, got: ${formSet}`);
  }

  await browserEval(session, `document.querySelector(\"[data-testid='submit-create-issue']\")?.click(); 'submitted'`);

  await waitForBrowserCondition({
    session,
    expression: `document.body.textContent?.includes('${createdIdentifier}') ? 'yes' : 'no'`,
    expected: "yes",
    timeoutMs: 30_000,
    intervalMs: 1_500,
  });

  await browserEval(session, `document.querySelector(\"[data-testid='issue-card-${createdIdentifier}']\")?.click(); 'clicked'`);
  await runAgentBrowser(session, ["wait", "1200"]);
  await runAgentBrowser(session, ["screenshot", boardShot]);

  const inspectorState = normalizeBrowserValue(
    await browserEval(session, `document.querySelector(\"[data-testid='issue-inspector']\")?.textContent || ''`),
  );
  if (!inspectorState.includes(createdIdentifier) || !inspectorState.includes("Tracker workflow")) {
    throw new Error(`Expected issue inspector to show tracker workflow guidance, got: ${inspectorState}`);
  }

  await waitForBrowserCondition({
    session,
    expression: `document.body.textContent?.includes('Plan') && document.body.textContent?.includes('Progress') && document.body.textContent?.includes('Review handoff') ? 'yes' : 'no'`,
    expected: "yes",
    timeoutMs: 180_000,
    intervalMs: 4_000,
  });

  await waitForBrowserCondition({
    session,
    expression: `Array.from(document.querySelectorAll('select')).some((el)=>el.value === 'agent_review') ? 'yes' : 'no'`,
    expected: "yes",
    timeoutMs: 180_000,
    intervalMs: 4_000,
  });

  await browserEval(session, `Array.from(document.querySelectorAll('a')).find((el)=>el.textContent?.includes('Runs'))?.click(); 'runs'`);

  await waitForBrowserCondition({
    session,
    expression: `document.body.textContent?.includes('${createdIdentifier}') ? 'yes' : 'no'`,
    expected: "yes",
    timeoutMs: 60_000,
    intervalMs: 2_000,
  });

  await waitForBrowserCondition({
    session,
    expression: `document.body.textContent?.includes('Issue ${createdIdentifier} has been processed') ? 'yes' : 'no'`,
    expected: "yes",
    timeoutMs: 180_000,
    intervalMs: 4_000,
  });

  await runAgentBrowser(session, ["screenshot", runsShot]);

  const runCard = normalizeBrowserValue(
    await browserEval(
      session,
      `Array.from(document.querySelectorAll('[data-testid^="run-card-"]')).map((el)=>el.getAttribute('data-testid') || '').find(Boolean) || ''`,
    ),
  );

  console.log(JSON.stringify({ ok: true, url: webUrl, issue: createdIdentifier, runCard, screenshots: [boardShot, runsShot] }, null, 2));
} finally {
  await runAgentBrowser(session, ["close"]).catch(() => undefined);
  server.kill("SIGTERM");
  orchestrator.kill("SIGTERM");
}
