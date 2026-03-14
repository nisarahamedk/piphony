import { CANONICAL_STATES, type CanonicalState } from "./types.js";

export const VALID_WORK_ITEM_TRANSITIONS = {
  backlog: ["todo", "cancelled"],
  todo: ["backlog", "in_progress", "cancelled"],
  in_progress: ["human_review", "rework", "todo"],
  human_review: ["done", "rework", "merging", "todo"],
  rework: ["todo", "in_progress", "cancelled"],
  merging: ["done", "human_review"],
  done: ["rework", "backlog"],
  cancelled: ["backlog"],
} satisfies Record<CanonicalState, readonly CanonicalState[]>;

export function parseCanonicalState(value: string, fieldName = "state"): CanonicalState {
  if ((CANONICAL_STATES as readonly string[]).includes(value)) {
    return value as CanonicalState;
  }
  throw new Error(`Invalid ${fieldName}: ${value}`);
}

export function canTransitionWorkItem(from: CanonicalState, to: CanonicalState): boolean {
  const validNextStates = VALID_WORK_ITEM_TRANSITIONS[from] as readonly CanonicalState[];
  return from === to || validNextStates.includes(to);
}

export function assertValidWorkItemTransition(from: CanonicalState, to: CanonicalState): void {
  if (canTransitionWorkItem(from, to)) {
    return;
  }
  throw new Error(`Invalid work item transition: ${from} -> ${to}`);
}
