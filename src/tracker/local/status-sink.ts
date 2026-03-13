import { hostname } from "node:os";
import type { OrchestratorSnapshot, OrchestratorStatusSink, WorkerHeartbeat } from "../../core/types.js";
import { nowIso } from "../../core/utils.js";
import { LocalTrackerStore } from "./state.js";

export class LocalTrackerStatusSink implements OrchestratorStatusSink {
  private readonly hostName = hostname();

  constructor(
    private readonly store: LocalTrackerStore,
    private readonly processId = process.pid,
  ) {}

  async syncSnapshot(snapshot: OrchestratorSnapshot): Promise<void> {
    await this.store.upsertWorker({
      workerId: snapshot.instanceId,
      ownerId: snapshot.instanceId,
      role: "orchestrator",
      status: snapshot.status,
      processId: this.processId,
      host: this.hostName,
      startedAt: snapshot.startedAt,
      lastSeenAt: nowIso(),
      ...(snapshot.lastPollAt === undefined ? {} : { lastPollAt: snapshot.lastPollAt }),
      ...(snapshot.nextPollAt === undefined ? {} : { nextPollAt: snapshot.nextPollAt }),
      details: {
        pollIntervalMs: snapshot.pollIntervalMs,
        maxConcurrentWorkers: snapshot.maxConcurrentWorkers,
        claimedIssueIds: snapshot.claimedIssueIds,
        runningWorkers: snapshot.runningWorkers.length,
      },
    });
  }

  async upsertWorker(heartbeat: WorkerHeartbeat): Promise<void> {
    await this.store.upsertWorker(heartbeat);
  }

  async deleteWorker(workerId: string): Promise<void> {
    await this.store.deleteWorker(workerId);
  }
}
