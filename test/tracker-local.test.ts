import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createLocalTrackerAdapter } from "../src/tracker/local/adapter.js";
import { resetTrackerState } from "../src/tracker/local/harness.js";

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
});
