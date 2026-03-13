import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ActiveRunRegistry, type ActiveRunSnapshot } from "../core/active-run-registry.js";
import { Orchestrator } from "../core/orchestrator.js";
import { createRunId, ensureDir } from "../core/utils.js";
import { createChiefOfStaffRegistry } from "../cos/actor.js";
import { createLocalChiefOfStaffServices } from "../cos/local-services.js";
import { startChiefOfStaffServer, type ChiefOfStaffServer } from "../cos/server.js";
import { ProviderCapacityService } from "../pi/provider-middleware.js";
import { LocalTrackerImplementationWorker } from "../ui/worker.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { LocalTrackerStatusSink } from "../tracker/local/status-sink.js";
import { LocalTrackerStore } from "../tracker/local/state.js";

export interface LocalPiphonyStackOptions {
  repoRoot?: string;
  trackerDir?: string;
  runsRootDir?: string;
  sessionRootDir?: string;
  cosPort?: number;
  cosHost?: string;
  pollIntervalMs?: number;
  maxConcurrentWorkers?: number;
  instanceId?: string;
}

export interface StartedLocalPiphonyStack {
  readonly repoRoot: string;
  readonly trackerDir: string;
  readonly runsRootDir: string;
  readonly sessionRootDir: string;
  readonly cosEndpoint: string;
  readonly cosPort: number;
  readonly activeRunRegistry: ActiveRunRegistry;
  readonly providerCapacityService: ProviderCapacityService;
  listActiveRuns(): ActiveRunSnapshot[];
  stop(): Promise<void>;
}

export async function startLocalPiphonyStack(options: LocalPiphonyStackOptions = {}): Promise<StartedLocalPiphonyStack> {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const trackerDir = resolve(options.trackerDir ?? join(repoRoot, ".piphony", "tracker-local"));
  const runsRootDir = resolve(options.runsRootDir ?? join(repoRoot, ".piphony", "runs"));
  const sessionRootDir = resolve(options.sessionRootDir ?? join(repoRoot, ".piphony", "cos-sessions"));
  const cosPort = options.cosPort ?? 6521;
  const cosHost = options.cosHost ?? "127.0.0.1";
  const pollIntervalMs = options.pollIntervalMs ?? Number(process.env.PIPHONY_POLL_INTERVAL_MS ?? 3000);
  const maxConcurrentWorkers = options.maxConcurrentWorkers ?? Number(process.env.PIPHONY_MAX_CONCURRENT_WORKERS ?? 1);
  const instanceId = options.instanceId ?? process.env.PIPHONY_ORCHESTRATOR_ID ?? createRunId("orchestrator");

  await ensureDir(trackerDir);
  await ensureDir(runsRootDir);
  await ensureDir(sessionRootDir);

  const trackerStore = new LocalTrackerStore({ trackerDir });
  await trackerStore.ensure();
  const tracker = createLocalTrackerAdapter(trackerDir);
  const activeRunRegistry = new ActiveRunRegistry();
  const providerCapacityService = new ProviderCapacityService();
  const orchestrator = new Orchestrator({
    tracker,
    worker: new LocalTrackerImplementationWorker(repoRoot, trackerDir, providerCapacityService),
    runsRootDir,
    agentType: "implementation",
    pollIntervalMs,
    maxConcurrentWorkers,
    instanceId,
    statusSink: new LocalTrackerStatusSink(trackerStore),
    activeRunRegistry,
  });

  const cosRegistry = createChiefOfStaffRegistry({
    cwd: repoRoot,
    sessionRootDir,
    services: createLocalChiefOfStaffServices({
      trackerDir,
      runsRootDir,
      activeRunRegistry,
    }),
    providerCapacityService,
  });
  const cosServer = await startChiefOfStaffServer({
    registry: cosRegistry,
    port: cosPort,
    host: cosHost,
  });

  let stopping = false;
  const pollLoop = (async () => {
    while (!stopping) {
      try {
        await orchestrator.pollOnce();
      } catch (error) {
        console.error("local_stack_poll_error", error instanceof Error ? error.message : String(error));
      }
      await sleep(pollIntervalMs);
    }
  })();

  return {
    repoRoot,
    trackerDir,
    runsRootDir,
    sessionRootDir,
    cosEndpoint: cosServer.endpoint,
    cosPort,
    activeRunRegistry,
    providerCapacityService,
    listActiveRuns: () => activeRunRegistry.listSnapshots(),
    stop: async () => {
      if (stopping) {
        return;
      }
      stopping = true;
      await pollLoop;
      await orchestrator.shutdown().catch(() => undefined);
      await cosServer.close().catch(() => undefined);
    },
  };
}
