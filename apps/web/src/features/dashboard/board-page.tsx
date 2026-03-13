import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bot,
  GitBranch,
  LoaderCircle,
  MessageSquareMore,
  Plus,
  RefreshCcw,
  Send,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CANONICAL_STATES, type CanonicalState } from "@piphony/core/types";
import { AppShell } from "./shell";
import type {
  CreateIssueInput,
  DashboardIssue,
  DashboardRunSummary,
  DashboardSnapshot,
  DashboardWorkerStatus,
  UpdateIssueInput,
} from "@/lib/models";
import {
  appendIssueComment,
  createIssue,
  getDashboardSnapshot as getDashboardSnapshotServer,
  updateIssue,
} from "@/lib/server/functions";
import { useLiveValue } from "@/lib/use-live-data";

const STATE_LABELS: Record<CanonicalState, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  human_review: "Human Review",
  rework: "Rework",
  merging: "Merging",
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
  const selectedIssue = dashboard.value.issues.find(
    (issue) => issue.id === props.selectedIssueId,
  );
  const issuesByState = useMemo(
    () => groupIssuesByState(dashboard.value.issues),
    [dashboard.value.issues],
  );
  const [composeError, setComposeError] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<"global" | "create" | "details" | "steering">(
    selectedIssue === undefined ? "global" : "details",
  );

  useEffect(() => {
    setActiveTab(selectedIssue === undefined ? "global" : "details");
  }, [selectedIssue?.id]);

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
      setActiveTab("global");
    } catch (caught: unknown) {
      setComposeError(
        caught instanceof Error ? caught.message : String(caught),
      );
    }
  };

  return (
    <AppShell
      stats={dashboard.value.stats}
      masthead={
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            {dashboard.value.issues.length} issues
          </span>
          <button
            className="ghost-button"
            type="button"
            onClick={() => void dashboard.refresh()}
          >
            {dashboard.isRefreshing ? (
              <LoaderCircle size={12} className="spin" />
            ) : (
              <RefreshCcw size={12} />
            )}
            Sync
          </button>
        </div>
      }
    >
      <section className="board-surface">
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

      <aside className="sidebar">
        {selectedIssue === undefined ? (
          <>
            <div className="sidebar-tabs">
              <button
                className={`sidebar-tab ${activeTab === "global" ? "is-active" : ""}`}
                onClick={() => setActiveTab("global")}
              >
                Global Observability
              </button>
              <button
                className={`sidebar-tab ${activeTab === "create" ? "is-active" : ""}`}
                onClick={() => setActiveTab("create")}
                data-testid="toggle-create-issue"
              >
                New Issue
              </button>
            </div>

            {activeTab === "create" ? (
              <div className="sidebar-content">
                <div className="panel">
                  <IssueComposer
                    onSubmit={handleCreateIssue}
                    error={composeError}
                  />
                </div>
                <div className="panel" style={{ flexGrow: 1, borderBottom: "none" }}>
                  <div className="eyebrow">Tracker workflow</div>
                  <p className="support-copy">
                    New issues start in <strong>Backlog</strong>. Move them into
                    <strong> Todo</strong> or <strong>Rework</strong> when you want the
                    separate orchestrator process to claim them.
                  </p>
                </div>
              </div>
            ) : (
              <ObservabilityPanel
                workers={dashboard.value.workers}
                recentRuns={dashboard.value.recentRuns}
                error={dashboard.error}
              />
            )}
          </>
        ) : (
          <>
            <div className="sidebar-tabs">
              <button
                className={`sidebar-tab ${activeTab === "details" ? "is-active" : ""}`}
                onClick={() => setActiveTab("details")}
              >
                Issue Details
              </button>
              <button
                className={`sidebar-tab ${activeTab === "steering" ? "is-active" : ""}`}
                onClick={() => setActiveTab("steering")}
              >
                Agent Steering
              </button>
            </div>

            {activeTab === "steering" ? (
              <IssueSteering issue={selectedIssue} />
            ) : (
              <div className="sidebar-content">
                <IssueInspector
                  issue={selectedIssue}
                  onClose={() => void handleSelectIssue(undefined)}
                  onSave={async (input) => {
                    const next = await updateIssue({ data: input });
                    dashboard.setValue(next);
                  }}
                  onComment={async (body) => {
                    const next = await appendIssueComment({
                      data: { id: selectedIssue.id, body, author: "human" },
                    });
                    dashboard.setValue(next);
                  }}
                />
              </div>
            )}
          </>
        )}
      </aside>
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
        {STATE_LABELS[props.state]}
        <span>{props.issues.length}</span>
      </header>
      <div className="issue-stack">
        {props.issues.length === 0 ? (
          <div className="issue-empty">Empty</div>
        ) : null}
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
              {issue.priority ? (
                <span className="priority-icon" title={issue.priority}>
                  ●
                </span>
              ) : null}
            </div>
            <h4>{issue.title}</h4>

            {issue.state === "in_progress" ? (
              <div className="agent-activity-bar">
                <div className="agent-pulse" />
                Impl Agent: working...
              </div>
            ) : null}

            {issue.state === "human_review" ? (
              <div className="agent-activity-bar is-warning">
                <AlertTriangle size={10} />
                Human Review Required
              </div>
            ) : null}

            <div className="issue-card-footer" style={{ marginTop: "4px" }}>
              <div className="tag-row">
                {issue.labels.slice(0, 2).map((label) => (
                  <span key={label} className="tag-pill">
                    {label}
                  </span>
                ))}
              </div>
              {issue.assignee ? (
                <span>{issue.assignee[0]?.toUpperCase()}</span>
              ) : (
                <span>Unassigned</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function ObservabilityPanel(props: {
  workers: DashboardWorkerStatus[];
  recentRuns: DashboardRunSummary[];
  error?: string | undefined;
}) {
  const [input, setInput] = useState("");
  const activeWorkers = props.workers.filter(
    (worker) => worker.status === "running" || worker.status === "polling",
  ).length;

  return (
    <div className="agent-console">
      <div className="console-messages">
        <div className="chat-msg agent">
          <div className="sender">
            <Bot size={12} /> Chief Agent
          </div>
          <div className="bubble">
            Systems nominal. {activeWorkers} active agents in the swarm. What
            would you like to check on?
          </div>
        </div>
        <div className="chat-msg human">
          <div className="bubble">
            What is the status of the tracker-driven workflow smoke?
          </div>
        </div>
        <div className="chat-msg agent">
          <div className="sender">
            <Bot size={12} /> Chief Agent
          </div>
          <div className="bubble">
            Create or select an issue, move it from <strong>Backlog</strong> to
            <strong> Todo</strong>, and the separate orchestrator will claim it.
            The implementation agent will append <strong>Plan</strong>,
            <strong> Progress</strong>, and <strong>Review handoff</strong>
            comments before transitioning the issue to
            <strong> Human Review</strong>.
          </div>
        </div>

        <div className="panel panel-embedded">
          <div className="eyebrow">Worker status</div>
          <div className="worker-list" data-testid="worker-status-panel">
            {props.workers.length === 0 ? (
              <div className="issue-empty">No orchestrator heartbeat yet.</div>
            ) : (
              props.workers.slice(0, 4).map((worker) => (
                <article
                  key={worker.workerId}
                  className="worker-card"
                  data-testid={`worker-card-${worker.role}-${worker.workerId}`}
                >
                  <div className="worker-card-topline">
                    <strong>{worker.role}</strong>
                    <span className={`mini-run is-${worker.status}`}>
                      {worker.status}
                    </span>
                  </div>
                  <p>
                    {worker.currentIssueIdentifier ??
                      `${worker.host} · pid ${worker.processId}`}
                  </p>
                </article>
              ))
            )}
          </div>
        </div>

        <div className="panel panel-embedded">
          <div className="eyebrow">Recent Runs</div>
          <div className="run-list compact-run-list">
            {props.recentRuns.slice(0, 5).map((run) => (
              <Link
                key={run.runId}
                to="/runs"
                search={{ runId: run.runId }}
                className="run-item"
              >
                <span>{run.workItemIdentifier ?? run.runId.slice(0, 8)}</span>
                <span className="run-status">{run.status.replace("_", " ")}</span>
              </Link>
            ))}
          </div>
        </div>

        {props.error ? (
          <div className="chat-msg agent">
            <div className="sender">
              <Bot size={12} /> Chief Agent
            </div>
            <div className="bubble">Refresh warning: {props.error}</div>
          </div>
        ) : null}
      </div>

      <form
        className="console-input-area"
        onSubmit={(event) => {
          event.preventDefault();
          setInput("");
        }}
      >
        <textarea
          placeholder="Ask the swarm..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              setInput("");
            }
          }}
        />
        <button type="submit" className="console-send" disabled={!input.trim()}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

function IssueSteering(props: { issue: DashboardIssue }) {
  const [input, setInput] = useState("");

  return (
    <div className="agent-console">
      <div className="console-messages">
        <div className="chat-msg agent">
          <div className="sender">
            <Bot size={12} /> Chief Agent
          </div>
          <div className="bubble">
            Connecting to implementation context for {props.issue.identifier}...
          </div>
        </div>
        <div className="chat-msg agent">
          <div className="sender">
            <Bot size={12} /> Impl Agent
          </div>
          <div className="bubble">
            This panel is advisory only. Tracker fields, comments, and workflow
            transitions remain the source of truth for orchestration.
          </div>
        </div>
        <div className="chat-msg human">
          <div className="bubble">
            Move the issue to Todo or Rework when you want it picked up.
          </div>
        </div>
        <div className="chat-msg agent">
          <div className="sender">
            <Bot size={12} /> Impl Agent
          </div>
          <div className="bubble">
            Understood. Once runnable, I will transition to
            <code> in_progress</code>, leave <strong>Plan</strong>,
            <strong> Progress</strong>, and <strong>Review handoff</strong>
            comments, then hand back in <code>human_review</code>.
          </div>
        </div>
      </div>

      <form
        className="console-input-area"
        onSubmit={(event) => {
          event.preventDefault();
          setInput("");
        }}
      >
        <textarea
          placeholder={`Steer agent on ${props.issue.identifier}...`}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              setInput("");
            }
          }}
        />
        <button type="submit" className="console-send" disabled={!input.trim()}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

function IssueComposer(props: {
  onSubmit: (input: CreateIssueInput) => Promise<void>;
  error?: string | undefined;
}) {
  const [form, setForm] = useState<CreateIssueInput>({
    title: "",
    priority: "medium",
  });
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="issue-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitting(true);
        void props
          .onSubmit(form)
          .then(() =>
            setForm({
              title: "",
              priority: "medium",
              description: "",
              labels: "",
              assignee: "",
              identifier: "",
              branchName: "",
              prUrl: "",
            }),
          )
          .finally(() => setSubmitting(false));
      }}
      data-testid="create-issue-form"
    >
      <label>
        Identifier
        <input
          value={form.identifier ?? ""}
          onChange={(event) =>
            setForm((current) => ({ ...current, identifier: event.target.value }))
          }
          placeholder="Leave blank to auto-generate"
          data-testid="create-issue-identifier"
        />
      </label>
      <label>
        Title
        <input
          required
          value={form.title}
          onChange={(event) =>
            setForm((current) => ({ ...current, title: event.target.value }))
          }
          placeholder="Issue title"
          data-testid="create-issue-title"
        />
      </label>
      <label>
        Description
        <textarea
          rows={3}
          value={form.description ?? ""}
          onChange={(event) =>
            setForm((current) => ({ ...current, description: event.target.value }))
          }
          placeholder="Add description..."
          data-testid="create-issue-description"
        />
      </label>
      <div className="form-row">
        <label>
          Priority
          <select
            value={form.priority ?? "medium"}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                priority: event.target.value as CreateIssueInput["priority"],
              }))
            }
          >
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label>
          Assignee
          <input
            value={form.assignee ?? ""}
            onChange={(event) =>
              setForm((current) => ({ ...current, assignee: event.target.value }))
            }
            placeholder="Name"
          />
        </label>
      </div>
      {props.error ? (
        <p style={{ color: "var(--failed)", fontSize: "13px" }}>
          {props.error}
        </p>
      ) : null}
      <button
        className="action-button"
        type="submit"
        disabled={submitting}
        data-testid="submit-create-issue"
      >
        {submitting ? (
          <LoaderCircle size={14} className="spin" />
        ) : (
          <Plus size={14} />
        )}
        Create Issue
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
  const [draft, setDraft] = useState<UpdateIssueInput>(() =>
    toDraft(props.issue),
  );
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [commenting, setCommenting] = useState(false);

  useEffect(() => {
    setDraft(toDraft(props.issue));
    setComment("");
  }, [props.issue]);

  return (
    <>
      <div className="panel" style={{ paddingBottom: "16px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <span
            style={{
              fontSize: "16px",
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
            }}
          >
            {props.issue.identifier}
          </span>
          <button
            className="ghost-button"
            type="button"
            onClick={props.onClose}
            style={{ padding: "4px 8px" }}
          >
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
            Title
            <input
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Description
            <textarea
              rows={4}
              value={draft.description ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </label>
          <div className="form-row">
            <label>
              Status
              <select
                value={draft.state}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    state: event.target.value as CanonicalState,
                  }))
                }
                data-testid="issue-state-select"
              >
                {CANONICAL_STATES.map((state) => (
                  <option key={state} value={state}>
                    {STATE_LABELS[state]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={draft.priority ?? "medium"}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    priority: event.target
                      .value as UpdateIssueInput["priority"],
                  }))
                }
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
              <input
                value={draft.assignee ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    assignee: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Labels
              <input
                value={draft.labels ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    labels: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Branch
              <input
                value={draft.branchName ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    branchName: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              PR URL
              <input
                value={draft.prUrl ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    prUrl: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <button
            className="ghost-button"
            type="submit"
            disabled={saving}
            style={{ justifyContent: "center" }}
            data-testid="save-issue"
          >
            {saving ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              "Save Changes"
            )}
          </button>
        </form>

        <div className="metadata-grid" style={{ marginTop: "20px" }}>
          <div className="stat-pill">
            <span>Created</span>
            <strong>{props.issue.createdAt.slice(0, 10)}</strong>
          </div>
          <div className="stat-pill">
            <span>Updated</span>
            <strong>{props.issue.updatedAt.slice(0, 10)}</strong>
          </div>
        </div>

        <div className="panel-embedded">
          <div className="eyebrow">Tracker workflow</div>
          <p className="support-copy">
            This UI only edits tracker state. Move the issue into <strong>Todo</strong>
            or <strong>Rework</strong> when you want the poller to claim it.
          </p>
        </div>

        {props.issue.prUrl && (
          <a
            href={props.issue.prUrl}
            target="_blank"
            rel="noreferrer"
            className="ghost-button"
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "6px",
              marginTop: "16px",
            }}
            data-testid="issue-pr-link"
          >
            <GitBranch size={14} /> Open Pull Request
          </a>
        )}
      </div>

      <div className="panel" style={{ flexGrow: 1, borderBottom: "none" }}>
        <div className="eyebrow">Activity & Notes</div>
        <div className="comment-list">
          {props.issue.comments.map((commentItem) => (
            <article key={commentItem.id} className="comment-card">
              <header>
                <strong>{commentItem.author}</strong>
                <span>{commentItem.createdAt.slice(0, 10)}</span>
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
            void props
              .onComment(comment)
              .then(() => setComment(""))
              .finally(() => setCommenting(false));
          }}
        >
          <label>
            <textarea
              rows={2}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Leave a manual note..."
            />
          </label>
          <button
            className="ghost-button"
            type="submit"
            disabled={commenting || comment.trim() === ""}
            style={{ justifyContent: "center" }}
          >
            {commenting ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <MessageSquareMore size={14} />
            )}
            Add Note
          </button>
        </form>
      </div>
    </>
  );
}

function groupIssuesByState(
  issues: DashboardIssue[],
): Record<CanonicalState, DashboardIssue[]> {
  return issues.reduce<Record<CanonicalState, DashboardIssue[]>>(
    (accumulator, issue) => {
      accumulator[issue.state].push(issue);
      return accumulator;
    },
    {
      backlog: [],
      todo: [],
      in_progress: [],
      human_review: [],
      rework: [],
      merging: [],
      done: [],
      cancelled: [],
    },
  );
}

function toDraft(issue: DashboardIssue): UpdateIssueInput {
  return {
    id: issue.id,
    title: issue.title,
    ...(issue.description === undefined
      ? {}
      : { description: issue.description }),
    state: issue.state,
    labels: issue.labels.join(", "),
    ...(issue.assignee === undefined ? {} : { assignee: issue.assignee }),
    priority: issue.priority ?? "medium",
    ...(issue.branchName === undefined ? {} : { branchName: issue.branchName }),
    ...(issue.prUrl === undefined ? {} : { prUrl: issue.prUrl }),
  };
}
