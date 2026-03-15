export interface LinearTrackerConfig {
  apiUrl: string;
  apiKey: string;
  defaultTeamKey?: string;
}

export function resolveLinearTrackerConfig(env: NodeJS.ProcessEnv): LinearTrackerConfig | undefined {
  const apiKey = normalizeOptionalString(env.PIPHONY_LINEAR_API_KEY);
  if (apiKey === undefined) {
    return undefined;
  }
  const apiUrl = normalizeOptionalString(env.PIPHONY_LINEAR_API_URL) ?? "https://api.linear.app/graphql";
  const defaultTeamKey = normalizeOptionalString(env.PIPHONY_LINEAR_TEAM_KEY) ?? normalizeOptionalString(env.PIPHONY_LINEAR_PROJECT_KEY);
  return {
    apiUrl,
    apiKey,
    ...(defaultTeamKey === undefined ? {} : { defaultTeamKey }),
  };
}

export function requireLinearTrackerConfig(env: NodeJS.ProcessEnv): LinearTrackerConfig {
  const config = resolveLinearTrackerConfig(env);
  if (config === undefined) {
    throw new Error("Linear tracker is not configured. Set PIPHONY_LINEAR_API_KEY.");
  }
  return config;
}

function normalizeOptionalString(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
