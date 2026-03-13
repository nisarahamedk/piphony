import { randomUUID } from "node:crypto";
import {
  ACTIVE_WORK_ITEM_STATES,
  type CanonicalState,
  type TrackerAdapter,
  type TrackerArtifact,
  type TrackerComment,
  type TrackerMutation,
  type WorkItem,
} from "../../core/types.js";
import { nowIso, withOptional } from "../../core/utils.js";
import { LocalTrackerStore } from "./state.js";
import type { LocalIssue } from "./types.js";

export class LocalTrackerAdapter implements TrackerAdapter {
  readonly provider = "local";

  constructor(readonly store: LocalTrackerStore) {}

  async fetchCandidateWorkItems(): Promise<WorkItem[]> {
    const issues = await this.store.listIssuesByStates(ACTIVE_WORK_ITEM_STATES);
    return issues.map((issue) => this.normalize(issue));
  }

  async fetchWorkItemById(id: string): Promise<WorkItem | undefined> {
    const issue = await this.store.findIssue(id);
    return issue === undefined ? undefined : this.normalize(issue);
  }

  async fetchWorkItemsByState(states: CanonicalState[]): Promise<WorkItem[]> {
    const issues = await this.store.listIssuesByStates(states);
    return issues.map((issue) => this.normalize(issue));
  }

  normalize(issue: unknown): WorkItem {
    const local = issue as LocalIssue;
    return withOptional(
      withOptional(
        withOptional(
          {
            provider: this.provider,
            externalId: local.id,
            identifier: local.identifier,
            title: local.title,
            state: local.state,
            labels: [...local.labels],
            metadata: {
              ...local.metadata,
              comments: local.comments.length,
              artifacts: local.artifacts.length,
              createdAt: local.createdAt,
              updatedAt: local.updatedAt,
            },
          },
          "description",
          local.description,
        ),
        "assignee",
        local.assignee,
      ),
      "url",
      local.url,
    );
  }

  async applyMutation(id: string, mutation: TrackerMutation): Promise<WorkItem> {
    let issue: LocalIssue;
    if (mutation.type === "transition") {
      issue = await this.store.updateIssue(id, (target) => {
        target.state = mutation.state;
      });
    } else if (mutation.type === "comment") {
      await this.appendComment(
        id,
        mutation.author === undefined ? { body: mutation.body } : { body: mutation.body, author: mutation.author },
      );
      issue = await this.requireIssue(id);
    } else {
      await this.attachArtifact(id, { name: mutation.name, path: mutation.path });
      issue = await this.requireIssue(id);
    }
    return this.normalize(issue);
  }

  async appendComment(id: string, input: { body: string; author?: string }): Promise<TrackerComment> {
    const comment: TrackerComment = {
      id: randomUUID(),
      body: input.body,
      author: input.author ?? "agent",
      createdAt: nowIso(),
    };
    await this.store.updateIssue(id, (issue) => {
      issue.comments.push(comment);
    });
    return comment;
  }

  async attachArtifact(id: string, input: { name: string; path: string }): Promise<TrackerArtifact> {
    const issue = await this.requireIssue(id);
    const copiedPath = await this.store.copyArtifact(issue.identifier, input.path);
    const artifact: TrackerArtifact = {
      id: randomUUID(),
      name: input.name,
      path: copiedPath,
      createdAt: nowIso(),
    };
    await this.store.updateIssue(id, (target) => {
      target.artifacts.push(artifact);
    });
    return artifact;
  }

  async inspectIssue(id: string): Promise<LocalIssue> {
    return this.requireIssue(id);
  }

  async dumpState(): Promise<unknown> {
    return this.store.load();
  }

  private async requireIssue(id: string): Promise<LocalIssue> {
    const issue = await this.store.findIssue(id);
    if (issue === undefined) {
      throw new Error(`Local issue not found: ${id}`);
    }
    return issue;
  }
}

export function createLocalTrackerAdapter(trackerDir: string): LocalTrackerAdapter {
  return new LocalTrackerAdapter(new LocalTrackerStore({ trackerDir }));
}
