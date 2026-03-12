import { join } from "node:path";
import { RunLogger } from "../observability/logger.js";
import { WorkflowExecutor } from "../workflow/executor.js";
import type { WorkflowDefinition } from "../workflow/types.js";
import type { RunRecord, RunWorkerResult, RuntimeProvider, TrackerAdapter, WorkItem } from "./types.js";
import { createRunId, nowIso, withOptional } from "./utils.js";

export interface RunWorkerContext {
  workItem: WorkItem;
  run: RunRecord;
  logger: RunLogger;
  runtimeProvider?: RuntimeProvider;
  workspacePath?: string;
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
}

export interface RunOnceResult {
  run: RunRecord;
  result?: RunWorkerResult;
  workItem?: WorkItem;
  logger: RunLogger;
}

const DEFAULT_CANDIDATE_STATES = new Set(["todo", "in_progress", "rework"]);

export class Orchestrator {
  constructor(private readonly options: OrchestratorOptions) {}

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

    const runId = createRunId();
    const logger = new RunLogger(this.options.runsRootDir, runId, true);
    const run = withOptional<RunRecord, "runtimeProvider", string>(
      {
        runId,
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

    await logger.init(run);
    await logger.emit("run.created", {
      identifier: workItem.identifier,
      title: workItem.title,
      state: workItem.state,
    });

    let workflowExecutor: WorkflowExecutor | undefined;
    if (this.options.runtimeProvider !== undefined) {
      await this.options.runtimeProvider.prepare({ runId, workItem });
      await this.options.runtimeProvider.start();
      await this.options.runtimeProvider.waitUntilReady();
      await logger.emit("runtime.ready", { provider: this.options.runtimeProvider.name });
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
      }
    }

    run.status = "running";
    run.updatedAt = nowIso();
    await logger.writeStatus(run);
    await logger.emit("agent.turn.started", { worker: this.options.worker.name });

    let result: RunWorkerResult | undefined;
    let thrownError: unknown;

    try {
      const context = this.options.runtimeProvider === undefined
        ? { workItem, run, logger }
        : { workItem, run, logger, runtimeProvider: this.options.runtimeProvider };
      result = await this.options.worker.execute(context);
      await workflowExecutor?.runPhase("validate");
      run.status = "completed";
      run.updatedAt = nowIso();
      await logger.writeStatus(run);
      if (result.output !== undefined) {
        await logger.writeTranscript(result.output);
      }
      await logger.emit("run.completed", { summary: result.summary });
      await logger.writeSummary({
        runId,
        workItem: workItem.identifier,
        status: run.status,
        summary: result.summary,
        transcriptPath: join(logger.artifacts.runDir, "transcript.md"),
      });
      return { run, result, workItem, logger };
    } catch (error) {
      thrownError = error;
      run.status = "failed";
      run.updatedAt = nowIso();
      await logger.writeStatus(run);
      await logger.emit("run.failed", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await logger.writeSummary({
        runId,
        workItem: workItem.identifier,
        status: run.status,
        error: error instanceof Error ? error.message : String(error),
      });
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

  private async selectCandidateWorkItem(): Promise<WorkItem | undefined> {
    const candidates = await this.options.tracker.fetchCandidateWorkItems();
    return candidates.find((item) => DEFAULT_CANDIDATE_STATES.has(item.state));
  }

  private async selectExplicitWorkItem(workItemId: string): Promise<WorkItem | undefined> {
    const workItem = await this.options.tracker.fetchWorkItemById(workItemId);
    if (workItem === undefined) {
      throw new Error(`Work item not found: ${workItemId}`);
    }
    if (!DEFAULT_CANDIDATE_STATES.has(workItem.state)) {
      throw new Error(`Work item ${workItem.identifier} is not runnable from state ${workItem.state}`);
    }
    return workItem;
  }
}

export class StubWorker implements RunWorker {
  readonly name = "stub-worker";

  async execute(context: RunWorkerContext): Promise<RunWorkerResult> {
    await context.logger.emit("worker.stub.executed", { identifier: context.workItem.identifier });
    return {
      summary: `Stub worker handled ${context.workItem.identifier}`,
      output: `Stub worker handled ${context.workItem.identifier}`,
    };
  }
}
