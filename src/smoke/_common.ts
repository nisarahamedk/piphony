import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDir, inspectLatestRun, inspectRun } from "../index.js";
import { defaultTrackerDir } from "../tracker/local/harness.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(__dirname, "../..");
export const runsRootDir = join(repoRoot, ".piphony", "runs");
export const trackerDir = defaultTrackerDir(repoRoot);

export async function ensureBaseDirs(): Promise<void> {
  await ensureDir(runsRootDir);
  await ensureDir(join(repoRoot, ".piphony"));
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
