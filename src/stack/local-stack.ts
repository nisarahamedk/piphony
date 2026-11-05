import { setTimeout as sleep } from "node:timers/promises";
import { ActiveRunRegistry, type ActiveRunSnapshot } from "../core/active-run-registry.js";
import { attemptCleanup } from "../core/cleanup.js";
import { errorMessage } from "../core/errors.js";
import { Orchestrator } from "../core/orchestrator.js";
import { ensureDir } from "../core/utils.js";
import { createChiefOfStaffRegistry } from "../cos/actor.js";
import { createLocalChiefOfStaffServices } from "../cos/local-services.js";
import { createProjectTracker, loadOnboardedProjectExecution } from "../project/execution.js";
import { ProviderCapacityService } from "../pi/provider-middleware.js";
import { startChiefOfStaffServer } from "../cos/server.js";
import { resolveLocalPiphonyStackConfig, type LocalPiphonyStackConfigInput } from "./local-stack-config.js";
import { createLocalStackWorker } from "./local-worker-factory.js";
import type { LocalStackWorkerMode } from "./local-worker-mode.js";
import { LocalTrackerStatusSink } from "../tracker/local/status-sink.js";
import { LocalTrackerStore } from "../tracker/local/state.js";

export interface LocalPiphonyStackOptions extends LocalPiphonyStackConfigInput {}

export interface StartedLocalPiphonyStack {
  readonly repoRoot: string;
  readonly extensionsPath: string;
  readonly executionTarget: string;
  readonly trackerDir: string;
  readonly runsRootDir: string;
  readonly sessionRootDir: string;
  readonly cosEndpoint: string;
  readonly cosPort: number;
  readonly workerMode: LocalStackWorkerMode;
  readonly trackerProvider: string;
  readonly trackerProjectKey?: string;
  readonly trackerBoardId?: string;
  readonly activeRunRegistry: ActiveRunRegistry;
  readonly providerCapacityService: ProviderCapacityService;
  listActiveRuns(): ActiveRunSnapshot[];
  stop(): Promise<void>;
}

export async function startLocalPiphonyStack(options: LocalPiphonyStackOptions = {}): Promise<StartedLocalPiphonyStack> {
  const config = resolveLocalPiphonyStackConfig(options);
  const projectExecution = loadOnboardedProjectExecution(config.repoRoot);
  const trackerSelection = {
    trackerProvider: config.trackerProvider,
    ...(config.trackerProjectKey === undefined ? {} : { trackerProjectKey: config.trackerProjectKey }),
    ...(config.trackerBoardId === undefined ? {} : { trackerBoardId: config.trackerBoardId }),
  };

  await ensureDir(config.trackerDir);
  await ensureDir(config.runsRootDir);
  await ensureDir(config.sessionRootDir);

  const trackerStore = new LocalTrackerStore({ trackerDir: config.trackerDir });
  await trackerStore.ensure();
  const tracker = createProjectTracker({
    context: projectExecution,
    trackerDir: config.trackerDir,
    env: process.env,
    selection: trackerSelection,
  });
  if (config.workerMode === "smoke" && tracker.provider !== "local") {
    throw new Error("Smoke worker mode requires the local tracker provider");
  }

  const activeRunRegistry = new ActiveRunRegistry();
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
    activeRunRegistry,
  });

  const cosRegistry = createChiefOfStaffRegistry({
    cwd: projectExecution.projectRoot,
    sessionRootDir: config.sessionRootDir,
    services: createLocalChiefOfStaffServices({
      trackerDir: config.trackerDir,
      runsRootDir: config.runsRootDir,
      activeRunRegistry,
      projectRoot: projectExecution.projectRoot,
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
    repoRoot: projectExecution.projectRoot,
    extensionsPath: projectExecution.extensionsDir,
    executionTarget: projectExecution.runtime.runtimePlatformProvider.id,
    trackerDir: config.trackerDir,
    runsRootDir: config.runsRootDir,
    sessionRootDir: config.sessionRootDir,
    cosEndpoint: cosServer.endpoint,
    cosPort: config.cosPort,
    workerMode: config.workerMode,
    trackerProvider: trackerSelection.trackerProvider,
    ...(trackerSelection.trackerProjectKey === undefined ? {} : { trackerProjectKey: trackerSelection.trackerProjectKey }),
    ...(trackerSelection.trackerBoardId === undefined ? {} : { trackerBoardId: trackerSelection.trackerBoardId }),
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
