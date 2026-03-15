import { createLocalTrackerProviderClient } from "./local/provider.js";
import { requireJiraTrackerConfig } from "./jira/config.js";
import { JiraTrackerAdapter } from "./jira/adapter.js";
import { requireLinearTrackerConfig } from "./linear/config.js";
import { LinearTrackerAdapter } from "./linear/adapter.js";
import { parseSupportedTrackerProvider, type SupportedTrackerProvider, type TrackerProviderClient } from "./types.js";

export interface TrackerProviderRegistry {
  resolve(provider?: string): TrackerProviderClient;
}

export interface CreateTrackerProviderRegistryOptions {
  trackerDir: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  trackerProjectKey?: string;
  trackerBoardId?: string;
  providers?: Partial<Record<SupportedTrackerProvider, TrackerProviderClient>>;
}

export function createTrackerProviderRegistry(options: CreateTrackerProviderRegistryOptions): TrackerProviderRegistry {
  const env = options.env ?? process.env;
  const cache = new Map<SupportedTrackerProvider, TrackerProviderClient>();

  return {
    resolve(provider?: string): TrackerProviderClient {
      const key = parseSupportedTrackerProvider(provider, "local");
      const existing = cache.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const created = options.providers?.[key] ?? createTrackerProviderClient(key, options.trackerDir, env, options.fetchImpl, {
        ...(options.trackerProjectKey === undefined ? {} : { trackerProjectKey: options.trackerProjectKey }),
        ...(options.trackerBoardId === undefined ? {} : { trackerBoardId: options.trackerBoardId }),
      });
      cache.set(key, created);
      return created;
    },
  };
}

function createTrackerProviderClient(
  provider: SupportedTrackerProvider,
  trackerDir: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch | undefined,
  selection: { trackerProjectKey?: string; trackerBoardId?: string },
): TrackerProviderClient {
  if (provider === "local") {
    return createLocalTrackerProviderClient(trackerDir);
  }
  if (provider === "linear") {
    const config = requireLinearTrackerConfig(env);
    return new LinearTrackerAdapter({
      ...config,
      ...(selection.trackerProjectKey === undefined ? {} : { defaultTeamKey: selection.trackerProjectKey }),
    }, fetchImpl);
  }
  const config = requireJiraTrackerConfig(env);
  return new JiraTrackerAdapter({
    ...config,
    ...(selection.trackerProjectKey === undefined ? {} : { defaultProjectKey: selection.trackerProjectKey }),
  }, fetchImpl);
}
