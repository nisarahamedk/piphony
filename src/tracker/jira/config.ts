export interface JiraTrackerConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  defaultProjectKey?: string;
  defaultIssueTypeName: string;
}

export function resolveJiraTrackerConfig(env: NodeJS.ProcessEnv): JiraTrackerConfig | undefined {
  const baseUrl = normalizeOptionalString(env.PIPHONY_JIRA_BASE_URL);
  const email = normalizeOptionalString(env.PIPHONY_JIRA_EMAIL);
  const apiToken = normalizeOptionalString(env.PIPHONY_JIRA_API_TOKEN);
  if (baseUrl === undefined || email === undefined || apiToken === undefined) {
    return undefined;
  }
  const defaultProjectKey = normalizeOptionalString(env.PIPHONY_JIRA_PROJECT_KEY);
  const defaultIssueTypeName = normalizeOptionalString(env.PIPHONY_JIRA_ISSUE_TYPE) ?? "Task";
  return {
    baseUrl: stripTrailingSlash(baseUrl),
    email,
    apiToken,
    defaultIssueTypeName,
    ...(defaultProjectKey === undefined ? {} : { defaultProjectKey }),
  };
}

export function requireJiraTrackerConfig(env: NodeJS.ProcessEnv): JiraTrackerConfig {
  const config = resolveJiraTrackerConfig(env);
  if (config === undefined) {
    throw new Error(
      "Jira tracker is not configured. Set PIPHONY_JIRA_BASE_URL, PIPHONY_JIRA_EMAIL, and PIPHONY_JIRA_API_TOKEN.",
    );
  }
  return config;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizeOptionalString(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
