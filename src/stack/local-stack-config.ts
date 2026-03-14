import { join, resolve } from "node:path";
import { createRunId } from "../core/utils.js";

export interface LocalPiphonyStackConfig {
  repoRoot: string;
  trackerDir: string;
  runsRootDir: string;
  sessionRootDir: string;
  cosPort: number;
  cosHost: string;
  pollIntervalMs: number;
  maxConcurrentWorkers: number;
  instanceId: string;
}

export interface LocalPiphonyStackConfigInput {
  repoRoot?: string;
  trackerDir?: string;
  runsRootDir?: string;
  sessionRootDir?: string;
  cosPort?: number;
  cosHost?: string;
  pollIntervalMs?: number;
  maxConcurrentWorkers?: number;
  instanceId?: string;
}

export function resolveLocalPiphonyStackConfig(
  options: LocalPiphonyStackConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
): LocalPiphonyStackConfig {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  return {
    repoRoot,
    trackerDir: resolve(options.trackerDir ?? join(repoRoot, ".piphony", "tracker-local")),
    runsRootDir: resolve(options.runsRootDir ?? join(repoRoot, ".piphony", "runs")),
    sessionRootDir: resolve(options.sessionRootDir ?? join(repoRoot, ".piphony", "cos-sessions")),
    cosPort: options.cosPort ?? 6521,
    cosHost: options.cosHost ?? "127.0.0.1",
    pollIntervalMs: options.pollIntervalMs ?? parsePositiveInteger(env.PIPHONY_POLL_INTERVAL_MS, 3_000, "PIPHONY_POLL_INTERVAL_MS"),
    maxConcurrentWorkers: options.maxConcurrentWorkers ?? parsePositiveInteger(env.PIPHONY_MAX_CONCURRENT_WORKERS, 1, "PIPHONY_MAX_CONCURRENT_WORKERS"),
    instanceId: options.instanceId ?? (env.PIPHONY_ORCHESTRATOR_ID?.trim() || createRunId("orchestrator")),
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
