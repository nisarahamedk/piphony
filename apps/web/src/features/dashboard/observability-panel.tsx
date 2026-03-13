import { Link } from "@tanstack/react-router";
import type { DashboardRunSummary, DashboardWorkerStatus } from "@/lib/models";

export function ObservabilityPanel(props: {
  workers: DashboardWorkerStatus[];
  recentRuns: DashboardRunSummary[];
  error?: string | undefined;
}) {
  return (
    <>
      <div className="panel">
        <div className="eyebrow">Workers</div>
        {props.error && (
          <p style={{ color: "var(--danger)", fontSize: "12px" }}>
            Sync error: {props.error}
          </p>
        )}
        <div className="worker-list" data-testid="worker-status-panel">
          {props.workers.length === 0 ? (
            <div className="issue-empty">
              No orchestrator heartbeat yet. Start the orchestrator with{" "}
              <code>npm run orchestrator:watch</code>.
            </div>
          ) : (
            props.workers.map((worker) => (
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
                  {worker.currentIssueIdentifier
                    ? `Working on ${worker.currentIssueIdentifier}`
                    : `${worker.host} · pid ${worker.processId}`}
                </p>
                {worker.currentRunId && (
                  <Link
                    to="/runs"
                    search={{ runId: worker.currentRunId }}
                    className="ghost-button"
                    style={{
                      padding: "4px 8px",
                      fontSize: "11px",
                      marginTop: "6px",
                    }}
                  >
                    View run →
                  </Link>
                )}
              </article>
            ))
          )}
        </div>
      </div>

      <div className="panel" style={{ flexGrow: 1, borderBottom: "none" }}>
        <div className="eyebrow">Recent Runs</div>
        <div className="run-list compact-run-list">
          {props.recentRuns.length === 0 ? (
            <div className="issue-empty">
              No runs yet. Create an issue and move it to Todo.
            </div>
          ) : (
            props.recentRuns.slice(0, 8).map((run) => (
              <Link
                key={run.runId}
                to="/runs"
                search={{ runId: run.runId }}
                className="run-item"
              >
                <span>
                  {run.workItemIdentifier ?? run.runId.slice(0, 8)}
                </span>
                <span className="run-status">
                  {run.status.replace("_", " ")}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>
    </>
  );
}
