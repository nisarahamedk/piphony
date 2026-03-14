import { Orchestrator } from "../core/orchestrator.js";
import type { RunWorker, RunWorkerContext } from "../core/orchestrator.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { resetTrackerState } from "../tracker/local/harness.js";
import { runPiTask } from "../pi/runner.js";
import { repoRoot, runsRootDir, trackerDir } from "./_common.js";

const adapter = createLocalTrackerAdapter(trackerDir);

class PiWorker implements RunWorker {
  readonly name = "implementation";

  async execute(context: RunWorkerContext) {
    const result = await runPiTask({
      cwd: repoRoot,
      agentType: "implementation",
      tracker: adapter,
      workItem: context.workItem,
      prompt: `Use tracker_get_issue on ${context.workItem.identifier}. If the issue is still in todo or rework, transition it to in_progress first. Then add a comment saying \"local smoke ok\". Then transition the issue to human_review. Finally reply with a one sentence summary.`,
      onTrackerEvent: async (event) => {
        await context.logger.emit(event.event, event.details);
      },
    });
    return result.usedModel === undefined
      ? { summary: result.output || "local e2e complete", output: result.output }
      : { summary: result.output || "local e2e complete", output: result.output, metadata: { usedModel: result.usedModel } };
  }
}

await resetTrackerState({ trackerDir });
await adapter.store.createIssue({ identifier: "LOCAL-301", title: "Local E2E smoke", state: "todo" });
const orchestrator = new Orchestrator({
  tracker: adapter,
  worker: new PiWorker(),
  runsRootDir,
  agentType: "implementation",
});
const result = await orchestrator.runOnce();
const issue = await adapter.inspectIssue("LOCAL-301");
if (issue.state !== "human_review") throw new Error(`Expected human_review, got ${issue.state}`);
if (!issue.comments.some((comment) => comment.body.includes("local smoke ok"))) throw new Error("Expected smoke comment to be appended");
console.log(JSON.stringify({ ok: true, runId: result.run.runId, issueState: issue.state, comments: issue.comments.length }, null, 2));
