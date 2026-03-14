import { CANONICAL_STATES, type CanonicalState } from "@piphony/core/types";
import type { DashboardIssue, UpdateIssueInput } from "@/lib/models";

export const STATE_LABELS: Record<CanonicalState, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  human_review: "Human Review",
  rework: "Rework",
  merging: "Merging",
  done: "Done",
  cancelled: "Cancelled",
};

export const STATE_COLORS: Record<CanonicalState, string> = {
  backlog: "var(--text-muted)",
  todo: "var(--warning)",
  in_progress: "var(--accent)",
  human_review: "var(--danger)",
  rework: "var(--danger)",
  merging: "var(--live)",
  done: "var(--live)",
  cancelled: "var(--text-muted)",
};

export function groupIssuesByState(
  issues: DashboardIssue[],
): Record<CanonicalState, DashboardIssue[]> {
  return issues.reduce<Record<CanonicalState, DashboardIssue[]>>(
    (accumulator, issue) => {
      accumulator[issue.state].push(issue);
      return accumulator;
    },
    {
      backlog: [],
      todo: [],
      in_progress: [],
      human_review: [],
      rework: [],
      merging: [],
      done: [],
      cancelled: [],
    },
  );
}

export function toDraft(issue: DashboardIssue): UpdateIssueInput {
  return {
    id: issue.id,
    title: issue.title,
    ...(issue.description === undefined ? {} : { description: issue.description }),
    state: issue.state,
    labels: issue.labels.join(", "),
    ...(issue.assignee === undefined ? {} : { assignee: issue.assignee }),
    priority: issue.priority ?? "medium",
    ...(issue.branchName === undefined ? {} : { branchName: issue.branchName }),
    ...(issue.prUrl === undefined ? {} : { prUrl: issue.prUrl }),
  };
}

export { CANONICAL_STATES };
