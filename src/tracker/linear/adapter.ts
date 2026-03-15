import { ACTIVE_WORK_ITEM_STATES, type TrackerArtifact, type TrackerComment, type TrackerMutation, type WorkItem } from "../../core/types.js";
import type { TrackerBoardQuery, TrackerCreateIssueInput, TrackerProviderClient, TrackerUpdateIssueInput } from "../types.js";
import type { LinearTrackerConfig } from "./config.js";
import { mapLinearIssueToWorkItem, selectLinearWorkflowStateId, type LinearIssueNode, type LinearWorkflowStateNode } from "./mapping.js";

interface LinearGraphQlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface LinearIssueQueryData {
  issue?: LinearIssueNode | null;
}

interface LinearIssuesQueryData {
  issues?: { nodes?: LinearIssueNode[] | null } | null;
}

interface LinearTeamQueryData {
  team?: {
    id: string;
    key: string;
    states?: { nodes?: LinearWorkflowStateNode[] | null } | null;
    labels?: { nodes?: Array<{ id: string; name: string }> | null } | null;
  } | null;
}

interface LinearIssueUpdateData {
  issueUpdate?: { success: boolean; issue?: LinearIssueNode | null } | null;
}

interface LinearCommentCreateData {
  commentCreate?: { success: boolean; comment?: { id: string; body: string; createdAt: string } | null } | null;
}

interface LinearIssueCreateData {
  issueCreate?: { success: boolean; issue?: LinearIssueNode | null } | null;
}

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  branchName
  url
  createdAt
  updatedAt
  state { id name type }
  labels { nodes { id name } }
  assignee { displayName name email }
  team { id key name }
`;

export class LinearTrackerAdapter implements TrackerProviderClient {
  readonly provider = "linear";

  constructor(
    private readonly config: LinearTrackerConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetchCandidateWorkItems(): Promise<WorkItem[]> {
    const issues = await this.fetchBoardWorkItems({ projectKey: this.requireTeamKey(undefined) });
    const activeStates = new Set<string>(ACTIVE_WORK_ITEM_STATES);
    return issues.filter((issue) => activeStates.has(issue.state));
  }

  async fetchBoardWorkItems(input?: TrackerBoardQuery): Promise<WorkItem[]> {
    const teamKey = this.requireTeamKey(input?.projectKey);
    const data = await this.graphql<LinearIssuesQueryData>(
      `query LinearBoardIssues($teamKey: String!) {
        issues(first: 100, filter: { team: { key: { eq: $teamKey } } }) {
          nodes {
            ${ISSUE_FIELDS}
          }
        }
      }`,
      { teamKey },
    );
    return (data.issues?.nodes ?? []).map(mapLinearIssueToWorkItem);
  }

  async fetchWorkItemById(id: string): Promise<WorkItem | undefined> {
    const data = await this.graphql<LinearIssueQueryData>(
      `query LinearIssueById($id: String!) {
        issue(id: $id) {
          ${ISSUE_FIELDS}
        }
      }`,
      { id },
    );
    return data.issue === undefined || data.issue === null ? undefined : mapLinearIssueToWorkItem(data.issue);
  }

  async fetchWorkItemByIdentifier(identifier: string): Promise<WorkItem | undefined> {
    const data = await this.graphql<LinearIssuesQueryData>(
      `query LinearIssueByIdentifier($identifier: String!) {
        issues(first: 1, filter: { identifier: { eq: $identifier } }) {
          nodes {
            ${ISSUE_FIELDS}
          }
        }
      }`,
      { identifier },
    );
    const issue = data.issues?.nodes?.[0];
    return issue === undefined ? undefined : mapLinearIssueToWorkItem(issue);
  }

  async fetchWorkItemsByState(states: WorkItem["state"][]): Promise<WorkItem[]> {
    const stateSet = new Set(states);
    const issues = await this.fetchBoardWorkItems({ projectKey: this.requireTeamKey(undefined) });
    return issues.filter((issue) => stateSet.has(issue.state));
  }

  normalize(issue: unknown): WorkItem {
    return mapLinearIssueToWorkItem(issue as LinearIssueNode);
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
      return (await this.fetchWorkItemById(id)) ?? this.requireWorkItem(id);
    }
    await this.attachArtifact(id, { name: mutation.name, path: mutation.path });
    return (await this.fetchWorkItemById(id)) ?? this.requireWorkItem(id);
  }

  async appendComment(id: string, input: { body: string; author?: string }): Promise<TrackerComment> {
    const body = input.author === undefined ? input.body : `${input.author}:\n${input.body}`;
    const data = await this.graphql<LinearCommentCreateData>(
      `mutation LinearCommentCreate($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
          comment { id body createdAt }
        }
      }`,
      { issueId: id, body },
    );
    const comment = data.commentCreate?.comment;
    if (comment === undefined || comment === null) {
      throw new Error(`Linear comment mutation did not return a comment for issue ${id}`);
    }
    return {
      id: comment.id,
      body: comment.body,
      author: input.author ?? "agent",
      createdAt: comment.createdAt,
    };
  }

  async attachArtifact(_id: string, input: { name: string; path: string }): Promise<TrackerArtifact> {
    throw new Error(`Linear tracker artifact attachments are not implemented yet: ${input.name} (${input.path})`);
  }

  async createIssue(input: TrackerCreateIssueInput): Promise<WorkItem> {
    const teamKey = this.requireTeamKey(input.projectKey);
    const team = await this.fetchTeam(teamKey);
    const stateId = input.state === undefined ? undefined : selectLinearWorkflowStateId(team.states, input.state);
    const labelIds = resolveLinearLabelIds(team.labels, input.labels ?? []);
    const data = await this.graphql<LinearIssueCreateData>(
      `mutation LinearIssueCreate($title: String!, $description: String, $teamId: String!, $stateId: String, $labelIds: [String!]) {
        issueCreate(input: { title: $title, description: $description, teamId: $teamId, stateId: $stateId, labelIds: $labelIds }) {
          success
          issue {
            ${ISSUE_FIELDS}
          }
        }
      }`,
      {
        title: input.title,
        description: input.description,
        teamId: team.id,
        stateId,
        labelIds: labelIds.length === 0 ? undefined : labelIds,
      },
    );
    const issue = data.issueCreate?.issue;
    if (issue === undefined || issue === null) {
      throw new Error(`Linear issue creation did not return an issue for team ${teamKey}`);
    }
    return mapLinearIssueToWorkItem(issue);
  }

  async updateIssue(id: string, input: TrackerUpdateIssueInput): Promise<WorkItem> {
    if (input.assignee !== undefined) {
      throw new Error("Linear assignee updates are not implemented yet");
    }
    if (input.branchName !== undefined) {
      throw new Error("Linear branch name updates are not implemented yet");
    }
    if (input.prUrl !== undefined) {
      throw new Error("Linear PR URL updates are not implemented yet");
    }

    const issue = await this.requireWorkItem(id);
    const teamKey = typeof issue.metadata.linearTeamKey === "string" ? issue.metadata.linearTeamKey : undefined;
    const team = await this.fetchTeam(this.requireTeamKey(teamKey));
    const stateId = input.state === undefined ? undefined : selectLinearWorkflowStateId(team.states, input.state);
    const labelIds = input.labels === undefined ? undefined : resolveLinearLabelIds(team.labels, input.labels);
    const priority = input.priority === undefined ? undefined : toLinearPriority(input.priority);
    const data = await this.graphql<LinearIssueUpdateData>(
      `mutation LinearIssueUpdate($id: String!, $title: String, $description: String, $priority: Int, $stateId: String, $labelIds: [String!]) {
        issueUpdate(id: $id, input: { title: $title, description: $description, priority: $priority, stateId: $stateId, labelIds: $labelIds }) {
          success
          issue {
            ${ISSUE_FIELDS}
          }
        }
      }`,
      {
        id,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...("description" in input ? { description: input.description ?? null } : {}),
        ...("priority" in input ? { priority } : {}),
        ...("state" in input ? { stateId } : {}),
        ...("labels" in input ? { labelIds: labelIds ?? [] } : {}),
      },
    );
    const updated = data.issueUpdate?.issue;
    if (data.issueUpdate?.success !== true || updated === undefined || updated === null) {
      throw new Error(`Linear issue update failed for ${issue.identifier}`);
    }
    return mapLinearIssueToWorkItem(updated);
  }

  private async transitionIssue(id: string, targetState: WorkItem["state"]): Promise<WorkItem> {
    const issue = await this.requireWorkItem(id);
    const teamKey = typeof issue.metadata.linearTeamKey === "string" ? issue.metadata.linearTeamKey : undefined;
    const team = await this.fetchTeam(this.requireTeamKey(teamKey));
    const stateId = selectLinearWorkflowStateId(team.states, targetState);
    const data = await this.graphql<LinearIssueUpdateData>(
      `mutation LinearIssueUpdate($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) {
          success
        }
      }`,
      { id, stateId },
    );
    if (data.issueUpdate?.success !== true) {
      throw new Error(`Linear issue transition failed for ${issue.identifier}`);
    }
    return await this.requireWorkItem(id);
  }

  private async requireWorkItem(id: string): Promise<WorkItem> {
    const issue = await this.fetchWorkItemById(id);
    if (issue === undefined) {
      throw new Error(`Linear issue not found: ${id}`);
    }
    return issue;
  }

  private requireTeamKey(projectKey: string | undefined): string {
    const teamKey = normalizeOptionalString(projectKey) ?? this.config.defaultTeamKey;
    if (teamKey === undefined) {
      throw new Error("Linear board operations require a team key. Provide projectKey or set PIPHONY_LINEAR_TEAM_KEY.");
    }
    return teamKey;
  }

  private async fetchTeam(teamKey: string): Promise<{ id: string; key: string; states: LinearWorkflowStateNode[]; labels: Array<{ id: string; name: string }> }> {
    const data = await this.graphql<LinearTeamQueryData>(
      `query LinearTeam($teamKey: String!) {
        team(key: $teamKey) {
          id
          key
          states { nodes { id name type } }
          labels { nodes { id name } }
        }
      }`,
      { teamKey },
    );
    if (data.team === undefined || data.team === null) {
      throw new Error(`Linear team not found: ${teamKey}`);
    }
    return {
      id: data.team.id,
      key: data.team.key,
      states: data.team.states?.nodes?.filter((state): state is LinearWorkflowStateNode => state !== null && state !== undefined) ?? [],
      labels: data.team.labels?.nodes?.filter((label): label is { id: string; name: string } => label !== null && label !== undefined) ?? [],
    };
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(this.config.apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: this.config.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await response.text();
    let payload: LinearGraphQlResponse<T>;
    try {
      payload = JSON.parse(text) as LinearGraphQlResponse<T>;
    } catch (error) {
      throw new Error(`Failed to parse Linear response JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      throw new Error(`Linear request failed (${response.status} ${response.statusText}): ${formatGraphqlErrors(payload.errors, text)}`);
    }
    if (payload.errors !== undefined && payload.errors.length > 0) {
      throw new Error(`Linear GraphQL error: ${formatGraphqlErrors(payload.errors, text)}`);
    }
    if (payload.data === undefined) {
      throw new Error("Linear response did not include data");
    }
    return payload.data;
  }
}

function resolveLinearLabelIds(teamLabels: Array<{ id: string; name: string }>, requested: string[]): string[] {
  const labelsByName = new Map(teamLabels.map((label) => [label.name.trim().toLowerCase(), label.id]));
  return requested.flatMap((label) => {
    const id = labelsByName.get(label.trim().toLowerCase());
    return id === undefined ? [] : [id];
  });
}

function formatGraphqlErrors(errors: Array<{ message?: string }> | undefined, fallback: string): string {
  const messages = errors
    ?.map((error) => error.message?.trim())
    .filter((message): message is string => message !== undefined && message !== "");
  return messages !== undefined && messages.length > 0 ? messages.join("; ") : fallback;
}

function toLinearPriority(priority: NonNullable<TrackerUpdateIssueInput["priority"]>): number {
  if (priority === "critical") {
    return 1;
  }
  if (priority === "high") {
    return 2;
  }
  if (priority === "medium") {
    return 3;
  }
  return 4;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
