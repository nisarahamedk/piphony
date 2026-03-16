import { Orchestrator, StubWorker } from "../core/orchestrator.js";
import { ensureDir } from "../core/utils.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { resetTrackerState } from "../tracker/local/harness.js";
import { createOnboardedOpenclawsseumProject } from "../fixtures/project.js";

const fixture = await createOnboardedOpenclawsseumProject();
const { runsRootDir, trackerDir } = fixture.paths;

try {
  await ensureDir(runsRootDir);
  await resetTrackerState({ trackerDir });
  const adapter = createLocalTrackerAdapter(trackerDir);
  await adapter.store.createIssue({
    identifier: "LOCAL-201",
    title: "Orchestrator smoke",
    state: "todo",
  });
  const orchestrator = new Orchestrator({
    tracker: adapter,
    worker: new StubWorker(),
    runsRootDir,
  });
  const result = await orchestrator.runOnce();
  if (result.run.status !== "completed") throw new Error(`Expected completed run, got ${result.run.status}`);
  console.log(JSON.stringify({ ok: true, runId: result.run.runId, summary: result.result?.summary }, null, 2));
} finally {
  await fixture.cleanup();
}
