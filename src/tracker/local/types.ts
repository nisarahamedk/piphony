import type { CanonicalState, TrackerArtifact, TrackerComment, WorkerHeartbeat } from "../../core/types.js";

export interface LocalIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: CanonicalState;
  labels: string[];
  assignee?: string;
  url: string;
  metadata: Record<string, unknown>;
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
