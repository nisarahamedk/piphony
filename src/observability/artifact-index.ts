import { join } from "node:path";
import type { RunLogger } from "./logger.js";

export interface RunArtifactIndex {
  runDir: string;
  eventsPath: string;
  statusPath: string;
  summaryPath: string;
  transcriptPath: string;
  transcriptMetaPath: string;
  artifactsDir: string;
  sessionsDir: string;
  sessionFile?: string;
}

export function createRunArtifactIndex(logger: RunLogger): RunArtifactIndex {
  return {
    ...logger.artifacts,
    sessionsDir: join(logger.artifacts.runDir, "sessions"),
  };
}

export function withSessionFile(index: RunArtifactIndex, sessionFile: string | undefined): RunArtifactIndex {
  return sessionFile === undefined ? index : { ...index, sessionFile };
}
