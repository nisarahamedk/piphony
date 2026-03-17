import type { CanonicalState, ExecutionTarget, TrackerAdapter, WorkItem } from "../core/types.js";
import type { RunLogger } from "../observability/logger.js";
import type { SupportedTrackerProvider, TrackerProviderClient } from "../tracker/types.js";

export type ExtensionScope = "project" | "user";

export interface DiscoveredExtension {
  readonly path: string;
  readonly scope: ExtensionScope;
}

export type PiphonyExtensionFactory = (api: PiphonyExtensionAPI) => void | Promise<void>;

export interface PiphonyExtensionAPI {
  readonly environments: {
    provide(provider: EnvironmentProvider): void;
  };
  readonly trackers: {
    provide(provider: TrackerProviderDefinition): void;
  };
  readonly transitions: {
    preWorkItemTransition(hook: TransitionHook): void;
    postWorkItemTransition(hook: TransitionHook): void;
  };
  readonly helpers: ExtensionHelperAPI;
}

export interface ExtensionHelperAPI {
  execControlPlane(input: {
    projectRoot: string;
    command: string;
    timeoutSeconds?: number;
    env?: Record<string, string>;
  }): Promise<string>;
  createDockerComposeExecutionTarget(input: {
    projectRoot: string;
    composeFile: string;
    projectName: string;
    service: string;
    workdir?: string;
    endpoints?: Record<string, string>;
  }): ExecutionTarget;
  createHostExecutionTarget(input: {
    projectRoot: string;
    workdir?: string;
    endpoints?: Record<string, string>;
  }): ExecutionTarget;
  createLocalTracker(input: {
    trackerDir: string;
  }): TrackerProviderClient;
  createLinearTracker(input: {
    env: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    defaultTeamKey?: string;
  }): TrackerProviderClient;
  createJiraTracker(input: {
    env: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    defaultProjectKey?: string;
  }): TrackerProviderClient;
}

export interface EnvironmentProvider {
  readonly id: string;
  prepareEnv(context: PrepareEnvironmentContext): Promise<PreparedEnvironment>;
  tearDownEnv(prepared: PreparedEnvironment, context: TearDownEnvironmentContext): Promise<void>;
}

export interface PrepareEnvironmentContext {
  readonly projectRoot: string;
  readonly logger: RunLogger;
  readonly env: NodeJS.ProcessEnv;
  readonly helpers: ExtensionHelperAPI;
}

export interface TearDownEnvironmentContext extends PrepareEnvironmentContext {}

export interface PreparedEnvironment {
  readonly executionTargets: Record<string, ExecutionTarget>;
  readonly defaultExecutionTarget?: string;
  readonly endpoints?: Record<string, string>;
  readonly sharedEnv?: Record<string, string>;
}

export interface TrackerProviderDefinition {
  readonly id: string;
  readonly provider: SupportedTrackerProvider;
  readonly defaultProjectKey?: string;
  readonly defaultBoardId?: string;
  createTracker(context: CreateTrackerContext): TrackerProviderClient;
}

export interface CreateTrackerContext {
  readonly projectRoot: string;
  readonly trackerDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly helpers: ExtensionHelperAPI;
}

export interface TransitionEvent {
  readonly workItem: WorkItem;
  readonly fromState: CanonicalState;
  readonly toState: CanonicalState;
}

export interface TransitionHookContext {
  readonly projectRoot: string;
  readonly tracker: TrackerAdapter;
  readonly helpers: ExtensionHelperAPI;
  readonly logger?: RunLogger;
}

export type TransitionHook = (event: TransitionEvent, context: TransitionHookContext) => Promise<void> | void;

export interface LoadedPiphonyExtensions {
  readonly environmentProvider: EnvironmentProvider;
  readonly trackerProvider: TrackerProviderDefinition;
  readonly preTransitionHooks: readonly TransitionHook[];
  readonly postTransitionHooks: readonly TransitionHook[];
  readonly discoveredExtensions: readonly DiscoveredExtension[];
}
