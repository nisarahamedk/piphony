import type { CanonicalState, WorkItem, WorkItemPriority } from "../../core/types.js";

export interface LinearWorkflowStateNode {
  id: string;
  name: string;
  type: string;
}

export interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority?: number | null;
  branchName?: string | null;
  url?: string | null;
  createdAt: string;
  updatedAt: string;
  state?: LinearWorkflowStateNode | null;
  labels?: { nodes?: Array<{ id?: string | null; name?: string | null } | null> | null } | null;
  assignee?: { displayName?: string | null; name?: string | null; email?: string | null } | null;
  team?: { id?: string | null; key?: string | null; name?: string | null } | null;
}

export function mapLinearIssueToWorkItem(issue: LinearIssueNode): WorkItem {
  const description = normalizeOptionalString(issue.description);
  const assignee = normalizeOptionalString(issue.assignee?.displayName)
    ?? normalizeOptionalString(issue.assignee?.name)
    ?? normalizeOptionalString(issue.assignee?.email);
  const priority = mapLinearPriority(issue.priority);
  const branchName = normalizeOptionalString(issue.branchName);
  const url = normalizeOptionalString(issue.url);
  const stateName = normalizeOptionalString(issue.state?.name);
  const teamKey = normalizeOptionalString(issue.team?.key);

  return {
    provider: "linear",
    externalId: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    ...(description === undefined ? {} : { description }),
    state: mapLinearWorkflowState(issue.state?.type, stateName),
    labels: (issue.labels?.nodes ?? [])
      .flatMap((label) => {
        const name = normalizeOptionalString(label?.name);
        return name === undefined ? [] : [name];
      }),
    ...(assignee === undefined ? {} : { assignee }),
    ...(priority === undefined ? {} : { priority }),
    ...(branchName === undefined ? {} : { branchName }),
    ...(url === undefined ? {} : { url }),
    metadata: {
      ...(stateName === undefined ? {} : { linearStateName: stateName }),
      ...(issue.state?.type === undefined ? {} : { linearStateType: issue.state.type }),
      ...(teamKey === undefined ? {} : { linearTeamKey: teamKey }),
    },
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}

export function mapLinearWorkflowState(type: string | undefined, name: string | undefined): CanonicalState {
  const normalizedType = normalizeOptionalString(type)?.toLowerCase();
  const normalizedName = normalizeOptionalString(name)?.toLowerCase();

  if (normalizedType === "completed") {
    return "done";
  }
  if (normalizedType === "canceled") {
    return "cancelled";
  }
  if (normalizedType === "backlog" || normalizedType === "triage") {
    return "backlog";
  }
  if (normalizedType === "unstarted") {
    return normalizedName !== undefined && /backlog|triage/.test(normalizedName) ? "backlog" : "todo";
  }
  if (normalizedType === "started") {
    return mapStartedStateName(normalizedName);
  }

  if (normalizedName !== undefined) {
    if (/cancel|won'?t do|duplicate/.test(normalizedName)) {
      return "cancelled";
    }
    if (/done|complete|shipped|closed/.test(normalizedName)) {
      return "done";
    }
    if (/review|qa|verify|test/.test(normalizedName)) {
      return "human_review";
    }
    if (/rework|changes requested|blocked/.test(normalizedName)) {
      return "rework";
    }
    if (/merg|deploy|release/.test(normalizedName)) {
      return "merging";
    }
    if (/todo|next|queued|ready/.test(normalizedName)) {
      return "todo";
    }
    if (/backlog|triage/.test(normalizedName)) {
      return "backlog";
    }
  }

  return "todo";
}

export function selectLinearWorkflowStateId(states: LinearWorkflowStateNode[], target: CanonicalState): string {
  const exact = states.find((state) => mapLinearWorkflowState(state.type, state.name) === target);
  if (exact !== undefined) {
    return exact.id;
  }

  if (target === "human_review" || target === "rework" || target === "merging") {
    const started = states.find((state) => mapLinearWorkflowState(state.type, state.name) === "in_progress");
    if (started !== undefined) {
      return started.id;
    }
  }

  if (target === "todo") {
    const backlog = states.find((state) => mapLinearWorkflowState(state.type, state.name) === "backlog");
    if (backlog !== undefined) {
      return backlog.id;
    }
  }

  throw new Error(`Linear workflow does not expose a state for canonical target: ${target}`);
}

function mapStartedStateName(normalizedName: string | undefined): CanonicalState {
  if (normalizedName === undefined) {
    return "in_progress";
  }
  if (/review|qa|verify|test/.test(normalizedName)) {
    return "human_review";
  }
  if (/rework|changes requested|blocked/.test(normalizedName)) {
    return "rework";
  }
  if (/merg|deploy|release/.test(normalizedName)) {
    return "merging";
  }
  return "in_progress";
}

function mapLinearPriority(priority: number | null | undefined): WorkItemPriority | undefined {
  if (priority === 1) {
    return "critical";
  }
  if (priority === 2) {
    return "high";
  }
  if (priority === 3) {
    return "medium";
  }
  if (priority === 4) {
    return "low";
  }
  return undefined;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
