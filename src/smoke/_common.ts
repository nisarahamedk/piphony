import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDir, inspectLatestRun, inspectRun } from "../index.js";
import { resolveRepoPaths } from "../config/repo-paths.js";

const repoPaths = resolveRepoPaths();
export const repoRoot = repoPaths.repoRoot;
export const runsRootDir = repoPaths.runsRootDir;
export const trackerDir = repoPaths.trackerDir;

export async function ensureBaseDirs(): Promise<void> {
  await ensureDir(runsRootDir);
  await ensureDir(repoPaths.piphonyRoot);
}

export async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

export async function createTempFile(name: string, content: string): Promise<string> {
  const dir = await makeTempDir("piphony-temp");
  const path = join(dir, name);
  await writeFile(path, content, "utf8");
  return path;
}

export async function cleanupPath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function latestRun() {
  return inspectLatestRun(runsRootDir);
}

export async function readRun(runId: string) {
  return inspectRun(runsRootDir, runId);
}
