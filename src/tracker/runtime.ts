import { resolveTrackerSelectionConfig, type TrackerSelectionConfig } from "../config/tracker-provider.js";
import { createTrackerProviderRegistry, type CreateTrackerProviderRegistryOptions, type TrackerProviderRegistry } from "./provider-registry.js";
import type { TrackerProviderClient } from "./types.js";

export interface ResolvedTrackerRuntime {
  readonly selection: TrackerSelectionConfig;
  readonly registry: TrackerProviderRegistry;
  readonly tracker: TrackerProviderClient;
  resolve(provider?: string): TrackerProviderClient;
}

export interface ResolveTrackerRuntimeOptions {
  trackerDir: string;
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  providers?: CreateTrackerProviderRegistryOptions["providers"];
  trackerProvider?: TrackerSelectionConfig["trackerProvider"];
  trackerProjectKey?: string;
  trackerBoardId?: string;
}

export function resolveTrackerRuntime(options: ResolveTrackerRuntimeOptions): ResolvedTrackerRuntime {
  const baseSelection = resolveTrackerSelectionConfig(options.env ?? process.env, options.projectRoot);
  const selection: TrackerSelectionConfig = {
    trackerProvider: options.trackerProvider ?? baseSelection.trackerProvider,
    ...((options.trackerProjectKey ?? baseSelection.trackerProjectKey) === undefined
      ? {}
      : { trackerProjectKey: options.trackerProjectKey ?? baseSelection.trackerProjectKey }),
    ...((options.trackerBoardId ?? baseSelection.trackerBoardId) === undefined
      ? {}
      : { trackerBoardId: options.trackerBoardId ?? baseSelection.trackerBoardId }),
  };
  const registry = createTrackerProviderRegistry({
    trackerDir: options.trackerDir,
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.providers === undefined ? {} : { providers: options.providers }),
    ...(selection.trackerProjectKey === undefined ? {} : { trackerProjectKey: selection.trackerProjectKey }),
    ...(selection.trackerBoardId === undefined ? {} : { trackerBoardId: selection.trackerBoardId }),
  });

  const resolve = (provider?: string) => registry.resolve(provider ?? selection.trackerProvider);

  return {
    selection,
    registry,
    get tracker() {
      return resolve();
    },
    resolve,
  };
}
