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
      priority: "high",
      metadata: { source: "test" },
      audit: { createdFrom: "ui", createdBy: "human" },
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
    expect(snapshot.issues[0]?.priority).toBe("high");
    expect(snapshot.issues[0]?.audit?.createdFrom).toBe("ui");
    expect(snapshot.workers).toHaveLength(1);
    expect(snapshot.workers[0]?.workerId).toBe("worker-1");
  });

  test("serializes concurrent tracker writes across store instances without losing comments", async () => {
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-tracker-concurrency-"));
    await resetTrackerState({ trackerDir });

    const firstStore = new LocalTrackerStore({ trackerDir });
    const secondStore = new LocalTrackerStore({ trackerDir });
    const issue = await firstStore.createIssue({
      identifier: "LOCAL-T3",
      title: "Concurrent issue",
      state: "todo",
    });

    await Promise.all(
      Array.from({ length: 12 }, (_, index) => {
        const store = index % 2 === 0 ? firstStore : secondStore;
        return store.appendIssueComment(issue.identifier, {
          id: `comment-${index}`,
          body: `comment ${index}`,
          author: "test",
          createdAt: `2026-03-12T00:00:${String(index).padStart(2, "0")}.000Z`,
        });
      }),
    );

    const loaded = await secondStore.findIssue(issue.identifier);
    expect(loaded?.comments).toHaveLength(12);
    expect(loaded?.comments[0]?.body).toBe("comment 0");
    expect(loaded?.comments[11]?.body).toBe("comment 11");
  });
});

describe("tracker-local LOCAL-TEST", () => {
  test("supports LOCAL-TEST issue workflow", async () => {
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-tracker-local-test-"));
    await resetTrackerState({ trackerDir });
    const adapter = createLocalTrackerAdapter(trackerDir);
    
    // Create LOCAL-TEST issue
    const issue = await adapter.store.createIssue({ 
      identifier: "LOCAL-TEST", 
      title: "Test issue", 
      state: "todo" 
    });
    expect(issue.identifier).toBe("LOCAL-TEST");
    expect(issue.state).toBe("todo");
    
    // Transition to in_progress
    await adapter.applyMutation(issue.identifier, { type: "transition", state: "in_progress" });
    
    // Add comment
    await adapter.appendComment(issue.identifier, { body: "Test comment", author: "tester" });
    
    // Add artifact
    const artifactPath = join(trackerDir, "test-artifact.txt");
    await writeFile(artifactPath, "test artifact content\n", "utf8");
    await adapter.attachArtifact(issue.identifier, { name: "test-artifact.txt", path: artifactPath });
    
    // Verify final state
    const inspected = await adapter.inspectIssue(issue.identifier);
    expect(inspected.state).toBe("in_progress");
    expect(inspected.comments).toHaveLength(1);
    expect(inspected.comments[0]?.body).toBe("Test comment");
    expect(inspected.artifacts).toHaveLength(1);
    expect(inspected.artifacts[0]?.name).toBe("test-artifact.txt");
  });
});
