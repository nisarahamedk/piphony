import { join } from "node:path";
import type { ActiveRunRegistry } from "./active-run-registry.js";
import { errorMessage, errorStack } from "./errors.js";
import type { RunLogger } from "../observability/logger.js";
import { WorkflowExecutor } from "../workflow/executor.js";
import type { WorkflowDefinition } from "../workflow/types.js";
import type { ExecutionTarget, RunRecord, RunSummaryRecord, RunWorkerResult, WorkItem } from "./types.js";
import { nowIso } from "./utils.js";
import type { RunWorker } from "./orchestrator.js";

export interface ExecuteOrchestratorRunOptions {
  workItem: WorkItem;
  run: RunRecord;
  logger: RunLogger;
  worker: RunWorker;
  executionTarget?: ExecutionTarget;
  workflow?: WorkflowDefinition;
  repoRoot?: string;
  activeRunRegistry?: ActiveRunRegistry;
  heartbeat?: (details?: Record<string, unknown>) => Promise<void>;
}

export async function executeOrchestratorRun(options: ExecuteOrchestratorRunOptions): Promise<RunWorkerResult> {
  const { workItem, run, logger, worker, executionTarget, workflow, repoRoot, activeRunRegistry, heartbeat } = options;

  await logger.emit("run.created", {
    identifier: workItem.identifier,
    title: workItem.title,
    state: workItem.state,
  });
  await heartbeat?.({ phase: "created" });

  let workflowExecutor: WorkflowExecutor | undefined;
  let thrownError: unknown;

  try {
    if (workflow !== undefined) {
      if (repoRoot === undefined) {
        throw new Error("repoRoot is required when workflow is configured");
      }
      if (executionTarget === undefined) {
        throw new Error("executionTarget is required when workflow is configured");
      }
      workflowExecutor = new WorkflowExecutor({
        repoRoot,
        workflow,
        executionTarget,
        logger,
      });
      await workflowExecutor.runHook("prepare");
      await heartbeat?.({ phase: "prepare_complete" });
    }

    run.status = "running";
    run.updatedAt = nowIso();
    activeRunRegistry?.updateStatus(run.runId, run.status);
    await logger.writeStatus(run);
    await logger.emit("agent.turn.started", { worker: worker.name });
    await heartbeat?.({ phase: "running" });

    const contextBase = {
      workItem,
      run,
      logger,
      runArtifacts: logger.artifacts,
      ...(heartbeat === undefined ? {} : { heartbeat }),
      ...(activeRunRegistry === undefined ? {} : { activeRunRegistry }),
    };
    const context = executionTarget === undefined
      ? contextBase
      : { ...contextBase, executionTarget };
    const result = await worker.execute(context);
    run.status = "completed";
    run.updatedAt = nowIso();
    activeRunRegistry?.updateStatus(run.runId, run.status);
    activeRunRegistry?.updateSummary(run.runId, result.summary);
    await logger.writeStatus(run);
    if (result.output !== undefined) {
      await logger.writeTranscript(result.output);
    }
    await logger.emit("run.completed", { summary: result.summary });
    await logger.writeSummary(buildRunSummaryRecord({
      run,
      workItem,
      summary: result.summary,
      transcriptPath: join(logger.artifacts.runDir, "transcript.md"),
      ...(typeof result.metadata?.usedModel === "string" ? { usedModel: result.metadata.usedModel } : {}),
    }));
    await heartbeat?.({ phase: "completed", summary: result.summary });
    return result;
  } catch (error) {
    thrownError = error;
    run.status = "failed";
    run.updatedAt = nowIso();
    activeRunRegistry?.updateStatus(run.runId, run.status);
    activeRunRegistry?.updateError(run.runId, errorMessage(error));
    await logger.writeStatus(run);
    await logger.emit("run.failed", {
      message: errorMessage(error),
      stack: errorStack(error),
    });
    await logger.writeSummary(buildRunSummaryRecord({
      run,
      workItem,
      error: errorMessage(error),
    }));
    await heartbeat?.({ phase: "failed", error: errorMessage(error) });
    throw error;
  } finally {
    if (workflowExecutor !== undefined) {
      try {
        await workflowExecutor.runHook("teardown");
      } catch (teardownError) {
        await logger.emit("workflow.teardown.failed", {
          message: errorMessage(teardownError),
          stack: errorStack(teardownError),
        });
        if (thrownError === undefined) {
          throw teardownError;
        }
      }
    }
  }
}

function buildRunSummaryRecord(input: {
  run: RunRecord;
  workItem: WorkItem;
  summary?: string;
  error?: string;
  transcriptPath?: string;
  usedModel?: string;
}): RunSummaryRecord {
  return {
    runId: input.run.runId,
    workItemId: input.workItem.externalId,
    workItemIdentifier: input.workItem.identifier,
    workItemTitle: input.workItem.title,
    status: input.run.status,
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.error === undefined ? {} : { error: input.error }),
    ...(input.transcriptPath === undefined ? {} : { transcriptPath: input.transcriptPath }),
    ...(input.usedModel === undefined ? {} : { usedModel: input.usedModel }),
  };
}
