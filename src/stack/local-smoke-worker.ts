import { setTimeout as sleep } from "node:timers/promises";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import type { RunWorker, RunWorkerContext } from "../core/orchestrator.js";

export class LocalTrackerSmokeWorker implements RunWorker {
  readonly name = "implementation";

  constructor(private readonly trackerDir: string) {}

  async execute(context: RunWorkerContext) {
    await context.logger.emit("ui.workflow.issue.started", {
      identifier: context.workItem.identifier,
      title: context.workItem.title,
      state: context.workItem.state,
      workflowMode: "smoke",
    });
    await context.heartbeat?.({
      phase: "ui_workflow_started",
      issue: context.workItem.identifier,
      workflowMode: "smoke",
    });

    const tracker = createLocalTrackerAdapter(this.trackerDir);

    if (context.workItem.state === "todo" || context.workItem.state === "rework") {
      await tracker.applyMutation(context.workItem.identifier, { type: "transition", state: "in_progress" });
      await context.heartbeat?.({ phase: "issue_in_progress", issue: context.workItem.identifier });
    }

    await tracker.appendComment(context.workItem.identifier, {
      author: "smoke-worker",
      body: [
        "Plan",
        "",
        "- Inspect the local tracker workflow end-to-end.",
        "- Confirm the board and extension surfaces can observe canonical run state.",
        "- Prepare a deterministic review handoff.",
      ].join("\n"),
    });
    await context.logger.emit("tracker.comment", { issueIdentifier: context.workItem.identifier, stage: "plan" });
    await sleep(200);

    await tracker.appendComment(context.workItem.identifier, {
      author: "smoke-worker",
      body: [
        "Progress",
        "",
        "- Inspected apps/web/src/features/dashboard and apps/extension/src for the active smoke path.",
        "- Confirmed the deterministic smoke worker can update tracker state without external Pi auth.",
        "- Next step is handing off the issue for review in the UI.",
      ].join("\n"),
    });
    await context.logger.emit("tracker.comment", { issueIdentifier: context.workItem.identifier, stage: "progress" });
    await sleep(200);

    await tracker.appendComment(context.workItem.identifier, {
      author: "smoke-worker",
      body: [
        "Review handoff",
        "",
        "- Review the board column move to Human Review.",
        "- Check the recent runs view for the completed smoke run summary.",
        "- Verify the extension can reference this issue and create a follow-up ticket.",
      ].join("\n"),
    });
    await context.logger.emit("tracker.comment", { issueIdentifier: context.workItem.identifier, stage: "review_handoff" });

    await tracker.applyMutation(context.workItem.identifier, { type: "transition", state: "human_review" });
    await context.heartbeat?.({ phase: "issue_human_review", issue: context.workItem.identifier });

    return {
      summary: `Issue ${context.workItem.identifier} has been processed`,
      output: `Issue ${context.workItem.identifier} has been processed`,
    };
  }
}
