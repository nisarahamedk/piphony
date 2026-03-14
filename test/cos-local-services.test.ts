import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ACTIVE_RUN_STALE_AFTER_MS, ActiveRunRegistry, type ActiveRunControl } from "../src/core/active-run-registry.js";
import { createLocalChiefOfStaffServices } from "../src/cos/local-services.js";
import { RunLogger } from "../src/observability/logger.js";
import { createRunArtifactIndex } from "../src/observability/artifact-index.js";
import { createLocalTrackerAdapter } from "../src/tracker/local/adapter.js";
import { resetTrackerState } from "../src/tracker/local/harness.js";

function makeControl(input?: { onAbort?: () => void }): ActiveRunControl {
  return {
    snapshot: () => ({
      state: "running",
      sessionId: "session-1",
      isStreaming: false,
      pendingMessageCount: 0,
      steeringMessages: [],
      followUpMessages: [],
      messageCount: 1,
      thinkingLevel: "off",
    }),
    steer: async () => undefined,
    followUp: async () => undefined,
    abort: async () => {
      input?.onAbort?.();
    },
  };
}

describe("local ChiefOfStaff services", () => {
  test("resolves issue context, active runs, and creates issues", async () => {
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-cos-tracker-"));
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-cos-runs-"));
    await resetTrackerState({ trackerDir });
    const tracker = createLocalTrackerAdapter(trackerDir);
    const issue = await tracker.store.createIssue({ identifier: "LOCAL-401", title: "Existing issue", state: "todo" });

    const logger = new RunLogger(runsRootDir, "run-cos-1");
    await logger.init({
      runId: "run-cos-1",
      workItemId: issue.id,
      agentType: "implementation",
      status: "running",
      attemptNumber: 1,
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const registry = new ActiveRunRegistry();
    registry.register({
      run: {
        runId: "run-cos-1",
        workItemId: issue.id,
        agentType: "implementation",
        status: "running",
        attemptNumber: 1,
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      workItem: tracker.normalize(issue),
      workerName: "implementation",
      artifacts: createRunArtifactIndex(logger),
    });
    registry.attachControl("run-cos-1", makeControl());

    const services = createLocalChiefOfStaffServices({ trackerDir, runsRootDir, activeRunRegistry: registry });
    const issueContext = await services.getIssueContext({ identifier: "LOCAL-401" });
    expect(issueContext.issue?.identifier).toBe("LOCAL-401");
    expect(issueContext.activeRun?.run.runId).toBe("run-cos-1");

    const overview = await services.getBoardOverview({});
    expect(overview.issues.some((item) => item.identifier === "LOCAL-401")).toBe(true);
    expect(overview.activeRuns.some((run) => run.runId === "run-cos-1")).toBe(true);

    const created = await services.createIssue({ title: "Planned follow-up" });
    expect(created.identifier).toMatch(/^LOCAL-\d+$/);
    expect(created.title).toBe("Planned follow-up");
  });

  test("flags stale runs and retries issues", async () => {
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-cos-tracker-"));
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-cos-runs-"));
    await resetTrackerState({ trackerDir });
    const tracker = createLocalTrackerAdapter(trackerDir);
    const issue = await tracker.store.createIssue({ identifier: "LOCAL-402", title: "Retry me", state: "human_review" });

    let aborted = false;
    const registry = new ActiveRunRegistry();
    registry.register({
      run: {
        runId: "run-cos-stale",
        workItemId: issue.id,
        agentType: "implementation",
        status: "running",
        attemptNumber: 2,
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      workItem: tracker.normalize(issue),
      workerName: "implementation",
      artifacts: {
        runDir: "",
        eventsPath: "",
        statusPath: "",
        summaryPath: "",
        transcriptPath: "",
        transcriptMetaPath: "",
        artifactsDir: "",
        sessionsDir: "",
      },
    });
    registry.updateHeartbeat("run-cos-stale", {
      workerId: "worker-1",
      ownerId: "local-user",
      role: "implementation",
      status: "running",
      processId: 123,
      host: "localhost",
      startedAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: new Date(Date.now() - ACTIVE_RUN_STALE_AFTER_MS - 5_000).toISOString(),
      currentIssueIdentifier: "LOCAL-402",
      currentRunId: "run-cos-stale",
      details: {},
    });
    registry.attachControl("run-cos-stale", makeControl({ onAbort: () => {
      aborted = true;
    } }));

    const services = createLocalChiefOfStaffServices({ trackerDir, runsRootDir, activeRunRegistry: registry });
    const overview = await services.getBoardOverview({});
    expect(overview.activeRuns.find((run) => run.runId === "run-cos-stale")?.health).toBe("stale");
    expect(overview.needsAttention.some((item) => item.kind === "stale_run" && item.issueIdentifier === "LOCAL-402")).toBe(true);

    const retried = await services.retryIssue("LOCAL-402");
    expect(aborted).toBe(true);
    expect(retried.state).toBe("todo");
  });
});
