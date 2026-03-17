import { join } from "node:path";
import type { ProviderCapacityService } from "../pi/provider-middleware.js";
import { createPiSessionController } from "../pi/runner.js";
import type { RunWorker, RunWorkerContext } from "../core/orchestrator.js";
import type { TrackerAdapter } from "../core/types.js";

export class LocalTrackerImplementationWorker implements RunWorker {
  readonly name = "implementation";

  constructor(
    private readonly repoRoot: string,
    private readonly tracker: TrackerAdapter,
    private readonly providerCapacityService?: ProviderCapacityService,
  ) {}

  async execute(context: RunWorkerContext) {
    await context.logger.emit("ui.workflow.issue.started", {
      identifier: context.workItem.identifier,
      title: context.workItem.title,
      state: context.workItem.state,
      workflowMode: "implementation",
    });
    await context.heartbeat?.({
      phase: "ui_workflow_started",
      issue: context.workItem.identifier,
      workflowMode: "implementation",
    });

    const controller = await createPiSessionController({
      cwd: this.repoRoot,
      agentType: "implementation",
      tracker: this.tracker,
      workItem: context.workItem,
      ...(context.executionTarget === undefined ? {} : { executionTarget: context.executionTarget }),
      ...(this.providerCapacityService === undefined ? {} : { providerCapacityService: this.providerCapacityService }),
      sessionDir: join(context.runArtifacts.runDir, "sessions"),
      onTrackerEvent: async (event) => {
        await context.logger.emit(event.event, event.details);
        await context.heartbeat?.({ phase: event.event, issue: context.workItem.identifier, ...(event.details ?? {}) });
      },
    });

    context.activeRunRegistry?.attachControl(context.run.runId, controller);

    try {
      const result = await controller.runPrompt(buildImplementationPrompt(context.workItem.identifier));
      return result.usedModel === undefined
        ? { summary: summarizeOutput(result.output, context.workItem.identifier), output: result.output }
        : {
            summary: summarizeOutput(result.output, context.workItem.identifier),
            output: result.output,
            metadata: { usedModel: result.usedModel },
          };
    } finally {
      await controller.dispose();
    }
  }
}

function buildImplementationPrompt(issueIdentifier: string): string {
  return [
    `You are implementing tracker issue ${issueIdentifier} in the current repository.`,
    `First call tracker_get_issue for ${issueIdentifier} and use the issue title/description as the source of truth.`,
    "If the issue is currently in todo or rework, transition it to in_progress before starting implementation.",
    "Inspect the repository, make the necessary code changes in the current working tree, and run the most relevant validation commands for the work you performed.",
    "If the issue description explicitly says this is a smoke/verification-only task or that no product code changes are required, do not wander the repo. Instead, do the minimal declared verification, add the required tracker comments, and hand off cleanly.",
    "Use concise tracker comments with exactly these headings as work progresses: Plan, Progress, Review handoff.",
    "The Plan comment should summarize the concrete implementation approach.",
    "The Progress comment should summarize the key code changes and validation you ran.",
    "The Review handoff comment should summarize what changed, what validation passed, and any reviewer follow-up.",
    "When the implementation and validation are complete, transition the issue to human_review.",
    `Reply with one concise sentence starting exactly with '${issueIdentifier}:' summarizing what you implemented and validated.`,
    "Do not claim validation you did not actually run.",
  ].join("\n");
}

function summarizeOutput(output: string, issueIdentifier: string): string {
  const normalized = output.trim();
  if (normalized !== "") {
    return normalized;
  }
  return `${issueIdentifier}: implementation complete`;
}
