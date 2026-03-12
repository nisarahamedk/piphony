import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ensureDir, nowIso, readJson, withOptional, writeJson } from "../../core/utils.js";
import type { LocalIssue, LocalTrackerState } from "./types.js";

export interface LocalTrackerStoreOptions {
  trackerDir: string;
}

export class LocalTrackerStore {
  readonly trackerDir: string;
  readonly stateFile: string;
  readonly artifactsDir: string;

  constructor(options: LocalTrackerStoreOptions) {
    this.trackerDir = resolve(options.trackerDir);
    this.stateFile = join(this.trackerDir, "state.json");
    this.artifactsDir = join(this.trackerDir, "artifacts");
  }

  async ensure(): Promise<void> {
    await ensureDir(this.trackerDir);
    await ensureDir(this.artifactsDir);
    try {
      await readFile(this.stateFile, "utf8");
    } catch {
      await this.save(emptyLocalTrackerState());
    }
  }

  async load(): Promise<LocalTrackerState> {
    await this.ensure();
    return readJson<LocalTrackerState>(this.stateFile);
  }

  async save(state: LocalTrackerState): Promise<void> {
    await ensureDir(dirname(this.stateFile));
    await writeJson(this.stateFile, state);
  }

  async reset(seed?: LocalTrackerState): Promise<LocalTrackerState> {
    const next = seed ?? emptyLocalTrackerState();
    await this.save(next);
    return next;
  }

  async createIssue(input: {
    identifier: string;
    title: string;
    description?: string;
    state: LocalIssue["state"];
    labels?: string[];
    assignee?: string;
    metadata?: Record<string, unknown>;
  }): Promise<LocalIssue> {
    const state = await this.load();
    const timestamp = nowIso();
    const issue = withOptional(
      withOptional(
        {
          id: randomUUID(),
          identifier: input.identifier,
          title: input.title,
          state: input.state,
          labels: input.labels ?? [],
          url: `local://issues/${input.identifier}`,
          metadata: input.metadata ?? {},
          comments: [],
          artifacts: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        "description",
        input.description,
      ),
      "assignee",
      input.assignee,
    ) as LocalIssue;
    state.issues.push(issue);
    await this.save(state);
    return issue;
  }

  async findIssue(identifierOrId: string): Promise<LocalIssue | undefined> {
    const state = await this.load();
    return state.issues.find((issue) => issue.id === identifierOrId || issue.identifier === identifierOrId);
  }

  async updateIssue(identifierOrId: string, mutate: (issue: LocalIssue) => void): Promise<LocalIssue> {
    const state = await this.load();
    const issue = state.issues.find((candidate) => candidate.id === identifierOrId || candidate.identifier === identifierOrId);
    if (issue === undefined) {
      throw new Error(`Local issue not found: ${identifierOrId}`);
    }
    mutate(issue);
    issue.updatedAt = nowIso();
    await this.save(state);
    return issue;
  }

  async copyArtifact(identifier: string, sourcePath: string): Promise<string> {
    const destinationDir = join(this.artifactsDir, identifier);
    await mkdir(destinationDir, { recursive: true });
    const destination = join(destinationDir, `${Date.now()}-${basename(sourcePath)}`);
    await copyFile(sourcePath, destination);
    return destination;
  }
}

export function emptyLocalTrackerState(): LocalTrackerState {
  return {
    version: 1,
    provider: "local",
    issues: [],
  };
}

export async function loadSeedState(path: string): Promise<LocalTrackerState> {
  return readJson<LocalTrackerState>(path);
}

export async function writeSeedState(path: string, state: LocalTrackerState): Promise<void> {
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
