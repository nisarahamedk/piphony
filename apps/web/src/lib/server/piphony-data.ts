import { basename } from "node:path";
import { CANONICAL_STATES, type CanonicalState, type WorkItem, type WorkerStatus } from "@piphony/core/types";
import { nowIso } from "@piphony/core/utils";
import { parseCanonicalState } from "@piphony/core/work-item-transitions";
import { inspectRun, listRuns, listRunSummaries, type RunInspection, type RunSummaryInspection } from "@piphony/observability";
import { resolveTrackerRuntime } from "@piphony/tracker/runtime";
import { resolveWebServerPaths } from "./config";
import { LocalTrackerStore } from "@piphony/tracker/local/state";
import type { LocalIssue, LocalTrackerState, LocalTrackerWorker } from "@piphony/tracker/local/types";
import type {
  DashboardIssue,
  DashboardRunSummary,
  DashboardSnapshot,
  DashboardWorkerStatus,
  JsonValue,
  RunDetail,
} from "../models";

const webServerPaths = resolveWebServerPaths();
const trackerDir = webServerPaths.trackerDir;
const runsDir = webServerPaths.runsRootDir;
const trackerRuntime = resolveTrackerRuntime({
  trackerDir,
  projectRoot: webServerPaths.repoRoot,
  env: process.env,
});
const trackerSelection = trackerRuntime.selection;
const WORKER_STALE_AFTER_MS = 15_000;

export function getTrackerStore(): LocalTrackerStore {
  return new LocalTrackerStore({ trackerDir });
}

export function getTrackerProvider() {
  return trackerRuntime.tracker;
}

export function getTrackerSelection() {
  return trackerSelection;
}

export async function readDashboardSnapshot(): Promise<DashboardSnapshot> {
  const [issues, recentRuns, workers] = await Promise.all([readIssues(), readRunsIndex(), readWorkers()]);
  const latestRunByIssueId = new Map<string, DashboardRunSummary>();
  for (const run of recentRuns) {
    if (run.workItemId !== "none" && !latestRunByIssueId.has(run.workItemId)) {
      latestRunByIssueId.set(run.workItemId, run);
    }
  }

  const enrichedIssues = issues.map((issue) => {
    const latestRun = latestRunByIssueId.get(issue.id);
    return latestRun === undefined ? issue : { ...issue, latestRun };
  });

  return {
    issues: enrichedIssues,
    recentRuns,
    workers,
    stats: {
      openIssues: enrichedIssues.filter((issue) => !["done", "cancelled"].includes(issue.state)).length,
      activeRuns: recentRuns.filter((run) => run.status === "running" || run.status === "created").length,
      activeWorkers: workers.filter((worker) => worker.status === "running" || worker.status === "polling").length,
      staleWorkers: workers.filter((worker) => worker.status === "stale").length,
      failedRuns: recentRuns.filter((run) => run.status === "failed").length,
      updatedAt: nowIso(),
    },
  };
}

export async function readIssues(): Promise<DashboardIssue[]> {
  if (trackerSelection.trackerProvider === "local") {
    const state = await getTrackerStore().load();
    return state.issues
      .map(serializeLocalIssue)
      .sort((left, right) => left.identifier.localeCompare(right.identifier, undefined, { numeric: true }));
  }

  const issues = await getTrackerProvider().fetchBoardWorkItems({
    ...(trackerSelection.trackerProjectKey === undefined ? {} : { projectKey: trackerSelection.trackerProjectKey }),
    ...(trackerSelection.trackerBoardId === undefined ? {} : { boardId: trackerSelection.trackerBoardId }),
  });
  return issues
    .map(serializeWorkItem)
    .sort((left, right) => left.identifier.localeCompare(right.identifier, undefined, { numeric: true }));
}

export async function readIssueById(id: string): Promise<DashboardIssue | undefined> {
  if (trackerSelection.trackerProvider === "local") {
    const state = await getTrackerStore().load();
    const issue = state.issues.find((item) => item.id === id || item.identifier === id);
    return issue === undefined ? undefined : serializeLocalIssue(issue);
  }

  const tracker = getTrackerProvider();
  const issue = await tracker.fetchWorkItemById(id) ?? await tracker.fetchWorkItemByIdentifier(id);
  return issue === undefined ? undefined : serializeWorkItem(issue);
}

export async function readWorkers(): Promise<DashboardWorkerStatus[]> {
  const state = await getTrackerStore().load();
  return state.workers
    .map(serializeWorker)
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
}

export async function readRunsIndex(): Promise<DashboardRunSummary[]> {
  const runs = await listRunSummaries(runsDir);
  return runs
    .map(serializeRunSummary)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readRunDetail(runId: string): Promise<RunDetail | undefined> {
  const runIds = await listRuns(runsDir);
  if (!runIds.includes(runId)) {
    return undefined;
  }
  const run = await inspectRun(runsDir, runId);
  const summary = serializeRunSummary(run);
  const trimmedTranscript = run.transcript?.trim() === "" ? undefined : run.transcript;
  return {
    ...summary,
    ...(run.summary === undefined ? {} : { summaryData: toJsonRecord(run.summary as unknown as Record<string, unknown>) }),
    ...(trimmedTranscript === undefined ? {} : { transcript: trimmedTranscript }),
    events: run.events.map((event) => ({
      timestamp: event.timestamp,
      event: event.event,
      ...(event.runId === undefined ? {} : { runId: event.runId }),
      ...(event.data === undefined ? {} : { data: toJsonRecord(event.data) }),
    })),
    ...(run.sessionLog === undefined ? {} : {
      sessionLog: {
        sessionFile: run.sessionLog.sessionFile,
        entries: run.sessionLog.entries.map((entry) => ({
          timestamp: entry.timestamp,
          type: entry.type,
          data: toJsonRecord(entry.data),
        })),
      },
    }),
  };
}

export async function nextSuggestedIdentifier(): Promise<string> {
  if (trackerSelection.trackerProvider !== "local") {
    throw new Error(`Suggested identifiers are only available for the local tracker provider, got ${trackerSelection.trackerProvider}`);
  }
  const state = await getTrackerStore().load();
  const max = state.issues.reduce((highest, issue) => {
    const match = issue.identifier.match(/(\d+)$/);
    if (match === null) {
      return highest;
    }
    return Math.max(highest, Number(match[1]));
  }, 100);
  return `LOCAL-${max + 1}`;
}

export function normalizeLabels(raw?: string): string[] {
  return (raw ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

export function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

export function normalizeState(value: string): CanonicalState {
  return parseCanonicalState(value, "issue state");
}

export function normalizePriority(value?: string): DashboardIssue["priority"] | undefined {
  const trimmed = normalizeOptionalString(value);
  return trimmed === "critical" || trimmed === "high" || trimmed === "medium" || trimmed === "low"
    ? trimmed
    : undefined;
}

function serializeLocalIssue(issue: LocalIssue): DashboardIssue {
  const description = normalizeOptionalString(issue.description);
  const assignee = normalizeOptionalString(issue.assignee);
  const url = normalizeOptionalString(issue.url);

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    ...(description === undefined ? {} : { description }),
    state: issue.state,
    labels: [...issue.labels],
    ...(assignee === undefined ? {} : { assignee }),
    ...(issue.priority === undefined ? {} : { priority: issue.priority }),
    ...(issue.branchName === undefined ? {} : { branchName: issue.branchName }),
    ...(issue.prUrl === undefined ? {} : { prUrl: issue.prUrl }),
    ...(url === undefined ? {} : { url }),
    ...(issue.audit === undefined ? {} : { audit: { ...issue.audit } }),
    comments: issue.comments.map((comment) => ({ ...comment })),
    artifacts: issue.artifacts.map((artifact) => ({ ...artifact })),
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}

function serializeWorkItem(issue: WorkItem): DashboardIssue {
  const description = normalizeOptionalString(issue.description);
  const assignee = normalizeOptionalString(issue.assignee);
  const url = normalizeOptionalString(issue.url);

  return {
    id: issue.externalId,
    identifier: issue.identifier,
    title: issue.title,
    ...(description === undefined ? {} : { description }),
    state: issue.state,
    labels: [...issue.labels],
    ...(assignee === undefined ? {} : { assignee }),
    ...(issue.priority === undefined ? {} : { priority: issue.priority }),
    ...(issue.branchName === undefined ? {} : { branchName: issue.branchName }),
    ...(issue.prUrl === undefined ? {} : { prUrl: issue.prUrl }),
    ...(url === undefined ? {} : { url }),
    comments: [],
    artifacts: [],
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}

function serializeWorker(worker: LocalTrackerWorker): DashboardWorkerStatus {
  const lastSeenMs = Date.parse(worker.lastSeenAt);
  const status = worker.status === "offline"
    ? "offline"
    : Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs > WORKER_STALE_AFTER_MS
      ? "stale"
      : worker.status;

  return {
    workerId: worker.workerId,
    ownerId: worker.ownerId,
    role: worker.role,
    status: status as WorkerStatus,
    processId: worker.processId,
    host: worker.host,
    startedAt: worker.startedAt,
    lastSeenAt: worker.lastSeenAt,
    ...(worker.lastPollAt === undefined ? {} : { lastPollAt: worker.lastPollAt }),
    ...(worker.nextPollAt === undefined ? {} : { nextPollAt: worker.nextPollAt }),
    ...(worker.currentIssueIdentifier === undefined ? {} : { currentIssueIdentifier: worker.currentIssueIdentifier }),
    ...(worker.currentRunId === undefined ? {} : { currentRunId: worker.currentRunId }),
    details: toJsonRecord(worker.details),
  };
}

function serializeRunSummary(run: RunInspection | RunSummaryInspection): DashboardRunSummary {
  const summaryText = run.summary?.summary ?? run.summary?.error;
  const transcriptPreview = "transcript" in run
    ? run.transcript
      ?.split("\n")
      .map((line) => line.trim())
      .find(Boolean)
    : undefined;
  const eventCount = "events" in run ? run.events.length : 0;

  return {
    runId: run.status.runId,
    workItemId: run.status.workItemId,
    ...(run.status.workItemIdentifier === undefined ? {} : { workItemIdentifier: run.status.workItemIdentifier }),
    ...(run.status.workItemTitle === undefined ? {} : { workItemTitle: run.status.workItemTitle }),
    agentType: run.status.agentType,
    ...(run.status.executionTarget === undefined ? {} : { executionTarget: run.status.executionTarget }),
    status: run.status.status,
    attemptNumber: run.status.attemptNumber,
    startedAt: run.status.startedAt,
    updatedAt: run.status.updatedAt,
    ...(summaryText === undefined ? {} : { summary: summaryText }),
    ...(transcriptPreview === undefined ? {} : { transcriptPreview }),
    ...(run.summary?.usedModel === undefined ? {} : { usedModel: run.summary.usedModel }),
    eventCount,
  };
}

function toJsonRecord(value: Record<string, unknown>): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const serialized = toJsonValue(item);
      return serialized === undefined ? [] : [[key, serialized]];
    }),
  );
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => toJsonValue(item))
      .filter((item): item is JsonValue => item !== undefined);
    return items;
  }
  if (typeof value === "object") {
    return toJsonRecord(value as Record<string, unknown>);
  }
  return undefined;
}

export async function readTrackerState(): Promise<LocalTrackerState> {
  return getTrackerStore().load();
}

export function formatRunDirName(path: string): string {
  return basename(path);
}
