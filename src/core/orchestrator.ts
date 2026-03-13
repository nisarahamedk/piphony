import { join } from "node:path";
import { hostname } from "node:os";
import { createRunArtifactIndex } from "../observability/artifact-index.js";
import { RunLogger, type RunArtifacts } from "../observability/logger.js";
import { WorkflowExecutor } from "../workflow/executor.js";
import type { WorkflowDefinition } from "../workflow/types.js";
import {
  ACTIVE_WORK_ITEM_STATES,
  type OrchestratorSnapshot,
  type OrchestratorStatusSink,
  type RunRecord,
  type RunWorkerResult,
  type RuntimeProvider,
  type TrackerAdapter,
  type WorkItem,
  type WorkerHeartbeat,
} from "./types.js";
import type { ActiveRunRegistry } from "./active-run-registry.js";
import { createRunId, nowIso, withOptional } from "./utils.js";

export interface RunWorkerContext {
  workItem: WorkItem;
  run: RunRecord;
  logger: RunLogger;
  runArtifacts: RunArtifacts;
  runtimeProvider?: RuntimeProvider;
  workspacePath?: string;
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
  runtimeProvider?: RuntimeProvider;
  workflow?: WorkflowDefinition;
  repoRoot?: string;
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

  constructor(private readonly options: OrchestratorOptions) {
    this.instanceId = options.instanceId ?? createRunId("orchestrator");
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
    this.maxConcurrentWorkers = options.maxConcurrentWorkers ?? 1;
  }

  async pollOnce(): Promise<OrchestratorSnapshot> {
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
    this.status = "offline";
    this.nextPollAt = undefined;
    await this.flushSnapshot();
  }

  async runOnce(): Promise<RunOnceResult> {
    const workItem = this.options.workItemId === undefined
      ? await this.selectCandidateWorkItem()
      : await this.selectExplicitWorkItem(this.options.workItemId);

    if (workItem === undefined) {
      const runId = createRunId("idle");
      const logger = new RunLogger(this.options.runsRootDir, runId, true);
      const idleRun = withOptional<RunRecord, "runtimeProvider", string>(
        {
          runId,
          workItemId: "none",
          agentType: this.options.agentType ?? this.options.worker.name,
          status: "idle",
          attemptNumber: this.options.attemptNumber ?? 1,
          startedAt: nowIso(),
          updatedAt: nowIso(),
        },
        "runtimeProvider",
        this.options.runtimeProvider?.name,
      );
      await logger.init(idleRun);
      await logger.emit("run.idle", { provider: this.options.tracker.provider });
      await logger.writeSummary({ status: "idle", reason: "no_candidate_work_items" });
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
    try {
      const result = await this.executeWorkItem({ workItem, run, logger });
      return { run, result, workItem, logger };
    } finally {
      this.options.activeRunRegistry?.remove(run.runId);
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

    entry.promise = this.executeTrackedEntry(entry);
  }

  private async executeTrackedEntry(entry: RunningEntry): Promise<void> {
    try {
      entry.result = await this.executeWorkItem({
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
      });
    } catch (error) {
      entry.error = error;
      this.options.activeRunRegistry?.updateError(entry.run.runId, error instanceof Error ? error.message : String(error));
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
    return withOptional<RunRecord, "runtimeProvider", string>(
      {
        runId: createRunId(),
        workItemId: workItem.externalId,
        agentType: this.options.agentType ?? this.options.worker.name,
        status: "created",
        attemptNumber: this.options.attemptNumber ?? 1,
        startedAt: nowIso(),
        updatedAt: nowIso(),
      },
      "runtimeProvider",
      this.options.runtimeProvider?.name,
    );
  }

  private async executeWorkItem(input: {
    workItem: WorkItem;
    run: RunRecord;
    logger: RunLogger;
    heartbeat?: (details?: Record<string, unknown>) => Promise<void>;
  }): Promise<RunWorkerResult> {
    const { workItem, run, logger, heartbeat } = input;

    await logger.emit("run.created", {
      identifier: workItem.identifier,
      title: workItem.title,
      state: workItem.state,
    });
    await heartbeat?.({ phase: "created" });

    let workflowExecutor: WorkflowExecutor | undefined;
    if (this.options.runtimeProvider !== undefined) {
      await this.options.runtimeProvider.prepare({ runId: run.runId, workItem });
      await this.options.runtimeProvider.start();
      await this.options.runtimeProvider.waitUntilReady();
      await logger.emit("runtime.ready", { provider: this.options.runtimeProvider.name });
      await heartbeat?.({ phase: "runtime_ready" });
      if (this.options.workflow !== undefined) {
        if (this.options.repoRoot === undefined) {
          throw new Error("repoRoot is required when workflow is configured");
        }
        workflowExecutor = new WorkflowExecutor({
          repoRoot: this.options.repoRoot,
          workflow: this.options.workflow,
          runtimeProvider: this.options.runtimeProvider,
          logger,
        });
        await workflowExecutor.runPhase("prepare");
        await heartbeat?.({ phase: "prepare_complete" });
      }
    }

    run.status = "running";
    run.updatedAt = nowIso();
    this.options.activeRunRegistry?.updateStatus(run.runId, run.status);
    await logger.writeStatus(run);
    await logger.emit("agent.turn.started", { worker: this.options.worker.name });
    await heartbeat?.({ phase: "running" });

    let result: RunWorkerResult | undefined;
    let thrownError: unknown;

    try {
      const contextBase = {
        workItem,
        run,
        logger,
        runArtifacts: logger.artifacts,
        ...(heartbeat === undefined ? {} : { heartbeat }),
        ...(this.options.activeRunRegistry === undefined ? {} : { activeRunRegistry: this.options.activeRunRegistry }),
      };
      const context = this.options.runtimeProvider === undefined
        ? contextBase
        : { ...contextBase, runtimeProvider: this.options.runtimeProvider };
      result = await this.options.worker.execute(context);
      await workflowExecutor?.runPhase("validate");
      run.status = "completed";
      run.updatedAt = nowIso();
      this.options.activeRunRegistry?.updateStatus(run.runId, run.status);
      this.options.activeRunRegistry?.updateSummary(run.runId, result.summary);
      await logger.writeStatus(run);
      if (result.output !== undefined) {
        await logger.writeTranscript(result.output);
      }
      await logger.emit("run.completed", { summary: result.summary });
      await logger.writeSummary({
        runId: run.runId,
        workItem: workItem.identifier,
        status: run.status,
        summary: result.summary,
        transcriptPath: join(logger.artifacts.runDir, "transcript.md"),
      });
      await heartbeat?.({ phase: "completed", summary: result.summary });
      return result;
    } catch (error) {
      thrownError = error;
      run.status = "failed";
      run.updatedAt = nowIso();
      this.options.activeRunRegistry?.updateStatus(run.runId, run.status);
      this.options.activeRunRegistry?.updateError(run.runId, error instanceof Error ? error.message : String(error));
      await logger.writeStatus(run);
      await logger.emit("run.failed", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await logger.writeSummary({
        runId: run.runId,
        workItem: workItem.identifier,
        status: run.status,
        error: error instanceof Error ? error.message : String(error),
      });
      await heartbeat?.({ phase: "failed", error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      if (workflowExecutor !== undefined) {
        try {
          await workflowExecutor.runPhase("teardown");
        } catch (teardownError) {
          await logger.emit("workflow.teardown.failed", {
            message: teardownError instanceof Error ? teardownError.message : String(teardownError),
          });
          if (thrownError === undefined) {
            throw teardownError;
          }
        }
      }
      if (this.options.runtimeProvider !== undefined) {
        await this.options.runtimeProvider.stop().catch(() => undefined);
        await this.options.runtimeProvider.destroy().catch(() => undefined);
      }
    }
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
  const leftPriority = priorityRank(left.metadata.priority);
  const rightPriority = priorityRank(right.metadata.priority);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  const leftCreated = typeof left.metadata.createdAt === "string" ? left.metadata.createdAt : "9999";
  const rightCreated = typeof right.metadata.createdAt === "string" ? right.metadata.createdAt : "9999";
  return leftCreated.localeCompare(rightCreated);
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
