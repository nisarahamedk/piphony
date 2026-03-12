import { runPiTask } from "../pi/runner.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import type { RunWorker, RunWorkerContext } from "../core/orchestrator.js";

export class LocalTrackerImplementationWorker implements RunWorker {
  readonly name = "implementation";

  constructor(
    private readonly repoRoot: string,
    private readonly trackerDir: string,
  ) {}

  async execute(context: RunWorkerContext) {
    await context.logger.emit("ui.workflow.issue.started", {
      identifier: context.workItem.identifier,
      title: context.workItem.title,
      state: context.workItem.state,
    });

    const prompt = [
      `Handle issue ${context.workItem.identifier}: ${context.workItem.title}`,
      `This run was selected by the pull-based orchestrator from the local tracker.`,
      `Do not modify code or git state in this run. This is a tracker-driven workflow smoke for Piphony itself.`,
      `Use tracker tools for issue comments and transitions.`,
      `If the issue is currently in Todo or Rework, immediately transition it to in_progress before doing the rest of the work.`,
      `Inspect the repository enough to reference at least two relevant files or directories in your updates.`,
      `Required workflow:` ,
      `1. Ensure the issue is in in_progress before active work if it started in todo or rework.`,
      `2. Append a tracker comment titled 'Plan' with 2-4 concise bullets tailored to this issue.`,
      `3. Inspect the repo enough to mention at least two relevant files or directories.`,
      `4. Append a tracker comment titled 'Progress' summarizing what you inspected and what should happen next.`,
      `5. Append a tracker comment titled 'Review handoff' that tells the human reviewer what is ready to check next.`,
      `6. Transition the issue to agent_review.`,
      `7. Reply with exactly: Issue ${context.workItem.identifier} has been processed.`,
      context.workItem.description === undefined ? "" : `Issue description:\n${context.workItem.description}`,
    ].filter(Boolean).join("\n");

    const result = await runPiTask({
      cwd: this.repoRoot,
      agentType: "implementation",
      tracker: createLocalTrackerAdapter(this.trackerDir),
      workItem: context.workItem,
      modelPreference: "minimax/MiniMax-M2.5",
      thinkingLevel: "off",
      prompt,
      onTrackerEvent: async (event) => {
        await context.logger.emit(event.event, event.details);
      },
    });

    return result.usedModel === undefined
      ? { summary: result.output || `Handled ${context.workItem.identifier}`, output: result.output }
      : { summary: result.output || `Handled ${context.workItem.identifier}`, output: result.output, metadata: { usedModel: result.usedModel } };
  }
}
