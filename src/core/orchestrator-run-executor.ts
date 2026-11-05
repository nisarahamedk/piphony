import { join } from "node:path";
import type { ActiveRunRegistry } from "./active-run-registry.js";
import { errorMessage, errorStack } from "./errors.js";
import type { RunLogger } from "../observability/logger.js";
import type { RunRecord, RunSummaryRecord, RunWorkerResult, WorkItem, ExecutionTarget } from "./types.js";
import { nowIso } from "./utils.js";
import type { RunWorker } from "./orchestrator.js";
import type { ProjectExecutionContext } from "../project/execution.js";
import type { RepoAttachmentIdentity, RepoAttachment } from "../extensions/types.js";
import type { WorkspaceHandle, AttachmentHandle } from "./workspace-coordinator.js";

export interface ExecuteOrchestratorRunOptions {
  workItem: WorkItem;
  run: RunRecord;
  logger: RunLogger;
  worker: RunWorker;
  projectExecution?: ProjectExecutionContext;
  /** Pre-prepared workspace handle from coordinator. Required when projectExecution is present. */
  workspaceHandle?: WorkspaceHandle;
  activeRunRegistry?: ActiveRunRegistry;
  heartbeat?: (details?: Record<string, unknown>) => Promise<void>;
}

/**
 * Execute a single orchestrator run.
 *
 * Responsibilities:
 * - Attach the repo to the pre-prepared workspace (via coordinator handle)
 * - Execute the worker
 * - Detach the repo from the workspace
 *
 * Workspace prepare/teardown is managed by the orchestrator layer, not here.
 * This function only handles attach/execute/detach within an already-open workspace.
 */
export async function executeOrchestratorRun(options: ExecuteOrchestratorRunOptions): Promise<RunWorkerResult> {
  const { workItem, run, logger, worker, projectExecution, workspaceHandle, activeRunRegistry, heartbeat } = options;

  // Validate: if projectExecution is present, workspaceHandle must also be present
  if (projectExecution !== undefined && workspaceHandle === undefined) {
    throw new Error(
      "Workspace handle is required when projectExecution is configured. " +
      "Orchestrator should prepare workspace before executing runs.",
    );
  }

  await logger.emit("run.created", {
    identifier: workItem.identifier,
    title: workItem.title,
    state: workItem.state,
  });
  await heartbeat?.({ phase: "created" });

  // Attachment handle for cleanup
  let attachmentHandle: AttachmentHandle | undefined;
  let executionTarget: ExecutionTarget | undefined;

  try {
    if (workspaceHandle) {
      // Use the pre-prepared workspace handle from coordinator
      const workspaceIdentity = workspaceHandle.workspace.workspace;
      
      run.workspaceIdentity = {
        workspaceId: workspaceIdentity.workspaceId,
        platformType: workspaceIdentity.platformType,
        ...(workspaceIdentity.name === undefined ? {} : { name: workspaceIdentity.name }),
        ...(workspaceIdentity.primaryEndpoint === undefined ? {} : { primaryEndpoint: workspaceIdentity.primaryEndpoint }),
      };

      // Attach the repo to the workspace
      const attachOptions: {
        repoIdentifier: string;
        branch?: string;
        projectRoot: string;
        logger: RunLogger;
        workItemId: string;
      } = {
        repoIdentifier: workItem.identifier,
        projectRoot: projectExecution?.projectRoot ?? process.cwd(),
        logger,
        workItemId: workItem.externalId,
      };
      if (workItem.branchName !== undefined) {
        attachOptions.branch = workItem.branchName;
      }
      attachmentHandle = await workspaceHandle.attach(attachOptions);

      const attachment = attachmentHandle.attachment;
      
      run.attachmentIdentity = {
        attachmentId: attachmentHandle.identity.attachmentId,
        repoIdentifier: attachmentHandle.identity.repoIdentifier,
        workspaceId: attachmentHandle.identity.workspaceId,
        ...(attachmentHandle.identity.branch === undefined ? {} : { branch: attachmentHandle.identity.branch }),
      };

      // Use execution targets from attachment
      executionTarget = attachment.defaultExecutionTarget
        ? attachment.executionTargets[attachment.defaultExecutionTarget]
        : Object.values(attachment.executionTargets)[0];
      if (executionTarget?.name !== undefined) {
        run.executionTarget = executionTarget.name;
      }
      run.updatedAt = nowIso();
      activeRunRegistry?.updateStatus(run.runId, run.status);
      await logger.writeStatus(run);
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
    // Detach the attachment - workspace teardown is handled by the coordinator
    // Note: The coordinator's detach method already emits lifecycle events,
    // so we don't emit them here to avoid duplication
    if (workspaceHandle && attachmentHandle) {
      const { identity } = attachmentHandle;
      try {
        await attachmentHandle.detach();
      } catch (detachError) {
        // The coordinator's detach method already emitted the failed event,
        // but we log additional error info here for debugging
        console.error("[DEBUG] detach failed for:", identity.attachmentId, "error:", detachError);
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
    ...(input.run.workspaceIdentity === undefined ? {} : { workspaceIdentity: input.run.workspaceIdentity }),
    ...(input.run.attachmentIdentity === undefined ? {} : { attachmentIdentity: input.run.attachmentIdentity }),
  };
}
