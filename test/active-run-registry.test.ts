import { describe, expect, test } from "vitest";
import { ActiveRunRegistry, type ActiveRunControl } from "../src/core/active-run-registry.js";
import type { RunRecord, WorkItem } from "../src/core/types.js";

function makeRun(runId: string, workItemId: string): RunRecord {
  return {
    runId,
    workItemId,
    agentType: "implementation",
    status: "running",
    attemptNumber: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeWorkItem(externalId: string, identifier: string): WorkItem {
  return {
    provider: "local",
    externalId,
    identifier,
    title: `Issue ${identifier}`,
    state: "todo",
    labels: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeControl(): ActiveRunControl {
  return {
    snapshot: () => ({
      state: "running",
      sessionId: "session-1",
      sessionFile: "/tmp/session.jsonl",
      isStreaming: true,
      pendingMessageCount: 1,
      steeringMessages: [],
      followUpMessages: [],
      messageCount: 2,
      thinkingLevel: "off",
    }),
    steer: async () => undefined,
    followUp: async () => undefined,
    abort: async () => undefined,
  };
}

describe("ActiveRunRegistry", () => {
  test("registers lookups by run id, work item id, and identifier", () => {
    const registry = new ActiveRunRegistry();
    registry.register({
      run: makeRun("run-1", "issue-1"),
      workItem: makeWorkItem("issue-1", "LOCAL-101"),
      workerName: "implementation",
      artifacts: {
        runDir: "/tmp/run-1",
        eventsPath: "/tmp/run-1/events.jsonl",
        statusPath: "/tmp/run-1/status.json",
        summaryPath: "/tmp/run-1/summary.json",
        transcriptPath: "/tmp/run-1/transcript.md",
        transcriptMetaPath: "/tmp/run-1/transcript.meta.json",
        artifactsDir: "/tmp/run-1/artifacts",
        sessionsDir: "/tmp/run-1/sessions",
      },
    });

    expect(registry.getByRunId("run-1")?.workItem.identifier).toBe("LOCAL-101");
    expect(registry.getByWorkItemId("issue-1")?.run.runId).toBe("run-1");
    expect(registry.getByIdentifier("LOCAL-101")?.run.runId).toBe("run-1");
  });

  test("attaches control and updates live metadata", () => {
    const registry = new ActiveRunRegistry();
    registry.register({
      run: makeRun("run-2", "issue-2"),
      workItem: makeWorkItem("issue-2", "LOCAL-102"),
      workerName: "implementation",
      artifacts: {
        runDir: "/tmp/run-2",
        eventsPath: "/tmp/run-2/events.jsonl",
        statusPath: "/tmp/run-2/status.json",
        summaryPath: "/tmp/run-2/summary.json",
        transcriptPath: "/tmp/run-2/transcript.md",
        transcriptMetaPath: "/tmp/run-2/transcript.meta.json",
        artifactsDir: "/tmp/run-2/artifacts",
        sessionsDir: "/tmp/run-2/sessions",
      },
    });

    registry.attachControl("run-2", makeControl());
    registry.updatePhase("run-2", "running");
    registry.updateSummary("run-2", "Doing the work");
    registry.updateError("run-2", "boom");

    const entry = registry.getByRunId("run-2");
    expect(entry?.control?.snapshot().sessionId).toBe("session-1");
    expect(entry?.artifacts.sessionFile).toBe("/tmp/session.jsonl");
    expect(entry?.phase).toBe("running");
    expect(entry?.lastSummary).toBe("Doing the work");
    expect(entry?.lastError).toBe("boom");
  });

  test("removes active runs cleanly", () => {
    const registry = new ActiveRunRegistry();
    registry.register({
      run: makeRun("run-3", "issue-3"),
      workItem: makeWorkItem("issue-3", "LOCAL-103"),
      workerName: "implementation",
      artifacts: {
        runDir: "/tmp/run-3",
        eventsPath: "/tmp/run-3/events.jsonl",
        statusPath: "/tmp/run-3/status.json",
        summaryPath: "/tmp/run-3/summary.json",
        transcriptPath: "/tmp/run-3/transcript.md",
        transcriptMetaPath: "/tmp/run-3/transcript.meta.json",
        artifactsDir: "/tmp/run-3/artifacts",
        sessionsDir: "/tmp/run-3/sessions",
      },
    });

    registry.remove("run-3");
    expect(registry.getByRunId("run-3")).toBeUndefined();
    expect(registry.getByWorkItemId("issue-3")).toBeUndefined();
    expect(registry.getByIdentifier("LOCAL-103")).toBeUndefined();
  });
});
