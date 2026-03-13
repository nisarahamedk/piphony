import { setTimeout as sleep } from "node:timers/promises";
import { createRunId } from "../core/utils.js";
import { Orchestrator } from "../core/orchestrator.js";
import { repoRoot, runsRootDir, trackerDir } from "../smoke/_common.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { LocalTrackerStatusSink } from "../tracker/local/status-sink.js";
import { LocalTrackerStore } from "../tracker/local/state.js";
import { LocalTrackerImplementationWorker } from "../ui/worker.js";

const intervalMs = Number(process.env.PIPHONY_POLL_INTERVAL_MS ?? 3000);
const maxConcurrentWorkers = Number(process.env.PIPHONY_MAX_CONCURRENT_WORKERS ?? 1);
const instanceId = process.env.PIPHONY_ORCHESTRATOR_ID ?? createRunId("orchestrator");
const trackerStore = new LocalTrackerStore({ trackerDir });
const tracker = createLocalTrackerAdapter(trackerDir);
const worker = new LocalTrackerImplementationWorker(repoRoot, trackerDir);
const orchestrator = new Orchestrator({
  tracker,
  worker,
  runsRootDir,
  agentType: "implementation",
  pollIntervalMs: intervalMs,
  maxConcurrentWorkers,
  instanceId,
  statusSink: new LocalTrackerStatusSink(trackerStore),
});

let stopping = false;

async function handleShutdown(signal: string): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  console.log(`Piphony orchestrator watch stopping (${signal})`);
  await orchestrator.shutdown().catch((error) => {
    console.error("orchestrator_shutdown_error", error instanceof Error ? error.message : String(error));
  });
  process.exit(0);
}

process.on("SIGINT", () => {
  void handleShutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void handleShutdown("SIGTERM");
});

console.log(`Piphony orchestrator watch starting (interval=${intervalMs}ms, concurrency=${maxConcurrentWorkers}, instance=${instanceId})`);

for (;;) {
  if (stopping) {
    break;
  }
  try {
    await orchestrator.pollOnce();
  } catch (error) {
    console.error("orchestrator_watch_error", error instanceof Error ? error.message : String(error));
  }
  await sleep(intervalMs);
}
