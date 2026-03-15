import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ACTIVE_WORK_ITEM_STATES, type TrackerArtifact, type TrackerComment, type TrackerMutation, type WorkItem } from "../../core/types.js";
import type { TrackerBoardQuery, TrackerCreateIssueInput, TrackerProviderClient, TrackerUpdateIssueInput } from "../types.js";
import type { JiraTrackerConfig } from "./config.js";
import {
  mapJiraIssueToWorkItem,
  selectJiraTransitionId,
  toJiraDocument,
  type JiraIssue,
  type JiraTransition,
} from "./mapping.js";

interface JiraSearchResponse {
  issues: JiraIssue[];
}

interface JiraTransitionsResponse {
  transitions?: JiraTransition[];
}

interface JiraCreateIssueResponse {
  id: string;
  key: string;
}

interface JiraCommentResponse {
  id: string;
  created: string;
  body?: unknown;
}

interface JiraAttachmentResponseItem {
  id: string;
  filename: string;
  created: string;
  content?: string;
}

const JIRA_FIELDS = ["summary", "description", "labels", "assignee", "priority", "status", "created", "updated"] as const;

export class JiraTrackerAdapter implements TrackerProviderClient {
  readonly provider = "jira";
  private readonly authHeader: string;

  constructor(
    private readonly config: JiraTrackerConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`, "utf8").toString("base64")}`;
  }

  async fetchCandidateWorkItems(): Promise<WorkItem[]> {
    const issues = await this.fetchBoardWorkItems({ projectKey: this.requireProjectKey(undefined) });
    const activeStates = new Set<string>(ACTIVE_WORK_ITEM_STATES);
    return issues.filter((issue) => activeStates.has(issue.state));
  }

  async fetchBoardWorkItems(input?: TrackerBoardQuery): Promise<WorkItem[]> {
    const projectKey = this.requireProjectKey(input?.projectKey);
    const data = await this.requestJson<JiraSearchResponse>("/rest/api/3/search", {
      method: "POST",
      body: JSON.stringify({
        jql: `project = \"${projectKey}\" ORDER BY updated DESC`,
        fields: [...JIRA_FIELDS],
        maxResults: 100,
      }),
    });
    return data.issues.map((issue) => mapJiraIssueToWorkItem(this.config.baseUrl, issue));
  }

  async fetchWorkItemById(id: string): Promise<WorkItem | undefined> {
    const issue = await this.requestJson<JiraIssue | undefined>(
      `/rest/api/3/issue/${encodeURIComponent(id)}?fields=${JIRA_FIELDS.join(",")}`,
      undefined,
      { allowNotFound: true },
    );
    return issue === undefined ? undefined : mapJiraIssueToWorkItem(this.config.baseUrl, issue);
  }

  async fetchWorkItemByIdentifier(identifier: string): Promise<WorkItem | undefined> {
    return this.fetchWorkItemById(identifier);
  }

  async fetchWorkItemsByState(states: WorkItem["state"][]): Promise<WorkItem[]> {
    const stateSet = new Set(states);
    const issues = await this.fetchBoardWorkItems({ projectKey: this.requireProjectKey(undefined) });
    return issues.filter((issue) => stateSet.has(issue.state));
  }

  normalize(issue: unknown): WorkItem {
    return mapJiraIssueToWorkItem(this.config.baseUrl, issue as JiraIssue);
  }

  async applyMutation(id: string, mutation: TrackerMutation): Promise<WorkItem> {
    if (mutation.type === "transition") {
      return this.transitionIssue(id, mutation.state);
    }
    if (mutation.type === "comment") {
      await this.appendComment(id, {
        body: mutation.body,
        ...(mutation.author === undefined ? {} : { author: mutation.author }),
      });
      return await this.requireWorkItem(id);
    }
    await this.attachArtifact(id, { name: mutation.name, path: mutation.path });
    return await this.requireWorkItem(id);
  }

  async appendComment(id: string, input: { body: string; author?: string }): Promise<TrackerComment> {
    const body = input.author === undefined ? input.body : `${input.author}:\n${input.body}`;
    const response = await this.requestJson<JiraCommentResponse>(`/rest/api/3/issue/${encodeURIComponent(id)}/comment`, {
      method: "POST",
      body: JSON.stringify({ body: toJiraDocument(body) }),
    });
    return {
      id: response.id,
      body,
      author: input.author ?? "agent",
      createdAt: response.created,
    };
  }

  async attachArtifact(id: string, input: { name: string; path: string }): Promise<TrackerArtifact> {
    const file = await readFile(input.path);
    const form = new FormData();
    form.append("file", new Blob([file]), basename(input.path));
    const response = await this.requestJson<JiraAttachmentResponseItem[]>(`/rest/api/3/issue/${encodeURIComponent(id)}/attachments`, {
      method: "POST",
      headers: { "X-Atlassian-Token": "no-check" },
      body: form,
    });
    const attachment = response[0];
    if (attachment === undefined) {
      throw new Error(`Jira attachment upload returned no attachment for ${id}`);
    }
    return {
      id: attachment.id,
      name: attachment.filename || input.name,
      path: attachment.content ?? input.path,
      createdAt: attachment.created,
    };
  }

  async createIssue(input: TrackerCreateIssueInput): Promise<WorkItem> {
    const projectKey = this.requireProjectKey(input.projectKey);
    const response = await this.requestJson<JiraCreateIssueResponse>("/rest/api/3/issue", {
      method: "POST",
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          issuetype: { name: this.config.defaultIssueTypeName },
          summary: input.title,
          ...(input.description === undefined ? {} : { description: toJiraDocument(input.description) }),
          ...(input.labels === undefined || input.labels.length === 0 ? {} : { labels: input.labels }),
        },
      }),
    });
    if (input.state !== undefined && input.state !== "backlog" && input.state !== "todo") {
      await this.transitionIssue(response.key, input.state);
    }
    return await this.requireWorkItem(response.key);
  }

  async updateIssue(id: string, input: TrackerUpdateIssueInput): Promise<WorkItem> {
    if (input.assignee !== undefined) {
      throw new Error("Jira assignee updates are not implemented yet");
    }
    if (input.branchName !== undefined) {
      throw new Error("Jira branch name updates are not implemented yet");
    }
    if (input.prUrl !== undefined) {
      throw new Error("Jira PR URL updates are not implemented yet");
    }

    const issue = await this.requireWorkItem(id);
    await this.requestJson<unknown>(`/rest/api/3/issue/${encodeURIComponent(issue.identifier)}`, {
      method: "PUT",
      body: JSON.stringify({
        fields: {
          ...(input.title === undefined ? {} : { summary: input.title }),
          ...("description" in input ? { description: input.description === undefined ? null : toJiraDocument(input.description) } : {}),
          ...(input.labels === undefined ? {} : { labels: input.labels }),
          ...("priority" in input && input.priority !== undefined ? { priority: { name: toJiraPriorityName(input.priority) } } : {}),
        },
      }),
    });
    if (input.state !== undefined) {
      await this.transitionIssue(issue.identifier, input.state);
    }
    return await this.requireWorkItem(issue.identifier);
  }

  private async transitionIssue(id: string, targetState: WorkItem["state"]): Promise<WorkItem> {
    const issue = await this.requireWorkItem(id);
    const transitions = await this.requestJson<JiraTransitionsResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issue.identifier)}/transitions`,
    );
    const transitionId = selectJiraTransitionId(transitions.transitions ?? [], targetState);
    await this.requestJson<unknown>(`/rest/api/3/issue/${encodeURIComponent(issue.identifier)}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
    return await this.requireWorkItem(issue.identifier);
  }

  private async requireWorkItem(id: string): Promise<WorkItem> {
    const issue = await this.fetchWorkItemById(id);
    if (issue === undefined) {
      throw new Error(`Jira issue not found: ${id}`);
    }
    return issue;
  }

  private requireProjectKey(projectKey: string | undefined): string {
    const resolved = normalizeOptionalString(projectKey) ?? this.config.defaultProjectKey;
    if (resolved === undefined) {
      throw new Error("Jira board operations require a project key. Provide projectKey or set PIPHONY_JIRA_PROJECT_KEY.");
    }
    return resolved;
  }

  private async requestJson<T>(
    path: string,
    init?: { method?: string; headers?: Record<string, string>; body?: RequestInit["body"] },
    options?: { allowNotFound?: boolean },
  ): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("authorization", this.authHeader);
    headers.set("accept", "application/json");
    if (init?.body !== undefined && !(init.body instanceof FormData) && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers,
      ...(init?.body === undefined ? {} : { body: init.body }),
    });

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (response.status === 404 && options?.allowNotFound === true) {
      return undefined as T;
    }
    if (!response.ok) {
      throw new Error(`Jira request failed (${response.status} ${response.statusText}): ${text}`);
    }
    if (text.trim() === "") {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new Error(`Failed to parse Jira response JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function toJiraPriorityName(priority: NonNullable<TrackerUpdateIssueInput["priority"]>): string {
  if (priority === "critical") {
    return "Highest";
  }
  if (priority === "high") {
    return "High";
  }
  if (priority === "medium") {
    return "Medium";
  }
  return "Low";
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
