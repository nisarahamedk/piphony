import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  Clock,
  GitBranch,
  GripVertical,
  LoaderCircle,
  MessageSquareMore,
  Plus,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CanonicalState } from "@piphony/core/types";
import { VALID_WORK_ITEM_TRANSITIONS } from "@piphony/core/work-item-transitions";
import type {
  CreateIssueInput,
  DashboardIssue,
  DashboardWorkerStatus,
  UpdateIssueInput,
} from "@/lib/models";
import { CANONICAL_STATES, STATE_COLORS, STATE_LABELS, toDraft } from "./board-page-shared";

export interface BoardColumnProps {
  state: CanonicalState;
  issues: DashboardIssue[];
  selectedIssueId?: string | undefined;
  onSelectIssue: (issue?: DashboardIssue) => void | Promise<void>;
  dragState: { issueId: string; fromState: CanonicalState } | null;
  onDragStart: (issueId: string, fromState: CanonicalState) => void;
  onDragEnd: () => void;
  onDrop: (issueId: string, targetState: CanonicalState) => void;
  workers: DashboardWorkerStatus[];
}

export function BoardColumn(props: BoardColumnProps) {
  const [isOver, setIsOver] = useState(false);

  const validTargetStates = props.dragState === null
    ? []
    : VALID_WORK_ITEM_TRANSITIONS[props.dragState.fromState] as readonly CanonicalState[];
  const isValidTarget =
    props.dragState !== null &&
    props.dragState.fromState !== props.state &&
    validTargetStates.includes(props.state);

  return (
    <section
      className={`board-column ${isOver && isValidTarget ? "drop-target" : ""} ${
        props.dragState !== null && !isValidTarget && props.dragState.fromState !== props.state
          ? "drop-invalid"
          : ""
      }`}
      onDragOver={(e) => {
        if (isValidTarget) {
          e.preventDefault();
          setIsOver(true);
        }
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        if (isValidTarget && props.dragState !== null) {
          props.onDrop(props.dragState.issueId, props.state);
          props.onDragEnd();
        }
      }}
    >
      <div className="board-column-header">
        <div>
          <strong>{STATE_LABELS[props.state]}</strong>
          <div className="column-subtitle">{props.issues.length} items</div>
        </div>
        <span
          className={`column-dot is-${props.state}`}
          style={{ backgroundColor: STATE_COLORS[props.state] }}
        />
      </div>

      <div className="board-column-body" data-testid={`board-column-${props.state}`}>
        {props.issues.length === 0 ? (
          <div className="issue-empty">Nothing here</div>
        ) : (
          props.issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              isSelected={props.selectedIssueId === issue.id}
              onSelect={() => void props.onSelectIssue(issue)}
              onDragStart={() => props.onDragStart(issue.id, issue.state)}
              onDragEnd={props.onDragEnd}
              worker={props.workers.find((worker) => worker.currentIssueIdentifier === issue.identifier)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function IssueCard(props: {
  issue: DashboardIssue;
  isSelected: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  worker?: DashboardWorkerStatus | undefined;
}) {
  const { issue, worker } = props;

  return (
    <div
      className={`issue-card ${props.isSelected ? "is-selected" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", issue.id);
        props.onDragStart();
      }}
      onDragEnd={props.onDragEnd}
      onClick={props.onSelect}
      data-testid={`issue-card-${issue.identifier}`}
    >
      <div className="issue-card-topline">
        <span className="issue-identifier">{issue.identifier}</span>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {issue.priority && (
            <span className={`priority-badge is-${issue.priority}`} title={issue.priority}>
              {issue.priority === "critical"
                ? "!!!"
                : issue.priority === "high"
                  ? "!!"
                  : issue.priority === "medium"
                    ? "!"
                    : "—"}
            </span>
          )}
          <GripVertical size={12} className="drag-handle" />
        </div>
      </div>

      <h4>{issue.title}</h4>

      {issue.state === "in_progress" && (
        <div className="agent-activity-bar">
          <div className="agent-pulse" />
          {worker ? `${worker.role}: working` : "Agent working…"}
        </div>
      )}
      {issue.state === "human_review" && (
        <div className="agent-activity-bar is-warning">
          <AlertTriangle size={10} />
          Awaiting review
        </div>
      )}

      {issue.latestRun && (
        <div className="card-run-cue">
          <span className={`mini-run is-${issue.latestRun.status}`}>{issue.latestRun.status}</span>
          <span className="card-run-agent">{issue.latestRun.agentType}</span>
        </div>
      )}

      <div className="issue-card-footer">
        <div className="tag-row">
          {issue.labels.slice(0, 2).map((label) => (
            <span key={label} className="tag-pill">{label}</span>
          ))}
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {issue.comments.length > 0 && (
            <span className="card-comment-count" title={`${issue.comments.length} comment(s)`}>
              <MessageSquareMore size={10} />
              {issue.comments.length}
            </span>
          )}
          {issue.assignee ? (
            <span className="card-avatar" title={issue.assignee}>{issue.assignee[0]?.toUpperCase()}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function IssueComposer(props: {
  onSubmit: (input: CreateIssueInput) => Promise<void>;
  onCancel: () => void;
  error?: string | undefined;
}) {
  const [form, setForm] = useState<CreateIssueInput>({
    title: "",
    priority: "medium",
  });
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <form
      className="create-form-inline"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitting(true);
        void props
          .onSubmit(form)
          .then(() => setForm({
            title: "",
            priority: "medium",
            description: "",
            labels: "",
            assignee: "",
            identifier: "",
          }))
          .finally(() => setSubmitting(false));
      }}
      data-testid="create-issue-form"
    >
      <div className="create-form-row">
        <input
          value={form.identifier ?? ""}
          onChange={(e) => setForm((c) => ({ ...c, identifier: e.target.value }))}
          placeholder="ID (auto)"
          style={{ width: "100px" }}
          data-testid="create-issue-identifier"
        />
        <input
          ref={titleRef}
          required
          value={form.title}
          onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))}
          placeholder="Issue title"
          style={{ flex: 1 }}
          data-testid="create-issue-title"
        />
        <textarea
          rows={1}
          value={form.description ?? ""}
          onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))}
          placeholder="Description (optional)"
          style={{ flex: 1, minHeight: "38px", resize: "none" }}
          data-testid="create-issue-description"
        />
        <select
          value={form.priority ?? "medium"}
          onChange={(e) => setForm((c) => ({ ...c, priority: e.target.value as CreateIssueInput["priority"] }))}
          style={{ width: "100px" }}
        >
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input
          value={form.assignee ?? ""}
          onChange={(e) => setForm((c) => ({ ...c, assignee: e.target.value }))}
          placeholder="Assignee"
          style={{ width: "100px" }}
        />
      </div>

      {props.error && (
        <p style={{ color: "var(--danger)", fontSize: "12px", margin: 0 }}>{props.error}</p>
      )}

      <div className="create-form-actions">
        <button className="action-button" type="submit" disabled={submitting} style={{ width: "auto", padding: "8px 20px" }} data-testid="submit-create-issue">
          {submitting ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}
          Create Issue
        </button>
        <button className="ghost-button" type="button" onClick={props.onCancel} style={{ padding: "8px 14px" }}>
          <X size={14} />
          Cancel
        </button>
        <span className="support-copy" style={{ marginLeft: "8px" }}>
          New issues start in <strong>Backlog</strong>. Drag to <strong>Todo</strong> for the orchestrator to claim.
        </span>
      </div>
    </form>
  );
}

export function IssueInspectorModal(props: {
  issue: DashboardIssue;
  workers: DashboardWorkerStatus[];
  onClose: () => void;
  onSave: (input: UpdateIssueInput) => Promise<void>;
  onTransition: (state: CanonicalState) => Promise<void>;
  onComment: (body: string) => Promise<void>;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [props.onClose]);

  return (
    <div className="issue-modal-backdrop" onClick={props.onClose} data-testid="issue-modal-backdrop">
      <div
        className="issue-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Issue details for ${props.issue.identifier}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="issue-modal-header">
          <div>
            <div className="eyebrow">Issue Details</div>
            <strong>{props.issue.identifier}</strong>
          </div>
          <button className="ghost-button" type="button" onClick={props.onClose} style={{ padding: "6px 10px" }}>
            <X size={14} />
            Close
          </button>
        </div>
        <div className="issue-modal-body">
          <IssueInspector {...props} />
        </div>
      </div>
    </div>
  );
}

function IssueInspector(props: {
  issue: DashboardIssue;
  workers: DashboardWorkerStatus[];
  onClose: () => void;
  onSave: (input: UpdateIssueInput) => Promise<void>;
  onTransition: (state: CanonicalState) => Promise<void>;
  onComment: (body: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<UpdateIssueInput>(() => toDraft(props.issue));
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [transitioning, setTransitioning] = useState<CanonicalState | null>(null);

  useEffect(() => {
    setDraft(toDraft(props.issue));
    setComment("");
  }, [props.issue]);

  const claimedWorker = props.workers.find((w) => w.currentIssueIdentifier === props.issue.identifier);
  const validNextStates = VALID_WORK_ITEM_TRANSITIONS[props.issue.state] as readonly CanonicalState[];

  return (
    <>
      <div className="panel" data-testid="issue-inspector">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "16px", fontWeight: 600, fontFamily: "var(--font-mono)" }}>{props.issue.identifier}</span>
          <button className="ghost-button" type="button" onClick={props.onClose} style={{ padding: "4px 8px" }}>
            <X size={14} />
          </button>
        </div>

        <div className="inspector-state-row">
          <span className={`mini-run is-${props.issue.state}`}>{STATE_LABELS[props.issue.state]}</span>
          <div className="quick-transitions">
            {validNextStates.map((nextState) => (
              <button
                key={nextState}
                className={`transition-btn is-${nextState}`}
                disabled={transitioning !== null}
                onClick={async () => {
                  setTransitioning(nextState);
                  await props.onTransition(nextState);
                  setTransitioning(null);
                }}
                data-testid={`transition-to-${nextState}`}
              >
                {transitioning === nextState ? <LoaderCircle size={10} className="spin" /> : <ArrowRight size={10} />}
                {STATE_LABELS[nextState]}
              </button>
            ))}
          </div>
        </div>

        {claimedWorker && (
          <div className="panel-embedded" style={{ padding: "10px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "12px" }}>
                <Bot size={14} style={{ color: "var(--accent)" }} />
                <strong>{claimedWorker.role}</strong>
                <span className={`mini-run is-${claimedWorker.status}`}>{claimedWorker.status}</span>
              </div>
              {claimedWorker.currentRunId && (
                <Link to="/runs" search={{ runId: claimedWorker.currentRunId }} className="ghost-button" style={{ padding: "4px 8px", fontSize: "11px" }}>
                  View run →
                </Link>
              )}
            </div>
          </div>
        )}

        {props.issue.latestRun && (
          <div className="panel-embedded" style={{ padding: "10px 12px" }}>
            <div className="eyebrow" style={{ marginBottom: "6px" }}>Latest run</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" }}>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span className={`mini-run is-${props.issue.latestRun.status}`}>{props.issue.latestRun.status}</span>
                <span>{props.issue.latestRun.agentType}</span>
              </div>
              <Link to="/runs" search={{ runId: props.issue.latestRun.runId }} className="ghost-button" style={{ padding: "4px 8px", fontSize: "11px" }}>
                View run →
              </Link>
            </div>
            {props.issue.latestRun.summary && (
              <p className="support-copy" style={{ marginTop: "6px", fontSize: "12px" }}>{props.issue.latestRun.summary}</p>
            )}
          </div>
        )}

        <form
          className="issue-form"
          onSubmit={(event) => {
            event.preventDefault();
            setSaving(true);
            void props.onSave(draft).finally(() => setSaving(false));
          }}
        >
          <label>
            Title
            <input value={draft.title} onChange={(e) => setDraft((c) => ({ ...c, title: e.target.value }))} />
          </label>
          <label>
            Description
            <textarea rows={3} value={draft.description ?? ""} onChange={(e) => setDraft((c) => ({ ...c, description: e.target.value }))} />
          </label>
          <div className="form-row">
            <label>
              Status
              <select
                value={draft.state}
                onChange={(e) => setDraft((c) => ({ ...c, state: e.target.value as CanonicalState }))}
                data-testid="issue-state-select"
              >
                {CANONICAL_STATES.map((state) => (
                  <option key={state} value={state}>{STATE_LABELS[state]}</option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={draft.priority ?? "medium"}
                onChange={(e) => setDraft((c) => ({ ...c, priority: e.target.value as UpdateIssueInput["priority"] }))}
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              Assignee
              <input value={draft.assignee ?? ""} onChange={(e) => setDraft((c) => ({ ...c, assignee: e.target.value }))} />
            </label>
            <label>
              Labels
              <input value={draft.labels ?? ""} onChange={(e) => setDraft((c) => ({ ...c, labels: e.target.value }))} />
            </label>
          </div>
          <div className="form-row">
            <label>
              Branch
              <input value={draft.branchName ?? ""} onChange={(e) => setDraft((c) => ({ ...c, branchName: e.target.value }))} />
            </label>
            <label>
              PR URL
              <input value={draft.prUrl ?? ""} onChange={(e) => setDraft((c) => ({ ...c, prUrl: e.target.value }))} />
            </label>
          </div>
          <button className="ghost-button" type="submit" disabled={saving} style={{ justifyContent: "center" }} data-testid="save-issue">
            {saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
            Save Changes
          </button>
        </form>

        <div className="metadata-grid">
          <div className="stat-pill">
            <span>Created</span>
            <strong>{props.issue.createdAt.slice(0, 10)}</strong>
          </div>
          <div className="stat-pill">
            <span>Updated</span>
            <strong>{props.issue.updatedAt.slice(0, 10)}</strong>
          </div>
        </div>

        {props.issue.prUrl && (
          <a
            href={props.issue.prUrl}
            target="_blank"
            rel="noreferrer"
            className="ghost-button"
            style={{ display: "flex", justifyContent: "center", gap: "6px" }}
            data-testid="issue-pr-link"
          >
            <GitBranch size={14} /> Open Pull Request
          </a>
        )}
      </div>

      <div className="panel" style={{ flexGrow: 1, borderBottom: "none" }}>
        <div className="eyebrow">Activity ({props.issue.comments.length})</div>
        <div className="comment-list">
          {props.issue.comments.length === 0 && (
            <div className="issue-empty" style={{ padding: "14px" }}>
              No activity yet. Comments from agents and humans will appear here.
            </div>
          )}
          {props.issue.comments.map((commentItem) => (
            <article key={commentItem.id} className="comment-card">
              <header>
                <strong>{commentItem.author}</strong>
                <span>
                  <Clock size={10} style={{ marginRight: "4px" }} />
                  {commentItem.createdAt.slice(0, 16).replace("T", " ")}
                </span>
              </header>
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
            <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Leave a comment…" />
          </label>
          <button className="ghost-button" type="submit" disabled={commenting || comment.trim() === ""} style={{ justifyContent: "center" }}>
            {commenting ? <LoaderCircle size={14} className="spin" /> : <MessageSquareMore size={14} />}
            Add Comment
          </button>
        </form>
      </div>
    </>
  );
}
