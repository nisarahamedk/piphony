import { Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpRight, GitBranch, LoaderCircle, MessageSquareMore, Plus, RefreshCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CANONICAL_STATES, type CanonicalState } from "@piphony/core/types";
import { AppShell } from "./shell";
import type { CreateIssueInput, DashboardIssue, DashboardSnapshot, UpdateIssueInput } from "@/lib/models";
import { appendIssueComment, createIssue, getDashboardSnapshot as getDashboardSnapshotServer, updateIssue } from "@/lib/server/functions";
import { useLiveValue } from "@/lib/use-live-data";

const STATE_LABELS: Record<CanonicalState, string> = {
  todo: "Queued",
  in_progress: "In motion",
  agent_review: "Agent review",
  human_review: "Human review",
  rework: "Rework",
  merging: "Merge queue",
  done: "Done",
  cancelled: "Cancelled",
};

export function BoardPage(props: {
  initialSnapshot: DashboardSnapshot;
  selectedIssueId?: string | undefined;
}) {
  const navigate = useNavigate({ from: "/" });
  const dashboard = useLiveValue({
    initial: props.initialSnapshot,
    load: () => getDashboardSnapshotServer(),
    intervalMs: 3_500,
  });
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeError, setComposeError] = useState<string | undefined>(undefined);
  const issuesByState = useMemo(() => groupIssuesByState(dashboard.value.issues), [dashboard.value.issues]);
  const selectedIssue = dashboard.value.issues.find((issue) => issue.id === props.selectedIssueId);

  const handleSelectIssue = async (issueId?: string) => {
    await navigate({
      search: (current) => {
        if (issueId === undefined) {
          const { issueId: _ignored, ...rest } = current;
          return rest;
        }
        return { ...current, issueId };
      },
    });
  };

  const handleCreateIssue = async (input: CreateIssueInput) => {
    try {
      setComposeError(undefined);
      const next = await createIssue({ data: input });
      dashboard.setValue(next);
      setComposeOpen(false);
    } catch (caught: unknown) {
      setComposeError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <AppShell
      stats={dashboard.value.stats}
      masthead={
        <section className="masthead-grid">
          <div className="shell-card compose-panel">
            <div>
              <p className="eyebrow">Dispatch intake</p>
              <h3>Open a new work item without leaving the board.</h3>
            </div>
            <button
              className="action-button"
              type="button"
              onClick={() => setComposeOpen((value) => !value)}
              data-testid="toggle-create-issue"
            >
              <Plus size={16} />
              {composeOpen ? "Close composer" : "New issue"}
            </button>
            {composeOpen ? (
              <IssueComposer onSubmit={handleCreateIssue} error={composeError} />
            ) : (
              <p className="support-copy">
                Issue IDs can be auto-generated, labels accept comma-separated tags, and PR metadata can be attached when you already know the delivery lane.
              </p>
            )}
          </div>
          <div className="shell-card telemetry-banner">
            <div>
              <p className="eyebrow">Live telemetry</p>
              <h3>Recent autonomous motion</h3>
            </div>
            <button className="ghost-button" type="button" onClick={() => void dashboard.refresh()}>
              {dashboard.isRefreshing ? <LoaderCircle size={16} className="spin" /> : <RefreshCcw size={16} />}
              Refresh
            </button>
            <div className="run-pills">
              {dashboard.value.recentRuns.slice(0, 4).map((run) => (
                <Link key={run.runId} to="/runs" search={{ runId: run.runId }} className={`run-pill is-${run.status}`}>
                  <span>{run.status.replace("_", " ")}</span>
                  <strong>{run.workItemIdentifier ?? run.runId.slice(0, 8)}</strong>
                </Link>
              ))}
            </div>
            <p className="support-copy">Use the Runs view for transcripts, event streams, validation traces, and runtime/provider context.</p>
          </div>
        </section>
      }
    >
      <div className="workspace-grid">
        <section className="shell-card board-surface">
          <div className="section-header">
            <div>
              <p className="eyebrow">Issue board</p>
              <h3>Every canonical state, visible at once.</h3>
            </div>
            <span className="live-caption">{dashboard.value.issues.length} tracked issues</span>
          </div>
          <div className="board-columns" data-testid="board-columns">
            {CANONICAL_STATES.map((state) => (
              <BoardColumn
                key={state}
                state={state}
                issues={issuesByState[state] ?? []}
                selectedIssueId={selectedIssue?.id}
                onSelectIssue={handleSelectIssue}
              />
            ))}
          </div>
        </section>

        <aside className="shell-card inspector-surface">
          {selectedIssue === undefined ? (
            <EmptyInspector recentRuns={dashboard.value.recentRuns} error={dashboard.error} />
          ) : (
            <IssueInspector
              issue={selectedIssue}
              onClose={() => void handleSelectIssue(undefined)}
              onSave={async (input) => {
                const next = await updateIssue({ data: input });
                dashboard.setValue(next);
              }}
              onComment={async (body) => {
                const next = await appendIssueComment({ data: { id: selectedIssue.id, body, author: "human" } });
                dashboard.setValue(next);
              }}
            />
          )}
        </aside>
      </div>
    </AppShell>
  );
}

function BoardColumn(props: {
  state: CanonicalState;
  issues: DashboardIssue[];
  selectedIssueId?: string | undefined;
  onSelectIssue: (issueId?: string | undefined) => void | Promise<void>;
}) {
  return (
    <section className="board-column">
      <header>
        <div>
          <p>{STATE_LABELS[props.state]}</p>
          <strong>{props.issues.length}</strong>
        </div>
        <span className={`state-dot is-${props.state}`} />
      </header>
      <div className="issue-stack">
        {props.issues.length === 0 ? <div className="issue-empty">No issues in this lane.</div> : null}
        {props.issues.map((issue) => (
          <button
            key={issue.id}
            type="button"
            className={`issue-card ${issue.id === props.selectedIssueId ? "is-selected" : ""}`}
            onClick={() => void props.onSelectIssue(issue.id)}
            data-testid={`issue-card-${issue.identifier}`}
          >
            <div className="issue-card-topline">
              <span className="issue-identifier">{issue.identifier}</span>
              {issue.priority ? <span className={`priority-pill is-${issue.priority}`}>{issue.priority}</span> : null}
            </div>
            <h4>{issue.title}</h4>
            {issue.description ? <p>{issue.description}</p> : <p className="muted-copy">No brief yet.</p>}
            <div className="tag-row">
              {issue.labels.slice(0, 3).map((label) => (
                <span key={label} className="tag-pill">{label}</span>
              ))}
            </div>
            <div className="issue-card-footer">
              <span>{issue.assignee ?? "unassigned"}</span>
              {issue.latestRun ? <span className={`mini-run is-${issue.latestRun.status}`}>{issue.latestRun.status}</span> : null}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function EmptyInspector(props: { recentRuns: DashboardSnapshot["recentRuns"]; error?: string | undefined }) {
  return (
    <div className="empty-inspector">
      <div className="empty-badge">
        <Sparkles size={18} />
        Ready for dispatch
      </div>
      <h3>Select an issue card to inspect fields, comments, PR metadata, and linked runs.</h3>
      <p>
        This panel is tuned for operator work: edit the issue, attach branch/PR context, and audit what the automation actually did.
      </p>
      {props.error ? (
        <div className="warning-card">
          <AlertTriangle size={16} />
          <div>
            <strong>Refresh warning</strong>
            <p>{props.error}</p>
          </div>
        </div>
      ) : null}
      <div className="mini-run-list">
        {props.recentRuns.slice(0, 5).map((run) => (
          <div key={run.runId} className="mini-run-card">
            <span className={`mini-run is-${run.status}`}>{run.status}</span>
            <strong>{run.workItemIdentifier ?? run.runId.slice(0, 10)}</strong>
            <p>{run.summary ?? run.transcriptPreview ?? "Awaiting summary"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function IssueComposer(props: { onSubmit: (input: CreateIssueInput) => Promise<void>; error?: string | undefined }) {
  const [form, setForm] = useState<CreateIssueInput>({ title: "", priority: "medium" });
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="issue-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitting(true);
        void props.onSubmit(form).finally(() => setSubmitting(false));
      }}
      data-testid="create-issue-form"
    >
      <label>
        <span>Identifier</span>
        <input
          value={form.identifier ?? ""}
          onChange={(event) => setForm((current) => ({ ...current, identifier: event.target.value }))}
          placeholder="Leave blank to auto-generate"
          data-testid="create-issue-identifier"
        />
      </label>
      <label>
        <span>Title</span>
        <input
          required
          value={form.title}
          onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          placeholder="Ship a hosted-safe workflow refactor"
          data-testid="create-issue-title"
        />
      </label>
      <label>
        <span>Description</span>
        <textarea
          rows={4}
          value={form.description ?? ""}
          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          placeholder="Why this matters, acceptance criteria, and the key delivery notes."
          data-testid="create-issue-description"
        />
      </label>
      <div className="form-row two-up">
        <label>
          <span>Labels</span>
          <input
            value={form.labels ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, labels: event.target.value }))}
            placeholder="ui, local-tracker"
          />
        </label>
        <label>
          <span>Assignee</span>
          <input
            value={form.assignee ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, assignee: event.target.value }))}
            placeholder="nisar"
          />
        </label>
      </div>
      <div className="form-row three-up">
        <label>
          <span>Priority</span>
          <select
            value={form.priority ?? "medium"}
            onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as CreateIssueInput["priority"] }))}
          >
            <option value="critical">critical</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
        </label>
        <label>
          <span>Branch</span>
          <input
            value={form.branchName ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, branchName: event.target.value }))}
            placeholder="PIPHONY-102"
          />
        </label>
        <label>
          <span>PR URL</span>
          <input
            value={form.prUrl ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, prUrl: event.target.value }))}
            placeholder="https://github.com/..."
          />
        </label>
      </div>
      {props.error ? <p className="form-error">{props.error}</p> : null}
      <button className="action-button" type="submit" disabled={submitting} data-testid="submit-create-issue">
        {submitting ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}
        Create issue
      </button>
    </form>
  );
}

function IssueInspector(props: {
  issue: DashboardIssue;
  onClose: () => void;
  onSave: (input: UpdateIssueInput) => Promise<void>;
  onComment: (body: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<UpdateIssueInput>(() => toDraft(props.issue));
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [commenting, setCommenting] = useState(false);

  useEffect(() => {
    setDraft(toDraft(props.issue));
    setComment("");
  }, [props.issue]);

  return (
    <div className="issue-inspector" data-testid="issue-inspector">
      <div className="inspector-header">
        <div>
          <p className="eyebrow">Selected issue</p>
          <h3>{props.issue.identifier}</h3>
        </div>
        <button className="ghost-button" type="button" onClick={props.onClose}>
          Close
        </button>
      </div>

      <form
        className="issue-form"
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          void props.onSave(draft).finally(() => setSaving(false));
        }}
      >
        <label>
          <span>Title</span>
          <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
        </label>
        <label>
          <span>Description</span>
          <textarea rows={5} value={draft.description ?? ""} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
        </label>
        <div className="form-row two-up">
          <label>
            <span>State</span>
            <select value={draft.state} onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value as CanonicalState }))}>
              {CANONICAL_STATES.map((state) => (
                <option key={state} value={state}>{STATE_LABELS[state]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Priority</span>
            <select value={draft.priority ?? "medium"} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as UpdateIssueInput["priority"] }))}>
              <option value="critical">critical</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
          </label>
        </div>
        <div className="form-row two-up">
          <label>
            <span>Assignee</span>
            <input value={draft.assignee ?? ""} onChange={(event) => setDraft((current) => ({ ...current, assignee: event.target.value }))} />
          </label>
          <label>
            <span>Labels</span>
            <input value={draft.labels ?? ""} onChange={(event) => setDraft((current) => ({ ...current, labels: event.target.value }))} />
          </label>
        </div>
        <div className="form-row two-up">
          <label>
            <span>Branch</span>
            <input value={draft.branchName ?? ""} onChange={(event) => setDraft((current) => ({ ...current, branchName: event.target.value }))} />
          </label>
          <label>
            <span>PR URL</span>
            <input value={draft.prUrl ?? ""} onChange={(event) => setDraft((current) => ({ ...current, prUrl: event.target.value }))} />
          </label>
        </div>
        <button className="action-button" type="submit" disabled={saving}>
          {saving ? <LoaderCircle size={16} className="spin" /> : <RefreshCcw size={16} />}
          Save issue
        </button>
      </form>

      <div className="metadata-grid">
        <Stat label="created" value={props.issue.createdAt} />
        <Stat label="updated" value={props.issue.updatedAt} />
        <Stat label="comments" value={String(props.issue.comments.length)} />
        <Stat label="artifacts" value={String(props.issue.artifacts.length)} />
      </div>

      <div className="link-strip">
        {props.issue.branchName ? (
          <span className="inline-chip"><GitBranch size={14} /> {props.issue.branchName}</span>
        ) : null}
        {props.issue.prUrl ? (
          <a href={props.issue.prUrl} target="_blank" rel="noreferrer" className="inline-chip accent-link" data-testid="issue-pr-link">
            PR link
            <ArrowUpRight size={14} />
          </a>
        ) : null}
      </div>

      <div className="run-action-row shell-inset">
        <p className="eyebrow">Tracker workflow</p>
        <p className="support-copy">
          This UI behaves like Jira/Linear: create issues, edit fields, and transition workflow states. The separate pull-based orchestrator process polls runnable issues from the tracker and the agent updates progress/comments while it works.
        </p>
        <p className="support-copy">
          To dispatch work, move an issue into <strong>todo</strong> or <strong>rework</strong>. The orchestrator will claim it and the agent will transition it to <strong>in_progress</strong> as part of execution. For local dev, run <code>npm run orchestrator:watch</code> alongside this UI.
        </p>
      </div>

      {props.issue.latestRun ? (
        <div className="linked-run shell-inset">
          <div className="linked-run-header">
            <p className="eyebrow">Linked run</p>
            <Link to="/runs" search={{ runId: props.issue.latestRun.runId }} className="ghost-button subtle-link">
              Open run
            </Link>
          </div>
          <span className={`mini-run is-${props.issue.latestRun.status}`}>{props.issue.latestRun.status}</span>
          <strong>{props.issue.latestRun.runId}</strong>
          <p>{props.issue.latestRun.summary ?? props.issue.latestRun.transcriptPreview ?? "Awaiting summary"}</p>
        </div>
      ) : null}

      <section className="comments-section">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">Comment stream</p>
            <h4>Human notes + agent handoff</h4>
          </div>
        </div>
        <div className="comment-list">
          {props.issue.comments.map((commentItem) => (
            <article key={commentItem.id} className="comment-card">
              <div>
                <strong>{commentItem.author}</strong>
                <span>{commentItem.createdAt}</span>
              </div>
              <p>{commentItem.body}</p>
            </article>
          ))}
        </div>
        <form
          className="comment-form"
          onSubmit={(event) => {
            event.preventDefault();
            setCommenting(true);
            void props.onComment(comment).then(() => setComment("")).finally(() => setCommenting(false));
          }}
        >
          <label>
            <span>New comment</span>
            <textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Record a review note, decision, or next instruction." />
          </label>
          <button className="action-button" type="submit" disabled={commenting || comment.trim() === ""}>
            {commenting ? <LoaderCircle size={16} className="spin" /> : <MessageSquareMore size={16} />}
            Add comment
          </button>
        </form>
      </section>
    </div>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div className="stat-pill">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function groupIssuesByState(issues: DashboardIssue[]): Record<CanonicalState, DashboardIssue[]> {
  return issues.reduce<Record<CanonicalState, DashboardIssue[]>>((accumulator, issue) => {
    accumulator[issue.state].push(issue);
    return accumulator;
  }, {
    todo: [],
    in_progress: [],
    agent_review: [],
    human_review: [],
    rework: [],
    merging: [],
    done: [],
    cancelled: [],
  });
}

function toDraft(issue: DashboardIssue): UpdateIssueInput {
  return {
    id: issue.id,
    title: issue.title,
    ...(issue.description === undefined ? {} : { description: issue.description }),
    state: issue.state,
    labels: issue.labels.join(", "),
    ...(issue.assignee === undefined ? {} : { assignee: issue.assignee }),
    priority: issue.priority ?? "medium",
    ...(issue.branchName === undefined ? {} : { branchName: issue.branchName }),
    ...(issue.prUrl === undefined ? {} : { prUrl: issue.prUrl }),
  };
}
