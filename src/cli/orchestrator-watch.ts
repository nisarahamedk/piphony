import { setTimeout as sleep } from "node:timers/promises";
import { attemptCleanup } from "../core/cleanup.js";
import { errorMessage } from "../core/errors.js";
import { Orchestrator } from "../core/orchestrator.js";
import { parseOrchestratorWatchConfig } from "./orchestrator-watch-config.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { LocalTrackerStatusSink } from "../tracker/local/status-sink.js";
import { LocalTrackerStore } from "../tracker/local/state.js";
import { LocalTrackerSmokeWorker } from "../ui/worker.js";

const config = parseOrchestratorWatchConfig(process.env);
const trackerStore = new LocalTrackerStore({ trackerDir: config.trackerDir });
const tracker = createLocalTrackerAdapter(config.trackerDir);
const worker = new LocalTrackerSmokeWorker(config.repoRoot, config.trackerDir);
const orchestrator = new Orchestrator({
  tracker,
  worker,
  runsRootDir: config.runsRootDir,
  agentType: "implementation",
  pollIntervalMs: config.pollIntervalMs,
  maxConcurrentWorkers: config.maxConcurrentWorkers,
  instanceId: config.instanceId,
  statusSink: new LocalTrackerStatusSink(trackerStore),
});

let stopping = false;

async function handleShutdown(signal: string): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  console.log(`Piphony orchestrator watch stopping (${signal})`);
  await attemptCleanup(
    "orchestrator.shutdown",
    () => orchestrator.shutdown(),
    (failure) => {
      console.error("orchestrator_shutdown_error", failure);
    },
  );
  process.exit(0);
}

process.on("SIGINT", () => {
  void handleShutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void handleShutdown("SIGTERM");
});

console.log(
  `Piphony orchestrator watch starting (interval=${config.pollIntervalMs}ms, concurrency=${config.maxConcurrentWorkers}, instance=${config.instanceId})`,
);

for (;;) {
  if (stopping) {
    break;
  }
  try {
    await orchestrator.pollOnce();
  } catch (error) {
    console.error("orchestrator_watch_error", errorMessage(error));
  }
  await sleep(config.pollIntervalMs);
}
