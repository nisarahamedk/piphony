import { CANONICAL_STATES, type WorkItem } from "../../core/types.js";
import { stripUndefined } from "../../core/utils.js";
import { LocalTrackerAdapter } from "./adapter.js";
import { LocalTrackerStore } from "./state.js";
import type { TrackerBoardQuery, TrackerCreateIssueInput, TrackerProviderClient, TrackerUpdateIssueInput } from "../types.js";

export class LocalTrackerProviderClient extends LocalTrackerAdapter implements TrackerProviderClient {
  async fetchBoardWorkItems(_input?: TrackerBoardQuery): Promise<WorkItem[]> {
    return this.fetchWorkItemsByState([...CANONICAL_STATES]);
  }

  async createIssue(input: TrackerCreateIssueInput): Promise<WorkItem> {
    const issue = await this.store.createIssue({
      identifier: await nextSuggestedIdentifier(this.store),
      title: input.title,
      ...stripUndefined({
        description: input.description,
      }),
      state: input.state ?? "backlog",
      labels: input.labels ?? [],
    });
    return this.normalize(issue);
  }

  async updateIssue(id: string, input: TrackerUpdateIssueInput): Promise<WorkItem> {
    const issue = await this.store.updateIssue(id, (draft) => {
      if ("title" in input && input.title !== undefined) {
        draft.title = input.title;
      }
      if ("description" in input) {
        if (input.description === undefined) {
          delete draft.description;
        } else {
          draft.description = input.description;
        }
      }
      if ("labels" in input && input.labels !== undefined) {
        draft.labels = input.labels;
      }
      if ("assignee" in input) {
        if (input.assignee === undefined) {
          delete draft.assignee;
        } else {
          draft.assignee = input.assignee;
        }
      }
      if ("priority" in input) {
        if (input.priority === undefined) {
          delete draft.priority;
        } else {
          draft.priority = input.priority;
        }
      }
      if ("branchName" in input) {
        if (input.branchName === undefined) {
          delete draft.branchName;
        } else {
          draft.branchName = input.branchName;
        }
      }
      if ("prUrl" in input) {
        if (input.prUrl === undefined) {
          delete draft.prUrl;
        } else {
          draft.prUrl = input.prUrl;
        }
      }
      if ("state" in input && input.state !== undefined) {
        draft.state = input.state;
      }
    });
    return this.normalize(issue);
  }
}

export function createLocalTrackerProviderClient(trackerDir: string): LocalTrackerProviderClient {
  return new LocalTrackerProviderClient(new LocalTrackerStore({ trackerDir }));
}

async function nextSuggestedIdentifier(store: LocalTrackerStore): Promise<string> {
  const issues = await store.loadIssues();
  const max = issues.reduce((highest, issue) => {
    const match = issue.identifier.match(/(\d+)$/);
    return match === null ? highest : Math.max(highest, Number(match[1]));
  }, 100);
  return `LOCAL-${max + 1}`;
}
