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
      getTrackerProvider,
      getTrackerSelection,
      getTrackerStore,
      nextSuggestedIdentifier,
      normalizeLabels,
      normalizeOptionalString,
      readDashboardSnapshot,
    } = await loadServerDataModule();
    const tracker = getTrackerProvider();
    const selection = getTrackerSelection();
    const identifier = normalizeOptionalString(input.identifier);
    const description = normalizeOptionalString(input.description);
    const labels = normalizeLabels(input.labels);

    if (selection.trackerProvider !== "local" && identifier !== undefined) {
      throw new Error(`Explicit identifiers are only supported for the local tracker provider, got ${selection.trackerProvider}`);
    }

    if (tracker.provider === "local") {
      const store = getTrackerStore();
      await store.createIssue({
        identifier: identifier ?? await nextSuggestedIdentifier(),
        title,
        ...(description === undefined ? {} : { description }),
        state: "backlog",
        labels,
        audit: {
          createdFrom: "piphony_web",
          createdBy: "human",
          createdViaUiAt: nowIso(),
        },
      });
    } else {
      await tracker.createIssue({
        title,
        ...(description === undefined ? {} : { description }),
        state: "backlog",
        labels,
        ...(selection.trackerProjectKey === undefined ? {} : { projectKey: selection.trackerProjectKey }),
      });
    }

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
      getTrackerProvider,
      getTrackerStore,
      normalizeLabels,
      normalizeOptionalString,
      normalizePriority,
      readDashboardSnapshot,
    } = await loadServerDataModule();
    const nextState = parseCanonicalState(input.state, "issue state");
    const tracker = getTrackerProvider();
    const current = await tracker.fetchWorkItemById(id) ?? await tracker.fetchWorkItemByIdentifier(id);
    if (current === undefined) {
      throw new Error(`Issue not found: ${id}`);
    }
    assertValidWorkItemTransition(current.state, nextState);

    const description = normalizeOptionalString(input.description);
    const labels = normalizeLabels(input.labels);
    const assignee = normalizeOptionalString(input.assignee);
    const priority = normalizePriority(input.priority);
    const branchName = normalizeOptionalString(input.branchName);
    const prUrl = normalizeOptionalString(input.prUrl);

    if (tracker.provider !== "local") {
      if (assignee !== current.assignee) {
        throw new Error(`${tracker.provider} assignee editing is not implemented in the web UI yet`);
      }
      if (branchName !== current.branchName) {
        throw new Error(`${tracker.provider} branch name editing is not implemented in the web UI yet`);
      }
      if (prUrl !== current.prUrl) {
        throw new Error(`${tracker.provider} PR URL editing is not implemented in the web UI yet`);
      }
    }

    await tracker.updateIssue(current.externalId, {
      title,
      description,
      labels,
      assignee,
      priority,
      branchName,
      prUrl,
      state: nextState,
    });

    if (tracker.provider === "local") {
      const store = getTrackerStore();
      await store.updateIssueAudit(id, (audit) => ({
        ...audit,
        updatedFrom: "piphony_web",
        updatedViaUiAt: nowIso(),
      }));
    }

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

    const { getTrackerProvider, getTrackerStore, normalizeOptionalString, readDashboardSnapshot } = await loadServerDataModule();
    const tracker = getTrackerProvider();
    const createdAt = nowIso();
    const issue = await tracker.fetchWorkItemById(id) ?? await tracker.fetchWorkItemByIdentifier(id);
    if (issue === undefined) {
      throw new Error(`Issue not found: ${id}`);
    }
    await tracker.appendComment(issue.externalId, {
      body,
      author: normalizeOptionalString(input.author) ?? "human",
    });
    if (tracker.provider === "local") {
      const store = getTrackerStore();
      await store.updateIssueAudit(id, (audit) => ({
        ...audit,
        lastCommentedFrom: "piphony_web",
        lastCommentedAt: createdAt,
      }));
    }
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

    const { getTrackerProvider, getTrackerStore, readDashboardSnapshot } = await loadServerDataModule();
    const nextState = parseCanonicalState(input.state, "issue state");
    const tracker = getTrackerProvider();
    const current = await tracker.fetchWorkItemById(id) ?? await tracker.fetchWorkItemByIdentifier(id);
    if (current === undefined) {
      throw new Error(`Issue not found: ${id}`);
    }
    assertValidWorkItemTransition(current.state, nextState);
    await tracker.applyMutation(current.externalId, { type: "transition", state: nextState });
    if (tracker.provider === "local") {
      const store = getTrackerStore();
      await store.updateIssueAudit(id, (audit) => ({
        ...audit,
        updatedFrom: "piphony_web",
        updatedViaUiAt: nowIso(),
      }));
    }
    return readDashboardSnapshot();
  });

async function loadServerDataModule() {
  return import("./piphony-data");
}
