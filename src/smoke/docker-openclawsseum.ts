import { join } from "node:path";
import { Orchestrator } from "../core/orchestrator.js";
import type { RunWorker, RunWorkerContext } from "../core/orchestrator.js";
import { runPiTask } from "../pi/runner.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { resetTrackerState } from "../tracker/local/harness.js";
import { createRuntimeProviderFromWorkflow, loadWorkflow } from "../workflow/index.js";
import { repoRoot, runsRootDir, trackerDir } from "./_common.js";

const openclawsseumRoot = join(repoRoot, "reference", "openclawsseum");
const workflowEntry = await loadWorkflow(openclawsseumRoot);

await resetTrackerState({ trackerDir });
const adapter = createLocalTrackerAdapter(trackerDir);
await adapter.store.createIssue({
  identifier: "LOCAL-601",
  title: "Docker openclawsseum smoke",
  state: "todo",
});

const runtimeProvider = createRuntimeProviderFromWorkflow(openclawsseumRoot, workflowEntry.workflow);

class DockerOpenclawsseumWorker implements RunWorker {
  readonly name = "implementation";

  async execute(context: RunWorkerContext) {
    if (context.runtimeProvider === undefined) {
      throw new Error("runtime provider required for docker smoke");
    }

    const result = await runPiTask({
      cwd: openclawsseumRoot,
      agentType: "implementation",
      tracker: adapter,
      workItem: context.workItem,
      runtimeProvider: context.runtimeProvider,
      prompt: [
        `Use bash to run these checks inside the runtime service:`,
        `1. pwd`,
        `2. ls apps`,
        `3. bash scripts/check-no-js.sh`,
        `4. curl -sf http://convex-backend:3210/version | head -c 120`,
        `Then append a tracker comment saying \"docker smoke ok\" and transition ${context.workItem.identifier} to human_review.`,
        `Finally reply with one short sentence.`,
      ].join("\n"),
      onTrackerEvent: async (event) => {
        await context.logger.emit(event.event, event.details);
      },
    });

    await context.logger.emit("validation.pi.complete", {
      usedModel: result.usedModel,
      endpoints: await context.runtimeProvider.getEndpoints(),
    });

    return result.usedModel === undefined
      ? { summary: result.output || "docker smoke complete", output: result.output }
      : {
          summary: result.output || "docker smoke complete",
          output: result.output,
          metadata: { usedModel: result.usedModel },
        };
  }
}

const orchestrator = new Orchestrator({
  tracker: adapter,
  worker: new DockerOpenclawsseumWorker(),
  runtimeProvider,
  workflow: workflowEntry.workflow,
  repoRoot: openclawsseumRoot,
  runsRootDir,
  agentType: "implementation",
});

const result = await orchestrator.runOnce();
const issue = await adapter.inspectIssue("LOCAL-601");
if (issue.state !== "human_review") {
  throw new Error(`Expected human_review, got ${issue.state}`);
}
if (!issue.comments.some((comment) => comment.body.includes("docker smoke ok"))) {
  throw new Error("Expected docker smoke comment");
}
const events = await result.logger.readEvents();
if (!events.some((event) => event.event === "workflow.phase.completed" && event.data?.phase === "prepare")) {
  throw new Error("Expected workflow prepare phase to complete");
}
if (!events.some((event) => event.event === "workflow.phase.completed" && event.data?.phase === "validate")) {
  throw new Error("Expected workflow validate phase to complete");
}
if (!events.some((event) => event.event === "tracker.transition")) {
  throw new Error("Expected tracker transition event");
}
console.log(JSON.stringify({ ok: true, runId: result.run.runId, issueState: issue.state, comments: issue.comments.length }, null, 2));
