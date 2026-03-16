import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { inspectRun, listRuns } from "../src/observability/index.js";

describe("observability artifact reading", () => {
  test("returns no runs when the runs directory is missing", async () => {
    await expect(listRuns(join(tmpdir(), `missing-runs-${Date.now()}`))).resolves.toEqual([]);
  });

  test("throws when summary.json is corrupt instead of silently hiding it", async () => {
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-observability-"));
    const runId = "run-1";
    const runDir = join(runsRootDir, runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "status.json"), JSON.stringify({
      runId,
      workItemId: "issue-1",
      agentType: "implementation",
      status: "completed",
      attemptNumber: 1,
      startedAt: "2026-03-13T00:00:00.000Z",
      updatedAt: "2026-03-13T00:00:01.000Z",
    }), "utf8");
    await writeFile(join(runDir, "summary.json"), "{not-json}", "utf8");

    await expect(inspectRun(runsRootDir, runId)).rejects.toThrow(/Failed to parse JSON artifact/);
  });

  test("throws when events.jsonl is corrupt instead of pretending the run had no events", async () => {
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-observability-events-"));
    const runId = "run-2";
    const runDir = join(runsRootDir, runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "status.json"), JSON.stringify({
      runId,
      workItemId: "issue-2",
      agentType: "implementation",
      status: "failed",
      attemptNumber: 1,
      startedAt: "2026-03-13T00:00:00.000Z",
      updatedAt: "2026-03-13T00:00:01.000Z",
    }), "utf8");
    await writeFile(join(runDir, "events.jsonl"), "not-json\n", "utf8");

    await expect(inspectRun(runsRootDir, runId)).rejects.toThrow(/Failed to parse JSONL artifact/);
  });

  test("parses session log when sessionFile is present in summary", async () => {
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-observability-session-"));
    const runId = "run-3";
    const runDir = join(runsRootDir, runId);
    const sessionsDir = join(runDir, "sessions");
    await mkdir(sessionsDir, { recursive: true });

    const sessionFile = join(sessionsDir, "session.jsonl");
    // Real Pi session JSONL format: each line has type, timestamp, id, parentId, and other fields
    // The parser normalizes to { timestamp, type, data } where data contains the rest
    await writeFile(sessionFile, JSON.stringify({
      type: "session",
      version: 3,
      id: "abc123",
      timestamp: "2026-03-13T00:00:00.022Z",
      cwd: "/test",
    }) + "\n" + JSON.stringify({
      type: "model_change",
      id: "5984af29",
      parentId: null,
      timestamp: "2026-03-13T00:00:01.022Z",
      provider: "minimax",
      modelId: "MiniMax-M2.5",
    }) + "\n" + JSON.stringify({
      type: "message",
      id: "bde25870",
      parentId: "5984af29",
      timestamp: "2026-03-13T00:00:02.023Z",
      message: { role: "user", content: [{ type: "text", text: "Hello" }] },
    }) + "\n", "utf8");

    await writeFile(join(runDir, "status.json"), JSON.stringify({
      runId,
      workItemId: "issue-3",
      agentType: "implementation",
      status: "completed",
      attemptNumber: 1,
      startedAt: "2026-03-13T00:00:00.000Z",
      updatedAt: "2026-03-13T00:00:02.000Z",
    }), "utf8");
    await writeFile(join(runDir, "summary.json"), JSON.stringify({
      runId,
      workItemId: "issue-3",
      status: "completed",
      sessionFile,
    }), "utf8");

    const result = await inspectRun(runsRootDir, runId);
    expect(result.sessionLog).toBeDefined();
    expect(result.sessionLog!.sessionFile).toBe(sessionFile);
    expect(result.sessionLog!.entries).toHaveLength(3);

    // First entry - session type
    const entry0 = result.sessionLog!.entries[0]!;
    expect(entry0.type).toBe("session");
    expect(entry0.timestamp).toBe("2026-03-13T00:00:00.022Z");
    expect(entry0.data.version).toBe(3);
    expect(entry0.data.id).toBe("abc123");
    expect(entry0.data.cwd).toBe("/test");

    // Second entry - model_change type
    const entry1 = result.sessionLog!.entries[1]!;
    expect(entry1.type).toBe("model_change");
    expect(entry1.timestamp).toBe("2026-03-13T00:00:01.022Z");
    expect(entry1.data.provider).toBe("minimax");
    expect(entry1.data.modelId).toBe("MiniMax-M2.5");
    expect(entry1.data.parentId).toBeNull();

    // Third entry - message type
    const entry2 = result.sessionLog!.entries[2]!;
    expect(entry2.type).toBe("message");
    expect((entry2.data.message as { role: string }).role).toBe("user");
  });

  test("throws when declared session file does not exist", async () => {
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-observability-session-missing-"));
    const runId = "run-4";
    const runDir = join(runsRootDir, runId);
    await mkdir(runDir, { recursive: true });

    await writeFile(join(runDir, "status.json"), JSON.stringify({
      runId,
      workItemId: "issue-4",
      agentType: "implementation",
      status: "completed",
      attemptNumber: 1,
      startedAt: "2026-03-13T00:00:00.000Z",
      updatedAt: "2026-03-13T00:00:01.000Z",
    }), "utf8");
    await writeFile(join(runDir, "summary.json"), JSON.stringify({
      runId,
      workItemId: "issue-4",
      status: "completed",
      sessionFile: join(runDir, "sessions", "nonexistent.jsonl"),
    }), "utf8");

    // Missing declared session files must fail loudly - do not silently return empty entries
    await expect(inspectRun(runsRootDir, runId)).rejects.toThrow(/Session log artifact.*not found/);
  });

  test("throws when session JSONL is corrupt instead of silently hiding it", async () => {
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-observability-session-corrupt-"));
    const runId = "run-5";
    const runDir = join(runsRootDir, runId);
    const sessionsDir = join(runDir, "sessions");
    await mkdir(sessionsDir, { recursive: true });

    const sessionFile = join(sessionsDir, "session.jsonl");
    await writeFile(sessionFile, "not-json\n", "utf8");

    await writeFile(join(runDir, "status.json"), JSON.stringify({
      runId,
      workItemId: "issue-5",
      agentType: "implementation",
      status: "completed",
      attemptNumber: 1,
      startedAt: "2026-03-13T00:00:00.000Z",
      updatedAt: "2026-03-13T00:00:01.000Z",
    }), "utf8");
    await writeFile(join(runDir, "summary.json"), JSON.stringify({
      runId,
      workItemId: "issue-5",
      status: "completed",
      sessionFile,
    }), "utf8");

    await expect(inspectRun(runsRootDir, runId)).rejects.toThrow(/Failed to parse session JSONL/);
  });

  test("does not include sessionLog when sessionFile is not in summary", async () => {
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-observability-no-session-"));
    const runId = "run-6";
    const runDir = join(runsRootDir, runId);
    await mkdir(runDir, { recursive: true });

    await writeFile(join(runDir, "status.json"), JSON.stringify({
      runId,
      workItemId: "issue-6",
      agentType: "implementation",
      status: "completed",
      attemptNumber: 1,
      startedAt: "2026-03-13T00:00:00.000Z",
      updatedAt: "2026-03-13T00:00:01.000Z",
    }), "utf8");
    await writeFile(join(runDir, "summary.json"), JSON.stringify({
      runId,
      workItemId: "issue-6",
      status: "completed",
    }), "utf8");

    const result = await inspectRun(runsRootDir, runId);
    expect(result.sessionLog).toBeUndefined();
  });
});
