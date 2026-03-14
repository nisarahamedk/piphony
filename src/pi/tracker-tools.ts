import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { TrackerAdapter, WorkItem } from "../core/types.js";

export interface TrackerToolEvent {
  event: string;
  details?: Record<string, unknown>;
}

const issueSchema = Type.Object({
  issueIdentifier: Type.String({ description: "Tracker issue identifier" }),
});

const commentSchema = Type.Object({
  issueIdentifier: Type.String({ description: "Tracker issue identifier" }),
  body: Type.String({ description: "Comment body" }),
});

const transitionSchema = Type.Object({
  issueIdentifier: Type.String({ description: "Tracker issue identifier" }),
  state: Type.String({ description: "Target canonical workflow state" }),
});

const artifactSchema = Type.Object({
  issueIdentifier: Type.String({ description: "Tracker issue identifier" }),
  name: Type.String({ description: "Artifact display name" }),
  path: Type.String({ description: "Absolute path to file" }),
});

export function createTrackerTools(input: {
  tracker: TrackerAdapter;
  workItem: WorkItem;
  onEvent?: (event: TrackerToolEvent) => Promise<void> | void;
}): ToolDefinition[] {
  return [
    {
      name: "tracker_get_issue",
      label: "tracker_get_issue",
      description: "Fetch tracker issue details.",
      parameters: issueSchema,
      execute: async (_toolCallId, params: { issueIdentifier: string }) => {
        const item = await input.tracker.fetchWorkItemByIdentifier(params.issueIdentifier);
        await input.onEvent?.({ event: "tracker.read", details: { issueIdentifier: params.issueIdentifier } });
        return {
          content: [{ type: "text", text: item === undefined ? `Issue not found: ${params.issueIdentifier}` : JSON.stringify(item, null, 2) }],
          details: { issueIdentifier: params.issueIdentifier, found: item !== undefined },
        };
      },
    },
    {
      name: "tracker_append_comment",
      label: "tracker_append_comment",
      description: "Append a comment to a tracker issue.",
      parameters: commentSchema,
      execute: async (_toolCallId, params: { issueIdentifier: string; body: string }) => {
        const issue = await requireIssueByIdentifier(input.tracker, params.issueIdentifier);
        const comment = await input.tracker.appendComment(issue.externalId, { body: params.body, author: "pi-agent" });
        await input.onEvent?.({ event: "tracker.comment", details: { issueIdentifier: params.issueIdentifier } });
        return {
          content: [{ type: "text", text: JSON.stringify(comment, null, 2) }],
          details: { issueIdentifier: params.issueIdentifier },
        };
      },
    },
    {
      name: "tracker_transition_issue",
      label: "tracker_transition_issue",
      description: "Transition a tracker issue to a new workflow state.",
      parameters: transitionSchema,
      execute: async (_toolCallId, params: { issueIdentifier: string; state: string }) => {
        const issue = await requireIssueByIdentifier(input.tracker, params.issueIdentifier);
        const item = await input.tracker.applyMutation(issue.externalId, { type: "transition", state: params.state as never });
        await input.onEvent?.({ event: "tracker.transition", details: { issueIdentifier: params.issueIdentifier, state: params.state } });
        return {
          content: [{ type: "text", text: JSON.stringify(item, null, 2) }],
          details: { issueIdentifier: params.issueIdentifier, state: params.state },
        };
      },
    },
    {
      name: "tracker_attach_artifact",
      label: "tracker_attach_artifact",
      description: "Attach a file artifact to a tracker issue.",
      parameters: artifactSchema,
      execute: async (_toolCallId, params: { issueIdentifier: string; name: string; path: string }) => {
        const issue = await requireIssueByIdentifier(input.tracker, params.issueIdentifier);
        const artifact = await input.tracker.attachArtifact(issue.externalId, { name: params.name, path: params.path });
        await input.onEvent?.({ event: "tracker.artifact", details: { issueIdentifier: params.issueIdentifier, path: params.path } });
        return {
          content: [{ type: "text", text: JSON.stringify(artifact, null, 2) }],
          details: { issueIdentifier: params.issueIdentifier, path: params.path },
        };
      },
    },
  ];
}

async function requireIssueByIdentifier(tracker: TrackerAdapter, issueIdentifier: string): Promise<WorkItem> {
  const item = await tracker.fetchWorkItemByIdentifier(issueIdentifier);
  if (item === undefined) {
    throw new Error(`Issue not found: ${issueIdentifier}`);
  }
  return item;
}
