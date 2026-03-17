import { resolve } from "node:path";
import { createExtensionHelpers } from "../extensions/api.js";
import { createTransitionAwareTracker, resolvePreparedExecutionTarget } from "../extensions/context.js";
import { resolveProjectExtensionsDir, resolveUserExtensionsDir } from "../extensions/discovery.js";
import { isProjectOnboarded, loadProjectExtensions } from "../extensions/runtime.js";
import type { LoadedPiphonyExtensions, PreparedEnvironment } from "../extensions/types.js";
import type { ExecutionTarget } from "../core/types.js";
import type { RunLogger } from "../observability/logger.js";
import { createTrackerProviderRegistry } from "../tracker/provider-registry.js";
import type { TrackerProviderClient } from "../tracker/types.js";
import { trackerSelectionsEqual, type TrackerSelection } from "./tracker-selection.js";

export interface ProjectExecutionContext {
  readonly projectRoot: string;
  readonly extensionsDir: string;
  readonly runtime: LoadedPiphonyExtensions;
}

export interface CreateProjectTrackerInput {
  context: ProjectExecutionContext;
  trackerDir: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  logger?: RunLogger;
  selection?: TrackerSelection;
}

export function loadOnboardedProjectExecution(projectRoot: string): ProjectExecutionContext {
  const resolvedProjectRoot = resolve(projectRoot);
  if (!isProjectOnboarded(resolvedProjectRoot)) {
    throw new Error(
      `Project is not onboarded. Expected extension files at ${resolveProjectExtensionsDir(resolvedProjectRoot)} or user-global extensions at ${resolveUserExtensionsDir()}. Run 'npm run onboard' inside the managed repo first, or ensure user-global extensions are installed.`,
    );
  }
  return {
    projectRoot: resolvedProjectRoot,
    extensionsDir: resolveProjectExtensionsDir(resolvedProjectRoot),
    runtime: loadProjectExtensions(resolvedProjectRoot),
  };
}

export function getProjectTrackerSelection(context: ProjectExecutionContext): TrackerSelection {
  const provider = context.runtime.trackerProvider;
  return {
    trackerProvider: provider.provider,
    ...(provider.defaultProjectKey === undefined ? {} : { trackerProjectKey: provider.defaultProjectKey }),
    ...(provider.defaultBoardId === undefined ? {} : { trackerBoardId: provider.defaultBoardId }),
  };
}

export function createProjectTracker(input: CreateProjectTrackerInput): TrackerProviderClient {
  const extensionSelection = getProjectTrackerSelection(input.context);
  const effectiveSelection = input.selection ?? extensionSelection;
  const baseTracker = trackerSelectionsEqual(effectiveSelection, extensionSelection)
    ? createExtensionTracker(input)
    : createSelectedTracker(input, effectiveSelection);

  return createTransitionAwareTracker({
    projectRoot: input.context.projectRoot,
    tracker: baseTracker,
    runtime: input.context.runtime,
    ...(input.logger === undefined ? {} : { logger: input.logger }),
  });
}

export async function prepareProjectEnvironment(input: {
  context: ProjectExecutionContext;
  logger: RunLogger;
  env?: NodeJS.ProcessEnv;
}): Promise<{ preparedEnvironment: PreparedEnvironment; executionTarget: ExecutionTarget }> {
  const helpers = createExtensionHelpers();
  const preparedEnvironment = await input.context.runtime.environmentProvider.prepareEnv({
    projectRoot: input.context.projectRoot,
    logger: input.logger,
    env: input.env ?? process.env,
    helpers,
  });
  let executionTarget: ExecutionTarget;
  try {
    executionTarget = resolvePreparedExecutionTarget(preparedEnvironment);
  } catch (targetError) {
    (targetError as Error & { preparedEnvironment?: PreparedEnvironment }).preparedEnvironment = preparedEnvironment;
    throw targetError;
  }
  return { preparedEnvironment, executionTarget };
}

export async function teardownProjectEnvironment(input: {
  context: ProjectExecutionContext;
  preparedEnvironment: PreparedEnvironment;
  logger: RunLogger;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const helpers = createExtensionHelpers();
  await input.context.runtime.environmentProvider.tearDownEnv(input.preparedEnvironment, {
    projectRoot: input.context.projectRoot,
    logger: input.logger,
    env: input.env ?? process.env,
    helpers,
  });
}

function createExtensionTracker(input: CreateProjectTrackerInput): TrackerProviderClient {
  const helpers = createExtensionHelpers();
  return input.context.runtime.trackerProvider.createTracker({
    projectRoot: input.context.projectRoot,
    trackerDir: input.trackerDir,
    env: input.env ?? process.env,
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
    helpers,
  });
}

function createSelectedTracker(
  input: CreateProjectTrackerInput,
  selection: TrackerSelection,
): TrackerProviderClient {
  const registry = createTrackerProviderRegistry({
    trackerDir: input.trackerDir,
    env: input.env ?? process.env,
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
    ...(selection.trackerProjectKey === undefined ? {} : { trackerProjectKey: selection.trackerProjectKey }),
    ...(selection.trackerBoardId === undefined ? {} : { trackerBoardId: selection.trackerBoardId }),
  });
  return registry.resolve(selection.trackerProvider);
}
