import type { ActiveRunEntry, ActiveRunSnapshot } from "../core/active-run-registry.js";
import type { WorkItem } from "../core/types.js";
import type { RunInspection } from "../observability/index.js";

export type TrackerPageContext = IssuePageContext | BoardPageContext;

export interface IssuePageContext {
  kind: "issue";
  provider: string;
  identifier: string;
  url?: string;
}

export interface BoardPageContext {
  kind: "board";
  provider: string;
  boardId?: string;
  projectKey?: string;
  url?: string;
}

export interface ChiefOfStaffIssueContext {
  issue?: WorkItem;
  activeRun?: ActiveRunEntry;
  latestRun?: RunInspection;
}

export interface ChiefOfStaffBoardOverview {
  provider: string;
  issues: WorkItem[];
  activeRuns: ActiveRunSnapshot[];
  needsAttention: Array<{
    kind: "failed_run" | "stale_run" | "human_review";
    message: string;
    runId?: string;
    issueIdentifier?: string;
  }>;
}

export interface CreateIssueInput {
  provider?: string;
  title: string;
  description?: string;
  state?: WorkItem["state"];
  labels?: string[];
}

export interface ChiefOfStaffServices {
  getIssueContext(input: { provider?: string; identifier: string }): Promise<ChiefOfStaffIssueContext>;
  getBoardOverview(input: { provider?: string }): Promise<ChiefOfStaffBoardOverview>;
  listActiveRuns(): Promise<ActiveRunSnapshot[]>;
  getRunDetail(runId: string): Promise<RunInspection>;
  steerRun(runId: string, message: string): Promise<void>;
  followUpRun(runId: string, message: string): Promise<void>;
  abortRun(runId: string): Promise<void>;
  retryIssue(identifier: string, provider?: string): Promise<WorkItem>;
  createIssue(input: CreateIssueInput): Promise<WorkItem>;
}
