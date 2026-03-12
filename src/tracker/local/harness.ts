import { join } from "node:path";
import { emptyLocalTrackerState, loadSeedState, LocalTrackerStore } from "./state.js";
import type { LocalTrackerState } from "./types.js";

export function defaultTrackerDir(cwd = process.cwd()): string {
  return join(cwd, ".piphony", "tracker-local");
}

export async function resetTrackerState(input: { trackerDir: string; seedPath?: string }): Promise<LocalTrackerState> {
  const store = new LocalTrackerStore({ trackerDir: input.trackerDir });
  const seed = input.seedPath === undefined ? emptyLocalTrackerState() : await loadSeedState(input.seedPath);
  await store.reset(seed);
  return seed;
}

export async function readTrackerState(trackerDir: string): Promise<LocalTrackerState> {
  const store = new LocalTrackerStore({ trackerDir });
  return store.load();
}
