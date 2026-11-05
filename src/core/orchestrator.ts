import { hostname } from "node:os";
import { createRunArtifactIndex } from "../observability/artifact-index.js";
import { RunLogger, type RunArtifacts } from "../observability/logger.js";
import { executeOrchestratorRun } from "./orchestrator-run-executor.js";
import {
  ACTIVE_WORK_ITEM_STATES,
  type OrchestratorSnapshot,
  type OrchestratorStatusSink,
  type RunRecord,
  type RunWorkerResult,
  type ExecutionTarget,
  type TrackerAdapter,
  type WorkItem,
  type WorkerHeartbeat,
} from "./types.js";
import type { ActiveRunRegistry } from "./active-run-registry.js";
import { errorMessage } from "./errors.js";
import { createRunId, nowIso } from "./utils.js";
import type { ProjectExecutionContext } from "../project/execution.js";
import { WorkspaceCoordinator, type WorkspaceHandle } from "./workspace-coordinator.js";

export interface RunWorkerContext {
  workItem: WorkItem;
  run: RunRecord;
  logger: RunLogger;
  runArtifacts: RunArtifacts;
  executionTarget?: ExecutionTarget;
  heartbeat?: (details?: Record<string, unknown>) => Promise<void>;
  activeRunRegistry?: ActiveRunRegistry;
}

export interface RunWorker {
  readonly name: string;
  execute(context: RunWorkerContext): Promise<RunWorkerResult>;
}

export interface OrchestratorOptions {
  tracker: TrackerAdapter;
  worker: RunWorker;
  projectExecution?: ProjectExecutionContext;
  runsRootDir: string;
  agentType?: string;
  attemptNumber?: number;
  workItemId?: string;
  pollIntervalMs?: number;
  maxConcurrentWorkers?: number;
  instanceId?: string;
  statusSink?: OrchestratorStatusSink;
  activeRunRegistry?: ActiveRunRegistry;
}

export interface RunOnceResult {
  run: RunRecord;
  result?: RunWorkerResult;
  workItem?: WorkItem;
  logger: RunLogger;
}

interface RunningEntry {
  workerHeartbeat: WorkerHeartbeat;
  workItem: WorkItem;
  run: RunRecord;
  logger: RunLogger;
  promise: Promise<void>;
  result?: RunWorkerResult;
  error?: unknown;
  settled: boolean;
  workspaceHandle?: WorkspaceHandle;
}

const ACTIVE_STATES = new Set<string>(ACTIVE_WORK_ITEM_STATES);
const PRIORITY_RANKS: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export class Orchestrator {
  private readonly instanceId: string;
  private readonly startedAt = nowIso();
  private readonly pollIntervalMs: number;
  private readonly maxConcurrentWorkers: number;
  private readonly host = hostname();
  private readonly processId = process.pid;
  private readonly claimed = new Set<string>();
  private readonly running = new Map<string, RunningEntry>();
  private status: OrchestratorSnapshot["status"] = "idle";
  private lastPollAt: string | undefined;
  private nextPollAt: string | undefined;

  // Workspace coordinator for managing workspace lifecycle above runs
  private workspaceCoordinator: WorkspaceCoordinator | undefined;
  private workspaceHandle: WorkspaceHandle | undefined;

  constructor(private readonly options: OrchestratorOptions) {
    this.instanceId = options.instanceId ?? createRunId("orchestrator");
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
    this.maxConcurrentWorkers = options.maxConcurrentWorkers ?? 1;
  }

  async pollOnce(): Promise<OrchestratorSnapshot> {
    this.assertNotOffline("Cannot poll orchestrator after shutdown");
    this.status = "polling";
    this.nextPollAt = undefined;
    await this.flushSnapshot();

    await this.reconcileRunningWorkers();

    const capacity = Math.max(0, this.maxConcurrentWorkers - this.running.size);
    if (capacity > 0) {
      const candidates = [...await this.options.tracker.fetchCandidateWorkItems()].sort(compareWorkItems);
      let dispatched = 0;
      for (const candidate of candidates) {
        if (dispatched >= capacity) {
          break;
        }
        const workItem = await this.revalidateForDispatch(candidate);
        if (workItem === undefined) {
          continue;
        }
        await this.dispatch(workItem);
        dispatched += 1;
      }
    }

    this.lastPollAt = nowIso();
    this.nextPollAt = new Date(Date.now() + this.pollIntervalMs).toISOString();
    this.status = "idle";
    await this.flushSnapshot();
    return this.snapshot();
  }

  async shutdown(): Promise<void> {
    // Teardown workspace if open
    await this.teardownWorkspace();

    this.status = "offline";
    this.nextPollAt = undefined;
    await this.flushSnapshot();
  }

  async runOnce(): Promise<RunOnceResult> {
    this.assertNotOffline("Cannot run orchestrator after shutdown");
    const workItem = this.options.workItemId === undefined
      ? await this.selectCandidateWorkItem()
      : await this.selectExplicitWorkItem(this.options.workItemId);

    if (workItem === undefined) {
      const runId = createRunId("idle");
      const logger = new RunLogger(this.options.runsRootDir, runId, true);
      const idleRun: RunRecord = {
        runId,
        workItemId: "none",
        agentType: this.options.agentType ?? this.options.worker.name,
        status: "idle",
        attemptNumber: this.options.attemptNumber ?? 1,
        startedAt: nowIso(),
        updatedAt: nowIso(),
      };
      await logger.init(idleRun);
      await logger.emit("run.idle", { provider: this.options.tracker.provider });
      await logger.writeSummary({
        runId,
        workItemId: "none",
        status: "idle",
        summary: "no_candidate_work_items",
      });
      return { run: idleRun, logger };
    }

    const run = this.createRunRecord(workItem);
    const logger = new RunLogger(this.options.runsRootDir, run.runId, true);
    await logger.init(run);
    this.options.activeRunRegistry?.register({
      run,
      workItem,
      workerName: this.options.worker.name,
      artifacts: createRunArtifactIndex(logger),
    });

    // Prepare workspace once above this run (workspace lifecycle is above runs)
    await this.prepareWorkspace(logger);

    try {
      const result = await this.executeWorkItem({ workItem, run, logger });
      return { run, result, workItem, logger };
    } finally {
      this.options.activeRunRegistry?.remove(run.runId);
      // Teardown workspace after run completes
      await this.teardownWorkspace();
    }
  }

  private async dispatch(workItem: WorkItem): Promise<void> {
    if (this.claimed.has(workItem.externalId) || this.running.has(workItem.externalId)) {
      return;
    }

    const run = this.createRunRecord(workItem);
    const logger = new RunLogger(this.options.runsRootDir, run.runId, true);
    await logger.init(run);

    const workerHeartbeat: WorkerHeartbeat = {
      workerId: `${this.instanceId}:${run.runId}`,
      ownerId: this.instanceId,
      role: this.options.worker.name,
      status: "running",
      processId: this.processId,
      host: this.host,
      startedAt: nowIso(),
      lastSeenAt: nowIso(),
      currentIssueId: workItem.externalId,
      currentIssueIdentifier: workItem.identifier,
      currentRunId: run.runId,
      details: {},
    };

    const entry: RunningEntry = {
      workerHeartbeat,
      workItem,
      run,
      logger,
      promise: Promise.resolve(),
      settled: false,
    };

    this.claimed.add(workItem.externalId);
    this.running.set(workItem.externalId, entry);
    this.options.activeRunRegistry?.register({
      run,
      workItem,
      workerName: this.options.worker.name,
      artifacts: createRunArtifactIndex(logger),
    });
    await this.options.statusSink?.upsertWorker(workerHeartbeat);
    await this.flushSnapshot();

    // Prepare workspace once for this dispatch (if not already prepared)
    await this.prepareWorkspace(logger);

    // Only assign workspace handle if it's defined
    if (this.workspaceHandle !== undefined) {
      entry.workspaceHandle = this.workspaceHandle;
    }

    entry.promise = this.executeTrackedEntry(entry);
  }

  private async executeTrackedEntry(entry: RunningEntry): Promise<void> {
    // Build work item input - only include workspaceHandle if defined
    const workItemInput: {
      workItem: WorkItem;
      run: RunRecord;
      logger: RunLogger;
      heartbeat: (details?: Record<string, unknown>) => Promise<void>;
      workspaceHandle?: WorkspaceHandle;
    } = {
      workItem: entry.workItem,
      run: entry.run,
      logger: entry.logger,
      heartbeat: async (details) => {
        entry.workerHeartbeat = {
          ...entry.workerHeartbeat,
          lastSeenAt: nowIso(),
          details: details === undefined ? entry.workerHeartbeat.details : { ...entry.workerHeartbeat.details, ...details },
        };
        this.options.activeRunRegistry?.updateHeartbeat(entry.run.runId, entry.workerHeartbeat);
        if (typeof details?.phase === "string") {
          this.options.activeRunRegistry?.updatePhase(entry.run.runId, details.phase);
        }
        await this.options.statusSink?.upsertWorker(entry.workerHeartbeat);
        await this.flushSnapshot();
      },
    };

    if (entry.workspaceHandle !== undefined) {
      workItemInput.workspaceHandle = entry.workspaceHandle;
    }

    try {
      entry.result = await this.executeWorkItem(workItemInput);
    } catch (error) {
      entry.error = error;
      this.options.activeRunRegistry?.updateError(entry.run.runId, errorMessage(error));
    } finally {
      entry.settled = true;
      entry.workerHeartbeat = {
        ...entry.workerHeartbeat,
        lastSeenAt: nowIso(),
      };
      await this.options.statusSink?.upsertWorker(entry.workerHeartbeat);
      await this.flushSnapshot();
    }
  }

  private async reconcileRunningWorkers(): Promise<void> {
    const settledEntries = [...this.running.values()].filter((entry) => entry.settled);
    for (const entry of settledEntries) {
      this.running.delete(entry.workItem.externalId);
      this.claimed.delete(entry.workItem.externalId);
      this.options.activeRunRegistry?.remove(entry.run.runId);
      await this.options.statusSink?.deleteWorker(entry.workerHeartbeat.workerId);

      // After all runs are done, teardown workspace
      if (this.running.size === 0) {
        await this.teardownWorkspace();
      }
    }
  }

  private async revalidateForDispatch(candidate: WorkItem): Promise<WorkItem | undefined> {
    if (this.claimed.has(candidate.externalId) || this.running.has(candidate.externalId)) {
      return undefined;
    }
    const refreshed = await this.options.tracker.fetchWorkItemById(candidate.externalId);
    if (refreshed === undefined) {
      return undefined;
    }
    return ACTIVE_STATES.has(refreshed.state) ? refreshed : undefined;
  }

  private async selectCandidateWorkItem(): Promise<WorkItem | undefined> {
    const candidates = [...await this.options.tracker.fetchCandidateWorkItems()].sort(compareWorkItems);
    return candidates.find((item) => ACTIVE_STATES.has(item.state));
  }

  private async selectExplicitWorkItem(workItemId: string): Promise<WorkItem | undefined> {
    const workItem = await this.options.tracker.fetchWorkItemById(workItemId);
    if (workItem === undefined) {
      throw new Error(`Work item not found: ${workItemId}`);
    }
    if (!ACTIVE_STATES.has(workItem.state)) {
      throw new Error(`Work item ${workItem.identifier} is not runnable from state ${workItem.state}`);
    }
    return workItem;
  }

  private createRunRecord(workItem: WorkItem): RunRecord {
    return {
      runId: createRunId(),
      workItemId: workItem.externalId,
      workItemIdentifier: workItem.identifier,
      workItemTitle: workItem.title,
      agentType: this.options.agentType ?? this.options.worker.name,
      status: "created",
      attemptNumber: this.options.attemptNumber ?? 1,
      startedAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  /**
   * Prepare workspace once above run execution.
   * If projectExecution is provided, creates a workspace coordinator and prepares the workspace.
   * For polling mode, workspace is reused across multiple runs in the same session.
   * For runOnce mode, workspace is prepared for the single run.
   */
  private async prepareWorkspace(logger: RunLogger): Promise<void> {
    // Already prepared
    if (this.workspaceHandle !== undefined) {
      return;
    }

    // No projectExecution means no workspace needed (e.g., using stub worker)
    if (this.options.projectExecution === undefined) {
      return;
    }

    const { runtime, projectRoot } = this.options.projectExecution;
    const runtimePlatform = runtime.runtimePlatformProvider;

    // Create coordinator and prepare workspace
    this.workspaceCoordinator = new WorkspaceCoordinator(runtimePlatform, projectRoot);
    this.workspaceHandle = await this.workspaceCoordinator.prepare({
      projectRoot,
      logger,
      env: process.env,
    });
  }

  /**
   * Teardown workspace after all runs complete.
   */
  private async teardownWorkspace(): Promise<void> {
    if (this.workspaceCoordinator !== undefined && this.workspaceCoordinator.isOpen()) {
      await this.workspaceCoordinator.teardown();
      this.workspaceCoordinator = undefined;
      this.workspaceHandle = undefined;
    }
  }

  private async executeWorkItem(input: {
    workItem: WorkItem;
    run: RunRecord;
    logger: RunLogger;
    heartbeat?: (details?: Record<string, unknown>) => Promise<void>;
    workspaceHandle?: WorkspaceHandle;
  }): Promise<RunWorkerResult> {
    // When workspaceHandle is provided, it must be used (coordinator mode)
    // When workspaceHandle is undefined but projectExecution is present, that's an error
    // (orchestrator should have prepared workspace before calling executeWorkItem)
    const effectiveWorkspaceHandle = input.workspaceHandle ?? this.workspaceHandle;

    if (this.options.projectExecution !== undefined && effectiveWorkspaceHandle === undefined) {
      throw new Error(
        "Workspace handle is required when projectExecution is configured. " +
        "Orchestrator should prepare workspace before executing work items.",
      );
    }

    // Build options object - only include defined properties to satisfy exactOptionalPropertyTypes
    const options: {
      workItem: WorkItem;
      run: RunRecord;
      logger: RunLogger;
      worker: RunWorker;
      projectExecution?: ProjectExecutionContext;
      workspaceHandle?: WorkspaceHandle;
      activeRunRegistry?: ActiveRunRegistry;
      heartbeat?: (details?: Record<string, unknown>) => Promise<void>;
    } = {
      workItem: input.workItem,
      run: input.run,
      logger: input.logger,
      worker: this.options.worker,
    };

    if (this.options.projectExecution !== undefined) {
      options.projectExecution = this.options.projectExecution;
    }
    if (effectiveWorkspaceHandle !== undefined) {
      options.workspaceHandle = effectiveWorkspaceHandle;
    }
    if (this.options.activeRunRegistry !== undefined) {
      options.activeRunRegistry = this.options.activeRunRegistry;
    }
    if (input.heartbeat !== undefined) {
      options.heartbeat = input.heartbeat;
    }

    return executeOrchestratorRun(options);
  }

  private snapshot(): OrchestratorSnapshot {
    return {
      instanceId: this.instanceId,
      startedAt: this.startedAt,
      status: this.status,
      pollIntervalMs: this.pollIntervalMs,
      maxConcurrentWorkers: this.maxConcurrentWorkers,
      ...(this.lastPollAt === undefined ? {} : { lastPollAt: this.lastPollAt }),
      ...(this.nextPollAt === undefined ? {} : { nextPollAt: this.nextPollAt }),
      claimedIssueIds: [...this.claimed],
      runningWorkers: [...this.running.values()].map((entry) => entry.workerHeartbeat),
    };
  }

  private async flushSnapshot(): Promise<void> {
    await this.options.statusSink?.syncSnapshot(this.snapshot());
  }

  private assertNotOffline(message: string): void {
    if (this.status === "offline") {
      throw new Error(message);
    }
  }
}

export class StubWorker implements RunWorker {
  readonly name = "stub-worker";

  async execute(context: RunWorkerContext): Promise<RunWorkerResult> {
    await context.logger.emit("worker.stub.executed", { identifier: context.workItem.identifier });
    await context.heartbeat?.({ phase: "stub_executed", identifier: context.workItem.identifier });
    return {
      summary: `Stub worker handled ${context.workItem.identifier}`,
      output: `Stub worker handled ${context.workItem.identifier}`,
    };
  }
}

function compareWorkItems(left: WorkItem, right: WorkItem): number {
  const leftPriority = priorityRank(left.priority);
  const rightPriority = priorityRank(right.priority);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return left.createdAt.localeCompare(right.createdAt);
}

function priorityRank(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    return PRIORITY_RANKS[value] ?? 2;
  }
  return 2;
}
