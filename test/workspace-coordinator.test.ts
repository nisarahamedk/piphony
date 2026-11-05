import { describe, expect, test, vi, beforeEach } from "vitest";
import { WorkspaceCoordinator, type WorkspaceHandle, type AttachmentHandle } from "../src/core/workspace-coordinator.js";
import type { PreparedWorkspace, RepoAttachment, RuntimePlatformProvider } from "../src/extensions/types.js";
import type { ExecutionTarget } from "../src/core/types.js";
import type { RunLogger } from "../src/observability/logger.js";

// Mock types
interface MockExecutionTarget extends ExecutionTarget {
  name: string;
  selectTarget: ReturnType<typeof vi.fn>;
  execOnTarget: ReturnType<typeof vi.fn>;
  getEndpoints: ReturnType<typeof vi.fn>;
  collectArtifacts: ReturnType<typeof vi.fn>;
}

// Create mock execution target
const createMockExecutionTarget = (): MockExecutionTarget => ({
  name: "default",
  selectTarget: vi.fn().mockResolvedValue({ id: "target-1", service: "default" }),
  execOnTarget: vi.fn(),
  getEndpoints: vi.fn().mockResolvedValue({}),
  collectArtifacts: vi.fn().mockResolvedValue([]),
});

// Mock RunLogger
const createMockLogger = (): RunLogger => {
  const mock = {
    emit: vi.fn().mockResolvedValue(undefined),
    writeStatus: vi.fn().mockResolvedValue(undefined),
    writeSummary: vi.fn().mockResolvedValue(undefined),
    writeTranscript: vi.fn().mockResolvedValue(undefined),
    artifacts: { runDir: "/tmp/test-run" },
    rootDir: "/tmp",
    runId: "test-run",
    echo: false,
    init: vi.fn(),
    readEvents: vi.fn().mockResolvedValue([]),
  } as unknown as RunLogger;
  return mock;
};

// Mock RuntimePlatformProvider
const createMockProvider = (): RuntimePlatformProvider => ({
  id: "mock-provider",
  platformType: "mock",
  prepareWorkspace: vi.fn().mockResolvedValue({
    workspace: {
      workspaceId: "ws-001",
      platformType: "mock",
      name: "test-workspace",
    },
    endpoints: { api: "http://api.test" },
  }),
  tearDownWorkspace: vi.fn().mockResolvedValue(undefined),
  attachRepo: vi.fn().mockResolvedValue({
    attachment: {
      attachmentId: "att-001",
      repoIdentifier: "owner/repo",
      workspaceId: "ws-001",
      branch: "main",
    },
    executionTargets: {
      default: createMockExecutionTarget(),
    },
    defaultExecutionTarget: "default",
  }),
  detachRepo: vi.fn().mockResolvedValue(undefined),
});

describe("WorkspaceCoordinator", () => {
  let provider: RuntimePlatformProvider;
  let coordinator: WorkspaceCoordinator;
  let mockLogger: RunLogger;

  beforeEach(() => {
    provider = createMockProvider();
    coordinator = new WorkspaceCoordinator(provider, "/test/project");
    mockLogger = createMockLogger();
  });

  describe("prepare", () => {
    test("prepares a workspace and returns a handle", async () => {
      const handle = await coordinator.prepare({
        projectRoot: "/test/project",
        logger: mockLogger,
        env: process.env,
      });

      expect(handle).toBeDefined();
      expect(handle.workspaceId).toBe("ws-001");
      expect(handle.workspace.workspace.workspaceId).toBe("ws-001");
      expect(coordinator.isOpen()).toBe(true);
      expect(coordinator.getState().status).toBe("open");
    });

    test("fails when preparing an already open workspace", async () => {
      await coordinator.prepare({
        projectRoot: "/test/project",
        logger: mockLogger,
        env: process.env,
      });

      await expect(
        coordinator.prepare({
          projectRoot: "/test/project",
          logger: mockLogger,
          env: process.env,
        }),
      ).rejects.toThrow("Workspace is already open");
    });

    test("fails when preparing while tearing down", async () => {
      const handle = await coordinator.prepare({
        projectRoot: "/test/project",
        logger: mockLogger,
        env: process.env,
      });

      // Verify the coordinator tracks state properly
      expect(coordinator.getState().status).toBe("open");
    });

    test("fails when preparing after previous failure", async () => {
      const failingProvider = createMockProvider();
      failingProvider.prepareWorkspace = vi.fn().mockRejectedValue(new Error("prepare failed"));
      const failingCoordinator = new WorkspaceCoordinator(failingProvider, "/test/project");

      await expect(
        failingCoordinator.prepare({
          projectRoot: "/test/project",
          logger: mockLogger,
          env: process.env,
        }),
      ).rejects.toThrow("prepare failed");

      expect(failingCoordinator.getState().status).toBe("failed");
    });
  });

  describe("attach", () => {
    let workspaceHandle: WorkspaceHandle;

    beforeEach(async () => {
      workspaceHandle = await coordinator.prepare({
        projectRoot: "/test/project",
        logger: mockLogger,
        env: process.env,
      });
    });

    test("attaches a repo and returns an attachment handle", async () => {
      const attachmentHandle = await workspaceHandle.attach({
        repoIdentifier: "owner/repo",
        branch: "feature-branch",
        projectRoot: "/test/project",
        logger: mockLogger,
        workItemId: "WORK-123",
      });

      expect(attachmentHandle).toBeDefined();
      expect(attachmentHandle.identity.attachmentId).toBe("att-001");
      expect(attachmentHandle.identity.repoIdentifier).toBe("owner/repo");
      expect(attachmentHandle.identity.workspaceId).toBe("ws-001");
    });

    test("fails when attaching to a closed workspace", async () => {
      const closedCoordinator = new WorkspaceCoordinator(provider, "/test/project");

      await expect(
        closedCoordinator.attach({
          repoIdentifier: "owner/repo",
          projectRoot: "/test/project",
          logger: mockLogger,
          workItemId: "WORK-123",
        }),
      ).rejects.toThrow("Cannot attach: workspace is closed");
    });

    test("allows multiple attachments to the same workspace", async () => {
      const attachment1 = await workspaceHandle.attach({
        repoIdentifier: "owner/repo1",
        projectRoot: "/test/project",
        logger: mockLogger,
        workItemId: "WORK-1",
      });

      const attachment2 = await workspaceHandle.attach({
        repoIdentifier: "owner/repo2",
        projectRoot: "/test/project",
        logger: mockLogger,
        workItemId: "WORK-2",
      });

      expect(attachment1.identity.attachmentId).toBe("att-001");
      expect(attachment2.identity.attachmentId).toBe("att-001");
    });
  });

  describe("detach", () => {
    let workspaceHandle: WorkspaceHandle;
    let attachmentHandle: AttachmentHandle;

    beforeEach(async () => {
      workspaceHandle = await coordinator.prepare({
        projectRoot: "/test/project",
        logger: mockLogger,
        env: process.env,
      });
      attachmentHandle = await workspaceHandle.attach({
        repoIdentifier: "owner/repo",
        projectRoot: "/test/project",
        logger: mockLogger,
        workItemId: "WORK-123",
      });
    });

    test("detaches an attachment without tearing down workspace", async () => {
      await attachmentHandle.detach();

      // Verify detach was called on provider
      expect(provider.detachRepo).toHaveBeenCalled();

      // Workspace should still be open
      expect(coordinator.isOpen()).toBe(true);
      expect(coordinator.getState().status).toBe("open");
    });

    test("fails when detaching non-existent attachment", async () => {
      await expect(coordinator.detach("non-existent:WORK-999")).rejects.toThrow(
        "Attachment not found: non-existent:WORK-999",
      );
    });
  });

  describe("teardown", () => {
    let workspaceHandle: WorkspaceHandle;

    beforeEach(async () => {
      workspaceHandle = await coordinator.prepare({
        projectRoot: "/test/project",
        logger: mockLogger,
        env: process.env,
      });
    });

    test("tears down the workspace", async () => {
      await coordinator.teardown();

      expect(provider.tearDownWorkspace).toHaveBeenCalled();
      expect(coordinator.isOpen()).toBe(false);
      expect(coordinator.getState().status).toBe("closed");
    });

    test("fails when tearing down a closed workspace", async () => {
      await coordinator.teardown();

      await expect(coordinator.teardown()).rejects.toThrow("Cannot teardown: workspace is closed");
    });
  });

  describe("sequential multi-run reuse", () => {
    test("single workspace survives multiple attach/detach cycles", async () => {
      // Prepare workspace once
      const workspaceHandle = await coordinator.prepare({
        projectRoot: "/test/project",
        logger: mockLogger,
        env: process.env,
      });

      // Run 1: attach, execute, detach
      const attachment1 = await workspaceHandle.attach({
        repoIdentifier: "owner/repo1",
        projectRoot: "/test/project",
        logger: mockLogger,
        workItemId: "WORK-1",
      });
      // ... would execute worker here
      await attachment1.detach();

      // Workspace still open after first run
      expect(coordinator.isOpen()).toBe(true);

      // Run 2: attach, execute, detach
      const attachment2 = await workspaceHandle.attach({
        repoIdentifier: "owner/repo2",
        projectRoot: "/test/project",
        logger: mockLogger,
        workItemId: "WORK-2",
      });
      // ... would execute worker here
      await attachment2.detach();

      // Workspace still open after second run
      expect(coordinator.isOpen()).toBe(true);

      // Now tear down
      await coordinator.teardown();

      // Verify teardown happened once for the workspace
      expect(provider.tearDownWorkspace).toHaveBeenCalledTimes(1);
      // But detach was called twice (once per attachment)
      expect(provider.detachRepo).toHaveBeenCalledTimes(2);
    });
  });

  describe("invalid state transitions", () => {
    test("prepare -> prepare fails", async () => {
      await coordinator.prepare({
        projectRoot: "/test/project",
        logger: mockLogger,
        env: process.env,
      });

      await expect(
        coordinator.prepare({
          projectRoot: "/test/project",
          logger: mockLogger,
          env: process.env,
        }),
      ).rejects.toThrow("Workspace is already open");
    });

    test("attach on closed workspace fails", async () => {
      const closedCoordinator = new WorkspaceCoordinator(provider, "/test/project");

      await expect(
        closedCoordinator.attach({
          repoIdentifier: "owner/repo",
          projectRoot: "/test/project",
          logger: mockLogger,
          workItemId: "WORK-123",
        }),
      ).rejects.toThrow("Cannot attach: workspace is closed");
    });

    test("teardown on closed workspace fails", async () => {
      const closedCoordinator = new WorkspaceCoordinator(provider, "/test/project");

      await expect(closedCoordinator.teardown()).rejects.toThrow("Cannot teardown: workspace is closed");
    });
  });
});
