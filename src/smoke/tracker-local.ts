import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureDir } from "../core/utils.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { resetTrackerState } from "../tracker/local/harness.js";
import { createOnboardedOpenclawsseumProject } from "../fixtures/project.js";
import { repoRoot } from "./_common.js";

const fixture = await createOnboardedOpenclawsseumProject();
const { trackerDir } = fixture.paths;
const seedPath = join(repoRoot, "src", "tracker", "local", "seed-state.json");

try {
  await resetTrackerState({ trackerDir, seedPath });
  const adapter = createLocalTrackerAdapter(trackerDir);
  const created = await adapter.store.createIssue({
    identifier: "LOCAL-101",
    title: "Tracker smoke issue",
    description: "Smoke test issue",
    state: "todo",
    labels: ["smoke"],
  });
  await adapter.applyMutation(created.identifier, { type: "transition", state: "in_progress" });
  await adapter.appendComment(created.identifier, { body: "Tracker smoke comment", author: "smoke" });
  const tempDir = join(fixture.projectRoot, ".tmp");
  await ensureDir(tempDir);
  const artifactPath = join(tempDir, "tracker-smoke.txt");
  await writeFile(artifactPath, "tracker smoke artifact\n", "utf8");
  await adapter.attachArtifact(created.identifier, { name: "tracker-smoke.txt", path: artifactPath });
  const inspected = await adapter.inspectIssue(created.identifier);
  const dumped = await adapter.dumpState() as { issues: unknown[] };
  if (inspected.state !== "in_progress") throw new Error("Issue did not transition to in_progress");
  if (inspected.comments.length !== 1) throw new Error("Issue comment missing");
  if (inspected.artifacts.length !== 1) throw new Error("Issue artifact missing");
  console.log(JSON.stringify({ ok: true, trackerDir, issue: inspected.identifier, issueCount: dumped.issues.length }, null, 2));
} finally {
  await fixture.cleanup();
}
