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
  readonly runtimePlatforms: {
    provide(provider: RuntimePlatformProvider): void;
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

// =============================================================================
// Runtime Platform Contract
// Canonical model: workspace lifecycle + repo attachment lifecycle
// =============================================================================

/**
 * Identity metadata for a prepared workspace.
 * Captures the essential identity that can be used for observability and re-attachment.
 */
export interface WorkspaceIdentity {
  /** Unique identifier for this workspace instance */
  readonly workspaceId: string;
  /** Runtime platform type (e.g., 'host', 'docker-compose', 'devspace', 'okteto') */
  readonly platformType: string;
  /** Human-readable name or description of the workspace */
  readonly name?: string;
  /** Primary endpoint summary for the workspace (e.g., main URL) */
  readonly primaryEndpoint?: string;
  /** Additional metadata specific to the platform */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Context passed to prepare a workspace.
 */
export interface WorkspacePrepareContext {
  /** Root directory of the project being executed */
  readonly projectRoot: string;
  /** Logger for the operation */
  readonly logger: RunLogger;
  /** Environment variables */
  readonly env: NodeJS.ProcessEnv;
  /** Extension helper APIs */
  readonly helpers: ExtensionHelperAPI;
  /** Optional workspace name/identifier to use (for re-attachment scenarios) */
  readonly workspaceName?: string;
}

/**
 * Context passed to tear down a workspace.
 */
export interface WorkspaceTeardownContext extends WorkspacePrepareContext {
  /** The workspace identity from preparation */
  readonly workspace: WorkspaceIdentity;
}

/**
 * Result of preparing a workspace.
 */
export interface PreparedWorkspace {
  /** Identity metadata for the prepared workspace */
  readonly workspace: WorkspaceIdentity;
  /** Shared endpoints exposed by the workspace (e.g., service URLs) */
  readonly endpoints?: Record<string, string>;
  /** Shared environment variables from the workspace */
  readonly sharedEnv?: Record<string, string>;
}

/**
 * Identity metadata for a repo attachment.
 * Captures the essential identity for the attachment lifecycle.
 */
export interface RepoAttachmentIdentity {
  /** Unique identifier for this attachment instance */
  readonly attachmentId: string;
  /** Repository identifier (e.g., owner/repo name) */
  readonly repoIdentifier: string;
  /** The workspace this repo is attached to */
  readonly workspaceId: string;
  /** Branch or ref being worked on */
  readonly branch?: string;
  /** Additional metadata specific to the platform */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Context passed when attaching a repo to a workspace.
 */
export interface RepoAttachContext {
  /** Root directory of the project being executed */
  readonly projectRoot: string;
  /** Repository identifier (e.g., owner/repo name) */
  readonly repoIdentifier: string;
  /** Branch or ref to attach */
  readonly branch?: string;
  /** Logger for the operation */
  readonly logger: RunLogger;
  /** Environment variables */
  readonly env: NodeJS.ProcessEnv;
  /** Extension helper APIs */
  readonly helpers: ExtensionHelperAPI;
  /** The workspace to attach to */
  readonly workspace: WorkspaceIdentity;
}

/**
 * Context passed when detaching a repo from a workspace.
 */
export interface RepoDetachContext {
  /** Root directory of the project being executed */
  readonly projectRoot: string;
  /** Repository identifier */
  readonly repoIdentifier: string;
  /** Logger for the operation */
  readonly logger: RunLogger;
  /** Environment variables */
  readonly env: NodeJS.ProcessEnv;
  /** Extension helper APIs */
  readonly helpers: ExtensionHelperAPI;
  /** The attachment to detach */
  readonly attachment: RepoAttachmentIdentity;
}

/**
 * Result of attaching a repo to a workspace.
 */
export interface RepoAttachment {
  /** Identity metadata for the attachment */
  readonly attachment: RepoAttachmentIdentity;
  /** Execution targets available for this repo in the workspace */
  readonly executionTargets: Record<string, ExecutionTarget>;
  /** Default execution target name */
  readonly defaultExecutionTarget?: string;
  /** Endpoints specific to this attachment */
  readonly endpoints?: Record<string, string>;
}

/**
 * Runtime platform provider interface.
 * Provides workspace lifecycle and repo attachment lifecycle.
 *
 * This is the canonical interface for runtime platforms that support:
 * - Shared workspace preparation/teardown
 * - Repo-specific attachment into the workspace
 *
 * Simple providers (host, docker-compose) can implement trivial behaviors.
 * Complex providers (DevSpace, Okteto) can implement full workspace semantics.
 */
export interface RuntimePlatformProvider {
  /** Unique identifier for this runtime platform */
  readonly id: string;
  /** Platform type identifier */
  readonly platformType: string;

  /**
   * Prepare a workspace for the work definition.
   * Creates or resolves the shared environment.
   */
  prepareWorkspace(context: WorkspacePrepareContext): Promise<PreparedWorkspace>;

  /**
   * Tear down a previously prepared workspace.
   * Called when the entire work definition is complete.
   */
  tearDownWorkspace(workspace: PreparedWorkspace, context: WorkspaceTeardownContext): Promise<void>;

  /**
   * Attach a repo to an existing workspace.
   * Returns execution targets for running commands in the attached repo context.
   */
  attachRepo(context: RepoAttachContext): Promise<RepoAttachment>;

  /**
   * Detach a repo from the workspace.
   * Called when a repo's work slice is complete.
   * Should NOT tear down the workspace itself.
   */
  detachRepo(attachment: RepoAttachment, context: RepoDetachContext): Promise<void>;
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
  readonly runtimePlatformProvider: RuntimePlatformProvider;
  readonly trackerProvider: TrackerProviderDefinition;
  readonly preTransitionHooks: readonly TransitionHook[];
  readonly postTransitionHooks: readonly TransitionHook[];
  readonly discoveredExtensions: readonly DiscoveredExtension[];
}
