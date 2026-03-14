import { createServerFn } from "@tanstack/react-start";
import { nowIso } from "@piphony/core/utils";
import { assertValidWorkItemTransition, parseCanonicalState } from "@piphony/core/work-item-transitions";
import type { AddCommentInput, CreateIssueInput, TransitionIssueInput, UpdateIssueInput } from "../models";

export const getDashboardSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  const { readDashboardSnapshot } = await loadServerDataModule();
  return readDashboardSnapshot();
});

export const getRunsSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  const { readRunsIndex } = await loadServerDataModule();
  return readRunsIndex();
});

export const getRunDetail = createServerFn({ method: "GET" })
  .inputValidator((input: { runId: string }) => input)
  .handler(async ({ data }) => {
    const { readRunDetail } = await loadServerDataModule();
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

    const {
      getTrackerStore,
      nextSuggestedIdentifier,
      normalizeLabels,
      normalizeOptionalString,
      normalizePriority,
      readDashboardSnapshot,
    } = await loadServerDataModule();
    const identifier = normalizeOptionalString(input.identifier) ?? await nextSuggestedIdentifier();
    const description = normalizeOptionalString(input.description);
    const assignee = normalizeOptionalString(input.assignee);
    const priority = normalizePriority(input.priority);
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
      ...(priority === undefined ? {} : { priority }),
      ...(branchName === undefined ? {} : { branchName }),
      ...(prUrl === undefined ? {} : { prUrl }),
      audit: {
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

    const {
      getTrackerStore,
      normalizeLabels,
      normalizeOptionalString,
      normalizePriority,
      readDashboardSnapshot,
    } = await loadServerDataModule();
    const nextState = parseCanonicalState(input.state, "issue state");
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
      assertValidWorkItemTransition(issue.state, nextState);
      issue.state = nextState;

      const priority = normalizePriority(input.priority);
      const branchName = normalizeOptionalString(input.branchName);
      const prUrl = normalizeOptionalString(input.prUrl);

      if (priority === undefined) {
        delete issue.priority;
      } else {
        issue.priority = priority;
      }
      if (branchName === undefined) {
        delete issue.branchName;
      } else {
        issue.branchName = branchName;
      }
      if (prUrl === undefined) {
        delete issue.prUrl;
      } else {
        issue.prUrl = prUrl;
      }
      issue.audit = {
        ...(issue.audit ?? {}),
        updatedFrom: "piphony_web",
        updatedViaUiAt: nowIso(),
      };
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

    const { getTrackerStore, normalizeOptionalString, readDashboardSnapshot } = await loadServerDataModule();
    const store = getTrackerStore();
    const createdAt = nowIso();
    await store.appendIssueComment(id, {
      id: crypto.randomUUID(),
      body,
      author: normalizeOptionalString(input.author) ?? "human",
      createdAt,
    });
    await store.updateIssueAudit(id, (audit) => ({
      ...audit,
      lastCommentedFrom: "piphony_web",
      lastCommentedAt: createdAt,
    }));
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

    const { getTrackerStore, readDashboardSnapshot } = await loadServerDataModule();
    const nextState = parseCanonicalState(input.state, "issue state");
    const store = getTrackerStore();
    const current = await store.findIssue(id);
    if (current === undefined) {
      throw new Error(`Issue not found: ${id}`);
    }
    assertValidWorkItemTransition(current.state, nextState);
    await store.transitionIssue(id, nextState);
    await store.updateIssueAudit(id, (audit) => ({
      ...audit,
      updatedFrom: "piphony_web",
      updatedViaUiAt: nowIso(),
    }));
    return readDashboardSnapshot();
  });

async function loadServerDataModule() {
  return import("./piphony-data");
}
