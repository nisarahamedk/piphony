import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EventRecord, RunRecord, RunSummaryRecord } from "../core/types.js";
import { ensureDir, nowIso, writeJson } from "../core/utils.js";

export interface RunArtifacts {
  runDir: string;
  eventsPath: string;
  statusPath: string;
  summaryPath: string;
  transcriptPath: string;
  transcriptMetaPath: string;
  artifactsDir: string;
  sessionsDir: string;
}

export class RunLogger {
  readonly artifacts: RunArtifacts;

  constructor(
    private readonly rootDir: string,
    readonly runId: string,
    private readonly echo = false,
  ) {
    const runDir = join(rootDir, runId);
    this.artifacts = {
      runDir,
      eventsPath: join(runDir, "events.jsonl"),
      statusPath: join(runDir, "status.json"),
      summaryPath: join(runDir, "summary.json"),
      transcriptPath: join(runDir, "transcript.md"),
      transcriptMetaPath: join(runDir, "transcript.meta.json"),
      artifactsDir: join(runDir, "artifacts"),
      sessionsDir: join(runDir, "sessions"),
    };
  }

  async init(run: RunRecord): Promise<void> {
    await ensureDir(this.artifacts.runDir);
    await ensureDir(this.artifacts.artifactsDir);
    await this.writeStatus(run);
  }

  async emit(event: string, data?: Record<string, unknown>): Promise<void> {
    const record: EventRecord = data === undefined
      ? { timestamp: nowIso(), event, runId: this.runId }
      : { timestamp: nowIso(), event, runId: this.runId, data };
    await appendFile(this.artifacts.eventsPath, `${JSON.stringify(record)}\n`, "utf8");
    if (this.echo) {
      console.log(`[${record.timestamp}] ${event}`, data ?? {});
    }
  }

  async writeStatus(run: RunRecord): Promise<void> {
    await writeJson(this.artifacts.statusPath, run);
  }

  async writeSummary(summary: RunSummaryRecord): Promise<void> {
    await writeJson(this.artifacts.summaryPath, summary);
  }

  async writeTranscript(text: string): Promise<void> {
    await writeFile(this.artifacts.transcriptPath, text.endsWith("\n") ? text : `${text}\n`, "utf8");
    await writeJson(this.artifacts.transcriptMetaPath, {
      updatedAt: nowIso(),
      bytes: Buffer.byteLength(text, "utf8"),
    });
  }

  async readEvents(): Promise<EventRecord[]> {
    try {
      const raw = await readFile(this.artifacts.eventsPath, "utf8");
      if (raw.trim() === "") {
        return [];
      }
      return raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as EventRecord);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}
