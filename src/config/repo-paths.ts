import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultTrackerDir } from "../tracker/local/harness.js";

const thisDir = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(thisDir, "../..");

export interface RepoPaths {
  repoRoot: string;
  piphonyRoot: string;
  runsRootDir: string;
  trackerDir: string;
  sessionRootDir: string;
}

export function resolveRepoPaths(repoRoot = defaultRepoRoot): RepoPaths {
  const resolvedRepoRoot = resolve(repoRoot);
  const piphonyRoot = join(resolvedRepoRoot, ".piphony");
  return {
    repoRoot: resolvedRepoRoot,
    piphonyRoot,
    runsRootDir: join(piphonyRoot, "runs"),
    trackerDir: defaultTrackerDir(resolvedRepoRoot),
    sessionRootDir: join(piphonyRoot, "cos-sessions"),
  };
}
