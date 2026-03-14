import { createRunId } from "../core/utils.js";
import { resolveRepoPaths, type RepoPaths } from "../config/repo-paths.js";

export interface OrchestratorWatchConfig extends RepoPaths {
  pollIntervalMs: number;
  maxConcurrentWorkers: number;
  instanceId: string;
}

export function parseOrchestratorWatchConfig(env: NodeJS.ProcessEnv, repoRoot = process.cwd()): OrchestratorWatchConfig {
  const paths = resolveRepoPaths(repoRoot);
  return {
    ...paths,
    pollIntervalMs: parsePositiveInteger(env.PIPHONY_POLL_INTERVAL_MS, 3_000, "PIPHONY_POLL_INTERVAL_MS"),
    maxConcurrentWorkers: parsePositiveInteger(env.PIPHONY_MAX_CONCURRENT_WORKERS, 1, "PIPHONY_MAX_CONCURRENT_WORKERS"),
    instanceId: env.PIPHONY_ORCHESTRATOR_ID?.trim() || createRunId("orchestrator"),
  };
}

function parsePositiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
