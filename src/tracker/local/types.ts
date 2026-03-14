import type { CanonicalState, TrackerArtifact, TrackerComment, WorkerHeartbeat, WorkItemPriority } from "../../core/types.js";

export interface LocalIssueAudit {
  createdFrom?: string;
  createdBy?: string;
  createdViaUiAt?: string;
  updatedFrom?: string;
  updatedViaUiAt?: string;
  lastCommentedFrom?: string;
  lastCommentedAt?: string;
}

export interface LocalIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: CanonicalState;
  labels: string[];
  assignee?: string;
  priority?: WorkItemPriority;
  branchName?: string;
  prUrl?: string;
  url: string;
  metadata: Record<string, unknown>;
  audit?: LocalIssueAudit;
  comments: TrackerComment[];
  artifacts: TrackerArtifact[];
  createdAt: string;
  updatedAt: string;
}

export interface LocalTrackerWorker extends WorkerHeartbeat {}

export interface LocalTrackerState {
  version: number;
  provider: "local";
  issues: LocalIssue[];
  workers: LocalTrackerWorker[];
}
