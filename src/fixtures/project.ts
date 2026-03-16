import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { resolveRepoPaths, type RepoPaths } from "../config/repo-paths.js";
import { onboardProject, type OnboardProjectOptions } from "../onboarding/project-onboarding.js";
import { readWorkflowSync } from "../workflow/loader.js";
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
    // Ignore when the reference repo does not have an origin remote.
  }
  await overlaySourceWorkingTreeDelta(source, projectRoot);
  return {
    tempRoot,
    projectRoot,
    cleanup: () => rm(tempRoot, { recursive: true, force: true }),
  };
}

export async function createOnboardedReferenceProject(referenceName: string, options: Omit<OnboardProjectOptions, "projectRoot">): Promise<OnboardedSmokeFixtureProject> {
  const fixture = await cloneReferenceProject(referenceName);
  try {
    await onboardProject({ ...options, projectRoot: fixture.projectRoot });
    return {
      ...fixture,
      paths: resolveRepoPaths(fixture.projectRoot),
    };
  } catch (error) {
    await fixture.cleanup();
    throw error;
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

export async function createOnboardedOpenclawsseumProject(options?: {
  trackerProvider?: OnboardProjectOptions["trackerProvider"];
  trackerProjectKey?: string;
  trackerBoardId?: string;
  model?: string;
  force?: boolean;
}): Promise<OnboardedSmokeFixtureProject> {
  const sourceWorkflow = readWorkflowSync(join(repoRoot, "reference", "openclawsseum"));
  if (sourceWorkflow === undefined) {
    throw new Error("Expected reference/openclawsseum to contain .piphony/workflow.json for smoke onboarding defaults");
  }
  return createOnboardedReferenceProject("openclawsseum", {
    trackerProvider: options?.trackerProvider ?? "local",
    ...(options?.trackerProjectKey === undefined ? {} : { trackerProjectKey: options.trackerProjectKey }),
    ...(options?.trackerBoardId === undefined ? {} : { trackerBoardId: options.trackerBoardId }),
    model: options?.model ?? "minimax/MiniMax-M2.5",
    execution: sourceWorkflow.execution,
    lifecycle: sourceWorkflow.lifecycle,
    force: options?.force ?? true,
  });
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
