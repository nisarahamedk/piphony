import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { errorMessage } from "../../core/errors.js";
import { ensureDir, nowIso, readJson } from "../../core/utils.js";
import type { TrackerArtifact, TrackerComment, WorkerHeartbeat } from "../../core/types.js";
import type { LocalIssue, LocalIssueAudit, LocalTrackerState, LocalTrackerWorker } from "./types.js";

const trackerStoreMutexes = new Map<string, TrackerStoreMutex>();

export interface LocalTrackerStoreOptions {
  trackerDir: string;
}

interface IssueRow {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: string;
  labels_json: string;
  assignee: string | null;
  priority: string | null;
  branch_name: string | null;
  pr_url: string | null;
  url: string;
  metadata_json: string;
  audit_json: string | null;
  created_at: string;
  updated_at: string;
}

interface CommentRow {
  id: string;
  issue_id: string;
  body: string;
  author: string;
  created_at: string;
}

interface ArtifactRow {
  id: string;
  issue_id: string;
  name: string;
  path: string;
  created_at: string;
}

interface WorkerRow {
  worker_id: string;
  owner_id: string;
  role: string;
  status: string;
  process_id: number;
  host: string;
  started_at: string;
  last_seen_at: string;
  last_poll_at: string | null;
  next_poll_at: string | null;
  current_issue_id: string | null;
  current_issue_identifier: string | null;
  current_run_id: string | null;
  details_json: string;
}

class TrackerStoreMutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const previous = this.tail;
    let release: (() => void) | undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }
}

function trackerStoreMutex(dbFile: string): TrackerStoreMutex {
  let mutex = trackerStoreMutexes.get(dbFile);
  if (mutex === undefined) {
    mutex = new TrackerStoreMutex();
    trackerStoreMutexes.set(dbFile, mutex);
  }
  return mutex;
}

export class LocalTrackerStore {
  readonly trackerDir: string;
  readonly dbFile: string;
  readonly artifactsDir: string;

  constructor(options: LocalTrackerStoreOptions) {
    this.trackerDir = resolve(options.trackerDir);
    this.dbFile = join(this.trackerDir, "tracker.db");
    this.artifactsDir = join(this.trackerDir, "artifacts");
  }

  async ensure(): Promise<void> {
    await ensureDir(this.trackerDir);
    await ensureDir(this.artifactsDir);
    await this.withDatabase((db) => {
      initializeSchema(db);
    });
  }

  async load(): Promise<LocalTrackerState> {
    await this.ensure();
    const [issues, workers] = await Promise.all([this.loadIssues(), this.loadWorkers()]);
    return {
      version: 2,
      provider: "local",
      issues,
      workers,
    };
  }

  async loadIssues(): Promise<LocalIssue[]> {
    await this.ensure();
    return await this.withDatabase((db) => selectIssues(db));
  }

  async loadWorkers(): Promise<LocalTrackerWorker[]> {
    await this.ensure();
    return await this.withDatabase((db) => selectWorkers(db));
  }

  async listIssuesByStates(states: readonly string[]): Promise<LocalIssue[]> {
    const stateSet = new Set(states);
    const issues = await this.loadIssues();
    return issues.filter((issue) => stateSet.has(issue.state));
  }

  async reset(seed?: LocalTrackerState): Promise<LocalTrackerState> {
    await rm(this.trackerDir, { recursive: true, force: true });
    await this.ensure();
    const next = seed ?? emptyLocalTrackerState();
    await this.withDatabase((db) => {
      initializeSchema(db);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec("DELETE FROM issue_state_history");
        db.exec("DELETE FROM issue_artifacts");
        db.exec("DELETE FROM issue_comments");
        db.exec("DELETE FROM worker_status");
        db.exec("DELETE FROM issues");
        for (const issue of next.issues) {
          insertIssue(db, issue);
          insertIssueComments(db, issue.id, issue.comments);
          insertIssueArtifacts(db, issue.id, issue.artifacts);
        }
        for (const worker of next.workers ?? []) {
          upsertWorkerRow(db, worker);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
    return this.load();
  }

  async createIssue(input: {
    identifier: string;
    title: string;
    description?: string;
    state: LocalIssue["state"];
    labels?: string[];
    assignee?: string;
    priority?: LocalIssue["priority"];
    branchName?: string;
    prUrl?: string;
    metadata?: Record<string, unknown>;
    audit?: LocalIssueAudit;
  }): Promise<LocalIssue> {
    await this.ensure();
    const timestamp = nowIso();
    const issue: LocalIssue = {
      id: randomUUID(),
      identifier: input.identifier,
      title: input.title,
      ...(input.description === undefined ? {} : { description: input.description }),
      state: input.state,
      labels: input.labels ?? [],
      ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.branchName === undefined ? {} : { branchName: input.branchName }),
      ...(input.prUrl === undefined ? {} : { prUrl: input.prUrl }),
      url: `local://issues/${input.identifier}`,
      metadata: input.metadata ?? {},
      ...(input.audit === undefined ? {} : { audit: input.audit }),
      comments: [],
      artifacts: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.withDatabase((db) => {
      initializeSchema(db);
      db.exec("BEGIN IMMEDIATE");
      try {
        insertIssue(db, issue);
        db.prepare(
          `INSERT INTO issue_state_history (issue_id, from_state, to_state, actor, reason, created_at)
           VALUES (?, NULL, ?, 'system', 'issue created', ?)`,
        ).run(issue.id, issue.state, issue.createdAt);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });

    return issue;
  }

  async findIssue(identifierOrId: string): Promise<LocalIssue | undefined> {
    await this.ensure();
    return await this.withDatabase((db) => selectIssueByIdentifierOrId(db, identifierOrId));
  }

  async findIssueById(id: string): Promise<LocalIssue | undefined> {
    await this.ensure();
    return await this.withDatabase((db) => selectIssueById(db, id));
  }

  async findIssueByIdentifier(identifier: string): Promise<LocalIssue | undefined> {
    await this.ensure();
    return await this.withDatabase((db) => selectIssueByIdentifier(db, identifier));
  }

  async updateIssue(identifierOrId: string, mutate: (issue: LocalIssue) => void): Promise<LocalIssue> {
    const current = await this.findIssue(identifierOrId);
    if (current === undefined) {
      throw new Error(`Local issue not found: ${identifierOrId}`);
    }

    const previousState = current.state;
    const nextIssue = cloneIssue(current);
    mutate(nextIssue);
    nextIssue.updatedAt = nowIso();

    await this.withDatabase((db) => {
      initializeSchema(db);
      db.exec("BEGIN IMMEDIATE");
      try {
        rewriteIssue(db, nextIssue);
        if (previousState !== nextIssue.state) {
          db.prepare(
            `INSERT INTO issue_state_history (issue_id, from_state, to_state, actor, reason, created_at)
             VALUES (?, ?, ?, 'system', 'state transition', ?)`,
          ).run(nextIssue.id, previousState, nextIssue.state, nextIssue.updatedAt);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });

    return nextIssue;
  }

  async transitionIssue(identifierOrId: string, nextState: LocalIssue["state"]): Promise<LocalIssue> {
    const current = await this.findIssue(identifierOrId);
    if (current === undefined) {
      throw new Error(`Local issue not found: ${identifierOrId}`);
    }
    const updatedAt = nowIso();
    await this.withDatabase((db) => {
      initializeSchema(db);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE issues SET state = ?, updated_at = ? WHERE id = ?").run(nextState, updatedAt, current.id);
        if (current.state !== nextState) {
          db.prepare(
            `INSERT INTO issue_state_history (issue_id, from_state, to_state, actor, reason, created_at)
             VALUES (?, ?, ?, 'system', 'state transition', ?)`,
          ).run(current.id, current.state, nextState, updatedAt);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
    return (await this.findIssueById(current.id))!;
  }

  async appendIssueComment(identifierOrId: string, comment: TrackerComment): Promise<void> {
    const current = await this.findIssue(identifierOrId);
    if (current === undefined) {
      throw new Error(`Local issue not found: ${identifierOrId}`);
    }
    await this.withDatabase((db) => {
      initializeSchema(db);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          `INSERT INTO issue_comments (id, issue_id, body, author, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(comment.id, current.id, comment.body, comment.author, comment.createdAt);
        db.prepare("UPDATE issues SET updated_at = ? WHERE id = ?").run(comment.createdAt, current.id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async appendIssueArtifact(identifierOrId: string, artifact: TrackerArtifact): Promise<void> {
    const current = await this.findIssue(identifierOrId);
    if (current === undefined) {
      throw new Error(`Local issue not found: ${identifierOrId}`);
    }
    await this.withDatabase((db) => {
      initializeSchema(db);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          `INSERT INTO issue_artifacts (id, issue_id, name, path, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(artifact.id, current.id, artifact.name, artifact.path, artifact.createdAt);
        db.prepare("UPDATE issues SET updated_at = ? WHERE id = ?").run(artifact.createdAt, current.id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async updateIssueAudit(identifierOrId: string, mutate: (audit: LocalIssueAudit) => LocalIssueAudit): Promise<void> {
    const current = await this.findIssue(identifierOrId);
    if (current === undefined) {
      throw new Error(`Local issue not found: ${identifierOrId}`);
    }
    const nextAudit = mutate({ ...(current.audit ?? {}) });
    const updatedAt = nowIso();
    await this.withDatabase((db) => {
      initializeSchema(db);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE issues SET audit_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(nextAudit), updatedAt, current.id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async upsertWorker(worker: WorkerHeartbeat): Promise<void> {
    await this.ensure();
    await this.withDatabase((db) => {
      initializeSchema(db);
      upsertWorkerRow(db, worker);
    });
  }

  async deleteWorker(workerId: string): Promise<void> {
    await this.ensure();
    await this.withDatabase((db) => {
      initializeSchema(db);
      db.prepare("DELETE FROM worker_status WHERE worker_id = ?").run(workerId);
    });
  }

  async copyArtifact(identifier: string, sourcePath: string): Promise<string> {
    const destinationDir = join(this.artifactsDir, identifier);
    await mkdir(destinationDir, { recursive: true });
    const destination = join(destinationDir, `${Date.now()}-${basename(sourcePath)}`);
    await copyFile(sourcePath, destination);
    return destination;
  }

  private async withDatabase<T>(operation: (db: DatabaseSync) => T): Promise<T> {
    return trackerStoreMutex(this.dbFile).runExclusive(() => {
      const db = new DatabaseSync(this.dbFile);
      try {
        db.exec("PRAGMA busy_timeout = 5000");
        db.exec("PRAGMA foreign_keys = ON");
        db.exec("PRAGMA journal_mode = WAL");
        return operation(db);
      } catch (error) {
        throw new Error(`Local tracker database operation failed for ${this.dbFile}: ${errorMessage(error)}`);
      } finally {
        db.close();
      }
    });
  }
}

export function emptyLocalTrackerState(): LocalTrackerState {
  return {
    version: 2,
    provider: "local",
    issues: [],
    workers: [],
  };
}

export async function loadSeedState(path: string): Promise<LocalTrackerState> {
  const seed = await readJson<LocalTrackerState | { version: number; provider: "local"; issues: LocalIssue[] }>(path);
  return {
    version: 2,
    provider: "local",
    issues: seed.issues,
    workers: "workers" in seed && Array.isArray(seed.workers) ? seed.workers : [],
  };
}

export async function writeSeedState(path: string, state: LocalTrackerState): Promise<void> {
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      state TEXT NOT NULL,
      labels_json TEXT NOT NULL,
      assignee TEXT,
      priority TEXT,
      branch_name TEXT,
      pr_url TEXT,
      url TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      audit_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issue_comments (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      body TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS issue_artifacts (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS issue_state_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id TEXT NOT NULL,
      from_state TEXT,
      to_state TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS worker_status (
      worker_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      process_id INTEGER NOT NULL,
      host TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_poll_at TEXT,
      next_poll_at TEXT,
      current_issue_id TEXT,
      current_issue_identifier TEXT,
      current_run_id TEXT,
      details_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_issues_state ON issues(state);
    CREATE INDEX IF NOT EXISTS idx_issue_comments_issue_id ON issue_comments(issue_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_issue_artifacts_issue_id ON issue_artifacts(issue_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_worker_status_owner_id ON worker_status(owner_id);
    CREATE INDEX IF NOT EXISTS idx_worker_status_last_seen_at ON worker_status(last_seen_at);
  `);
  ensureIssueColumn(db, "priority", "TEXT");
  ensureIssueColumn(db, "branch_name", "TEXT");
  ensureIssueColumn(db, "pr_url", "TEXT");
  ensureIssueColumn(db, "audit_json", "TEXT");
}

function ensureIssueColumn(db: DatabaseSync, columnName: string, definition: string): void {
  const columns = db.prepare("PRAGMA table_info(issues)").all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE issues ADD COLUMN ${columnName} ${definition}`);
}

function insertIssue(db: DatabaseSync, issue: LocalIssue): void {
  db.prepare(
    `INSERT INTO issues (id, identifier, title, description, state, labels_json, assignee, priority, branch_name, pr_url, url, metadata_json, audit_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    issue.id,
    issue.identifier,
    issue.title,
    issue.description ?? null,
    issue.state,
    JSON.stringify(issue.labels),
    issue.assignee ?? null,
    issue.priority ?? null,
    issue.branchName ?? null,
    issue.prUrl ?? null,
    issue.url,
    JSON.stringify(issue.metadata),
    issue.audit === undefined ? null : JSON.stringify(issue.audit),
    issue.createdAt,
    issue.updatedAt,
  );
}

function rewriteIssue(db: DatabaseSync, issue: LocalIssue): void {
  db.prepare(
    `UPDATE issues
     SET identifier = ?, title = ?, description = ?, state = ?, labels_json = ?, assignee = ?, priority = ?, branch_name = ?, pr_url = ?, url = ?, metadata_json = ?, audit_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    issue.identifier,
    issue.title,
    issue.description ?? null,
    issue.state,
    JSON.stringify(issue.labels),
    issue.assignee ?? null,
    issue.priority ?? null,
    issue.branchName ?? null,
    issue.prUrl ?? null,
    issue.url,
    JSON.stringify(issue.metadata),
    issue.audit === undefined ? null : JSON.stringify(issue.audit),
    issue.updatedAt,
    issue.id,
  );
  db.prepare("DELETE FROM issue_comments WHERE issue_id = ?").run(issue.id);
  db.prepare("DELETE FROM issue_artifacts WHERE issue_id = ?").run(issue.id);
  insertIssueComments(db, issue.id, issue.comments);
  insertIssueArtifacts(db, issue.id, issue.artifacts);
}

function insertIssueComments(db: DatabaseSync, issueId: string, comments: readonly TrackerComment[]): void {
  const statement = db.prepare(
    `INSERT INTO issue_comments (id, issue_id, body, author, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const comment of comments) {
    statement.run(comment.id, issueId, comment.body, comment.author, comment.createdAt);
  }
}

function insertIssueArtifacts(db: DatabaseSync, issueId: string, artifacts: readonly TrackerArtifact[]): void {
  const statement = db.prepare(
    `INSERT INTO issue_artifacts (id, issue_id, name, path, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const artifact of artifacts) {
    statement.run(artifact.id, issueId, artifact.name, artifact.path, artifact.createdAt);
  }
}

function upsertWorkerRow(db: DatabaseSync, worker: WorkerHeartbeat): void {
  db.prepare(
    `INSERT INTO worker_status (
       worker_id, owner_id, role, status, process_id, host, started_at, last_seen_at,
       last_poll_at, next_poll_at, current_issue_id, current_issue_identifier, current_run_id, details_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(worker_id) DO UPDATE SET
       owner_id = excluded.owner_id,
       role = excluded.role,
       status = excluded.status,
       process_id = excluded.process_id,
       host = excluded.host,
       started_at = excluded.started_at,
       last_seen_at = excluded.last_seen_at,
       last_poll_at = excluded.last_poll_at,
       next_poll_at = excluded.next_poll_at,
       current_issue_id = excluded.current_issue_id,
       current_issue_identifier = excluded.current_issue_identifier,
       current_run_id = excluded.current_run_id,
       details_json = excluded.details_json`,
  ).run(
    worker.workerId,
    worker.ownerId,
    worker.role,
    worker.status,
    worker.processId,
    worker.host,
    worker.startedAt,
    worker.lastSeenAt,
    worker.lastPollAt ?? null,
    worker.nextPollAt ?? null,
    worker.currentIssueId ?? null,
    worker.currentIssueIdentifier ?? null,
    worker.currentRunId ?? null,
    JSON.stringify(worker.details),
  );
}

function selectIssues(db: DatabaseSync): LocalIssue[] {
  const issueRows = db.prepare(
    `SELECT id, identifier, title, description, state, labels_json, assignee, priority, branch_name, pr_url, url, metadata_json, audit_json, created_at, updated_at
     FROM issues
     ORDER BY created_at ASC, identifier ASC`,
  ).all() as unknown as IssueRow[];

  const comments = db.prepare(
    `SELECT id, issue_id, body, author, created_at
     FROM issue_comments
     ORDER BY created_at ASC, id ASC`,
  ).all() as unknown as CommentRow[];

  const artifacts = db.prepare(
    `SELECT id, issue_id, name, path, created_at
     FROM issue_artifacts
     ORDER BY created_at ASC, id ASC`,
  ).all() as unknown as ArtifactRow[];

  const commentsByIssue = new Map<string, TrackerComment[]>();
  for (const row of comments) {
    const next = commentsByIssue.get(row.issue_id) ?? [];
    next.push({
      id: row.id,
      body: row.body,
      author: row.author,
      createdAt: row.created_at,
    });
    commentsByIssue.set(row.issue_id, next);
  }

  const artifactsByIssue = new Map<string, TrackerArtifact[]>();
  for (const row of artifacts) {
    const next = artifactsByIssue.get(row.issue_id) ?? [];
    next.push({
      id: row.id,
      name: row.name,
      path: row.path,
      createdAt: row.created_at,
    });
    artifactsByIssue.set(row.issue_id, next);
  }

  return issueRows.map((row) => hydrateIssue(row, commentsByIssue.get(row.id) ?? [], artifactsByIssue.get(row.id) ?? []));
}

function selectIssueByIdentifierOrId(db: DatabaseSync, identifierOrId: string): LocalIssue | undefined {
  return selectIssueByRow(
    db.prepare(
      `SELECT id, identifier, title, description, state, labels_json, assignee, priority, branch_name, pr_url, url, metadata_json, audit_json, created_at, updated_at
       FROM issues
       WHERE id = ? OR identifier = ?
       LIMIT 1`,
    ).get(identifierOrId, identifierOrId) as IssueRow | undefined,
    db,
  );
}

function selectIssueById(db: DatabaseSync, id: string): LocalIssue | undefined {
  return selectIssueByRow(
    db.prepare(
      `SELECT id, identifier, title, description, state, labels_json, assignee, priority, branch_name, pr_url, url, metadata_json, audit_json, created_at, updated_at
       FROM issues
       WHERE id = ?
       LIMIT 1`,
    ).get(id) as IssueRow | undefined,
    db,
  );
}

function selectIssueByIdentifier(db: DatabaseSync, identifier: string): LocalIssue | undefined {
  return selectIssueByRow(
    db.prepare(
      `SELECT id, identifier, title, description, state, labels_json, assignee, priority, branch_name, pr_url, url, metadata_json, audit_json, created_at, updated_at
       FROM issues
       WHERE identifier = ?
       LIMIT 1`,
    ).get(identifier) as IssueRow | undefined,
    db,
  );
}

function selectIssueByRow(row: IssueRow | undefined, db: DatabaseSync): LocalIssue | undefined {
  if (row === undefined) {
    return undefined;
  }

  const comments = db.prepare(
    `SELECT id, issue_id, body, author, created_at
     FROM issue_comments
     WHERE issue_id = ?
     ORDER BY created_at ASC, id ASC`,
  ).all(row.id) as unknown as CommentRow[];

  const artifacts = db.prepare(
    `SELECT id, issue_id, name, path, created_at
     FROM issue_artifacts
     WHERE issue_id = ?
     ORDER BY created_at ASC, id ASC`,
  ).all(row.id) as unknown as ArtifactRow[];

  return hydrateIssue(
    row,
    comments.map((comment) => ({ id: comment.id, body: comment.body, author: comment.author, createdAt: comment.created_at })),
    artifacts.map((artifact) => ({ id: artifact.id, name: artifact.name, path: artifact.path, createdAt: artifact.created_at })),
  );
}

function selectWorkers(db: DatabaseSync): LocalTrackerWorker[] {
  const rows = db.prepare(
    `SELECT worker_id, owner_id, role, status, process_id, host, started_at, last_seen_at, last_poll_at, next_poll_at, current_issue_id, current_issue_identifier, current_run_id, details_json
     FROM worker_status
     ORDER BY last_seen_at DESC, worker_id ASC`,
  ).all() as unknown as WorkerRow[];
  return rows.map((row) => hydrateWorker(row));
}

function hydrateIssue(row: IssueRow, comments: TrackerComment[], artifacts: TrackerArtifact[]): LocalIssue {
  const labels = parseJsonColumn<string[]>(row.labels_json, "issues.labels_json");
  const metadata = parseJsonColumn<Record<string, unknown>>(row.metadata_json, "issues.metadata_json");
  const audit = row.audit_json === null ? undefined : parseJsonColumn<LocalIssueAudit>(row.audit_json, "issues.audit_json");
  return {
    id: row.id,
    identifier: row.identifier,
    title: row.title,
    ...(row.description === null ? {} : { description: row.description }),
    state: row.state as LocalIssue["state"],
    labels,
    ...(row.assignee === null ? {} : { assignee: row.assignee }),
    ...(row.priority === null ? {} : { priority: row.priority as Exclude<LocalIssue["priority"], undefined> }),
    ...(row.branch_name === null ? {} : { branchName: row.branch_name }),
    ...(row.pr_url === null ? {} : { prUrl: row.pr_url }),
    url: row.url,
    metadata,
    ...(audit === undefined ? {} : { audit }),
    comments,
    artifacts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hydrateWorker(row: WorkerRow): LocalTrackerWorker {
  const details = parseJsonColumn<Record<string, unknown>>(row.details_json, "worker_status.details_json");
  return {
    workerId: row.worker_id,
    ownerId: row.owner_id,
    role: row.role,
    status: row.status as LocalTrackerWorker["status"],
    processId: row.process_id,
    host: row.host,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    ...(row.last_poll_at === null ? {} : { lastPollAt: row.last_poll_at }),
    ...(row.next_poll_at === null ? {} : { nextPollAt: row.next_poll_at }),
    ...(row.current_issue_id === null ? {} : { currentIssueId: row.current_issue_id }),
    ...(row.current_issue_identifier === null ? {} : { currentIssueIdentifier: row.current_issue_identifier }),
    ...(row.current_run_id === null ? {} : { currentRunId: row.current_run_id }),
    details,
  };
}

function cloneIssue(issue: LocalIssue): LocalIssue {
  return {
    ...issue,
    labels: [...issue.labels],
    metadata: { ...issue.metadata },
    ...(issue.audit === undefined ? {} : { audit: { ...issue.audit } }),
    comments: issue.comments.map((comment) => ({ ...comment })),
    artifacts: issue.artifacts.map((artifact) => ({ ...artifact })),
  };
}

function parseJsonColumn<T>(value: string, columnName: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`Failed to parse persisted JSON column ${columnName}: ${errorMessage(error)}`);
  }
}
