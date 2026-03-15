import type { RunWorker } from "../core/orchestrator.js";
import type { TrackerAdapter } from "../core/types.js";
import type { ProviderCapacityService } from "../pi/provider-middleware.js";
import { LocalTrackerImplementationWorker } from "./local-implementation-worker.js";
import { LocalTrackerSmokeWorker } from "./local-smoke-worker.js";
import type { LocalStackWorkerMode } from "./local-worker-mode.js";

export function createLocalStackWorker(input: {
  mode: LocalStackWorkerMode;
  repoRoot: string;
  trackerDir: string;
  tracker: TrackerAdapter;
  providerCapacityService?: ProviderCapacityService;
}): RunWorker {
  return input.mode === "real"
    ? new LocalTrackerImplementationWorker(input.repoRoot, input.tracker, input.providerCapacityService)
    : new LocalTrackerSmokeWorker(input.trackerDir);
}
