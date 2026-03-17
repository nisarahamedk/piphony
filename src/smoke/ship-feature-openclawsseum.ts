import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Orchestrator } from "../core/orchestrator.js";
import type { RunWorker, RunWorkerContext } from "../core/orchestrator.js";
import { createOnboardedOpenclawsseumProject } from "../fixtures/project.js";
import { loadOnboardedProjectExecution, createProjectTracker } from "../project/execution.js";
import { runPiTask } from "../pi/runner.js";
import { resetTrackerState } from "../tracker/local/harness.js";

const execFileAsync = promisify(execFile);
const fixture = await createOnboardedOpenclawsseumProject();
const { runsRootDir, trackerDir } = fixture.paths;
const projectExecution = loadOnboardedProjectExecution(fixture.projectRoot);
const featureTitle = "Add real Terms and Privacy pages linked from the marketing footer";
const featureDescription = [
  "Implement real public-facing Terms and Privacy pages in the marketing site.",
  "Acceptance criteria:",
  "- Footer Terms and Privacy items become real links.",
  "- /terms route exists with meaningful Openclawsseum-specific terms content.",
  "- /privacy route exists with meaningful Openclawsseum-specific privacy content.",
  "- Pages use the existing marketing shell and match current content style.",
  "- Validate directly with route checks for /terms and /privacy.",
  "- Create or update a draft PR on GitHub for this branch.",
].join("\n");

await resetTrackerState({ trackerDir });
const tracker = createProjectTracker({ context: projectExecution, trackerDir, env: process.env });

// Create the issue and capture the actual created identity
const createdWorkItem = await tracker.createIssue({
  title: featureTitle,
  description: featureDescription,
  state: "todo",
  labels: ["feature", "shipping-smoke"],
});

// Use the actual created identifier for later lookup
const issueIdentifier = createdWorkItem.identifier;

async function runShell(command: string, options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }): Promise<string> {
  const { stdout } = await execFileAsync("bash", ["-lc", command], {
    cwd: options?.cwd,
    timeout: options?.timeoutMs ?? 20 * 60_000,
    maxBuffer: 20 * 1024 * 1024,
    env: options?.env === undefined ? process.env : { ...process.env, ...options.env },
  });
  return stdout.toString();
}

class FeatureShippingWorker implements RunWorker {
  readonly name = "implementation";

  async execute(context: RunWorkerContext) {
    if (context.executionTarget === undefined) {
      throw new Error("execution target required");
    }
    const prompt = [
      `Finish issue ${context.workItem.identifier}: ${context.workItem.title}`,
      `There is already partial work in the repo. Continue from the current working tree instead of starting over.`,
      `Use github_cli right away to create or reuse branch ${context.workItem.identifier} from the current working tree.`,
      `Use github_cli (not bash) for git/gh housekeeping: branch, status, commit, push, and draft PR create/update.`,
      `For github_cli, set driver='git' or driver='gh' and pass only the remaining arguments in args.`,
      `Use bash only for code edits and sanity checks in the declared execution target.`,
      `Complete this feature: footer Terms/Privacy links + real /terms and /privacy pages using the marketing shell.`,
      `Validate in the execution target with curl -sf http://web:3010/terms and curl -sf http://web:3010/privacy.`,
      `If the issue is still in todo or rework, transition it to in_progress before the final handoff.`,
      `Then append a tracker comment with the PR URL and transition the issue to human_review.`,
      `Reply with the PR URL and one sentence about what shipped.`,
    ].join("\n");

    const result = await runPiTask({
      cwd: fixture.projectRoot,
      agentType: "implementation",
      tracker,
      workItem: context.workItem,
      executionTarget: context.executionTarget,
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

    await runShell("curl -sf http://127.0.0.1:3010/terms >/dev/null", { cwd: fixture.projectRoot, timeoutMs: 120_000 });
    await runShell("curl -sf http://127.0.0.1:3010/privacy >/dev/null", { cwd: fixture.projectRoot, timeoutMs: 120_000 });

    return result.usedModel === undefined
      ? { summary: result.output || "feature shipped", output: result.output }
      : { summary: result.output || "feature shipped", output: result.output, metadata: { usedModel: result.usedModel } };
  }
}

const orchestrator = new Orchestrator({
  tracker,
  worker: new FeatureShippingWorker(),
  projectExecution,
  runsRootDir,
  agentType: "implementation",
});

try {
  const result = await orchestrator.runOnce();
  
  // Fetch the actual work item that was created and verify meaningful completion
  const completedIssue = await tracker.fetchWorkItemByIdentifier(issueIdentifier);
  
  // Assert the real completion state instead of reporting success on unrelated lookup
  if (completedIssue === undefined) {
    throw new Error(`Created issue ${issueIdentifier} not found after completion`);
  }
  
  // Verify meaningful completion: issue should be in human_review state with PR evidence
  if (completedIssue.state !== "human_review") {
    throw new Error(
      `Issue ${issueIdentifier} not in expected completion state 'human_review', got '${completedIssue.state}'. ` +
      `Meaningful completion requires the issue to be transitioned to human_review after PR creation.`
    );
  }
  
  // Verify a draft PR was actually created on GitHub for this branch
  if (completedIssue.prUrl === undefined || completedIssue.prUrl.trim() === "") {
    throw new Error(
      `Issue ${issueIdentifier} is in human_review but has no PR URL. ` +
      `Meaningful completion requires a draft PR to exist on GitHub.`
    );
  }

  // Verify the PR actually exists on GitHub and is a draft (not yet merged/closed)
  // Parse the PR URL to extract owner/repo and PR number
  const prUrlMatch = completedIssue.prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
  if (prUrlMatch === null) {
    throw new Error(
      `Issue ${issueIdentifier} has invalid PR URL '${completedIssue.prUrl}'. ` +
      `Expected GitHub pull request URL format.`
    );
  }
  const [, _owner, _repo, prNumber] = prUrlMatch;

  // Use gh CLI to verify the PR exists and is in draft state
  let ghPrView: string;
  try {
    ghPrView = await runShell(`gh pr view ${prNumber} --json state,disposition,isDraft,mergeStateStatus`, {
      cwd: fixture.projectRoot,
      timeoutMs: 30_000,
    });
  } catch (ghError) {
    throw new Error(
      `Issue ${issueIdentifier} PR URL '${completedIssue.prUrl}' points to non-existent or inaccessible PR. ` +
      `gh pr view failed: ${ghError}`
    );
  }

  // Parse the gh pr view JSON output to verify draft state
  interface GhPrViewOutput {
    isDraft?: boolean;
    state?: string;
    disposition?: string;
  }
  let prInfo: GhPrViewOutput;
  try {
    prInfo = JSON.parse(ghPrView);
  } catch {
    throw new Error(
      `Failed to parse gh pr view output for PR #${prNumber}: ${ghPrView}`
    );
  }

  // Verify the PR is still open and is a draft
  if (prInfo.state !== "OPEN") {
    throw new Error(
      `Issue ${issueIdentifier} PR #${prNumber} is not OPEN (state: '${prInfo.state}'). ` +
      `Meaningful completion requires an open draft PR.`
    );
  }
  if (prInfo.isDraft !== true) {
    throw new Error(
      `Issue ${issueIdentifier} PR #${prNumber} is not a draft PR. ` +
      `Meaningful completion requires a draft PR.`
    );
  }

  // The result.summary should contain evidence of successful completion (PR URL)
  const resultSummary = result.result?.summary;
  if (resultSummary === undefined || resultSummary.trim() === "") {
    throw new Error(`Run completed but summary is empty - PR evidence may be missing`);
  }
  
  console.log(JSON.stringify({ 
    ok: true, 
    runId: result.run.runId, 
    issueIdentifier: completedIssue.identifier,
    issueState: completedIssue.state,
    prUrl: completedIssue.prUrl,
    summary: resultSummary,
  }, null, 2));
} finally {
  await fixture.cleanup();
}
