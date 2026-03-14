import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Orchestrator, type RunWorker, type RunWorkerContext } from "../src/core/orchestrator.js";
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
});
