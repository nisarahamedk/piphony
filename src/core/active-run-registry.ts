import type { RunRecord, WorkItem, WorkerHeartbeat } from "./types.js";
import type { RunArtifactIndex } from "../observability/artifact-index.js";

export interface ActiveRunControlSnapshot {
  state: "ready" | "running" | "aborting" | "disposed";
  sessionId: string;
  sessionFile?: string;
  isStreaming: boolean;
  pendingMessageCount: number;
  steeringMessages: readonly string[];
  followUpMessages: readonly string[];
  lastAssistantText?: string;
  messageCount: number;
  thinkingLevel: string;
  usedModel?: string;
}

export interface ActiveRunControl {
  snapshot(): ActiveRunControlSnapshot;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  abort(): Promise<void>;
}

export interface ActiveRunEntry {
  run: RunRecord;
  workItem: WorkItem;
  workerName: string;
  artifacts: RunArtifactIndex;
  status: RunRecord["status"];
  phase?: string;
  workerHeartbeat?: WorkerHeartbeat;
  control?: ActiveRunControl;
  lastError?: string;
  lastSummary?: string;
  updatedAt: string;
}

export interface ActiveRunSnapshot {
  runId: string;
  workItemId: string;
  identifier: string;
  title: string;
  workerName: string;
  status: RunRecord["status"];
  phase?: string;
  health: "running" | "stale";
  lastHeartbeatAt?: string;
  updatedAt: string;
  artifacts: RunArtifactIndex;
  control?: ActiveRunControlSnapshot;
  lastError?: string;
  lastSummary?: string;
}

export interface ActiveRunRegistration {
  run: RunRecord;
  workItem: WorkItem;
  workerName: string;
  artifacts: RunArtifactIndex;
}

export const ACTIVE_RUN_STALE_AFTER_MS = 15_000;

export class ActiveRunRegistry {
  private readonly entriesByRunId = new Map<string, ActiveRunEntry>();
  private readonly runIdByWorkItemId = new Map<string, string>();
  private readonly runIdByIdentifier = new Map<string, string>();

  register(input: ActiveRunRegistration): ActiveRunEntry {
    const entry: ActiveRunEntry = {
      run: input.run,
      workItem: input.workItem,
      workerName: input.workerName,
      artifacts: input.artifacts,
      status: input.run.status,
      updatedAt: input.run.updatedAt,
    };
    this.entriesByRunId.set(input.run.runId, entry);
    this.runIdByWorkItemId.set(input.workItem.externalId, input.run.runId);
    this.runIdByIdentifier.set(input.workItem.identifier, input.run.runId);
    return entry;
  }

  attachControl(runId: string, control: ActiveRunControl): ActiveRunEntry {
    const current = this.require(runId);
    const snapshot = control.snapshot();
    const artifacts = snapshot.sessionFile === undefined
      ? current.artifacts
      : { ...current.artifacts, sessionFile: snapshot.sessionFile };
    const next: ActiveRunEntry = { ...current, control, artifacts };
    this.entriesByRunId.set(runId, next);
    return next;
  }

  updateHeartbeat(runId: string, heartbeat: WorkerHeartbeat): ActiveRunEntry {
    const current = this.require(runId);
    const next: ActiveRunEntry = {
      ...current,
      workerHeartbeat: heartbeat,
      updatedAt: heartbeat.lastSeenAt,
    };
    this.entriesByRunId.set(runId, next);
    return next;
  }

  updatePhase(runId: string, phase: string): ActiveRunEntry {
    const current = this.require(runId);
    const next: ActiveRunEntry = {
      ...current,
      phase,
      updatedAt: new Date().toISOString(),
    };
    this.entriesByRunId.set(runId, next);
    return next;
  }

  updateStatus(runId: string, status: RunRecord["status"]): ActiveRunEntry {
    const current = this.require(runId);
    const next: ActiveRunEntry = {
      ...current,
      status,
      updatedAt: new Date().toISOString(),
    };
    this.entriesByRunId.set(runId, next);
    return next;
  }

  updateSummary(runId: string, summary: string): ActiveRunEntry {
    const current = this.require(runId);
    const next: ActiveRunEntry = {
      ...current,
      lastSummary: summary,
      updatedAt: new Date().toISOString(),
    };
    this.entriesByRunId.set(runId, next);
    return next;
  }

  updateError(runId: string, error: string): ActiveRunEntry {
    const current = this.require(runId);
    const next: ActiveRunEntry = {
      ...current,
      lastError: error,
      updatedAt: new Date().toISOString(),
    };
    this.entriesByRunId.set(runId, next);
    return next;
  }

  getByRunId(runId: string): ActiveRunEntry | undefined {
    return this.entriesByRunId.get(runId);
  }

  getByWorkItemId(workItemId: string): ActiveRunEntry | undefined {
    const runId = this.runIdByWorkItemId.get(workItemId);
    return runId === undefined ? undefined : this.entriesByRunId.get(runId);
  }

  getByIdentifier(identifier: string): ActiveRunEntry | undefined {
    const runId = this.runIdByIdentifier.get(identifier);
    return runId === undefined ? undefined : this.entriesByRunId.get(runId);
  }

  listActive(): ActiveRunEntry[] {
    return [...this.entriesByRunId.values()].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  }

  listSnapshots(now = Date.now()): ActiveRunSnapshot[] {
    return this.listActive().map((entry) => this.toSnapshot(entry, now));
  }

  toSnapshot(entry: ActiveRunEntry, now = Date.now()): ActiveRunSnapshot {
    const lastHeartbeatAt = deriveActiveRunLastHeartbeatAt(entry);
    const health = deriveActiveRunHealth(entry, now);
    const control = entry.control?.snapshot();
    return {
      runId: entry.run.runId,
      workItemId: entry.workItem.externalId,
      identifier: entry.workItem.identifier,
      title: entry.workItem.title,
      workerName: entry.workerName,
      status: entry.status,
      ...(entry.phase === undefined ? {} : { phase: entry.phase }),
      health,
      ...(lastHeartbeatAt === undefined ? {} : { lastHeartbeatAt }),
      updatedAt: entry.updatedAt,
      artifacts: entry.artifacts,
      ...(control === undefined ? {} : { control }),
      ...(entry.lastError === undefined ? {} : { lastError: entry.lastError }),
      ...(entry.lastSummary === undefined ? {} : { lastSummary: entry.lastSummary }),
    };
  }

  remove(runId: string): void {
    const current = this.entriesByRunId.get(runId);
    if (current === undefined) {
      return;
    }
    this.entriesByRunId.delete(runId);
    this.runIdByWorkItemId.delete(current.workItem.externalId);
    this.runIdByIdentifier.delete(current.workItem.identifier);
  }

  private require(runId: string): ActiveRunEntry {
    const entry = this.entriesByRunId.get(runId);
    if (entry === undefined) {
      throw new Error(`Active run not found: ${runId}`);
    }
    return entry;
  }
}

function deriveActiveRunLastHeartbeatAt(entry: ActiveRunEntry): string | undefined {
  return entry.workerHeartbeat?.lastSeenAt;
}

function deriveActiveRunHealth(entry: ActiveRunEntry, now: number): ActiveRunSnapshot["health"] {
  const lastHeartbeatAt = deriveActiveRunLastHeartbeatAt(entry);
  if (lastHeartbeatAt === undefined) {
    return "running";
  }
  const lastSeenMs = Date.parse(lastHeartbeatAt);
  return Number.isFinite(lastSeenMs) && now - lastSeenMs > ACTIVE_RUN_STALE_AFTER_MS ? "stale" : "running";
}
