import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createLocalTrackerAdapter } from "../src/tracker/local/adapter.js";
import { resetTrackerState } from "../src/tracker/local/harness.js";
import { LocalTrackerStore } from "../src/tracker/local/state.js";

describe("tracker-local", () => {
  test("supports create, transition, comment, and artifact flows", async () => {
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-tracker-test-"));
    await resetTrackerState({ trackerDir });
    const adapter = createLocalTrackerAdapter(trackerDir);
    const issue = await adapter.store.createIssue({ identifier: "LOCAL-T1", title: "Test issue", state: "todo" });
    await adapter.applyMutation(issue.identifier, { type: "transition", state: "in_progress" });
    await adapter.appendComment(issue.identifier, { body: "hello" });
    const artifactPath = join(trackerDir, "artifact.txt");
    await writeFile(artifactPath, "artifact\n", "utf8");
    await adapter.attachArtifact(issue.identifier, { name: "artifact.txt", path: artifactPath });
    const inspected = await adapter.inspectIssue(issue.identifier);
    expect(inspected.state).toBe("in_progress");
    expect(inspected.comments).toHaveLength(1);
    expect(inspected.artifacts).toHaveLength(1);
  });

  test("persists issues and worker heartbeats in sqlite across store instances", async () => {
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-tracker-persist-"));
    await resetTrackerState({ trackerDir });

    const firstStore = new LocalTrackerStore({ trackerDir });
    await firstStore.createIssue({
      identifier: "LOCAL-T2",
      title: "Persistent issue",
      state: "backlog",
      metadata: { priority: "high" },
    });
    await firstStore.upsertWorker({
      workerId: "worker-1",
      ownerId: "orch-1",
      role: "orchestrator",
      status: "idle",
      processId: 123,
      host: "localhost",
      startedAt: "2026-03-12T00:00:00.000Z",
      lastSeenAt: "2026-03-12T00:00:01.000Z",
      details: { pollIntervalMs: 3000 },
    });

    const secondStore = new LocalTrackerStore({ trackerDir });
    const snapshot = await secondStore.load();
    expect(snapshot.issues).toHaveLength(1);
    expect(snapshot.issues[0]?.identifier).toBe("LOCAL-T2");
    expect(snapshot.workers).toHaveLength(1);
    expect(snapshot.workers[0]?.workerId).toBe("worker-1");
  });
});
