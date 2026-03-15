import type { CanonicalState, TrackerAdapter, WorkItem, WorkItemPriority } from "../core/types.js";

export const SUPPORTED_TRACKER_PROVIDERS = ["local", "linear", "jira"] as const;

export type SupportedTrackerProvider = (typeof SUPPORTED_TRACKER_PROVIDERS)[number];

export interface TrackerBoardQuery {
  projectKey?: string;
  boardId?: string;
}

export interface TrackerCreateIssueInput {
  title: string;
  description?: string;
  state?: CanonicalState;
  labels?: string[];
  projectKey?: string;
}

export interface TrackerUpdateIssueInput {
  title?: string | undefined;
  description?: string | undefined;
  labels?: string[] | undefined;
  assignee?: string | undefined;
  priority?: WorkItemPriority | undefined;
  branchName?: string | undefined;
  prUrl?: string | undefined;
  state?: CanonicalState | undefined;
}

export interface TrackerProviderClient extends TrackerAdapter {
  fetchBoardWorkItems(input?: TrackerBoardQuery): Promise<WorkItem[]>;
  createIssue(input: TrackerCreateIssueInput): Promise<WorkItem>;
  updateIssue(id: string, input: TrackerUpdateIssueInput): Promise<WorkItem>;
}

export function parseSupportedTrackerProvider(
  raw: string | undefined,
  fallback: SupportedTrackerProvider = "local",
): SupportedTrackerProvider {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "local" || normalized === "linear" || normalized === "jira") {
    return normalized;
  }
  throw new Error(
    `Unsupported tracker provider: ${raw}. Supported providers: ${SUPPORTED_TRACKER_PROVIDERS.join(", ")}`,
  );
}
