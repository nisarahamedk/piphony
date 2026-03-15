import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { ChiefOfStaffServices } from "./types.js";

const issueContextSchema = Type.Object({
  identifier: Type.String({ description: "Issue identifier, e.g. LOCAL-123, LIN-123, or PROJ-123" }),
  provider: Type.Optional(Type.String({ description: "Tracker provider. Supports local, linear, and jira." })),
});

const boardOverviewSchema = Type.Object({
  provider: Type.Optional(Type.String({ description: "Tracker provider. Supports local, linear, and jira." })),
  boardId: Type.Optional(Type.String({ description: "Optional board identifier when the tracker exposes one." })),
  projectKey: Type.Optional(Type.String({ description: "Optional project/team key for board-scoped queries." })),
});

const runIdSchema = Type.Object({
  runId: Type.String({ description: "Run identifier" }),
});

const steerSchema = Type.Object({
  runId: Type.String({ description: "Run identifier" }),
  message: Type.String({ description: "Steering or follow-up message for the active run" }),
});

const createIssueSchema = Type.Object({
  title: Type.String({ description: "Issue title" }),
  description: Type.Optional(Type.String({ description: "Issue description" })),
  state: Type.Optional(Type.String({ description: "Initial canonical workflow state" })),
  labels: Type.Optional(Type.Array(Type.String(), { description: "Issue labels" })),
  provider: Type.Optional(Type.String({ description: "Tracker provider. Supports local, linear, and jira." })),
  projectKey: Type.Optional(Type.String({ description: "Optional project/team key for provider-scoped issue creation." })),
});

const retryIssueSchema = Type.Object({
  identifier: Type.String({ description: "Issue identifier to retry, e.g. LOCAL-123, LIN-123, or PROJ-123" }),
  provider: Type.Optional(Type.String({ description: "Tracker provider. Supports local, linear, and jira." })),
});

export function createChiefOfStaffTools(services: ChiefOfStaffServices): ToolDefinition[] {
  return [
    {
      name: "piphony_get_issue_context",
      label: "piphony_get_issue_context",
      description: "Get tracker issue context, active run context, and latest historical run for a specific issue.",
      parameters: issueContextSchema,
      execute: async (_toolCallId, params: { identifier: string; provider?: string }) => ({
        content: [{ type: "text", text: JSON.stringify(await services.getIssueContext(params), null, 2) }],
        details: {
          identifier: params.identifier,
          ...(params.provider === undefined ? {} : { provider: params.provider }),
        },
      }),
    },
    {
      name: "piphony_get_board_overview",
      label: "piphony_get_board_overview",
      description: "Get board/overview state including open issues, active runs, and items needing attention.",
      parameters: boardOverviewSchema,
      execute: async (_toolCallId, params: { provider?: string; boardId?: string; projectKey?: string }) => ({
        content: [{ type: "text", text: JSON.stringify(await services.getBoardOverview(params), null, 2) }],
        details: {
          ...(params.provider === undefined ? {} : { provider: params.provider }),
          ...(params.boardId === undefined ? {} : { boardId: params.boardId }),
          ...(params.projectKey === undefined ? {} : { projectKey: params.projectKey }),
        },
      }),
    },
    {
      name: "piphony_list_active_runs",
      label: "piphony_list_active_runs",
      description: "List all currently active runs known to the control plane.",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [{ type: "text", text: JSON.stringify(await services.listActiveRuns(), null, 2) }],
        details: {},
      }),
    },
    {
      name: "piphony_get_run_detail",
      label: "piphony_get_run_detail",
      description: "Get detailed historical run information for a specific run id.",
      parameters: runIdSchema,
      execute: async (_toolCallId, params: { runId: string }) => ({
        content: [{ type: "text", text: JSON.stringify(await services.getRunDetail(params.runId), null, 2) }],
        details: { runId: params.runId },
      }),
    },
    {
      name: "piphony_steer_run",
      label: "piphony_steer_run",
      description: "Send a steering message to an active worker Pi session.",
      parameters: steerSchema,
      execute: async (_toolCallId, params: { runId: string; message: string }) => {
        await services.steerRun(params.runId, params.message);
        return {
          content: [{ type: "text", text: `Steering sent to ${params.runId}` }],
          details: { runId: params.runId },
        };
      },
    },
    {
      name: "piphony_follow_up_run",
      label: "piphony_follow_up_run",
      description: "Send a follow-up message to an active worker Pi session.",
      parameters: steerSchema,
      execute: async (_toolCallId, params: { runId: string; message: string }) => {
        await services.followUpRun(params.runId, params.message);
        return {
          content: [{ type: "text", text: `Follow-up sent to ${params.runId}` }],
          details: { runId: params.runId },
        };
      },
    },
    {
      name: "piphony_abort_run",
      label: "piphony_abort_run",
      description: "Abort an active worker Pi session.",
      parameters: runIdSchema,
      execute: async (_toolCallId, params: { runId: string }) => {
        await services.abortRun(params.runId);
        return {
          content: [{ type: "text", text: `Abort requested for ${params.runId}` }],
          details: { runId: params.runId },
        };
      },
    },
    {
      name: "piphony_request_run_summary",
      label: "piphony_request_run_summary",
      description: "Ask an active worker Pi session for a concise status summary.",
      parameters: runIdSchema,
      execute: async (_toolCallId, params: { runId: string }) => {
        await services.followUpRun(params.runId, "Please provide a concise status summary of your current work and next step.");
        return {
          content: [{ type: "text", text: `Summary requested for ${params.runId}` }],
          details: { runId: params.runId },
        };
      },
    },
    {
      name: "piphony_retry_issue",
      label: "piphony_retry_issue",
      description: "Abort any current active run for an issue and move the issue back to a runnable state so the pull-based orchestrator can pick it up again.",
      parameters: retryIssueSchema,
      execute: async (_toolCallId, params: { identifier: string; provider?: string }) => ({
        content: [{ type: "text", text: JSON.stringify(await services.retryIssue(params.identifier, params.provider), null, 2) }],
        details: { identifier: params.identifier },
      }),
    },
    {
      name: "piphony_create_issue",
      label: "piphony_create_issue",
      description: "Create a new tracker issue or follow-up ticket.",
      parameters: createIssueSchema,
      execute: async (_toolCallId, params: { title: string; description?: string; state?: string; labels?: string[]; provider?: string; projectKey?: string }) => ({
        content: [{ type: "text", text: JSON.stringify(await services.createIssue({
          title: params.title,
          ...(params.description === undefined ? {} : { description: params.description }),
          ...(params.state === undefined ? {} : { state: params.state as never }),
          ...(params.labels === undefined ? {} : { labels: params.labels }),
          ...(params.provider === undefined ? {} : { provider: params.provider }),
          ...(params.projectKey === undefined ? {} : { projectKey: params.projectKey }),
        }), null, 2) }],
        details: {
          title: params.title,
          ...(params.provider === undefined ? {} : { provider: params.provider }),
          ...(params.projectKey === undefined ? {} : { projectKey: params.projectKey }),
        },
      }),
    },
  ];
}
