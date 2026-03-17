import { join } from "node:path";
import type { ActiveRunRegistry } from "./active-run-registry.js";
import { errorMessage, errorStack } from "./errors.js";
import type { RunLogger } from "../observability/logger.js";
import type { RunRecord, RunSummaryRecord, RunWorkerResult, WorkItem } from "./types.js";
import { nowIso } from "./utils.js";
import type { RunWorker } from "./orchestrator.js";
import type { ProjectExecutionContext } from "../project/execution.js";
import { prepareProjectEnvironment, teardownProjectEnvironment } from "../project/execution.js";
import type { PreparedEnvironment } from "../extensions/types.js";

export interface ExecuteOrchestratorRunOptions {
  workItem: WorkItem;
  run: RunRecord;
  logger: RunLogger;
  worker: RunWorker;
  projectExecution?: ProjectExecutionContext;
  repoRoot?: string;
  activeRunRegistry?: ActiveRunRegistry;
  heartbeat?: (details?: Record<string, unknown>) => Promise<void>;
}

export async function executeOrchestratorRun(options: ExecuteOrchestratorRunOptions): Promise<RunWorkerResult> {
  const { workItem, run, logger, worker, projectExecution, activeRunRegistry, heartbeat } = options;

  await logger.emit("run.created", {
    identifier: workItem.identifier,
    title: workItem.title,
    state: workItem.state,
  });
  await heartbeat?.({ phase: "created" });

  let preparedEnvironment: PreparedEnvironment | undefined;
  let prepareAttempted = false;
  let prepareSucceeded = false;
  let thrownError: unknown;

  try {
    let executionTarget = undefined;
    if (projectExecution !== undefined) {
      await logger.emit("extension.lifecycle.prepare.started", {
        provider: projectExecution.runtime.environmentProvider.id,
      });
      prepareAttempted = true;
      let prepared: Awaited<ReturnType<typeof prepareProjectEnvironment>>;
      try {
        prepared = await prepareProjectEnvironment({ context: projectExecution, logger });
      } catch (prepareError) {
        // Target resolution failed, but prepareEnv succeeded and returned a real environment.
        // Capture it for teardown before re-throwing.
        const errorWithEnv = prepareError as Error & { preparedEnvironment?: PreparedEnvironment };
        if (errorWithEnv.preparedEnvironment !== undefined) {
          preparedEnvironment = errorWithEnv.preparedEnvironment;
          prepareSucceeded = true;
        }
        throw prepareError;
      }
      prepareSucceeded = true;
      preparedEnvironment = prepared.preparedEnvironment;
      executionTarget = prepared.executionTarget;
      run.executionTarget = executionTarget.name;
      run.updatedAt = nowIso();
      activeRunRegistry?.updateStatus(run.runId, run.status);
      await logger.writeStatus(run);
      await logger.emit("extension.lifecycle.prepare.completed", {
        provider: projectExecution.runtime.environmentProvider.id,
        executionTarget: executionTarget.name,
        endpoints: preparedEnvironment.endpoints,
      });
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
    const context = executionTarget === undefined ? contextBase : { ...contextBase, executionTarget };
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
    const sessionFile = activeRunRegistry?.getByRunId(run.runId)?.artifacts.sessionFile;
    const summaryRecord: Parameters<typeof buildRunSummaryRecord>[0] = {
      run,
      workItem,
      summary: result.summary,
      transcriptPath: join(logger.artifacts.runDir, "transcript.md"),
      ...(typeof result.metadata?.usedModel === "string" ? { usedModel: result.metadata.usedModel } : {}),
    };
    if (sessionFile !== undefined) {
      summaryRecord.sessionFile = sessionFile;
    }
    await logger.writeSummary(buildRunSummaryRecord(summaryRecord));
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
    const sessionFile = activeRunRegistry?.getByRunId(run.runId)?.artifacts.sessionFile;
    const failedSummary: Parameters<typeof buildRunSummaryRecord>[0] = {
      run,
      workItem,
      error: errorMessage(error),
    };
    if (sessionFile !== undefined) {
      failedSummary.sessionFile = sessionFile;
    }
    await logger.writeSummary(buildRunSummaryRecord(failedSummary));
    await heartbeat?.({ phase: "failed", error: errorMessage(error) });
    throw error;
  } finally {
    // Always attempt teardown when preparation was attempted, even if it failed.
    // The environment provider may have created external state (e.g., docker containers)
    // that needs cleanup regardless of whether prepare succeeded.
    //
    // If prepare succeeded, pass the real PreparedEnvironment to teardown.
    // If prepare failed (threw before returning), we have no choice but to use a fallback
    // because we don't have the actual environment object - but we still attempt cleanup
    // in case the provider created partial state.
    if (projectExecution !== undefined && prepareAttempted) {
      const environmentToTeardown = prepareSucceeded && preparedEnvironment !== undefined
        ? preparedEnvironment
        : {
            // Fallback: only used when prepare threw before returning
            executionTargets: {},
            endpoints: {},
          };
      try {
        await logger.emit("extension.lifecycle.teardown.started", {
          provider: projectExecution.runtime.environmentProvider.id,
        });
        await teardownProjectEnvironment({
          context: projectExecution,
          preparedEnvironment: environmentToTeardown,
          logger,
        });
        await logger.emit("extension.lifecycle.teardown.completed", {
          provider: projectExecution.runtime.environmentProvider.id,
        });
      } catch (teardownError) {
        await logger.emit("extension.lifecycle.teardown.failed", {
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
  sessionFile?: string;
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
    ...(input.sessionFile === undefined ? {} : { sessionFile: input.sessionFile }),
    ...(input.usedModel === undefined ? {} : { usedModel: input.usedModel }),
  };
}
