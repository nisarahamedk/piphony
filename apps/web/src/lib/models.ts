import type { CanonicalState } from "@piphony/core/types";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface DashboardRunSummary {
  runId: string;
  workItemId: string;
  workItemIdentifier?: string;
  workItemTitle?: string;
  agentType: string;
  runtimeProvider?: string;
  status: "created" | "running" | "completed" | "failed" | "idle";
  attemptNumber: number;
  startedAt: string;
  updatedAt: string;
  summary?: string;
  transcriptPreview?: string;
  eventCount: number;
}

export interface DashboardIssueComment {
  id: string;
  body: string;
  createdAt: string;
  author: string;
}

export interface DashboardIssueArtifact {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface DashboardIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: CanonicalState;
  labels: string[];
  assignee?: string;
  priority?: "critical" | "high" | "medium" | "low";
  branchName?: string;
  prUrl?: string;
  url?: string;
  comments: DashboardIssueComment[];
  artifacts: DashboardIssueArtifact[];
  createdAt: string;
  updatedAt: string;
  latestRun?: DashboardRunSummary;
}

export interface DashboardStats {
  openIssues: number;
  activeRuns: number;
  draftPrs: number;
  failedRuns: number;
  updatedAt: string;
}

export interface DashboardSnapshot {
  issues: DashboardIssue[];
  recentRuns: DashboardRunSummary[];
  stats: DashboardStats;
}

export interface RunEventItem {
  timestamp: string;
  event: string;
  runId?: string;
  data?: Record<string, JsonValue>;
}

export interface RunDetail extends DashboardRunSummary {
  summaryData?: Record<string, JsonValue>;
  transcript?: string;
  events: RunEventItem[];
}

export interface CreateIssueInput {
  identifier?: string;
  title: string;
  description?: string;
  labels?: string;
  assignee?: string;
  priority?: DashboardIssue["priority"];
  branchName?: string;
  prUrl?: string;
}

export interface UpdateIssueInput {
  id: string;
  title: string;
  description?: string;
  labels?: string;
  assignee?: string;
  priority?: DashboardIssue["priority"];
  branchName?: string;
  prUrl?: string;
  state: CanonicalState;
}

export interface AddCommentInput {
  id: string;
  body: string;
  author?: string;
}
