import type {
  PreparedWorkspace,
  RepoAttachment,
  RepoAttachmentIdentity,
  RuntimePlatformProvider,
  WorkspaceIdentity,
} from "../extensions/types.js";
import type { RunLogger } from "../observability/logger.js";
import { errorMessage, errorStack } from "./errors.js";
import { createExtensionHelpers } from "../extensions/api.js";

/**
 * Lifecycle state of a workspace in the coordinator.
 */
export type WorkspaceState =
  | { status: "closed" }
  | { status: "preparing" }
  | { status: "open"; workspace: PreparedWorkspace }
  | { status: "tearing_down"; workspace: PreparedWorkspace }
  | { status: "failed"; error: string };

/**
 * Lifecycle state of a workspace attachment in the coordinator.
 */
export type AttachmentState =
  | { status: "detached" }
  | { status: "attaching"; options: AttachOptions }
  | { status: "attached"; attachment: RepoAttachment; identity: RepoAttachmentIdentity; options: AttachOptions }
  | { status: "detaching"; attachment: RepoAttachment; identity: RepoAttachmentIdentity; options: AttachOptions }
  | { status: "failed"; error: string };

/**
 * Handle to an open workspace managed by the coordinator.
 * This is passed to individual runs for attachment.
 */
export interface WorkspaceHandle {
  readonly workspaceId: string;
  readonly workspace: PreparedWorkspace;
  readonly provider: RuntimePlatformProvider;
  attach(options: AttachOptions): Promise<AttachmentHandle>;
}

/**
 * Options for attaching a repo to an open workspace.
 */
export interface AttachOptions {
  repoIdentifier: string;
  branch?: string;
  projectRoot: string;
  logger: RunLogger;
  workItemId: string;
}

/**
 * Handle to an attachment within an open workspace.
 * This is used for executing a single implementation run.
 */
export interface AttachmentHandle {
  readonly identity: RepoAttachmentIdentity;
  readonly attachment: RepoAttachment;
  detach(): Promise<void>;
}

/**
 * Options for preparing a workspace.
 */
export interface PrepareWorkspaceOptions {
  projectRoot: string;
  logger: RunLogger;
  env: NodeJS.ProcessEnv;
  workspaceName?: string;
}

/**
 * Internal state for tracking an attachment.
 */
interface TrackedAttachment {
  state: AttachmentState;
}

/**
 * WorkspaceCoordinator manages workspace lifecycle above individual implementation runs.
 *
 * Responsibilities:
 * - Prepare a workspace once
 * - Allow multiple implementation runs to attach/detach
 * - Tear down the workspace once when all runs complete
 *
 * This coordinator is in-memory only. It does not persist state across process restarts.
 */
export class WorkspaceCoordinator {
  private state: WorkspaceState = { status: "closed" };
  private attachments = new Map<string, TrackedAttachment>();
  private readonly provider: RuntimePlatformProvider;
  private readonly projectRoot: string;
  private logger: RunLogger | undefined;

  constructor(provider: RuntimePlatformProvider, projectRoot: string) {
    this.provider = provider;
    this.projectRoot = projectRoot;
  }

  /**
   * Prepare and open a workspace.
   * Valid transitions: closed -> preparing -> open
   * @throws Error if workspace is not in closed state
   */
  async prepare(options: PrepareWorkspaceOptions): Promise<WorkspaceHandle> {
    if (this.state.status === "preparing") {
      throw new Error("Workspace is already preparing");
    }
    if (this.state.status === "open") {
      throw new Error("Workspace is already open");
    }
    if (this.state.status === "tearing_down") {
      throw new Error("Cannot prepare workspace while tearing down");
    }
    if (this.state.status === "failed") {
      throw new Error(`Cannot prepare workspace after previous failure: ${this.state.error}`);
    }

    this.logger = options.logger;
    this.state = { status: "preparing" };

    await this.logger.emit("workspace.lifecycle.prepare.started", {
      provider: this.provider.id,
      platformType: this.provider.platformType,
    });

    try {
      const helpers = createExtensionHelpers();
      const prepareContext = {
        projectRoot: this.projectRoot,
        logger: this.logger,
        env: options.env,
        helpers,
      };
      if (options.workspaceName !== undefined) {
        Object.assign(prepareContext, { workspaceName: options.workspaceName });
      }
      
      const preparedWorkspace = await this.provider.prepareWorkspace(prepareContext);

      this.state = { status: "open", workspace: preparedWorkspace };

      await this.logger.emit("workspace.lifecycle.prepare.completed", {
        provider: this.provider.id,
        workspaceId: preparedWorkspace.workspace.workspaceId,
        platformType: preparedWorkspace.workspace.platformType,
        endpoints: preparedWorkspace.endpoints,
      });

      return this.createWorkspaceHandle(preparedWorkspace);
    } catch (error) {
      const errorMsg = errorMessage(error);
      this.state = { status: "failed", error: errorMsg };

      await this.logger.emit("workspace.lifecycle.prepare.failed", {
        provider: this.provider.id,
        message: errorMsg,
        stack: errorStack(error),
      });

      throw error;
    }
  }

  /**
   * Attach a repo to the open workspace.
   * Valid transitions: open -> attaching -> attached
   * @throws Error if workspace is not open
   */
  async attach(options: AttachOptions): Promise<AttachmentHandle> {
    if (this.state.status !== "open") {
      throw new Error(`Cannot attach: workspace is ${this.state.status}`);
    }

    const attachmentKey = `${options.repoIdentifier}:${options.workItemId}`;
    const existingAttachment = this.attachments.get(attachmentKey);
    if (existingAttachment !== undefined) {
      if (existingAttachment.state.status === "attaching" || existingAttachment.state.status === "attached") {
        throw new Error(`Attachment for ${attachmentKey} already exists`);
      }
    }

    const trackedAttachment: TrackedAttachment = {
      state: { status: "attaching", options },
    };
    this.attachments.set(attachmentKey, trackedAttachment);

    const workspace = this.state.workspace;

    await options.logger.emit("attachment.lifecycle.attach.started", {
      provider: this.provider.id,
      workspaceId: workspace.workspace.workspaceId,
      repoIdentifier: options.repoIdentifier,
    });

    try {
      const helpers = createExtensionHelpers();
      const attachContext = {
        projectRoot: options.projectRoot,
        repoIdentifier: options.repoIdentifier,
        logger: options.logger,
        env: process.env,
        helpers,
        workspace: workspace.workspace,
      };
      if (options.branch !== undefined) {
        Object.assign(attachContext, { branch: options.branch });
      }
      
      const attachment = await this.provider.attachRepo(attachContext);

      trackedAttachment.state = {
        status: "attached",
        attachment,
        identity: attachment.attachment,
        options,
      };

      await options.logger.emit("attachment.lifecycle.attach.completed", {
        provider: this.provider.id,
        attachmentId: attachment.attachment.attachmentId,
        workspaceId: attachment.attachment.workspaceId,
        executionTargets: Object.keys(attachment.executionTargets),
      });

      return this.createAttachmentHandle(attachmentKey, attachment);
    } catch (error) {
      const errorMsg = errorMessage(error);
      trackedAttachment.state = { status: "failed", error: errorMsg };

      await options.logger.emit("attachment.lifecycle.attach.failed", {
        provider: this.provider.id,
        workspaceId: workspace.workspace.workspaceId,
        repoIdentifier: options.repoIdentifier,
        message: errorMsg,
        stack: errorStack(error),
      });

      throw error;
    }
  }

  /**
   * Detach a repo from the workspace WITHOUT tearing down the workspace.
   * Valid transitions: attached -> detaching -> detached
   * @throws Error if attachment doesn't exist or is not attached
   */
  async detach(attachmentKey: string): Promise<void> {
    const trackedAttachment = this.attachments.get(attachmentKey);
    if (trackedAttachment === undefined) {
      throw new Error(`Attachment not found: ${attachmentKey}`);
    }

    if (trackedAttachment.state.status !== "attached") {
      throw new Error(`Attachment is not attached: ${attachmentKey} (status: ${trackedAttachment.state.status})`);
    }

    const currentState = trackedAttachment.state;
    const { identity, attachment, options } = currentState;

    trackedAttachment.state = {
      status: "detaching",
      identity,
      attachment,
      options,
    };

    await options.logger.emit("attachment.lifecycle.detach.started", {
      provider: this.provider.id,
      attachmentId: identity.attachmentId,
      workspaceId: identity.workspaceId,
    });

    try {
      const helpers = createExtensionHelpers();
      await this.provider.detachRepo(attachment, {
        projectRoot: options.projectRoot,
        repoIdentifier: identity.repoIdentifier,
        logger: options.logger,
        env: process.env,
        helpers,
        attachment: identity,
      });

      trackedAttachment.state = { status: "detached" };

      await options.logger.emit("attachment.lifecycle.detach.completed", {
        provider: this.provider.id,
        attachmentId: identity.attachmentId,
        workspaceId: identity.workspaceId,
      });
    } catch (error) {
      const errorMsg = errorMessage(error);
      trackedAttachment.state = { status: "failed", error: errorMsg };

      await options.logger.emit("attachment.lifecycle.detach.failed", {
        provider: this.provider.id,
        attachmentId: identity.attachmentId,
        workspaceId: identity.workspaceId,
        message: errorMsg,
        stack: errorStack(error),
      });

      throw error;
    }
  }

  /**
   * Tear down the workspace.
   * Valid transitions: open -> tearing_down -> closed
   * @throws Error if workspace is not open
   */
  async teardown(): Promise<void> {
    if (this.state.status !== "open") {
      throw new Error(`Cannot teardown: workspace is ${this.state.status}`);
    }

    const workspace = this.state.workspace;

    // Check for any attached resources - warn but proceed
    const attachedCount = [...this.attachments.values()].filter(
      (a) => a.state.status === "attached" || a.state.status === "attaching",
    ).length;
    if (attachedCount > 0) {
      await this.logger?.emit("workspace.lifecycle.teardown.warning", {
        provider: this.provider.id,
        workspaceId: workspace.workspace.workspaceId,
        message: `Tearing down workspace with ${attachedCount} attached resources`,
      });
    }

    this.state = { status: "tearing_down", workspace };

    await this.logger?.emit("workspace.lifecycle.teardown.started", {
      provider: this.provider.id,
      workspaceId: workspace.workspace.workspaceId,
    });

    try {
      const helpers = createExtensionHelpers();
      await this.provider.tearDownWorkspace(workspace, {
        projectRoot: this.projectRoot,
        logger: this.logger!,
        env: process.env,
        helpers,
        workspace: workspace.workspace,
      });

      this.state = { status: "closed" };

      await this.logger?.emit("workspace.lifecycle.teardown.completed", {
        provider: this.provider.id,
        workspaceId: workspace.workspace.workspaceId,
      });
    } catch (error) {
      const errorMsg = errorMessage(error);
      this.state = { status: "failed", error: errorMsg };

      await this.logger?.emit("workspace.lifecycle.teardown.failed", {
        provider: this.provider.id,
        workspaceId: workspace.workspace.workspaceId,
        message: errorMsg,
        stack: errorStack(error),
      });

      throw error;
    }
  }

  /**
   * Get the current state of the workspace.
   */
  getState(): WorkspaceState {
    return this.state;
  }

  /**
   * Check if the workspace is open and ready for attachments.
   */
  isOpen(): boolean {
    return this.state.status === "open";
  }

  private createWorkspaceHandle(workspace: PreparedWorkspace): WorkspaceHandle {
    return {
      workspaceId: workspace.workspace.workspaceId,
      workspace,
      provider: this.provider,
      attach: (opts) => this.attach(opts),
    };
  }

  private createAttachmentHandle(
    attachmentKey: string,
    attachment: RepoAttachment,
  ): AttachmentHandle {
    return {
      identity: attachment.attachment,
      attachment,
      detach: () => this.detach(attachmentKey),
    };
  }
}
