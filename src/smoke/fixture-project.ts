import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { onboardProject, type OnboardProjectOptions } from "../onboarding/project-onboarding.js";
import { repoRoot } from "./_common.js";

const execFileAsync = promisify(execFile);

export interface SmokeFixtureProject {
  tempRoot: string;
  projectRoot: string;
  cleanup(): Promise<void>;
}

export async function cloneReferenceProject(referenceName: string): Promise<SmokeFixtureProject> {
  const tempRoot = await mkdtemp(join(tmpdir(), `piphony-${referenceName}-`));
  const source = join(repoRoot, "reference", referenceName);
  const projectRoot = join(tempRoot, referenceName);
  await execFileAsync("git", ["clone", "--quiet", "--no-hardlinks", source, projectRoot], {
    cwd: repoRoot,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    tempRoot,
    projectRoot,
    cleanup: () => rm(tempRoot, { recursive: true, force: true }),
  };
}

export async function createOnboardedReferenceProject(referenceName: string, options: Omit<OnboardProjectOptions, "projectRoot">): Promise<SmokeFixtureProject> {
  const fixture = await cloneReferenceProject(referenceName);
  try {
    await onboardProject({ ...options, projectRoot: fixture.projectRoot });
    return fixture;
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
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
