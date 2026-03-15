import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ActiveRunRegistry } from "../src/core/active-run-registry.js";
import { Orchestrator, type RunWorker, type RunWorkerContext } from "../src/core/orchestrator.js";
import type { WorkItem } from "../src/core/types.js";
import { createLocalChiefOfStaffServices } from "../src/cos/local-services.js";
import {
  mapJiraStatusToCanonicalState,
  selectJiraTransitionId,
} from "../src/tracker/jira/mapping.js";
import {
  mapLinearWorkflowState,
  selectLinearWorkflowStateId,
} from "../src/tracker/linear/mapping.js";
import { createTrackerProviderRegistry } from "../src/tracker/provider-registry.js";
import type { TrackerProviderClient } from "../src/tracker/types.js";

function makeFakeProvider(
  provider: TrackerProviderClient["provider"],
  seededState: WorkItem["state"] = "human_review",
): TrackerProviderClient & {
  boardQueries: Array<{ projectKey?: string; boardId?: string }>;
  createdIssues: Array<{ title: string; description?: string; state?: string; labels?: string[]; projectKey?: string }>;
  transitions: Array<{ id: string; state: string }>;
} {
  const issues = new Map<string, ReturnType<typeof makeWorkItem>>();
  const boardQueries: Array<{ projectKey?: string; boardId?: string }> = [];
  const createdIssues: Array<{ title: string; description?: string; state?: string; labels?: string[]; projectKey?: string }> = [];
  const transitions: Array<{ id: string; state: string }> = [];

  const seeded = makeWorkItem(provider, provider === "linear" ? "LIN-123" : "PROJ-123", seededState);
  issues.set(seeded.identifier, seeded);
  issues.set(seeded.externalId, seeded);

  return {
    provider,
    boardQueries,
    createdIssues,
    transitions,
    async fetchCandidateWorkItems() {
      return uniqueIssues(issues);
    },
    async fetchBoardWorkItems(input) {
      boardQueries.push({ ...(input?.projectKey === undefined ? {} : { projectKey: input.projectKey }), ...(input?.boardId === undefined ? {} : { boardId: input.boardId }) });
      return uniqueIssues(issues).filter((issue) => issue.identifier === seeded.identifier);
    },
    async fetchWorkItemById(id) {
      return issues.get(id);
    },
    async fetchWorkItemByIdentifier(identifier) {
      return issues.get(identifier);
    },
    async fetchWorkItemsByState(states) {
      const set = new Set(states);
      return uniqueIssues(issues).filter((issue) => set.has(issue.state));
    },
    normalize(issue) {
      return issue as ReturnType<typeof makeWorkItem>;
    },
    async applyMutation(id, mutation) {
      if (mutation.type !== "transition") {
        throw new Error(`Unexpected mutation type in fake provider: ${mutation.type}`);
      }
      transitions.push({ id, state: mutation.state });
      const current = issues.get(id) ?? issues.get(seeded.identifier);
      if (current === undefined) {
        throw new Error(`Missing fake issue: ${id}`);
      }
      const next = { ...current, state: mutation.state, updatedAt: "2026-01-01T00:00:01.000Z" };
      issues.set(next.identifier, next);
      issues.set(next.externalId, next);
      return next;
    },
    async appendComment() {
      return { id: "comment-1", body: "hi", author: "tester", createdAt: "2026-01-01T00:00:00.000Z" };
    },
    async attachArtifact() {
      return { id: "artifact-1", name: "artifact", path: "/tmp/file", createdAt: "2026-01-01T00:00:00.000Z" };
    },
    async createIssue(input) {
      createdIssues.push({
        title: input.title,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.state === undefined ? {} : { state: input.state }),
        ...(input.labels === undefined ? {} : { labels: input.labels }),
        ...(input.projectKey === undefined ? {} : { projectKey: input.projectKey }),
      });
      const created = makeWorkItem(provider, provider === "linear" ? "LIN-124" : "PROJ-124", input.state ?? "backlog", input.title);
      issues.set(created.identifier, created);
      issues.set(created.externalId, created);
      return created;
    },
    async updateIssue(id, input) {
      const current = issues.get(id) ?? issues.get(seeded.identifier);
      if (current === undefined) {
        throw new Error(`Missing fake issue for update: ${id}`);
      }
      const next = {
        ...current,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.labels === undefined ? {} : { labels: input.labels }),
        ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.branchName === undefined ? {} : { branchName: input.branchName }),
        ...(input.prUrl === undefined ? {} : { prUrl: input.prUrl }),
        ...(input.state === undefined ? {} : { state: input.state }),
        updatedAt: "2026-01-01T00:00:02.000Z",
      };
      issues.set(next.identifier, next);
      issues.set(next.externalId, next);
      return next;
    },
  };
}

function uniqueIssues(issues: Map<string, WorkItem>): WorkItem[] {
  return [...new Map([...issues.values()].map((issue) => [issue.externalId, issue])).values()];
}

function makeWorkItem(
  provider: string,
  identifier: string,
  state: WorkItem["state"],
  title = `${identifier} title`,
): WorkItem {
  return {
    provider,
    externalId: `${provider}:${identifier}`,
    identifier,
    title,
    state,
    labels: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("tracker provider mappings", () => {
  test("maps Linear workflow states to canonical states", () => {
    expect(mapLinearWorkflowState("backlog", "Backlog")).toBe("backlog");
    expect(mapLinearWorkflowState("unstarted", "Todo")).toBe("todo");
    expect(mapLinearWorkflowState("started", "In Review")).toBe("human_review");
    expect(mapLinearWorkflowState("started", "Merging")).toBe("merging");
    expect(mapLinearWorkflowState("completed", "Done")).toBe("done");
    expect(mapLinearWorkflowState("canceled", "Canceled")).toBe("cancelled");
    expect(selectLinearWorkflowStateId([
      { id: "1", name: "Todo", type: "unstarted" },
      { id: "2", name: "In Review", type: "started" },
      { id: "3", name: "Done", type: "completed" },
    ], "human_review")).toBe("2");
  });

  test("maps Jira statuses and transitions to canonical states", () => {
    expect(mapJiraStatusToCanonicalState({ name: "Backlog", statusCategory: { key: "new" } })).toBe("backlog");
    expect(mapJiraStatusToCanonicalState({ name: "In Progress", statusCategory: { key: "indeterminate" } })).toBe("in_progress");
    expect(mapJiraStatusToCanonicalState({ name: "In Review", statusCategory: { key: "indeterminate" } })).toBe("human_review");
    expect(mapJiraStatusToCanonicalState({ name: "Done", statusCategory: { key: "done" } })).toBe("done");
    expect(mapJiraStatusToCanonicalState({ name: "Canceled", statusCategory: { key: "done" } })).toBe("cancelled");
    expect(selectJiraTransitionId([
      { id: "11", name: "Start", to: { name: "In Progress", statusCategory: { key: "indeterminate" } } },
      { id: "12", name: "Review", to: { name: "In Review", statusCategory: { key: "indeterminate" } } },
    ], "human_review")).toBe("12");
  });
});

describe("orchestrator external tracker integration", () => {
  test("dispatches and mutates a Linear-backed work item through the generic tracker interface", async () => {
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-orchestrator-provider-tracker-"));
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-orchestrator-provider-runs-"));
    const linear = makeFakeProvider("linear", "todo");

    class ExternalTrackerWorker implements RunWorker {
      readonly name = "implementation";

      async execute(context: RunWorkerContext) {
        await linear.appendComment(context.workItem.externalId, {
          body: "External provider worker started",
          author: "agent",
        });
        const updated = await linear.applyMutation(context.workItem.externalId, { type: "transition", state: "human_review" });
        return {
          summary: `${updated.identifier} moved to ${updated.state}`,
          output: `${updated.identifier} moved to ${updated.state}`,
        };
      }
    }

    const orchestrator = new Orchestrator({
      tracker: linear,
      worker: new ExternalTrackerWorker(),
      runsRootDir,
      agentType: "implementation",
    });

    const result = await orchestrator.runOnce();
    const updated = await linear.fetchWorkItemByIdentifier("LIN-123");
    expect(result.workItem?.provider).toBe("linear");
    expect(updated?.state).toBe("human_review");
    expect(linear.transitions).toEqual([{ id: "linear:LIN-123", state: "human_review" }]);
  });
});

describe("Chief of Staff tracker provider integration", () => {
  test("routes board, create, and retry operations through external providers", async () => {
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-provider-tracker-"));
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-provider-runs-"));
    const linear = makeFakeProvider("linear");
    const jira = makeFakeProvider("jira");
    const registry = createTrackerProviderRegistry({
      trackerDir,
      providers: {
        linear,
        jira,
      },
    });
    const services = createLocalChiefOfStaffServices({
      trackerDir,
      runsRootDir,
      activeRunRegistry: new ActiveRunRegistry(),
      trackerRegistry: registry,
    });

    const linearOverview = await services.getBoardOverview({ provider: "linear", projectKey: "ENG" });
    expect(linearOverview.provider).toBe("linear");
    expect(linear.boardQueries).toEqual([{ projectKey: "ENG" }]);

    const jiraIssue = await services.getIssueContext({ provider: "jira", identifier: "PROJ-123" });
    expect(jiraIssue.issue?.provider).toBe("jira");
    expect(jiraIssue.issue?.identifier).toBe("PROJ-123");

    const created = await services.createIssue({
      provider: "jira",
      title: "Ship provider integration",
      projectKey: "PROJ",
      labels: ["integration"],
      state: "todo",
    });
    expect(created.provider).toBe("jira");
    expect(jira.createdIssues).toEqual([
      {
        title: "Ship provider integration",
        projectKey: "PROJ",
        labels: ["integration"],
        state: "todo",
      },
    ]);

    const retried = await services.retryIssue("LIN-123", "linear");
    expect(retried.state).toBe("todo");
    expect(linear.transitions).toEqual([{ id: "linear:LIN-123", state: "todo" }]);
  });
});
