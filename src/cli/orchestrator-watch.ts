import { setTimeout as sleep } from "node:timers/promises";
import { attemptCleanup } from "../core/cleanup.js";
import { errorMessage } from "../core/errors.js";
import { Orchestrator } from "../core/orchestrator.js";
import { parseOrchestratorWatchConfig } from "./orchestrator-watch-config.js";
import { ProviderCapacityService } from "../pi/provider-middleware.js";
import { loadOnboardedProjectExecution, createProjectTracker } from "../project/execution.js";
import { createLocalStackWorker } from "../stack/local-worker-factory.js";
import { LocalTrackerStatusSink } from "../tracker/local/status-sink.js";
import { LocalTrackerStore } from "../tracker/local/state.js";

const config = parseOrchestratorWatchConfig(process.env);
const projectExecution = loadOnboardedProjectExecution(config.repoRoot);
const trackerSelection = {
  trackerProvider: config.trackerProvider,
  ...(config.trackerProjectKey === undefined ? {} : { trackerProjectKey: config.trackerProjectKey }),
  ...(config.trackerBoardId === undefined ? {} : { trackerBoardId: config.trackerBoardId }),
};
const trackerStore = new LocalTrackerStore({ trackerDir: config.trackerDir });
const tracker = createProjectTracker({
  context: projectExecution,
  trackerDir: config.trackerDir,
  env: process.env,
  selection: trackerSelection,
});
if (config.workerMode === "smoke" && tracker.provider !== "local") {
  throw new Error("Smoke worker mode requires the local tracker provider");
}
const providerCapacityService = new ProviderCapacityService();
const worker = createLocalStackWorker({
  mode: config.workerMode,
  repoRoot: projectExecution.projectRoot,
  trackerDir: config.trackerDir,
  tracker,
  providerCapacityService,
});
const orchestrator = new Orchestrator({
  tracker,
  worker,
  projectExecution,
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
  `Piphony orchestrator watch starting (interval=${config.pollIntervalMs}ms, concurrency=${config.maxConcurrentWorkers}, instance=${config.instanceId}, workerMode=${config.workerMode}, trackerProvider=${tracker.provider}, extensions=${projectExecution.extensionsDir}, environmentProvider=${projectExecution.runtime.environmentProvider.id})`,
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
