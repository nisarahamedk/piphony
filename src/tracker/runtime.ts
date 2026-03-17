import { resolveTrackerSelectionConfig } from "../config/tracker-provider.js";
import { createProjectTracker, loadOnboardedProjectExecution } from "../project/execution.js";
import { createTrackerProviderRegistry } from "./provider-registry.js";
import type { CreateTrackerProviderRegistryOptions, TrackerProviderRegistry } from "./provider-registry.js";
import type { TrackerProviderClient } from "./types.js";

export interface ResolvedTrackerRuntime {
  readonly selection: {
    trackerProvider: string;
    trackerProjectKey?: string;
    trackerBoardId?: string;
  };
  readonly registry: TrackerProviderRegistry;
  readonly tracker: TrackerProviderClient;
  resolve(provider?: string): TrackerProviderClient;
}

export interface ResolveTrackerRuntimeOptions {
  trackerDir: string;
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  providers?: Partial<Record<"local" | "linear" | "jira", TrackerProviderClient>>;
  /** Explicit provider for direct validation without onboarded project */
  explicitProvider?: "local" | "linear" | "jira";
}

export function resolveTrackerRuntime(options: ResolveTrackerRuntimeOptions): ResolvedTrackerRuntime {
  if (options.explicitProvider !== undefined) {
    const registryOptions: CreateTrackerProviderRegistryOptions = {
      trackerDir: options.trackerDir,
    };
    if (options.env !== undefined) {
      registryOptions.env = options.env;
    }
    if (options.fetchImpl !== undefined) {
      registryOptions.fetchImpl = options.fetchImpl;
    }
    if (options.providers !== undefined) {
      registryOptions.providers = options.providers;
    }
    const registry = createTrackerProviderRegistry(registryOptions);
    const tracker = registry.resolve(options.explicitProvider);
    return {
      selection: {
        trackerProvider: options.explicitProvider,
      },
      registry,
      tracker,
      resolve: registry.resolve,
    };
  }

  const projectRoot = options.projectRoot ?? process.cwd();
  const projectExecution = loadOnboardedProjectExecution(projectRoot);
  const selection = resolveTrackerSelectionConfig(options.env ?? process.env, projectRoot);
  const tracker = options.providers?.[selection.trackerProvider] ?? createProjectTracker({
    context: projectExecution,
    trackerDir: options.trackerDir,
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    selection,
  });

  const registry: TrackerProviderRegistry = {
    resolve(provider?: string): TrackerProviderClient {
      if (provider !== undefined && provider !== selection.trackerProvider) {
        throw new Error(
          `Project runtime exposes tracker provider '${selection.trackerProvider}', not '${provider}'.`,
        );
      }
      return tracker;
    },
  };

  return {
    selection,
    registry,
    tracker,
    resolve: registry.resolve,
  };
}
