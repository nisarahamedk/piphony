import { resolveJiraTrackerConfig } from "./jira/config.js";
import { resolveLinearTrackerConfig } from "./linear/config.js";

export function hasLinearTrackerLiveValidationConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  const config = resolveLinearTrackerConfig(env);
  return config !== undefined && config.defaultTeamKey !== undefined;
}

export function hasJiraTrackerLiveValidationConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  const config = resolveJiraTrackerConfig(env);
  return config !== undefined && config.defaultProjectKey !== undefined;
}
