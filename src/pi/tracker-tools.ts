import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { TrackerAdapter, WorkItem } from "../core/types.js";

export interface TrackerToolEvent {
  event: string;
  details?: Record<string, unknown>;
}

const issueSchema = Type.Object({
  issueId: Type.String({ description: "Tracker issue id or identifier" }),
});

const commentSchema = Type.Object({
  issueId: Type.String({ description: "Tracker issue id or identifier" }),
  body: Type.String({ description: "Comment body" }),
});

const transitionSchema = Type.Object({
  issueId: Type.String({ description: "Tracker issue id or identifier" }),
  state: Type.String({ description: "Target canonical workflow state" }),
});

const artifactSchema = Type.Object({
  issueId: Type.String({ description: "Tracker issue id or identifier" }),
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
      execute: async (_toolCallId, params: { issueId: string }) => {
        const item = await input.tracker.fetchWorkItemById(params.issueId);
        await input.onEvent?.({ event: "tracker.read", details: { issueId: params.issueId } });
        return {
          content: [{ type: "text", text: item === undefined ? `Issue not found: ${params.issueId}` : JSON.stringify(item, null, 2) }],
          details: { issueId: params.issueId, found: item !== undefined },
        };
      },
    },
    {
      name: "tracker_append_comment",
      label: "tracker_append_comment",
      description: "Append a comment to a tracker issue.",
      parameters: commentSchema,
      execute: async (_toolCallId, params: { issueId: string; body: string }) => {
        const comment = await input.tracker.appendComment(params.issueId, { body: params.body, author: "pi-agent" });
        await input.onEvent?.({ event: "tracker.comment", details: { issueId: params.issueId } });
        return {
          content: [{ type: "text", text: JSON.stringify(comment, null, 2) }],
          details: { issueId: params.issueId },
        };
      },
    },
    {
      name: "tracker_transition_issue",
      label: "tracker_transition_issue",
      description: "Transition a tracker issue to a new workflow state.",
      parameters: transitionSchema,
      execute: async (_toolCallId, params: { issueId: string; state: string }) => {
        const item = await input.tracker.applyMutation(params.issueId, { type: "transition", state: params.state as never });
        await input.onEvent?.({ event: "tracker.transition", details: { issueId: params.issueId, state: params.state } });
        return {
          content: [{ type: "text", text: JSON.stringify(item, null, 2) }],
          details: { issueId: params.issueId, state: params.state },
        };
      },
    },
    {
      name: "tracker_attach_artifact",
      label: "tracker_attach_artifact",
      description: "Attach a file artifact to a tracker issue.",
      parameters: artifactSchema,
      execute: async (_toolCallId, params: { issueId: string; name: string; path: string }) => {
        const artifact = await input.tracker.attachArtifact(params.issueId, { name: params.name, path: params.path });
        await input.onEvent?.({ event: "tracker.artifact", details: { issueId: params.issueId, path: params.path } });
        return {
          content: [{ type: "text", text: JSON.stringify(artifact, null, 2) }],
          details: { issueId: params.issueId, path: params.path },
        };
      },
    },
  ];
}
