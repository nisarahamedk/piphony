import type { CanonicalState, WorkerStatus } from "@piphony/core/types";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface DashboardRunSummary {
  runId: string;
  workItemId: string;
  workItemIdentifier?: string;
  workItemTitle?: string;
  agentType: string;
  executionTarget?: string;
  status: "created" | "running" | "completed" | "failed" | "idle";
  attemptNumber: number;
  startedAt: string;
  updatedAt: string;
  summary?: string;
  transcriptPreview?: string;
  usedModel?: string;
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

export interface DashboardIssueAudit {
  createdFrom?: string;
  createdBy?: string;
  createdViaUiAt?: string;
  updatedFrom?: string;
  updatedViaUiAt?: string;
  lastCommentedFrom?: string;
  lastCommentedAt?: string;
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
  audit?: DashboardIssueAudit;
  comments: DashboardIssueComment[];
  artifacts: DashboardIssueArtifact[];
  createdAt: string;
  updatedAt: string;
  latestRun?: DashboardRunSummary;
}

export interface DashboardWorkerStatus {
  workerId: string;
  ownerId: string;
  role: string;
  status: WorkerStatus;
  processId: number;
  host: string;
  startedAt: string;
  lastSeenAt: string;
  lastPollAt?: string;
  nextPollAt?: string;
  currentIssueIdentifier?: string;
  currentRunId?: string;
  details: Record<string, JsonValue>;
}

export interface DashboardStats {
  openIssues: number;
  activeRuns: number;
  activeWorkers: number;
  staleWorkers: number;
  failedRuns: number;
  updatedAt: string;
}

export interface DashboardSnapshot {
  issues: DashboardIssue[];
  recentRuns: DashboardRunSummary[];
  workers: DashboardWorkerStatus[];
  stats: DashboardStats;
}

export interface RunEventItem {
  timestamp: string;
  event: string;
  runId?: string;
  data?: Record<string, JsonValue>;
}

export interface SessionLogEntry {
  timestamp: string;
  type: string;
  data: Record<string, JsonValue>;
}

export interface SessionLog {
  sessionFile: string;
  entries: SessionLogEntry[];
}

export interface RunDetail extends DashboardRunSummary {
  summaryData?: Record<string, JsonValue>;
  transcript?: string;
  events: RunEventItem[];
  sessionLog?: SessionLog;
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

export interface TransitionIssueInput {
  id: string;
  state: CanonicalState;
}

export interface AddCommentInput {
  id: string;
  body: string;
  author?: string;
}
