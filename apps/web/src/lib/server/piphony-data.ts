import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { CANONICAL_STATES, type CanonicalState } from "@piphony/core/types";
import { nowIso } from "@piphony/core/utils";
import { LocalTrackerStore } from "@piphony/tracker/local/state";
import type { LocalIssue, LocalTrackerState } from "@piphony/tracker/local/types";
import type {
  DashboardIssue,
  DashboardRunSummary,
  DashboardSnapshot,
  JsonValue,
  RunDetail,
} from "../models";

const repoRoot = resolve(process.cwd());
const piphonyDir = resolve(repoRoot, ".piphony");
const trackerDir = resolve(piphonyDir, "tracker-local");
const runsDir = resolve(piphonyDir, "runs");

export function getTrackerStore(): LocalTrackerStore {
  return new LocalTrackerStore({ trackerDir });
}

export function getRepoRoot(): string {
  return repoRoot;
}

export async function readDashboardSnapshot(): Promise<DashboardSnapshot> {
  const [issues, recentRuns] = await Promise.all([readIssues(), readRunsIndex()]);
  const byIssueId = new Map<string, DashboardRunSummary>();
  for (const run of recentRuns) {
    if (run.workItemId !== "none" && !byIssueId.has(run.workItemId)) {
      byIssueId.set(run.workItemId, run);
    }
  }

  const enrichedIssues = issues.map((issue) => {
    const latestRun = byIssueId.get(issue.id);
    return latestRun === undefined ? issue : { ...issue, latestRun };
  });

  return {
    issues: enrichedIssues,
    recentRuns,
    stats: {
      openIssues: enrichedIssues.filter((issue) => !["done", "cancelled"].includes(issue.state)).length,
      activeRuns: recentRuns.filter((run) => run.status === "running" || run.status === "created").length,
      draftPrs: enrichedIssues.filter((issue) => typeof issue.prUrl === "string" && issue.prUrl.trim() !== "").length,
      failedRuns: recentRuns.filter((run) => run.status === "failed").length,
      updatedAt: nowIso(),
    },
  };
}

export async function readIssues(): Promise<DashboardIssue[]> {
  const store = getTrackerStore();
  await store.ensure();
  const state = await store.load();
  return state.issues
    .map((issue) => serializeIssue(issue))
    .sort((left, right) => left.identifier.localeCompare(right.identifier, undefined, { numeric: true }));
}

export async function readIssueById(id: string): Promise<DashboardIssue | undefined> {
  const issues = await readIssues();
  return issues.find((issue) => issue.id === id || issue.identifier === id);
}

export async function readRunsIndex(): Promise<DashboardRunSummary[]> {
  if (!existsSync(runsDir)) {
    return [];
  }
  const dirs = await readdir(runsDir, { withFileTypes: true });
  const runs = await Promise.all(
    dirs
      .filter((entry) => entry.isDirectory())
      .map((entry) => readRunSummary(resolve(runsDir, entry.name))),
  );
  return runs
    .filter((run): run is DashboardRunSummary => run !== undefined)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readRunDetail(runId: string): Promise<RunDetail | undefined> {
  const runDir = resolve(runsDir, runId);
  const summary = await readRunSummary(runDir);
  if (summary === undefined) {
    return undefined;
  }
  const [summaryData, transcript, events] = await Promise.all([
    readJsonIfExists<Record<string, JsonValue>>(resolve(runDir, "summary.json")),
    readTextIfExists(resolve(runDir, "transcript.md")),
    readEvents(resolve(runDir, "events.jsonl")),
  ]);
  const trimmedTranscript = transcript?.trim() === "" ? undefined : transcript;
  return {
    ...summary,
    ...(summaryData === undefined ? {} : { summaryData }),
    ...(trimmedTranscript === undefined ? {} : { transcript: trimmedTranscript }),
    events,
  };
}

export async function nextSuggestedIdentifier(): Promise<string> {
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
  return CANONICAL_STATES.includes(value as CanonicalState) ? (value as CanonicalState) : "todo";
}

function serializeIssue(issue: LocalIssue): DashboardIssue {
  const priority = readPriorityMeta(issue);
  const branchName = readIssueMeta(issue, "branchName");
  const prUrl = readIssueMeta(issue, "prUrl");
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
    ...(priority === undefined ? {} : { priority }),
    ...(branchName === undefined ? {} : { branchName }),
    ...(prUrl === undefined ? {} : { prUrl }),
    ...(url === undefined ? {} : { url }),
    comments: issue.comments.map((comment) => ({ ...comment })),
    artifacts: issue.artifacts.map((artifact) => ({ ...artifact })),
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}

function readIssueMeta(issue: LocalIssue, key: string): string | undefined {
  const value = issue.metadata[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readPriorityMeta(issue: LocalIssue): DashboardIssue["priority"] | undefined {
  const value = readIssueMeta(issue, "priority");
  return value === "critical" || value === "high" || value === "medium" || value === "low" ? value : undefined;
}

async function readRunSummary(runDir: string): Promise<DashboardRunSummary | undefined> {
  const status = await readJsonIfExists<{
    runId: string;
    workItemId: string;
    agentType: string;
    runtimeProvider?: string;
    status: DashboardRunSummary["status"];
    attemptNumber: number;
    startedAt: string;
    updatedAt: string;
  }>(resolve(runDir, "status.json"));
  if (status === undefined) {
    return undefined;
  }
  const [summaryData, transcript, events] = await Promise.all([
    readJsonIfExists<Record<string, JsonValue>>(resolve(runDir, "summary.json")),
    readTextIfExists(resolve(runDir, "transcript.md")),
    readEvents(resolve(runDir, "events.jsonl")),
  ]);

  const summaryText = typeof summaryData?.summary === "string"
    ? summaryData.summary
    : typeof summaryData?.error === "string"
      ? summaryData.error
      : undefined;
  const transcriptPreview = transcript
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  return {
    runId: status.runId,
    workItemId: status.workItemId,
    ...(typeof summaryData?.workItem === "string" ? { workItemIdentifier: summaryData.workItem } : {}),
    agentType: status.agentType,
    ...(status.runtimeProvider === undefined ? {} : { runtimeProvider: status.runtimeProvider }),
    status: status.status,
    attemptNumber: status.attemptNumber,
    startedAt: status.startedAt,
    updatedAt: status.updatedAt,
    ...(summaryText === undefined ? {} : { summary: summaryText }),
    ...(transcriptPreview === undefined ? {} : { transcriptPreview }),
    eventCount: events.length,
  };
}

async function readEvents(path: string): Promise<RunDetail["events"]> {
  const raw = await readTextIfExists(path);
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as {
      timestamp: string;
      event: string;
      runId?: string;
      data?: Record<string, JsonValue>;
    })
    .map((event) => ({
      timestamp: event.timestamp,
      event: event.event,
      ...(event.runId === undefined ? {} : { runId: event.runId }),
      ...(event.data === undefined ? {} : { data: event.data }),
    }));
}

async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  const raw = await readTextIfExists(path);
  return raw === undefined ? undefined : (JSON.parse(raw) as T);
}

async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

export async function readTrackerState(): Promise<LocalTrackerState> {
  return getTrackerStore().load();
}

export function formatRunDirName(path: string): string {
  return basename(path);
}
