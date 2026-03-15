import { setTimeout as sleep } from "node:timers/promises";
import { ActiveRunRegistry, type ActiveRunSnapshot } from "../core/active-run-registry.js";
import { attemptCleanup } from "../core/cleanup.js";
import { errorMessage } from "../core/errors.js";
import { Orchestrator } from "../core/orchestrator.js";
import { ensureDir } from "../core/utils.js";
import { createChiefOfStaffRegistry } from "../cos/actor.js";
import { createLocalChiefOfStaffServices } from "../cos/local-services.js";
import { ProviderCapacityService } from "../pi/provider-middleware.js";
import { LocalTrackerStatusSink } from "../tracker/local/status-sink.js";
import { LocalTrackerStore } from "../tracker/local/state.js";
import { resolveTrackerRuntime } from "../tracker/runtime.js";
import { startChiefOfStaffServer } from "../cos/server.js";
import { resolveLocalPiphonyStackConfig, type LocalPiphonyStackConfigInput } from "./local-stack-config.js";
import { createLocalStackWorker } from "./local-worker-factory.js";
import type { LocalStackWorkerMode } from "./local-worker-mode.js";

export interface LocalPiphonyStackOptions extends LocalPiphonyStackConfigInput {}

export interface StartedLocalPiphonyStack {
  readonly repoRoot: string;
  readonly trackerDir: string;
  readonly runsRootDir: string;
  readonly sessionRootDir: string;
  readonly cosEndpoint: string;
  readonly cosPort: number;
  readonly workerMode: LocalStackWorkerMode;
  readonly trackerProvider: LocalPiphonyStackOptions["trackerProvider"];
  readonly trackerProjectKey?: string;
  readonly trackerBoardId?: string;
  readonly activeRunRegistry: ActiveRunRegistry;
  readonly providerCapacityService: ProviderCapacityService;
  listActiveRuns(): ActiveRunSnapshot[];
  stop(): Promise<void>;
}

export async function startLocalPiphonyStack(options: LocalPiphonyStackOptions = {}): Promise<StartedLocalPiphonyStack> {
  const config = resolveLocalPiphonyStackConfig(options);

  await ensureDir(config.trackerDir);
  await ensureDir(config.runsRootDir);
  await ensureDir(config.sessionRootDir);

  const trackerStore = new LocalTrackerStore({ trackerDir: config.trackerDir });
  await trackerStore.ensure();
  const trackerRuntime = resolveTrackerRuntime({
    trackerDir: config.trackerDir,
    projectRoot: config.repoRoot,
    env: process.env,
    trackerProvider: config.trackerProvider,
    ...(config.trackerProjectKey === undefined ? {} : { trackerProjectKey: config.trackerProjectKey }),
    ...(config.trackerBoardId === undefined ? {} : { trackerBoardId: config.trackerBoardId }),
  });
  const trackerRegistry = trackerRuntime.registry;
  const tracker = trackerRuntime.resolve(config.trackerProvider);
  if (config.workerMode === "smoke" && tracker.provider !== "local") {
    throw new Error("Smoke worker mode requires the local tracker provider");
  }
  const activeRunRegistry = new ActiveRunRegistry();
  const providerCapacityService = new ProviderCapacityService();
  const worker = createLocalStackWorker({
    mode: config.workerMode,
    repoRoot: config.repoRoot,
    trackerDir: config.trackerDir,
    tracker,
    providerCapacityService,
  });
  const orchestrator = new Orchestrator({
    tracker,
    worker,
    runsRootDir: config.runsRootDir,
    agentType: "implementation",
    pollIntervalMs: config.pollIntervalMs,
    maxConcurrentWorkers: config.maxConcurrentWorkers,
    instanceId: config.instanceId,
    statusSink: new LocalTrackerStatusSink(trackerStore),
    activeRunRegistry,
  });

  const cosRegistry = createChiefOfStaffRegistry({
    cwd: config.repoRoot,
    sessionRootDir: config.sessionRootDir,
    services: createLocalChiefOfStaffServices({
      trackerDir: config.trackerDir,
      runsRootDir: config.runsRootDir,
      activeRunRegistry,
      projectRoot: config.repoRoot,
      trackerRegistry,
      env: process.env,
    }),
    providerCapacityService,
  });
  const cosServer = await startChiefOfStaffServer({
    registry: cosRegistry,
    port: config.cosPort,
    host: config.cosHost,
  });

  let stopping = false;
  const pollLoop = (async () => {
    while (!stopping) {
      try {
        await orchestrator.pollOnce();
      } catch (error) {
        console.error("local_stack_poll_error", errorMessage(error));
      }
      await sleep(config.pollIntervalMs);
    }
  })();

  return {
    repoRoot: config.repoRoot,
    trackerDir: config.trackerDir,
    runsRootDir: config.runsRootDir,
    sessionRootDir: config.sessionRootDir,
    cosEndpoint: cosServer.endpoint,
    cosPort: config.cosPort,
    workerMode: config.workerMode,
    trackerProvider: config.trackerProvider,
    ...(config.trackerProjectKey === undefined ? {} : { trackerProjectKey: config.trackerProjectKey }),
    ...(config.trackerBoardId === undefined ? {} : { trackerBoardId: config.trackerBoardId }),
    activeRunRegistry,
    providerCapacityService,
    listActiveRuns: () => activeRunRegistry.listSnapshots(),
    stop: async () => {
      if (stopping) {
        return;
      }
      stopping = true;
      await pollLoop;
      await attemptCleanup(
        "orchestrator.shutdown",
        () => orchestrator.shutdown(),
        (failure) => {
          console.error("local_stack_cleanup_error", failure);
        },
      );
      await attemptCleanup(
        "cos_server.close",
        () => cosServer.close(),
        (failure) => {
          console.error("local_stack_cleanup_error", failure);
        },
      );
    },
  };
}
