import { attemptCleanup } from "../core/cleanup.js";
import type { WorkItem } from "../core/types.js";
import type { ActiveRunRegistry } from "../core/active-run-registry.js";
import { inspectRun, listRunSummaries } from "../observability/index.js";
import { resolveTrackerRuntime } from "../tracker/runtime.js";
import type { TrackerProviderRegistry } from "../tracker/provider-registry.js";
import type { ChiefOfStaffBoardOverview, ChiefOfStaffIssueContext, ChiefOfStaffServices, CreateIssueInput } from "./types.js";

export interface LocalChiefOfStaffServicesOptions {
  trackerDir: string;
  runsRootDir: string;
  activeRunRegistry: ActiveRunRegistry;
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  trackerRegistry?: TrackerProviderRegistry;
}

export function createLocalChiefOfStaffServices(options: LocalChiefOfStaffServicesOptions): ChiefOfStaffServices {
  const trackerRuntime = resolveTrackerRuntime({
    trackerDir: options.trackerDir,
    ...(options.projectRoot === undefined ? {} : { projectRoot: options.projectRoot }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
  const trackerSelection = trackerRuntime.selection;
  const trackerRegistry = options.trackerRegistry ?? trackerRuntime.registry;
  const resolveTracker = createTrackerResolver(trackerSelection.trackerProvider, trackerRegistry);

  return {
    async getIssueContext(input): Promise<ChiefOfStaffIssueContext> {
      const tracker = resolveTracker(input.provider);
      const issue = await tracker.fetchWorkItemByIdentifier(input.identifier);
      const activeRun = trackerMatch(issue, options.activeRunRegistry);
      const latestRun = issue === undefined ? undefined : await findLatestRunForWorkItem(options.runsRootDir, issue.externalId);
      return {
        ...(issue === undefined ? {} : { issue }),
        ...(activeRun === undefined ? {} : { activeRun }),
        ...(latestRun === undefined ? {} : { latestRun }),
      };
    },

    async getBoardOverview(input): Promise<ChiefOfStaffBoardOverview> {
      const tracker = resolveTracker(input.provider);
      const issues = await tracker.fetchBoardWorkItems({
        ...(input.boardId === undefined ? {} : { boardId: input.boardId }),
        ...(input.projectKey === undefined ? {} : { projectKey: input.projectKey }),
      });
      const activeRuns = options.activeRunRegistry.listSnapshots();
      return {
        provider: tracker.provider,
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
      const tracker = resolveTracker(provider);
      const issue = await tracker.fetchWorkItemByIdentifier(identifier);
      if (issue === undefined) {
        throw new Error(`Issue not found for retry: ${identifier}`);
      }
      const activeRun = options.activeRunRegistry.getByWorkItemId(issue.externalId) ?? options.activeRunRegistry.getByIdentifier(issue.identifier);
      if (activeRun?.control !== undefined) {
        await attemptCleanup(
          "active_run.abort",
          () => activeRun.control!.abort(),
          (failure) => {
            console.error("chief_of_staff_retry_abort_failed", {
              ...failure,
              runId: activeRun.run.runId,
              identifier: issue.identifier,
            });
          },
          activeRun.run.runId,
        );
      }
      const nextState = issue.state === "rework" ? "rework" : "todo";
      return tracker.applyMutation(issue.externalId, { type: "transition", state: nextState });
    },

    async createIssue(input: CreateIssueInput): Promise<WorkItem> {
      const tracker = resolveTracker(input.provider);
      return tracker.createIssue({
        title: input.title,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.state === undefined ? {} : { state: input.state }),
        ...(input.labels === undefined ? {} : { labels: input.labels }),
        ...(input.projectKey === undefined ? {} : { projectKey: input.projectKey }),
      });
    },
  };
}

function createTrackerResolver(defaultProvider: string, registry: TrackerProviderRegistry) {
  return (provider?: string) => registry.resolve(provider ?? defaultProvider);
}

function trackerMatch(issue: WorkItem | undefined, registry: ActiveRunRegistry) {
  if (issue === undefined) {
    return undefined;
  }
  return registry.getByWorkItemId(issue.externalId) ?? registry.getByIdentifier(issue.identifier);
}

async function findLatestRunForWorkItem(runsRootDir: string, workItemId: string) {
  const runs = await listRunSummaries(runsRootDir);
  const latest = [...runs].reverse().find((run) => run.status.workItemId === workItemId);
  return latest;
}

function requireActiveRun(registry: ActiveRunRegistry, runId: string) {
  const entry = registry.getByRunId(runId);
  if (entry === undefined) {
    throw new Error(`Active run not found: ${runId}`);
  }
  return entry;
}
