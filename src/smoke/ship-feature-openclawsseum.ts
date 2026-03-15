import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Orchestrator } from "../core/orchestrator.js";
import type { RunWorker, RunWorkerContext } from "../core/orchestrator.js";
import { runPiTask } from "../pi/runner.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { resetTrackerState } from "../tracker/local/harness.js";
import { createRuntimeProviderFromWorkflow, loadWorkflow } from "../workflow/index.js";
import { createOnboardedOpenclawsseumProject } from "./fixture-project.js";

const execFileAsync = promisify(execFile);
const fixture = await createOnboardedOpenclawsseumProject();
const { runsRootDir, trackerDir } = fixture.paths;
const workflowEntry = await loadWorkflow(fixture.projectRoot);
const webUrl = "http://127.0.0.1:3010";
const issueIdentifier = `PIPHONY-${Date.now()}`;
const featureTitle = "Add real Terms and Privacy pages linked from the marketing footer";
const featureDescription = [
  "Implement real public-facing Terms and Privacy pages in the marketing site.",
  "Acceptance criteria:",
  "- Footer Terms and Privacy items become real links.",
  "- /terms route exists with meaningful Openclawsseum-specific terms content.",
  "- /privacy route exists with meaningful Openclawsseum-specific privacy content.",
  "- Pages use the existing marketing shell and match current content style.",
  "- Validate with the repo-owned piphony workflow plus direct route checks for /terms and /privacy.",
  "- Create or update a draft PR on GitHub for this branch.",
].join("\n");

async function runShell(command: string, options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }): Promise<string> {
  const { stdout } = await execFileAsync("bash", ["-lc", command], {
    cwd: options?.cwd,
    timeout: options?.timeoutMs ?? 20 * 60_000,
    maxBuffer: 20 * 1024 * 1024,
    env: options?.env === undefined ? process.env : { ...process.env, ...options.env },
  });
  return stdout.toString();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/\u001b\(B/g, "");
}

await resetTrackerState({ trackerDir });
const adapter = createLocalTrackerAdapter(trackerDir);
const issue = await adapter.store.createIssue({
  identifier: issueIdentifier,
  title: featureTitle,
  description: featureDescription,
  state: "todo",
  labels: ["feature", "shipping-smoke"],
});

const runtimeProvider = createRuntimeProviderFromWorkflow(fixture.projectRoot, workflowEntry.workflow);

class FeatureShippingWorker implements RunWorker {
  readonly name = "implementation";

  async execute(context: RunWorkerContext) {
    if (context.runtimeProvider === undefined) {
      throw new Error("runtime provider required");
    }
    const prompt = [
      `Finish issue ${context.workItem.identifier}: ${context.workItem.title}`,
      `There is already partial work in the repo. Continue from the current working tree instead of starting over.`,
      `Use github_cli right away to create or reuse branch ${context.workItem.identifier} from the current working tree.`,
      `Use github_cli (not bash) for git/gh housekeeping: branch, status, commit, push, and draft PR create/update.`,
      `For github_cli, set driver='git' or driver='gh' and pass only the remaining arguments in args.`,
      `Use bash only for runtime code edits and runtime sanity checks in the target environment.`,
      `Complete this feature: footer Terms/Privacy links + real /terms and /privacy pages using the marketing shell.`,
      `Likely files: apps/web/src/features/marketing/marketing-shell.tsx and apps/web/src/routes plus apps/web/src/features/marketing pages.`,
      `Validate in runtime with curl -sf http://web:3010/terms and curl -sf http://web:3010/privacy.`,
      `Then use github_cli to commit, push, and open/update a draft PR.`,
      `If the issue is still in todo or rework, transition it to in_progress before the final handoff.`,
      `Then append a tracker comment with the PR URL and transition the issue to human_review.`,
      `Reply with the PR URL and one sentence about what shipped.`,
    ].join("\n");

    const result = await runPiTask({
      cwd: fixture.projectRoot,
      agentType: "implementation",
      tracker: adapter,
      workItem: context.workItem,
      runtimeProvider: context.runtimeProvider,
      githubCliCwd: fixture.projectRoot,
      modelPreference: "minimax/MiniMax-M2.5",
      thinkingLevel: "off",
      prompt,
      onTrackerEvent: async (event) => {
        await context.logger.emit(event.event, event.details);
      },
      onGitHubEvent: async (event) => {
        await context.logger.emit(event.event, event.details);
      },
    });

    await context.logger.emit("validation.routes.start", { terms: `${webUrl}/terms`, privacy: `${webUrl}/privacy` });
    const termsHtml = await runShell(`curl -sf ${shellQuote(`${webUrl}/terms`)}`, {
      cwd: fixture.projectRoot,
      timeoutMs: 120_000,
    });
    const privacyHtml = await runShell(`curl -sf ${shellQuote(`${webUrl}/privacy`)}`, {
      cwd: fixture.projectRoot,
      timeoutMs: 120_000,
    });
    if (!termsHtml.toLowerCase().includes("terms")) {
      throw new Error("Expected /terms page to render meaningful content");
    }
    if (!privacyHtml.toLowerCase().includes("privacy")) {
      throw new Error("Expected /privacy page to render meaningful content");
    }
    await context.logger.emit("validation.routes.complete", { ok: true });

    return result.usedModel === undefined
      ? { summary: result.output || "feature shipped", output: result.output }
      : { summary: result.output || "feature shipped", output: result.output, metadata: { usedModel: result.usedModel } };
  }
}

const orchestrator = new Orchestrator({
  tracker: adapter,
  worker: new FeatureShippingWorker(),
  runtimeProvider,
  workflow: workflowEntry.workflow,
  repoRoot: fixture.projectRoot,
  runsRootDir,
  agentType: "implementation",
});

try {
  const result = await orchestrator.runOnce();
  const finalIssue = await adapter.inspectIssue(issue.id);
  if (finalIssue.state !== "human_review") {
    throw new Error(`Expected issue to reach human_review, got ${finalIssue.state}`);
  }
  const events = await result.logger.readEvents();
  if (!events.some((event) => event.event === "workflow.phase.completed" && event.data?.phase === "prepare")) {
    throw new Error("Expected workflow prepare phase to complete");
  }
  if (!events.some((event) => event.event === "workflow.phase.completed" && event.data?.phase === "validate")) {
    throw new Error("Expected workflow validate phase to complete");
  }
  const prListRaw = await runShell(`gh pr list --head ${shellQuote(issueIdentifier)} --state open --json number,url,isDraft,title`, {
    cwd: fixture.projectRoot,
    timeoutMs: 120_000,
    env: { GH_FORCE_TTY: "0", CLICOLOR: "0", NO_COLOR: "1" },
  });
  const prs = JSON.parse(stripAnsi(prListRaw)) as Array<{ number: number; url: string; isDraft: boolean; title: string }>;
  if (prs.length === 0) {
    throw new Error(`No open PR found for branch ${issueIdentifier}`);
  }
  const pr = prs[0]!;
  if (!pr.isDraft) {
    throw new Error(`Expected PR to be draft, got non-draft PR: ${pr.url}`);
  }
  console.log(JSON.stringify({ ok: true, issue: issueIdentifier, pr }, null, 2));
  console.log(`OPEN_PR_URL=${pr.url}`);
  console.log(`OPEN_PR_NUMBER=${pr.number}`);
} finally {
  await fixture.cleanup();
}
