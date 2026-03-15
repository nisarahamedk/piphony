import type { CanonicalState, WorkItem, WorkItemPriority } from "../../core/types.js";

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: JiraDocument | string | null;
    labels?: string[] | null;
    assignee?: { displayName?: string | null; emailAddress?: string | null } | null;
    priority?: { name?: string | null } | null;
    status?: JiraStatus | null;
    created: string;
    updated: string;
  };
}

export interface JiraStatus {
  id?: string | null;
  name?: string | null;
  statusCategory?: { key?: string | null; name?: string | null } | null;
}

export interface JiraTransition {
  id: string;
  name: string;
  to?: JiraStatus | null;
}

export interface JiraDocument {
  type?: string;
  text?: string;
  content?: JiraDocument[];
}

export function mapJiraIssueToWorkItem(baseUrl: string, issue: JiraIssue): WorkItem {
  const description = toPlainText(issue.fields.description);
  const assignee = normalizeOptionalString(issue.fields.assignee?.displayName)
    ?? normalizeOptionalString(issue.fields.assignee?.emailAddress);
  const priority = mapJiraPriority(issue.fields.priority?.name);
  const statusName = normalizeOptionalString(issue.fields.status?.name);
  const statusCategoryKey = normalizeOptionalString(issue.fields.status?.statusCategory?.key);

  return {
    provider: "jira",
    externalId: issue.id,
    identifier: issue.key,
    title: issue.fields.summary,
    ...(description === undefined ? {} : { description }),
    state: mapJiraStatusToCanonicalState(issue.fields.status),
    labels: issue.fields.labels ?? [],
    ...(assignee === undefined ? {} : { assignee }),
    ...(priority === undefined ? {} : { priority }),
    url: `${baseUrl}/browse/${issue.key}`,
    metadata: {
      ...(statusName === undefined ? {} : { jiraStatusName: statusName }),
      ...(statusCategoryKey === undefined ? {} : { jiraStatusCategoryKey: statusCategoryKey }),
    },
    createdAt: issue.fields.created,
    updatedAt: issue.fields.updated,
  };
}

export function mapJiraStatusToCanonicalState(status: JiraStatus | null | undefined): CanonicalState {
  const statusName = normalizeOptionalString(status?.name)?.toLowerCase();
  const categoryKey = normalizeOptionalString(status?.statusCategory?.key)?.toLowerCase();

  if (categoryKey === "done") {
    return statusName !== undefined && /cancel|won'?t do|duplicate/.test(statusName) ? "cancelled" : "done";
  }
  if (categoryKey === "new" || categoryKey === "to do") {
    return statusName !== undefined && /backlog|triage/.test(statusName) ? "backlog" : "todo";
  }
  if (categoryKey === "indeterminate") {
    return mapActiveStatusName(statusName);
  }

  if (statusName !== undefined) {
    if (/done|complete|closed|shipped/.test(statusName)) {
      return "done";
    }
    if (/cancel|won'?t do|duplicate/.test(statusName)) {
      return "cancelled";
    }
    if (/backlog|triage/.test(statusName)) {
      return "backlog";
    }
    if (/todo|selected|ready/.test(statusName)) {
      return "todo";
    }
    return mapActiveStatusName(statusName);
  }

  return "todo";
}

export function selectJiraTransitionId(transitions: JiraTransition[], target: CanonicalState): string {
  const exact = transitions.find((transition) => mapJiraStatusToCanonicalState(transition.to) === target);
  if (exact !== undefined) {
    return exact.id;
  }

  if (target === "human_review" || target === "rework" || target === "merging") {
    const started = transitions.find((transition) => mapJiraStatusToCanonicalState(transition.to) === "in_progress");
    if (started !== undefined) {
      return started.id;
    }
  }

  if (target === "todo") {
    const backlog = transitions.find((transition) => mapJiraStatusToCanonicalState(transition.to) === "backlog");
    if (backlog !== undefined) {
      return backlog.id;
    }
  }

  throw new Error(`Jira workflow does not expose a transition for canonical target: ${target}`);
}

export function toJiraDocument(value: string | undefined): JiraDocument | undefined {
  const text = normalizeOptionalString(value);
  if (text === undefined) {
    return undefined;
  }
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

export function toPlainText(value: JiraDocument | string | null | undefined): string | undefined {
  if (typeof value === "string") {
    return normalizeOptionalString(value);
  }
  if (value === null || value === undefined) {
    return undefined;
  }
  const parts: string[] = [];
  visitTextNodes(value, parts);
  const text = parts.join("\n").trim();
  return text === "" ? undefined : text;
}

function visitTextNodes(node: JiraDocument, parts: string[]): void {
  const text = normalizeOptionalString(node.text);
  if (text !== undefined) {
    parts.push(text);
  }
  for (const child of node.content ?? []) {
    visitTextNodes(child, parts);
  }
}

function mapActiveStatusName(statusName: string | undefined): CanonicalState {
  if (statusName === undefined) {
    return "in_progress";
  }
  if (/review|qa|verify|test/.test(statusName)) {
    return "human_review";
  }
  if (/rework|changes requested|blocked/.test(statusName)) {
    return "rework";
  }
  if (/merg|deploy|release/.test(statusName)) {
    return "merging";
  }
  return "in_progress";
}

function mapJiraPriority(priorityName: string | null | undefined): WorkItemPriority | undefined {
  const normalized = normalizeOptionalString(priorityName)?.toLowerCase();
  if (normalized === undefined) {
    return undefined;
  }
  if (/highest|blocker|critical/.test(normalized)) {
    return "critical";
  }
  if (/high/.test(normalized)) {
    return "high";
  }
  if (/lowest|low/.test(normalized)) {
    return "low";
  }
  return "medium";
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
