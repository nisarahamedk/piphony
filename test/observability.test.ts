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
});
