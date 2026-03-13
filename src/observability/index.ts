import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EventRecord, RunRecord } from "../core/types.js";
export * from "./artifact-index.js";

export interface RunInspection {
  runId: string;
  status: RunRecord;
  summary?: Record<string, unknown>;
  transcript?: string;
  events: EventRecord[];
}

export async function listRuns(runsRootDir: string): Promise<string[]> {
  try {
    const entries = await readdir(runsRootDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function readJsonIfPresent<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function inspectRun(runsRootDir: string, runId: string): Promise<RunInspection> {
  const runDir = join(runsRootDir, runId);
  const status = await readJsonIfPresent<RunRecord>(join(runDir, "status.json"));
  if (status === undefined) {
    throw new Error(`Run status not found for ${runId}`);
  }

  const summary = await readJsonIfPresent<Record<string, unknown>>(join(runDir, "summary.json"));
  let transcript: string | undefined;
  try {
    transcript = await readFile(join(runDir, "transcript.md"), "utf8");
  } catch {
    transcript = undefined;
  }

  let events: EventRecord[] = [];
  try {
    const raw = await readFile(join(runDir, "events.jsonl"), "utf8");
    events = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EventRecord);
  } catch {
    events = [];
  }

  const base: RunInspection = { runId, status, events };
  if (summary !== undefined) {
    base.summary = summary;
  }
  if (transcript !== undefined) {
    base.transcript = transcript;
  }
  return base;
}

export async function inspectLatestRun(runsRootDir: string): Promise<RunInspection | undefined> {
  const runs = await listRuns(runsRootDir);
  const latest = runs.at(-1);
  return latest === undefined ? undefined : inspectRun(runsRootDir, latest);
}
