import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { resolveRepoPaths, type RepoPaths } from "../config/repo-paths.js";
import { createAgentModelOverrides } from "../pi/agent-types.js";
import { detectProjectOnboardingDefaults, onboardProject, type OnboardProjectOptions } from "../onboarding/project-onboarding.js";
import { repoRoot } from "../smoke/_common.js";

const execFileAsync = promisify(execFile);

export interface SmokeFixtureProject {
  tempRoot: string;
  projectRoot: string;
  cleanup(): Promise<void>;
}

export interface OnboardedSmokeFixtureProject extends SmokeFixtureProject {
  paths: RepoPaths;
}

export async function cloneReferenceProject(referenceName: string): Promise<SmokeFixtureProject> {
  const tempRoot = await mkdtemp(join(tmpdir(), `piphony-${referenceName}-`));
  const source = join(repoRoot, "reference", referenceName);
  const projectRoot = join(tempRoot, referenceName);
  await execFileAsync("git", ["clone", "--quiet", "--no-hardlinks", source, projectRoot], {
    cwd: repoRoot,
    maxBuffer: 20 * 1024 * 1024,
  });
  try {
    const { stdout } = await execFileAsync("git", ["-C", source, "remote", "get-url", "origin"], {
      cwd: repoRoot,
      maxBuffer: 20 * 1024 * 1024,
    });
    const upstream = stdout.toString().trim();
    if (upstream !== "") {
      await execFileAsync("git", ["-C", projectRoot, "remote", "set-url", "origin", upstream], {
        cwd: repoRoot,
        maxBuffer: 20 * 1024 * 1024,
      });
    }
  } catch {
    // ignore refs without origin
  }
  await overlaySourceWorkingTreeDelta(source, projectRoot);
  return {
    tempRoot,
    projectRoot,
    cleanup: () => rm(tempRoot, { recursive: true, force: true }),
  };
}

export async function createOnboardedReferenceProject(referenceName: string, options?: Omit<OnboardProjectOptions, "projectRoot">): Promise<OnboardedSmokeFixtureProject> {
  const fixture = await cloneReferenceProject(referenceName);
  try {
    await ensureOnboardedProject(fixture.projectRoot, options);
    return {
      ...fixture,
      paths: resolveRepoPaths(fixture.projectRoot),
    };
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
}

export async function createOnboardedOpenclawsseumProject(options?: {
  trackerProvider?: OnboardProjectOptions["trackerProvider"];
  trackerProjectKey?: string;
  trackerBoardId?: string;
  model?: string;
  force?: boolean;
}): Promise<OnboardedSmokeFixtureProject> {
  const fixture = await cloneReferenceProject("openclawsseum");
  try {
    await ensureOpenclawsseumProjectFiles(fixture.projectRoot, options?.model ?? "minimax/MiniMax-M2.5");
    await ensureOnboardedProject(fixture.projectRoot, options === undefined ? undefined : {
      trackerProvider: options.trackerProvider ?? "local",
      ...(options.trackerProjectKey === undefined ? {} : { trackerProjectKey: options.trackerProjectKey }),
      ...(options.trackerBoardId === undefined ? {} : { trackerBoardId: options.trackerBoardId }),
      model: options.model ?? "minimax/MiniMax-M2.5",
      execution: {
        kind: "docker_compose",
        composeFile: "infra/docker-compose.local.yml",
        projectName: "openclawsseum",
        service: "runtime",
        workdir: "/workspace",
        endpoints: {
          runtime: "http://runtime:8787",
          convex: "http://convex-backend:3210",
          web: "http://web:3010",
        },
        prepareCommand: "bash scripts/piphony/stack-prepare.sh",
        teardownCommand: "bash scripts/piphony/teardown.sh",
      },
      force: true,
    });
    return {
      ...fixture,
      paths: resolveRepoPaths(fixture.projectRoot),
    };
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
}

async function ensureOnboardedProject(projectRoot: string, options?: Omit<OnboardProjectOptions, "projectRoot">): Promise<void> {
  const extensionsDir = join(projectRoot, ".piphony", "extensions");
  const environmentPath = join(extensionsDir, "environment.ts");
  const trackerPath = join(extensionsDir, "tracker.ts");
  if (await exists(environmentPath) && await exists(trackerPath) && await exists(join(projectRoot, ".piphony", "agent-types.json"))) {
    return;
  }
  const defaults = detectProjectOnboardingDefaults(projectRoot);
  await onboardProject({
    projectRoot,
    trackerProvider: options?.trackerProvider ?? defaults.trackerProvider,
    ...(options?.trackerProjectKey === undefined ? {} : { trackerProjectKey: options.trackerProjectKey }),
    ...(options?.trackerBoardId === undefined ? {} : { trackerBoardId: options.trackerBoardId }),
    model: options?.model ?? defaults.model,
    execution: options?.execution ?? defaults.execution,
    force: options?.force ?? true,
  });
}

async function ensureOpenclawsseumProjectFiles(projectRoot: string, model: string): Promise<void> {
  const extensionsDir = join(projectRoot, ".piphony", "extensions");
  await mkdir(extensionsDir, { recursive: true });
  const environmentPath = join(extensionsDir, "environment.ts");
  const trackerPath = join(extensionsDir, "tracker.ts");
  const agentTypesPath = join(projectRoot, ".piphony", "agent-types.json");
  if (!await exists(environmentPath)) {
    await writeFile(environmentPath, OPENCLAWSSEUM_ENVIRONMENT_EXTENSION, "utf8");
  }
  if (!await exists(trackerPath)) {
    await writeFile(trackerPath, OPENCLAWSSEUM_TRACKER_EXTENSION, "utf8");
  }
  if (!await exists(agentTypesPath)) {
    await writeFile(agentTypesPath, `${JSON.stringify({ agents: createAgentModelOverrides(model) }, null, 2)}\n`, "utf8");
  }
  await rm(join(projectRoot, ".piphony", "workflow.json"), { force: true });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function overlaySourceWorkingTreeDelta(sourceRoot: string, projectRoot: string): Promise<void> {
  const modifiedPaths = await listGitPaths(sourceRoot, ["diff", "--name-only", "-z", "HEAD", "--"]);
  const deletedPaths = await listGitPaths(sourceRoot, ["diff", "--name-only", "--diff-filter=D", "-z", "HEAD", "--"]);
  const untrackedPaths = await listGitPaths(sourceRoot, ["ls-files", "--others", "--exclude-standard", "-z"]);

  for (const relativePath of deletedPaths) {
    await rm(join(projectRoot, relativePath), { recursive: true, force: true });
  }

  const pathsToCopy = new Set([...modifiedPaths, ...untrackedPaths]);
  for (const relativePath of pathsToCopy) {
    await copyPathWithMode(join(sourceRoot, relativePath), join(projectRoot, relativePath));
  }
}

async function listGitPaths(repoPath: string, args: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    cwd: repoRoot,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout
    .toString()
    .split("\0")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

async function copyPathWithMode(sourcePath: string, targetPath: string): Promise<void> {
  const sourceStat = await stat(sourcePath);
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: sourceStat.isDirectory(), force: true });
  await chmod(targetPath, sourceStat.mode);
}

export async function pickAvailablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate an available port")));
        return;
      }
      const port = address.port;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

const OPENCLAWSSEUM_ENVIRONMENT_EXTENSION = `export default function (piphony) {
  piphony.runtimePlatforms.provide({
    id: "repo/openclawsseum/docker-compose",
    platformType: "docker-compose",
    async prepareWorkspace(ctx) {
      await ctx.helpers.execControlPlane({
        projectRoot: ctx.projectRoot,
        command: "bash scripts/piphony/stack-prepare.sh",
        timeoutSeconds: 2700,
      });
      const projectName = process.env.OPENCLAWSSEUM_COMPOSE_PROJECT?.trim() || process.env.PIPHONY_DOCKER_COMPOSE_PROJECT_NAME?.trim() || "openclawsseum";
      return {
        workspace: {
          workspaceId: projectName,
          platformType: "docker-compose",
          primaryEndpoint: "http://runtime:8787",
        },
        endpoints: {
          runtime: "http://runtime:8787",
          convex: "http://convex-backend:3210",
          web: "http://web:3010",
        },
      };
    },
    async tearDownWorkspace(_workspace, ctx) {
      await ctx.helpers.execControlPlane({
        projectRoot: ctx.projectRoot,
        command: "bash scripts/piphony/teardown.sh",
        timeoutSeconds: 2700,
      });
    },
    async attachRepo(ctx) {
      const projectName = process.env.OPENCLAWSSEUM_COMPOSE_PROJECT?.trim() || process.env.PIPHONY_DOCKER_COMPOSE_PROJECT_NAME?.trim() || "openclawsseum";
      return {
        attachment: {
          attachmentId: "openclawsseum-" + ctx.repoIdentifier,
          repoIdentifier: ctx.repoIdentifier,
          workspaceId: projectName,
          branch: ctx.branch,
        },
        executionTargets: {
          runtime: ctx.helpers.createDockerComposeExecutionTarget({
            projectRoot: ctx.projectRoot,
            composeFile: "infra/docker-compose.local.yml",
            projectName,
            service: "runtime",
            workdir: "/workspace",
            endpoints: {
              runtime: "http://runtime:8787",
              convex: "http://convex-backend:3210",
              web: "http://web:3010",
            },
          }),
        },
        defaultExecutionTarget: "runtime",
        endpoints: {
          runtime: "http://runtime:8787",
          convex: "http://convex-backend:3210",
          web: "http://web:3010",
        },
      };
    },
    async detachRepo() {},
  });
}
`;

const OPENCLAWSSEUM_TRACKER_EXTENSION = `export default function (piphony) {
  piphony.trackers.provide({
    id: "repo/openclawsseum/local",
    provider: "local",
    createTracker(ctx) {
      return ctx.helpers.createLocalTracker({ trackerDir: ctx.trackerDir });
    },
  });
}
`;
