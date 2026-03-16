import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ActiveRunControl, type ActiveRunControlSnapshot } from "../src/core/active-run-registry.js";
import { ActiveRunRegistry } from "../src/core/active-run-registry.js";
import { Orchestrator, type RunWorker, type RunWorkerContext } from "../src/core/orchestrator.js";
import type { RunWorkerResult } from "../src/core/types.js";
import { inspectRun } from "../src/observability/index.js";
import { createLocalTrackerAdapter } from "../src/tracker/local/adapter.js";
import { resetTrackerState } from "../src/tracker/local/harness.js";

class ArtifactWorker implements RunWorker {
  readonly name = "artifact-worker";

  async execute(context: RunWorkerContext) {
    return {
      summary: `completed ${context.workItem.identifier}`,
      output: `transcript for ${context.workItem.identifier}`,
    };
  }
}

// Mock control that provides a sessionFile - simulates Pi session controller
class MockSessionControl implements ActiveRunControl {
  readonly name = "mock-session-control";

  constructor(private readonly sessionFile: string) {}

  snapshot(): ActiveRunControlSnapshot {
    return {
      state: "ready",
      sessionId: "mock-session-id",
      sessionFile: this.sessionFile,
      isStreaming: false,
      pendingMessageCount: 0,
      steeringMessages: [],
      followUpMessages: [],
      messageCount: 0,
      thinkingLevel: "off",
    };
  }

  async steer(_text: string): Promise<void> {
    // No-op for mock
  }

  async followUp(_text: string): Promise<void> {
    // No-op for mock
  }

  async abort(): Promise<void> {
    // No-op for mock
  }
}

class SessionFileWorker implements RunWorker {
  readonly name = "session-file-worker";

  async execute(context: RunWorkerContext) {
    // Create a session file in the canonical sessions directory
    const sessionsDir = join(context.runArtifacts.runDir, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const sessionFile = join(sessionsDir, "session.jsonl");
    await writeFile(sessionFile, JSON.stringify({
      type: "session",
      version: 3,
      id: "test-session",
      timestamp: "2026-03-13T00:00:00.022Z",
    }) + "\n", "utf8");

    // Attach control with the session file to persist it in the canonical artifacts
    const control = new MockSessionControl(sessionFile);
    context.activeRunRegistry?.attachControl(context.run.runId, control);

    return {
      summary: `completed ${context.workItem.identifier}`,
      output: `transcript for ${context.workItem.identifier}`,
    };
  }
}

class FailingSessionFileWorker implements RunWorker {
  readonly name = "failing-session-file-worker";

  async execute(context: RunWorkerContext): Promise<RunWorkerResult> {
    // Create a session file in the canonical sessions directory before failing
    const sessionsDir = join(context.runArtifacts.runDir, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const sessionFile = join(sessionsDir, "session.jsonl");
    await writeFile(sessionFile, JSON.stringify({
      type: "session",
      version: 3,
      id: "failed-session",
      timestamp: "2026-03-13T00:00:00.022Z",
    }) + "\n", "utf8");

    // Attach control with the session file to persist it in the canonical artifacts
    const control = new MockSessionControl(sessionFile);
    context.activeRunRegistry?.attachControl(context.run.runId, control);

    // Throw an error to simulate a failed run
    throw new Error("Intentional failure for testing");
  }
}

describe("run artifact contracts", () => {
  test("writes canonical work item identity into status and summary artifacts", async () => {
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-run-artifacts-tracker-"));
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-run-artifacts-runs-"));
    await resetTrackerState({ trackerDir });
    const tracker = createLocalTrackerAdapter(trackerDir);
    await tracker.store.createIssue({
      identifier: "LOCAL-A1",
      title: "Artifact contract",
      state: "todo",
      priority: "high",
    });

    const result = await new Orchestrator({
      tracker,
      worker: new ArtifactWorker(),
      runsRootDir,
      agentType: "implementation",
    }).runOnce();

    const inspection = await inspectRun(runsRootDir, result.run.runId);
    expect(inspection.status.workItemIdentifier).toBe("LOCAL-A1");
    expect(inspection.status.workItemTitle).toBe("Artifact contract");
    expect(inspection.summary?.workItemIdentifier).toBe("LOCAL-A1");
    expect(inspection.summary?.workItemTitle).toBe("Artifact contract");
    expect(inspection.summary?.summary).toBe("completed LOCAL-A1");
  });

  test("persists sessionFile into run summary artifacts when session file exists in canonical sessions directory", async () => {
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-run-session-file-tracker-"));
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-run-session-file-runs-"));
    await resetTrackerState({ trackerDir });
    const tracker = createLocalTrackerAdapter(trackerDir);
    await tracker.store.createIssue({
      identifier: "LOCAL-B1",
      title: "Session file test",
      state: "todo",
    });

    const activeRunRegistry = new ActiveRunRegistry();
    const result = await new Orchestrator({
      tracker,
      worker: new SessionFileWorker(),
      runsRootDir,
      agentType: "implementation",
      activeRunRegistry,
    }).runOnce();

    const inspection = await inspectRun(runsRootDir, result.run.runId);
    expect(inspection.summary?.sessionFile).toBeDefined();
    expect(inspection.summary?.sessionFile).toContain("sessions");
    expect(inspection.summary?.sessionFile).toContain("session.jsonl");
  });

  test("does not include sessionFile in summary when no session file exists in canonical sessions directory", async () => {
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-run-no-session-file-tracker-"));
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-run-no-session-file-runs-"));
    await resetTrackerState({ trackerDir });
    const tracker = createLocalTrackerAdapter(trackerDir);
    await tracker.store.createIssue({
      identifier: "LOCAL-C1",
      title: "No session file test",
      state: "todo",
    });

    const result = await new Orchestrator({
      tracker,
      worker: new ArtifactWorker(),
      runsRootDir,
      agentType: "implementation",
    }).runOnce();

    const inspection = await inspectRun(runsRootDir, result.run.runId);
    expect(inspection.summary?.sessionFile).toBeUndefined();
  });

  test("persists sessionFile into run summary artifacts when session file exists and run fails", async () => {
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-run-fail-session-file-tracker-"));
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-run-fail-session-file-runs-"));
    await resetTrackerState({ trackerDir });
    const tracker = createLocalTrackerAdapter(trackerDir);
    await tracker.store.createIssue({
      identifier: "LOCAL-D1",
      title: "Failed run with session file",
      state: "todo",
    });

    const activeRunRegistry = new ActiveRunRegistry();
    let failedRunId: string | undefined;
    try {
      await new Orchestrator({
        tracker,
        worker: new FailingSessionFileWorker(),
        runsRootDir,
        agentType: "implementation",
        activeRunRegistry,
      }).runOnce();
    } catch (error) {
      // Expected to fail - the run record was created before the error
      // Find the run in the runs directory by looking for status.json with "failed" status
      const { readdir, readFile } = await import("node:fs/promises");
      const runDirs = await readdir(runsRootDir);
      for (const dir of runDirs) {
        const statusPath = join(runsRootDir, dir, "status.json");
        try {
          const status = JSON.parse(await readFile(statusPath, "utf8"));
          if (status.status === "failed") {
            failedRunId = status.runId;
            break;
          }
        } catch {
          // Not a valid run dir, skip
        }
      }
    }

    expect(failedRunId).toBeDefined();

    const inspection = await inspectRun(runsRootDir, failedRunId!);
    expect(inspection.summary?.status).toBe("failed");
    expect(inspection.summary?.sessionFile).toBeDefined();
    expect(inspection.summary?.sessionFile).toContain("sessions");
    expect(inspection.summary?.sessionFile).toContain("session.jsonl");
  });
});
