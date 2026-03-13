import { CANONICAL_STATES, type WorkItem } from "../core/types.js";
import type { ActiveRunRegistry } from "../core/active-run-registry.js";
import { inspectRun, listRuns } from "../observability/index.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import type { ChiefOfStaffBoardOverview, ChiefOfStaffIssueContext, ChiefOfStaffServices, CreateIssueInput } from "./types.js";

export interface LocalChiefOfStaffServicesOptions {
  trackerDir: string;
  runsRootDir: string;
  activeRunRegistry: ActiveRunRegistry;
}

export function createLocalChiefOfStaffServices(options: LocalChiefOfStaffServicesOptions): ChiefOfStaffServices {
  const tracker = createLocalTrackerAdapter(options.trackerDir);

  return {
    async getIssueContext(input): Promise<ChiefOfStaffIssueContext> {
      ensureProvider(input.provider);
      const issue = await tracker.fetchWorkItemById(input.identifier);
      const activeRun = trackerMatch(issue, options.activeRunRegistry);
      const latestRun = issue === undefined ? undefined : await findLatestRunForWorkItem(options.runsRootDir, issue.externalId);
      return {
        ...(issue === undefined ? {} : { issue }),
        ...(activeRun === undefined ? {} : { activeRun }),
        ...(latestRun === undefined ? {} : { latestRun }),
      };
    },

    async getBoardOverview(input): Promise<ChiefOfStaffBoardOverview> {
      const provider = ensureProvider(input.provider);
      const issues = await tracker.fetchWorkItemsByState([...CANONICAL_STATES]);
      const activeRuns = options.activeRunRegistry.listSnapshots();
      return {
        provider,
        issues,
        activeRuns,
        needsAttention: [
          ...issues
            .filter((issue) => issue.state === "human_review")
            .map((issue) => ({ kind: "human_review" as const, message: `${issue.identifier} is waiting for human review`, issueIdentifier: issue.identifier })),
          ...activeRuns
            .filter((run) => run.status === "failed")
            .map((run) => ({ kind: "failed_run" as const, message: `${run.identifier} failed`, runId: run.runId, issueIdentifier: run.identifier })),
          ...activeRuns
            .filter((run) => run.health === "stale")
            .map((run) => ({ kind: "stale_run" as const, message: `${run.identifier} looks stale`, runId: run.runId, issueIdentifier: run.identifier })),
        ],
      };
    },

    async listActiveRuns() {
      return options.activeRunRegistry.listSnapshots();
    },

    async getRunDetail(runId: string) {
      return inspectRun(options.runsRootDir, runId);
    },

    async steerRun(runId: string, message: string) {
      const entry = requireActiveRun(options.activeRunRegistry, runId);
      if (entry.control === undefined) {
        throw new Error(`Active run ${runId} is not steerable`);
      }
      await entry.control.steer(message);
    },

    async followUpRun(runId: string, message: string) {
      const entry = requireActiveRun(options.activeRunRegistry, runId);
      if (entry.control === undefined) {
        throw new Error(`Active run ${runId} is not follow-up capable`);
      }
      await entry.control.followUp(message);
    },

    async abortRun(runId: string) {
      const entry = requireActiveRun(options.activeRunRegistry, runId);
      if (entry.control === undefined) {
        throw new Error(`Active run ${runId} is not abortable`);
      }
      await entry.control.abort();
    },

    async retryIssue(identifier: string, provider?: string): Promise<WorkItem> {
      ensureProvider(provider);
      const issue = await tracker.fetchWorkItemById(identifier);
      if (issue === undefined) {
        throw new Error(`Issue not found for retry: ${identifier}`);
      }
      const activeRun = options.activeRunRegistry.getByWorkItemId(issue.externalId) ?? options.activeRunRegistry.getByIdentifier(issue.identifier);
      if (activeRun?.control !== undefined) {
        await activeRun.control.abort().catch(() => undefined);
      }
      const nextState = issue.state === "rework" ? "rework" : "todo";
      return tracker.applyMutation(issue.externalId, { type: "transition", state: nextState });
    },

    async createIssue(input: CreateIssueInput): Promise<WorkItem> {
      ensureProvider(input.provider);
      const identifier = await nextSuggestedIdentifier(tracker.store.loadIssues.bind(tracker.store));
      const issue = await tracker.store.createIssue({
        identifier,
        title: input.title,
        ...(input.description === undefined ? {} : { description: input.description }),
        state: input.state ?? "backlog",
        labels: input.labels ?? [],
      });
      return tracker.normalize(issue);
    },
  };
}

function ensureProvider(provider: string | undefined): string {
  if (provider === undefined || provider === "" || provider === "local") {
    return "local";
  }
  throw new Error(`Unsupported tracker provider in v1 OSS: ${provider}`);
}

function trackerMatch(issue: WorkItem | undefined, registry: ActiveRunRegistry) {
  if (issue === undefined) {
    return undefined;
  }
  return registry.getByWorkItemId(issue.externalId) ?? registry.getByIdentifier(issue.identifier);
}

async function nextSuggestedIdentifier(loadIssues: () => Promise<Array<{ identifier: string }>>): Promise<string> {
  const issues = await loadIssues();
  const max = issues.reduce((highest, issue) => {
    const match = issue.identifier.match(/(\d+)$/);
    return match === null ? highest : Math.max(highest, Number(match[1]));
  }, 100);
  return `LOCAL-${max + 1}`;
}

async function findLatestRunForWorkItem(runsRootDir: string, workItemId: string) {
  const runIds = await listRuns(runsRootDir);
  for (const runId of [...runIds].reverse()) {
    const run = await inspectRun(runsRootDir, runId).catch(() => undefined);
    if (run?.status.workItemId === workItemId) {
      return run;
    }
  }
  return undefined;
}

function requireActiveRun(registry: ActiveRunRegistry, runId: string) {
  const entry = registry.getByRunId(runId);
  if (entry === undefined) {
    throw new Error(`Active run not found: ${runId}`);
  }
  return entry;
}
