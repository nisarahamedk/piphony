import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
  type JiraIssue,
} from "../src/tracker/jira/mapping.js";
import { JiraTrackerAdapter } from "../src/tracker/jira/adapter.js";
import {
  mapLinearWorkflowState,
  selectLinearWorkflowStateId,
  type LinearIssueNode,
} from "../src/tracker/linear/mapping.js";
import { LinearTrackerAdapter } from "../src/tracker/linear/adapter.js";
import { createTrackerProviderRegistry } from "../src/tracker/provider-registry.js";
import { resolveTrackerRuntime } from "../src/tracker/runtime.js";
import { hasJiraTrackerLiveValidationConfig, hasLinearTrackerLiveValidationConfig } from "../src/tracker/live-validation.js";
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

  const seededIdentifier = provider === "linear"
    ? "LIN-123"
    : provider === "jira"
      ? "PROJ-123"
      : "LOCAL-123";
  const seeded = makeWorkItem(provider, seededIdentifier, seededState);
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
      const createdIdentifier = provider === "linear"
        ? "LIN-124"
        : provider === "jira"
          ? "PROJ-124"
          : "LOCAL-124";
      const created = makeWorkItem(provider, createdIdentifier, input.state ?? "backlog", input.title);
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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

function createFetchQueue(responses: Array<Response | ((call: { url: string; init: RequestInit | undefined }) => Response | Promise<Response>)>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : typeof input === "object" && input !== null && "url" in input
          ? String((input as { url: unknown }).url)
          : String(input);
    calls.push({ url, init });
    const next = responses.shift();
    if (next === undefined) {
      throw new Error(`Unexpected fetch call: ${url}`);
    }
    return next instanceof Response ? next : await next({ url, init });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function parseJsonBody(call: { init: RequestInit | undefined }): Record<string, unknown> {
  if (typeof call.init?.body !== "string") {
    throw new Error("Expected JSON string request body");
  }
  return JSON.parse(call.init.body) as Record<string, unknown>;
}

function makeLinearIssue(overrides: Partial<LinearIssueNode> = {}): LinearIssueNode {
  return {
    id: "linear:LIN-123",
    identifier: "LIN-123",
    title: "Linear issue",
    description: "Investigate provider mapping",
    priority: 1,
    branchName: "feature/lin-123",
    url: "https://linear.app/acme/issue/LIN-123/provider-mapping",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    state: { id: "state-review", name: "In Review", type: "started" },
    labels: { nodes: [{ id: "label-bug", name: "bug" }] },
    assignee: { displayName: "Ada Lovelace", name: "ada", email: "ada@example.com" },
    team: { id: "team-eng", key: "ENG", name: "Engineering" },
    ...overrides,
  };
}

function makeJiraIssue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    id: "jira:PROJ-123",
    key: "PROJ-123",
    fields: {
      summary: "Jira issue",
      description: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Investigate Jira mapping" }] }],
      },
      labels: ["backend"],
      assignee: { displayName: "Grace Hopper", emailAddress: "grace@example.com" },
      priority: { name: "Highest" },
      status: { name: "In Review", statusCategory: { key: "indeterminate", name: "In Progress" } },
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-02T00:00:00.000Z",
    },
    ...overrides,
  };
}

async function createWorkflowProject(trackerProvider: "local" | "linear" | "jira", projectKey?: string) {
  const projectRoot = await mkdtemp(join(tmpdir(), "piphony-tracker-runtime-project-"));
  await mkdir(join(projectRoot, ".piphony"), { recursive: true });
  await writeFile(join(projectRoot, ".piphony", "workflow.json"), `${JSON.stringify({
    version: 1,
    tracker: {
      provider: trackerProvider,
      ...(projectKey === undefined ? {} : { projectKey }),
    },
    runtime: {
      provider: "docker_compose",
      composeFile: "docker-compose.yml",
      projectName: "tracker-runtime-test",
      service: "runtime",
      build: false,
    },
    phases: {},
  }, null, 2)}\n`, "utf8");
  return projectRoot;
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

describe("tracker provider adapter contracts", () => {
  test("Linear fetchBoardWorkItems normalizes canonical fields including branch, priority, and timestamps", async () => {
    const issue = makeLinearIssue();
    const { fetchImpl, calls } = createFetchQueue([
      jsonResponse({ data: { issues: { nodes: [issue] } } }),
    ]);
    const adapter = new LinearTrackerAdapter({ apiUrl: "https://api.linear.app/graphql", apiKey: "linear-key", defaultTeamKey: "ENG" }, fetchImpl);

    const issues = await adapter.fetchBoardWorkItems();
    const request = parseJsonBody(calls[0]!);

    expect(request.variables).toEqual({ teamKey: "ENG" });
    expect(issues).toEqual([
      {
        provider: "linear",
        externalId: "linear:LIN-123",
        identifier: "LIN-123",
        title: "Linear issue",
        description: "Investigate provider mapping",
        state: "human_review",
        labels: ["bug"],
        assignee: "Ada Lovelace",
        priority: "critical",
        branchName: "feature/lin-123",
        url: "https://linear.app/acme/issue/LIN-123/provider-mapping",
        metadata: {
          linearStateName: "In Review",
          linearStateType: "started",
          linearTeamKey: "ENG",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
  });

  test("Linear appendComment and updateIssue serialize canonical mutations without fallback fields", async () => {
    const current = makeLinearIssue({ id: "linear:LIN-555", identifier: "LIN-555", state: { id: "state-todo", name: "Todo", type: "unstarted" } });
    const updated = makeLinearIssue({
      id: "linear:LIN-555",
      identifier: "LIN-555",
      title: "Updated linear issue",
      description: "Updated description",
      priority: 2,
      labels: { nodes: [{ id: "label-bug", name: "bug" }] },
      state: { id: "state-review", name: "In Review", type: "started" },
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
    const { fetchImpl, calls } = createFetchQueue([
      jsonResponse({ data: { commentCreate: { success: true, comment: { id: "comment-1", body: "agent:\nProgress update", createdAt: "2026-01-01T01:00:00.000Z" } } } }),
      jsonResponse({ data: { issue: current } }),
      jsonResponse({ data: { team: { id: "team-eng", key: "ENG", states: { nodes: [
        { id: "state-todo", name: "Todo", type: "unstarted" },
        { id: "state-review", name: "In Review", type: "started" },
      ] }, labels: { nodes: [{ id: "label-bug", name: "bug" }] } } } }),
      jsonResponse({ data: { issueUpdate: { success: true, issue: updated } } }),
    ]);
    const adapter = new LinearTrackerAdapter({ apiUrl: "https://api.linear.app/graphql", apiKey: "linear-key", defaultTeamKey: "ENG" }, fetchImpl);

    const comment = await adapter.appendComment("linear:LIN-555", { body: "Progress update", author: "agent" });
    const next = await adapter.updateIssue("linear:LIN-555", {
      title: "Updated linear issue",
      description: "Updated description",
      labels: ["bug"],
      priority: "high",
      state: "human_review",
    });

    expect(comment).toEqual({
      id: "comment-1",
      body: "agent:\nProgress update",
      author: "agent",
      createdAt: "2026-01-01T01:00:00.000Z",
    });

    const commentRequest = parseJsonBody(calls[0]!);
    expect(commentRequest.variables).toEqual({ issueId: "linear:LIN-555", body: "agent:\nProgress update" });

    const updateRequest = parseJsonBody(calls[3]!);
    expect(updateRequest.variables).toEqual({
      id: "linear:LIN-555",
      title: "Updated linear issue",
      description: "Updated description",
      priority: 2,
      stateId: "state-review",
      labelIds: ["label-bug"],
    });
    expect(next.title).toBe("Updated linear issue");
    expect(next.priority).toBe("high");
    expect(next.state).toBe("human_review");
    expect(next.updatedAt).toBe("2026-01-03T00:00:00.000Z");

    await expect(adapter.updateIssue("linear:LIN-555", { branchName: "feature/new-branch" })).rejects.toThrow(
      "Linear branch name updates are not implemented yet",
    );
    await expect(adapter.updateIssue("linear:LIN-555", { prUrl: "https://github.com/acme/repo/pull/1" })).rejects.toThrow(
      "Linear PR URL updates are not implemented yet",
    );
  });

  test("Jira fetchBoardWorkItems normalizes canonical fields including priority and timestamps", async () => {
    const issue = makeJiraIssue();
    const { fetchImpl, calls } = createFetchQueue([
      jsonResponse({ issues: [issue] }),
    ]);
    const adapter = new JiraTrackerAdapter({
      baseUrl: "https://acme.atlassian.net",
      email: "jira@example.com",
      apiToken: "jira-token",
      defaultProjectKey: "PROJ",
      defaultIssueTypeName: "Task",
    }, fetchImpl);

    const issues = await adapter.fetchBoardWorkItems();
    const request = parseJsonBody(calls[0]!);

    expect(request.jql).toContain('project = "PROJ"');
    expect(issues).toEqual([
      {
        provider: "jira",
        externalId: "jira:PROJ-123",
        identifier: "PROJ-123",
        title: "Jira issue",
        description: "Investigate Jira mapping",
        state: "human_review",
        labels: ["backend"],
        assignee: "Grace Hopper",
        priority: "critical",
        url: "https://acme.atlassian.net/browse/PROJ-123",
        metadata: {
          jiraStatusName: "In Review",
          jiraStatusCategoryKey: "indeterminate",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
  });

  test("Jira appendComment and updateIssue serialize canonical mutations without fallback fields", async () => {
    const current = makeJiraIssue({
      id: "jira:PROJ-777",
      key: "PROJ-777",
      fields: {
        ...makeJiraIssue().fields,
        summary: "Current jira issue",
        status: { name: "Todo", statusCategory: { key: "new", name: "To Do" } },
      },
    });
    const updated = makeJiraIssue({
      id: "jira:PROJ-777",
      key: "PROJ-777",
      fields: {
        ...makeJiraIssue().fields,
        summary: "Updated jira issue",
        labels: ["backend", "integration"],
        priority: { name: "Highest" },
        status: { name: "In Review", statusCategory: { key: "indeterminate", name: "In Progress" } },
        updated: "2026-01-03T00:00:00.000Z",
      },
    });
    const { fetchImpl, calls } = createFetchQueue([
      jsonResponse({ id: "comment-1", created: "2026-01-01T01:00:00.000Z" }),
      jsonResponse(current),
      emptyResponse(),
      jsonResponse(current),
      jsonResponse({ transitions: [{ id: "transition-review", name: "Review", to: { name: "In Review", statusCategory: { key: "indeterminate" } } }] }),
      emptyResponse(),
      jsonResponse(updated),
      jsonResponse(updated),
    ]);
    const adapter = new JiraTrackerAdapter({
      baseUrl: "https://acme.atlassian.net",
      email: "jira@example.com",
      apiToken: "jira-token",
      defaultProjectKey: "PROJ",
      defaultIssueTypeName: "Task",
    }, fetchImpl);

    const comment = await adapter.appendComment("PROJ-777", { body: "Review update", author: "agent" });
    const next = await adapter.updateIssue("PROJ-777", {
      title: "Updated jira issue",
      description: "Updated description",
      labels: ["backend", "integration"],
      priority: "critical",
      state: "human_review",
    });

    expect(comment).toEqual({
      id: "comment-1",
      body: "agent:\nReview update",
      author: "agent",
      createdAt: "2026-01-01T01:00:00.000Z",
    });

    const commentRequest = parseJsonBody(calls[0]!);
    expect(commentRequest.body).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "agent:\nReview update" }] }],
    });

    const updateRequest = parseJsonBody(calls[2]!);
    expect(updateRequest).toEqual({
      fields: {
        summary: "Updated jira issue",
        description: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Updated description" }] }],
        },
        labels: ["backend", "integration"],
        priority: { name: "Highest" },
      },
    });

    const transitionRequest = parseJsonBody(calls[5]!);
    expect(transitionRequest).toEqual({ transition: { id: "transition-review" } });
    expect(next.title).toBe("Updated jira issue");
    expect(next.priority).toBe("critical");
    expect(next.state).toBe("human_review");
    expect(next.updatedAt).toBe("2026-01-03T00:00:00.000Z");

    await expect(adapter.updateIssue("PROJ-777", { branchName: "feature/jira-777" })).rejects.toThrow(
      "Jira branch name updates are not implemented yet",
    );
    await expect(adapter.updateIssue("PROJ-777", { prUrl: "https://github.com/acme/repo/pull/7" })).rejects.toThrow(
      "Jira PR URL updates are not implemented yet",
    );
  });
});

describe("tracker runtime selection", () => {
  test("resolves the configured workflow tracker provider as the canonical default", async () => {
    const projectRoot = await createWorkflowProject("linear", "ENG");
    const linear = makeFakeProvider("linear");
    const local = makeFakeProvider("local");

    const runtime = resolveTrackerRuntime({
      trackerDir: join(projectRoot, ".piphony", "tracker-local"),
      projectRoot,
      providers: { linear, local },
    });

    expect(runtime.selection).toEqual({
      trackerProvider: "linear",
      trackerProjectKey: "ENG",
    });
    expect(runtime.tracker.provider).toBe("linear");
    expect(runtime.resolve().provider).toBe("linear");
    expect(runtime.resolve("local").provider).toBe("local");
  });

  test("detects opt-in live tracker validation config only when creds and project selection are present", () => {
    expect(hasLinearTrackerLiveValidationConfig({ PIPHONY_LINEAR_API_KEY: "key" })).toBe(false);
    expect(hasLinearTrackerLiveValidationConfig({ PIPHONY_LINEAR_API_KEY: "key", PIPHONY_LINEAR_TEAM_KEY: "ENG" })).toBe(true);

    expect(hasJiraTrackerLiveValidationConfig({
      PIPHONY_JIRA_BASE_URL: "https://acme.atlassian.net",
      PIPHONY_JIRA_EMAIL: "jira@example.com",
      PIPHONY_JIRA_API_TOKEN: "token",
    })).toBe(false);
    expect(hasJiraTrackerLiveValidationConfig({
      PIPHONY_JIRA_BASE_URL: "https://acme.atlassian.net",
      PIPHONY_JIRA_EMAIL: "jira@example.com",
      PIPHONY_JIRA_API_TOKEN: "token",
      PIPHONY_JIRA_PROJECT_KEY: "PROJ",
    })).toBe(true);
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

  test("defaults omitted provider arguments to the configured workflow tracker", async () => {
    const projectRoot = await createWorkflowProject("linear", "ENG");
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-provider-default-tracker-"));
    const runsRootDir = await mkdtemp(join(tmpdir(), "piphony-provider-default-runs-"));
    const linear = makeFakeProvider("linear");
    const local = makeFakeProvider("local");
    const registry = createTrackerProviderRegistry({
      trackerDir,
      providers: {
        linear,
        local,
      },
    });
    const services = createLocalChiefOfStaffServices({
      trackerDir,
      runsRootDir,
      activeRunRegistry: new ActiveRunRegistry(),
      projectRoot,
      trackerRegistry: registry,
    });

    const overview = await services.getBoardOverview({});
    expect(overview.provider).toBe("linear");
    expect(linear.boardQueries).toHaveLength(1);
    expect(local.boardQueries).toHaveLength(0);

    const created = await services.createIssue({ title: "Default provider issue" });
    expect(created.provider).toBe("linear");
    expect(linear.createdIssues).toEqual([{ title: "Default provider issue" }]);
    expect(local.createdIssues).toEqual([]);

    const retried = await services.retryIssue("LIN-123");
    expect(retried.provider).toBe("linear");
    expect(linear.transitions).toEqual([{ id: "linear:LIN-123", state: "todo" }]);
    expect(local.transitions).toEqual([]);
  });
});
