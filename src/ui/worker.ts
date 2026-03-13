import { basename } from "node:path";
import type { ProviderCapacityService } from "../pi/provider-middleware.js";
import { createPiSessionController } from "../pi/runner.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import type { RunWorker, RunWorkerContext } from "../core/orchestrator.js";

export class LocalTrackerImplementationWorker implements RunWorker {
  readonly name = "implementation";

  constructor(
    private readonly repoRoot: string,
    private readonly trackerDir: string,
    private readonly providerCapacityService?: ProviderCapacityService,
  ) {}

  async execute(context: RunWorkerContext) {
    await context.logger.emit("ui.workflow.issue.started", {
      identifier: context.workItem.identifier,
      title: context.workItem.title,
      state: context.workItem.state,
    });
    await context.heartbeat?.({ phase: "ui_workflow_started", issue: context.workItem.identifier });

    const prompt = [
      `Handle issue ${context.workItem.identifier}: ${context.workItem.title}`,
      `This run was selected by the pull-based orchestrator from the local tracker.`,
      `Do not modify code or git state in this run. This is a tracker-driven workflow smoke for Piphony itself.`,
      `Use tracker tools for issue comments and transitions.`,
      `If the issue is currently in Todo or Rework, immediately transition it to in_progress before doing the rest of the work.`,
      `Inspect the repository enough to reference at least two relevant files or directories in your updates.`,
      `Required workflow:`,
      `1. Ensure the issue is in in_progress before active work if it started in todo or rework.`,
      `2. Append a tracker comment titled 'Plan' with 2-4 concise bullets tailored to this issue.`,
      `3. Inspect the repo enough to mention at least two relevant files or directories.`,
      `4. Append a tracker comment titled 'Progress' summarizing what you inspected and what should happen next.`,
      `5. Append a tracker comment titled 'Review handoff' that tells the human reviewer what is ready to check next.`,
      `6. Transition the issue to human_review.`,
      `7. Reply with exactly: Issue ${context.workItem.identifier} has been processed.`,
      context.workItem.description === undefined ? "" : `Issue description:\n${context.workItem.description}`,
    ].filter(Boolean).join("\n");

    const tracker = createLocalTrackerAdapter(this.trackerDir);
    const controller = await createPiSessionController({
      cwd: this.repoRoot,
      agentType: "implementation",
      tracker,
      workItem: context.workItem,
      modelPreference: "minimax/MiniMax-M2.5",
      thinkingLevel: "off",
      ...(this.providerCapacityService === undefined ? {} : { providerCapacityService: this.providerCapacityService }),
      requestClass: "background",
      sessionDir: joinPath(context.runArtifacts.runDir, "sessions"),
      onTrackerEvent: async (event) => {
        await context.logger.emit(event.event, event.details);
        await context.heartbeat?.({ lastTrackerEvent: event.event });
      },
    });

    context.activeRunRegistry?.attachControl(context.run.runId, controller);
    const initialSnapshot = controller.snapshot();
    await context.heartbeat?.({
      phase: "pi_session_ready",
      piSessionId: initialSnapshot.sessionId,
      ...(initialSnapshot.sessionFile === undefined ? {} : { piSessionFile: initialSnapshot.sessionFile }),
    });

    const unsubscribe = controller.subscribe(async (event) => {
      await context.logger.emit("pi.session.event", { type: event.type });
      if (event.type === "message_update") {
        return;
      }
      await context.heartbeat?.({
        lastPiEvent: event.type,
        ...(controller.snapshot().sessionFile === undefined ? {} : { piSessionFile: controller.snapshot().sessionFile }),
      });
    });

    try {
      const result = await controller.runPrompt(prompt);
      const finalSnapshot = controller.snapshot();
      await context.heartbeat?.({
        phase: "pi_session_completed",
        piSessionId: finalSnapshot.sessionId,
        ...(finalSnapshot.sessionFile === undefined ? {} : { piSessionFile: finalSnapshot.sessionFile }),
        piSessionFileName: finalSnapshot.sessionFile === undefined ? undefined : basename(finalSnapshot.sessionFile),
      });

      const output = result.output.trim();
      if (output === "") {
        throw new Error(`Implementation worker produced empty output for ${context.workItem.identifier}`);
      }

      const issue = await tracker.inspectIssue(context.workItem.identifier);
      const commentBodies = issue.comments.map((comment) => comment.body);
      const hasPlan = commentBodies.some((body) => body.includes("Plan"));
      const hasProgress = commentBodies.some((body) => body.includes("Progress"));
      const hasReviewHandoff = commentBodies.some((body) => body.includes("Review handoff"));
      if (issue.state !== "human_review" || !hasPlan || !hasProgress || !hasReviewHandoff) {
        throw new Error(`Implementation worker did not complete required tracker workflow for ${context.workItem.identifier}`);
      }

      return result.usedModel === undefined
        ? { summary: output, output }
        : { summary: output, output, metadata: { usedModel: result.usedModel } };
    } finally {
      unsubscribe();
      await controller.dispose();
    }
  }
}

function joinPath(left: string, right: string): string {
  return `${left.replace(/\/$/, "")}/${right.replace(/^\//, "")}`;
}
