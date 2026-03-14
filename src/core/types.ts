export const CANONICAL_STATES = [
  "backlog",
  "todo",
  "in_progress",
  "human_review",
  "rework",
  "merging",
  "done",
  "cancelled",
] as const;

export const ACTIVE_WORK_ITEM_STATES = [
  "todo",
  "in_progress",
  "rework",
  "merging",
] as const;

export const TERMINAL_WORK_ITEM_STATES = [
  "done",
  "cancelled",
] as const;

export const WORK_ITEM_PRIORITIES = ["critical", "high", "medium", "low"] as const;

export type CanonicalState = (typeof CANONICAL_STATES)[number];
export type ActiveWorkItemState = (typeof ACTIVE_WORK_ITEM_STATES)[number];
export type TerminalWorkItemState = (typeof TERMINAL_WORK_ITEM_STATES)[number];
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];
export type WorkerStatus = "idle" | "polling" | "running" | "stale" | "offline";

export interface WorkItem {
  provider: string;
  externalId: string;
  identifier: string;
  title: string;
  description?: string;
  state: CanonicalState;
  labels: string[];
  assignee?: string;
  priority?: WorkItemPriority;
  branchName?: string;
  prUrl?: string;
  url?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TrackerComment {
  id: string;
  body: string;
  createdAt: string;
  author: string;
}

export interface TrackerArtifact {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export type TrackerMutation =
  | { type: "transition"; state: CanonicalState }
  | { type: "comment"; body: string; author?: string }
  | { type: "artifact"; name: string; path: string };

export interface TrackerAdapter {
  readonly provider: string;
  fetchCandidateWorkItems(): Promise<WorkItem[]>;
  fetchWorkItemById(id: string): Promise<WorkItem | undefined>;
  fetchWorkItemByIdentifier(identifier: string): Promise<WorkItem | undefined>;
  fetchWorkItemsByState(states: CanonicalState[]): Promise<WorkItem[]>;
  normalize(issue: unknown): WorkItem;
  applyMutation(id: string, mutation: TrackerMutation): Promise<WorkItem>;
  appendComment(id: string, input: { body: string; author?: string }): Promise<TrackerComment>;
  attachArtifact(id: string, input: { name: string; path: string }): Promise<TrackerArtifact>;
}

export interface RuntimeTarget {
  id: string;
  service: string;
  workdir?: string;
}

export interface RuntimeExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface BashSpawnHookInput {
  command: string;
  cwd: string;
  env: Record<string, string | undefined>;
}

export interface BashSpawnHookOutput {
  command: string;
  cwd: string;
  env: Record<string, string | undefined>;
}

export interface RuntimeProvider {
  readonly name: string;
  prepare(input: { runId: string; workItem: WorkItem }): Promise<void>;
  start(): Promise<void>;
  waitUntilReady(): Promise<void>;
  selectTarget(input?: { preferredService?: string }): Promise<RuntimeTarget>;
  execOnTarget(target: RuntimeTarget, command: string, options?: { cwd?: string; timeoutMs?: number }): Promise<RuntimeExecResult>;
  getEndpoints(): Promise<Record<string, string>>;
  collectArtifacts(destinationDir: string): Promise<string[]>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  createBashSpawnHook?(): (input: BashSpawnHookInput) => BashSpawnHookOutput;
}

export interface RunRecord {
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
}

export interface RunSummaryRecord {
  runId: string;
  workItemId: string;
  workItemIdentifier?: string;
  workItemTitle?: string;
  status: RunRecord["status"];
  summary?: string;
  error?: string;
  transcriptPath?: string;
  usedModel?: string;
}

export interface RunWorkerResult {
  summary: string;
  output?: string;
  metadata?: Record<string, unknown>;
}

export interface EventRecord {
  timestamp: string;
  event: string;
  runId?: string;
  data?: Record<string, unknown>;
}

export interface WorktreePreparationResult {
  branchName: string;
  workspacePath: string;
  reusedExistingBranch: boolean;
  reason: string;
}

export interface ValidationResult {
  validatorName: string;
  status: "passed" | "failed";
  summary: string;
  details?: Record<string, unknown>;
  artifacts?: string[];
}

export interface WorkerHeartbeat {
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
  currentIssueId?: string;
  currentIssueIdentifier?: string;
  currentRunId?: string;
  details: Record<string, unknown>;
}

export interface OrchestratorSnapshot {
  instanceId: string;
  startedAt: string;
  status: WorkerStatus;
  pollIntervalMs: number;
  maxConcurrentWorkers: number;
  lastPollAt?: string;
  nextPollAt?: string;
  claimedIssueIds: string[];
  runningWorkers: WorkerHeartbeat[];
}

export interface OrchestratorStatusSink {
  syncSnapshot(snapshot: OrchestratorSnapshot): Promise<void>;
  upsertWorker(heartbeat: WorkerHeartbeat): Promise<void>;
  deleteWorker(workerId: string): Promise<void>;
}
