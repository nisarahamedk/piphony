import { setTimeout as sleep } from "node:timers/promises";
import { repoRoot, runsRootDir, trackerDir } from "../smoke/_common.js";
import { Orchestrator } from "../core/orchestrator.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { LocalTrackerImplementationWorker } from "../ui/worker.js";

const intervalMs = Number(process.env.PIPHONY_POLL_INTERVAL_MS ?? 3000);
const tracker = createLocalTrackerAdapter(trackerDir);
const worker = new LocalTrackerImplementationWorker(repoRoot, trackerDir);
const orchestrator = new Orchestrator({
  tracker,
  worker,
  runsRootDir,
  agentType: "implementation",
});

console.log(`Piphony orchestrator watch starting (interval=${intervalMs}ms)`);

for (;;) {
  try {
    const candidates = await tracker.fetchCandidateWorkItems();
    if (candidates.length > 0) {
      await orchestrator.runOnce();
    }
  } catch (error) {
    console.error("orchestrator_watch_error", error instanceof Error ? error.message : String(error));
  }
  await sleep(intervalMs);
}
