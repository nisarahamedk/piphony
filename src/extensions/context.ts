import type { CanonicalState, ExecutionTarget, TrackerMutation, WorkItem } from "../core/types.js";
import type { RunLogger } from "../observability/logger.js";
import type { TrackerProviderClient } from "../tracker/types.js";
import { createExtensionHelpers } from "./api.js";
import type { LoadedPiphonyExtensions, PreparedEnvironment, TransitionEvent, TransitionHookContext } from "./types.js";

export function resolvePreparedExecutionTarget(prepared: PreparedEnvironment): ExecutionTarget {
  if (prepared.defaultExecutionTarget !== undefined) {
    const target = prepared.executionTargets[prepared.defaultExecutionTarget];
    if (target === undefined) {
      throw new Error(`Prepared environment declared defaultExecutionTarget '${prepared.defaultExecutionTarget}' but did not return a matching execution target`);
    }
    return target;
  }
  const entries = Object.entries(prepared.executionTargets);
  if (entries.length === 0) {
    throw new Error("Prepared environment did not return any execution targets");
  }
  if (entries.length > 1) {
    throw new Error(
      `Prepared environment returned multiple execution targets (${entries.map(([name]) => name).join(", ")}) without a defaultExecutionTarget`,
    );
  }
  return entries[0]![1];
}

export function createTransitionAwareTracker(input: {
  projectRoot: string;
  tracker: TrackerProviderClient;
  runtime: LoadedPiphonyExtensions;
  logger?: RunLogger;
}): TrackerProviderClient {
  return new TransitionAwareTrackerProviderClient(input.projectRoot, input.tracker, input.runtime, input.logger);
}

class TransitionAwareTrackerProviderClient implements TrackerProviderClient {
  constructor(
    private readonly projectRoot: string,
    private readonly base: TrackerProviderClient,
    private readonly runtime: LoadedPiphonyExtensions,
    private readonly logger?: RunLogger,
  ) {}

  get provider(): string {
    return this.base.provider;
  }

  fetchCandidateWorkItems(): Promise<WorkItem[]> {
    return this.base.fetchCandidateWorkItems();
  }

  fetchWorkItemById(id: string): Promise<WorkItem | undefined> {
    return this.base.fetchWorkItemById(id);
  }

  fetchWorkItemByIdentifier(identifier: string): Promise<WorkItem | undefined> {
    return this.base.fetchWorkItemByIdentifier(identifier);
  }

  fetchWorkItemsByState(states: CanonicalState[]): Promise<WorkItem[]> {
    return this.base.fetchWorkItemsByState(states);
  }

  normalize(issue: unknown): WorkItem {
    return this.base.normalize(issue);
  }

  async applyMutation(id: string, mutation: TrackerMutation): Promise<WorkItem> {
    if (mutation.type !== "transition") {
      return this.base.applyMutation(id, mutation);
    }

    const current = await this.base.fetchWorkItemById(id);
    if (current === undefined) {
      throw new Error(`Work item not found for transition: ${id}`);
    }

    const event: TransitionEvent = {
      workItem: current,
      fromState: current.state,
      toState: mutation.state,
    };
    const context: TransitionHookContext = {
      projectRoot: this.projectRoot,
      tracker: this.base,
      helpers: createExtensionHelpers(),
      ...(this.logger === undefined ? {} : { logger: this.logger }),
    };

    for (const hook of this.runtime.preTransitionHooks) {
      await hook(event, context);
    }

    const updated = await this.base.applyMutation(id, mutation);
    const completedEvent: TransitionEvent = {
      workItem: updated,
      fromState: current.state,
      toState: mutation.state,
    };

    for (const hook of this.runtime.postTransitionHooks) {
      await hook(completedEvent, context);
    }

    return updated;
  }

  fetchBoardWorkItems(input?: { projectKey?: string; boardId?: string }): Promise<WorkItem[]> {
    return this.base.fetchBoardWorkItems(input);
  }

  createIssue(input: Parameters<TrackerProviderClient["createIssue"]>[0]): Promise<WorkItem> {
    return this.base.createIssue(input);
  }

  updateIssue(id: string, input: Parameters<TrackerProviderClient["updateIssue"]>[1]): Promise<WorkItem> {
    return this.base.updateIssue(id, input);
  }

  appendComment(id: string, input: Parameters<TrackerProviderClient["appendComment"]>[1]) {
    return this.base.appendComment(id, input);
  }

  attachArtifact(id: string, input: Parameters<TrackerProviderClient["attachArtifact"]>[1]) {
    return this.base.attachArtifact(id, input);
  }
}
