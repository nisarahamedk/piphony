import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { nowIso } from "@piphony/core/utils";
import {
  getTrackerStore,
  nextSuggestedIdentifier,
  normalizeLabels,
  normalizeOptionalString,
  normalizeState,
  readDashboardSnapshot,
  readRunDetail,
  readRunsIndex,
} from "./piphony-data";
import type { AddCommentInput, CreateIssueInput, TransitionIssueInput, UpdateIssueInput } from "../models";

export const getDashboardSnapshot = createServerFn({ method: "GET" }).handler(async () => readDashboardSnapshot());

export const getRunsSnapshot = createServerFn({ method: "GET" }).handler(async () => readRunsIndex());

export const getRunDetail = createServerFn({ method: "GET" })
  .inputValidator((input: { runId: string }) => input)
  .handler(async ({ data }) => {
    const payload = data as { runId?: unknown } | undefined;
    const runId = typeof payload?.runId === "string" ? payload.runId : "";
    return runId === "" ? undefined : readRunDetail(runId);
  });

export const createIssue = createServerFn({ method: "POST" })
  .inputValidator((input: CreateIssueInput) => input)
  .handler(async ({ data }) => {
    const input = (data ?? {}) as CreateIssueInput;
    const title = input.title?.trim();
    if (title === undefined || title === "") {
      throw new Error("Issue title is required");
    }

    const identifier = normalizeOptionalString(input.identifier) ?? await nextSuggestedIdentifier();
    const description = normalizeOptionalString(input.description);
    const assignee = normalizeOptionalString(input.assignee);
    const priority = normalizeOptionalString(input.priority);
    const branchName = normalizeOptionalString(input.branchName);
    const prUrl = normalizeOptionalString(input.prUrl);
    const store = getTrackerStore();
    await store.createIssue({
      identifier,
      title,
      ...(description === undefined ? {} : { description }),
      state: "backlog",
      labels: normalizeLabels(input.labels),
      ...(assignee === undefined ? {} : { assignee }),
      metadata: {
        ...(priority === undefined ? {} : { priority }),
        ...(branchName === undefined ? {} : { branchName }),
        ...(prUrl === undefined ? {} : { prUrl }),
        createdFrom: "piphony_web",
        createdBy: "human",
        createdViaUiAt: nowIso(),
      },
    });

    return readDashboardSnapshot();
  });

export const updateIssue = createServerFn({ method: "POST" })
  .inputValidator((input: UpdateIssueInput) => input)
  .handler(async ({ data }) => {
    const input = (data ?? {}) as UpdateIssueInput;
    const id = input.id?.trim();
    const title = input.title?.trim();
    if (id === undefined || id === "") {
      throw new Error("Issue id is required");
    }
    if (title === undefined || title === "") {
      throw new Error("Issue title is required");
    }

    const store = getTrackerStore();
    await store.updateIssue(id, (issue) => {
      issue.title = title;
      const description = normalizeOptionalString(input.description);
      if (description === undefined) {
        delete issue.description;
      } else {
        issue.description = description;
      }
      issue.labels = normalizeLabels(input.labels);
      const assignee = normalizeOptionalString(input.assignee);
      if (assignee === undefined) {
        delete issue.assignee;
      } else {
        issue.assignee = assignee;
      }
      issue.state = normalizeState(input.state);

      const priority = normalizeOptionalString(input.priority);
      const branchName = normalizeOptionalString(input.branchName);
      const prUrl = normalizeOptionalString(input.prUrl);

      if (priority === undefined) {
        delete issue.metadata.priority;
      } else {
        issue.metadata.priority = priority;
      }
      if (branchName === undefined) {
        delete issue.metadata.branchName;
      } else {
        issue.metadata.branchName = branchName;
      }
      if (prUrl === undefined) {
        delete issue.metadata.prUrl;
      } else {
        issue.metadata.prUrl = prUrl;
      }
      issue.metadata.updatedFrom = "piphony_web";
      issue.metadata.updatedViaUiAt = nowIso();
    });

    return readDashboardSnapshot();
  });

export const appendIssueComment = createServerFn({ method: "POST" })
  .inputValidator((input: AddCommentInput) => input)
  .handler(async ({ data }) => {
    const input = (data ?? {}) as AddCommentInput;
    const id = input.id?.trim();
    const body = input.body?.trim();
    if (id === undefined || id === "") {
      throw new Error("Issue id is required");
    }
    if (body === undefined || body === "") {
      throw new Error("Comment body is required");
    }

    const store = getTrackerStore();
    await store.updateIssue(id, (issue) => {
      issue.comments.push({
        id: randomUUID(),
        body,
        author: normalizeOptionalString(input.author) ?? "human",
        createdAt: nowIso(),
      });
      issue.metadata.lastCommentedFrom = "piphony_web";
      issue.metadata.lastCommentedAt = nowIso();
    });
    return readDashboardSnapshot();
  });

export const transitionIssue = createServerFn({ method: "POST" })
  .inputValidator((input: TransitionIssueInput) => input)
  .handler(async ({ data }) => {
    const input = (data ?? {}) as TransitionIssueInput;
    const id = input.id?.trim();
    if (id === undefined || id === "") {
      throw new Error("Issue id is required");
    }

    const state = normalizeState(input.state);
    const store = getTrackerStore();
    await store.updateIssue(id, (issue) => {
      issue.state = state;
      issue.metadata.updatedFrom = "piphony_web";
      issue.metadata.updatedViaUiAt = nowIso();
    });
    return readDashboardSnapshot();
  });
