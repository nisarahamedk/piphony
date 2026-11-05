import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveRepoPaths } from "../config/repo-paths.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolveRepoPaths().repoRoot;

export const DEVSPACE_FIXTURE_REFERENCE_REPO_NAMES = {
  workspace: "devspace-fixture-workspace",
  frontend: "devspace-fixture-frontend",
  gateway: "devspace-fixture-gateway",
  backend: "devspace-fixture-backend",
} as const;

export interface DevSpaceFixtureProject {
  tempRoot: string;
  workspaceRoot: string;
  frontendRoot: string;
  gatewayRoot: string;
  backendRoot: string;
  cleanup(): Promise<void>;
}

export async function cloneDevSpaceFixtureProject(): Promise<DevSpaceFixtureProject> {
  const tempRoot = await mkdtemp(join(tmpdir(), "piphony-devspace-fixture-"));
  try {
    const workspaceRoot = await materializeReferenceRepo(DEVSPACE_FIXTURE_REFERENCE_REPO_NAMES.workspace, tempRoot);
    const frontendRoot = await materializeReferenceRepo(DEVSPACE_FIXTURE_REFERENCE_REPO_NAMES.frontend, tempRoot);
    const gatewayRoot = await materializeReferenceRepo(DEVSPACE_FIXTURE_REFERENCE_REPO_NAMES.gateway, tempRoot);
    const backendRoot = await materializeReferenceRepo(DEVSPACE_FIXTURE_REFERENCE_REPO_NAMES.backend, tempRoot);

    return {
      tempRoot,
      workspaceRoot,
      frontendRoot,
      gatewayRoot,
      backendRoot,
      cleanup: () => rm(tempRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

async function materializeReferenceRepo(referenceName: string, targetParent: string): Promise<string> {
  const sourceRoot = join(repoRoot, "reference", referenceName);
  await assertDirectoryExists(sourceRoot);

  const targetRoot = join(targetParent, referenceName);
  await cp(sourceRoot, targetRoot, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
  });

  await execFileAsync("git", ["init", "--quiet", "-b", "main"], {
    cwd: targetRoot,
    maxBuffer: 20 * 1024 * 1024,
  });
  await execFileAsync("git", ["add", "."], {
    cwd: targetRoot,
    maxBuffer: 20 * 1024 * 1024,
  });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Piphony Fixture",
      "-c",
      "user.email=fixture@piphony.local",
      "commit",
      "--quiet",
      "-m",
      "Fixture snapshot",
    ],
    {
      cwd: targetRoot,
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  return targetRoot;
}

async function assertDirectoryExists(path: string): Promise<void> {
  try {
    const pathStat = await stat(path);
    if (!pathStat.isDirectory()) {
      throw new Error(`Expected reference fixture directory at ${path}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing reference fixture directory ${path}: ${message}`);
  }
}
