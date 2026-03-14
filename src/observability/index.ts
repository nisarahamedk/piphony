import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EventRecord, RunRecord, RunSummaryRecord } from "../core/types.js";
import { errorMessage } from "../core/errors.js";

export interface RunInspection {
  runId: string;
  status: RunRecord;
  summary?: RunSummaryRecord;
  transcript?: string;
  events: EventRecord[];
}

export interface RunSummaryInspection {
  runId: string;
  status: RunRecord;
  summary?: RunSummaryRecord;
}

export async function listRuns(runsRootDir: string): Promise<string[]> {
  try {
    const entries = await readdir(runsRootDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
}

export async function listRunSummaries(runsRootDir: string): Promise<RunSummaryInspection[]> {
  const runIds = await listRuns(runsRootDir);
  const summaries = await Promise.all(runIds.map((runId) => inspectRunSummary(runsRootDir, runId)));
  return summaries.filter((summary): summary is RunSummaryInspection => summary !== undefined);
}

export async function inspectRunSummary(runsRootDir: string, runId: string): Promise<RunSummaryInspection | undefined> {
  const runDir = join(runsRootDir, runId);
  const status = await readOptionalJson<RunRecord>(join(runDir, "status.json"));
  if (status === undefined) {
    return undefined;
  }
  const summary = await readOptionalJson<RunSummaryRecord>(join(runDir, "summary.json"));
  return summary === undefined ? { runId, status } : { runId, status, summary };
}

export async function inspectRun(runsRootDir: string, runId: string): Promise<RunInspection> {
  const summaryInspection = await inspectRunSummary(runsRootDir, runId);
  if (summaryInspection === undefined) {
    throw new Error(`Run status not found for ${runId}`);
  }

  const runDir = join(runsRootDir, runId);
  const transcript = await readOptionalText(join(runDir, "transcript.md"));
  const eventsText = await readOptionalText(join(runDir, "events.jsonl"));
  const events = eventsText === undefined ? [] : parseJsonLines(eventsText, join(runDir, "events.jsonl"));

  return {
    runId,
    status: summaryInspection.status,
    events,
    ...(summaryInspection.summary === undefined ? {} : { summary: summaryInspection.summary }),
    ...(transcript === undefined ? {} : { transcript }),
  };
}

export async function inspectLatestRun(runsRootDir: string): Promise<RunInspection | undefined> {
  const runs = await listRuns(runsRootDir);
  const latest = runs.at(-1);
  return latest === undefined ? undefined : inspectRun(runsRootDir, latest);
}

async function readOptionalJson<T>(path: string): Promise<T | undefined> {
  const text = await readOptionalText(path);
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Failed to parse JSON artifact ${path}: ${errorMessage(error)}`);
  }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw new Error(`Failed to read artifact ${path}: ${errorMessage(error)}`);
  }
}

function parseJsonLines(raw: string, path: string): EventRecord[] {
  if (raw.trim() === "") {
    return [];
  }
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as EventRecord;
      } catch (error) {
        throw new Error(`Failed to parse JSONL artifact ${path} at line ${index + 1}: ${errorMessage(error)}`);
      }
    });
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
