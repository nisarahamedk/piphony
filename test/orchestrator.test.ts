import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Orchestrator, type RunWorker, type RunWorkerContext } from "../src/core/orchestrator.js";
import type { OrchestratorSnapshot, OrchestratorStatusSink, RunWorkerResult, WorkerHeartbeat } from "../src/core/types.js";
import { createLocalTrackerAdapter } from "../src/tracker/local/adapter.js";
import { resetTrackerState } from "../src/tracker/local/harness.js";

class MemoryStatusSink implements OrchestratorStatusSink {
  snapshot?: OrchestratorSnapshot;
  workers = new Map<string, WorkerHeartbeat>();

  async syncSnapshot(snapshot: OrchestratorSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }

  async upsertWorker(heartbeat: WorkerHeartbeat): Promise<void> {
    this.workers.set(heartbeat.workerId, heartbeat);
  }

  async deleteWorker(workerId: string): Promise<void> {
    this.workers.delete(workerId);
  }
}

class GatedWorker implements RunWorker {
  readonly name = "gated-worker";

  constructor(private readonly gate: Promise<void>) {}

  async execute(context: RunWorkerContext): Promise<RunWorkerResult> {
    await context.heartbeat?.({ phase: "entered_test_worker" });
    await this.gate;
    return {
      summary: `done ${context.workItem.identifier}`,
      output: `done ${context.workItem.identifier}`,
    };
  }
}

describe("orchestrator poll loop", () => {
  test("dispatches only active issues, tracks claims, and reconciles completed workers", async () => {
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-orchestrator-test-"));
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-runs-test-"));
    await resetTrackerState({ trackerDir });
    const adapter = createLocalTrackerAdapter(trackerDir);
    await adapter.store.createIssue({ identifier: "LOCAL-B1", title: "Backlog issue", state: "backlog" });
    await adapter.store.createIssue({ identifier: "LOCAL-T1", title: "Todo issue", state: "todo" });

    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const sink = new MemoryStatusSink();
    const orchestrator = new Orchestrator({
      tracker: adapter,
      worker: new GatedWorker(gate),
      runsRootDir,
      statusSink: sink,
      pollIntervalMs: 50,
      instanceId: "orch-test",
    });

    const firstSnapshot = await orchestrator.pollOnce();
    expect(firstSnapshot.claimedIssueIds).toHaveLength(1);
    expect(firstSnapshot.runningWorkers).toHaveLength(1);
    expect(firstSnapshot.runningWorkers[0]?.currentIssueIdentifier).toBe("LOCAL-T1");
    expect([...sink.workers.values()].some((worker) => worker.currentIssueIdentifier === "LOCAL-T1")).toBe(true);

    releaseGate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await adapter.applyMutation("LOCAL-T1", { type: "transition", state: "human_review" });
    const secondSnapshot = await orchestrator.pollOnce();
    expect(secondSnapshot.claimedIssueIds).toHaveLength(0);
    expect(secondSnapshot.runningWorkers).toHaveLength(0);
    expect(sink.workers.size).toBe(0);
  });

  test("supports local swarm-style concurrency when configured", async () => {
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-orchestrator-swarm-"));
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-runs-swarm-"));
    await resetTrackerState({ trackerDir });
    const adapter = createLocalTrackerAdapter(trackerDir);
    await adapter.store.createIssue({ identifier: "LOCAL-S1", title: "Swarm issue 1", state: "todo" });
    await adapter.store.createIssue({ identifier: "LOCAL-S2", title: "Swarm issue 2", state: "rework" });

    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const orchestrator = new Orchestrator({
      tracker: adapter,
      worker: new GatedWorker(gate),
      runsRootDir,
      pollIntervalMs: 50,
      maxConcurrentWorkers: 2,
      instanceId: "orch-swarm",
    });

    const snapshot = await orchestrator.pollOnce();
    expect(snapshot.runningWorkers).toHaveLength(2);
    expect(snapshot.claimedIssueIds).toHaveLength(2);

    releaseGate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await adapter.applyMutation("LOCAL-S1", { type: "transition", state: "human_review" });
    await adapter.applyMutation("LOCAL-S2", { type: "transition", state: "human_review" });
    const cleared = await orchestrator.pollOnce();
    expect(cleared.runningWorkers).toHaveLength(0);
    expect(cleared.claimedIssueIds).toHaveLength(0);
  });
});
