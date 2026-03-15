export const LOCAL_STACK_WORKER_MODES = ["real", "smoke"] as const;

export type LocalStackWorkerMode = (typeof LOCAL_STACK_WORKER_MODES)[number];

export function parseLocalStackWorkerMode(raw: string | undefined, fallback: LocalStackWorkerMode, name: string): LocalStackWorkerMode {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "real" || normalized === "smoke") {
    return normalized;
  }
  throw new Error(`${name} must be one of: ${LOCAL_STACK_WORKER_MODES.join(", ")}`);
}
