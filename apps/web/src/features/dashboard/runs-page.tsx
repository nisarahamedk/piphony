import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, Clock, Hash, LoaderCircle, Play, RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ObservabilityPanel } from "./observability-panel";
import { AppShell } from "./shell";
import type { DashboardRunSummary, DashboardSnapshot, RunDetail } from "@/lib/models";
import { getDashboardSnapshot, getRunDetail, getRunsSnapshot } from "@/lib/server/functions";
import { useLiveValue } from "@/lib/use-live-data";

export function RunsPage(props: {
  initialRuns: DashboardRunSummary[];
  selectedRunId?: string | undefined;
}) {
  const navigate = useNavigate({ from: "/runs" });
  const runs = useLiveValue({
    initial: props.initialRuns,
    load: () => getRunsSnapshot(),
    intervalMs: 4_000,
  });
  const dashboard = useLiveValue<DashboardSnapshot>({
    initial: {
      issues: [],
      recentRuns: props.initialRuns,
      workers: [],
      stats: {
        openIssues: 0,
        activeRuns: props.initialRuns.filter(
          (r) => r.status === "running" || r.status === "created",
        ).length,
        activeWorkers: 0,
        staleWorkers: 0,
        failedRuns: props.initialRuns.filter((r) => r.status === "failed").length,
        updatedAt: new Date().toISOString(),
      },
    },
    load: () => getDashboardSnapshot(),
    intervalMs: 4_000,
  });
  const [detail, setDetail] = useState<RunDetail | undefined>(undefined);
  const [detailError, setDetailError] = useState<string | undefined>(undefined);

  const selectedRunId = props.selectedRunId;
  const selectedRun = useMemo(
    () =>
      selectedRunId === undefined
        ? undefined
        : runs.value.find((r) => r.runId === selectedRunId),
    [runs.value, selectedRunId],
  );

  useEffect(() => {
    if (selectedRun === undefined) {
      setDetail(undefined);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await getRunDetail({ data: { runId: selectedRun.runId } });
        if (!cancelled) {
          setDetail(next);
          setDetailError(undefined);
        }
      } catch (caught: unknown) {
        if (!cancelled)
          setDetailError(
            caught instanceof Error ? caught.message : String(caught),
          );
      }
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selectedRun]);

  return (
    <AppShell
      stats={{
        ...dashboard.value.stats,
        activeRuns: runs.value.filter(
          (r) => r.status === "running" || r.status === "created",
        ).length,
        failedRuns: runs.value.filter((r) => r.status === "failed").length,
        updatedAt: new Date().toISOString(),
      }}
      masthead={
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            {runs.value.length} runs
          </span>
          <button
            className="ghost-button"
            type="button"
            onClick={() => void runs.refresh()}
          >
            {runs.isRefreshing ? (
              <LoaderCircle size={12} className="spin" />
            ) : (
              <RefreshCcw size={12} />
            )}
            Sync
          </button>
        </div>
      }
    >
      {/* Run list */}
      <section className="runs-list-pane">
        <div className="runs-list-scroll" data-testid="runs-list">
          {runs.value.length === 0 && (
            <div className="issue-empty" style={{ margin: "20px" }}>
              No runs yet. Create an issue and move it to Todo.
            </div>
          )}
          {runs.value.map((run) => (
            <button
              key={run.runId}
              type="button"
              className={`runs-row ${run.runId === selectedRun?.runId ? "is-selected" : ""}`}
              onClick={() =>
                void navigate({ search: () => ({ runId: run.runId }) })
              }
              data-testid={`run-card-${run.runId}`}
            >
              <span className={`mini-run is-${run.status}`}>
                {run.status}
              </span>
              <span className="runs-row-id">
                {run.workItemIdentifier ?? run.runId.slice(0, 10)}
              </span>
              <span className="runs-row-summary">
                {run.summary ?? run.transcriptPreview ?? "—"}
              </span>
              <span className="runs-row-meta">{run.agentType}</span>
              <span className="runs-row-meta">
                {formatTimestamp(run.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      </section>

      <aside className="sidebar">
        {selectedRun === undefined ? (
          <>
            <div className="sidebar-tabs">
              <div className="sidebar-tab is-active" style={{ cursor: "default" }}>
                Observability
              </div>
            </div>
            <div className="sidebar-content">
              <ObservabilityPanel
                workers={dashboard.value.workers}
                recentRuns={dashboard.value.recentRuns}
                error={dashboard.error}
              />
            </div>
          </>
        ) : (
          <>
            <div className="sidebar-tabs">
              <div className="sidebar-tab is-active" style={{ cursor: "default" }}>
                Run Detail
              </div>
            </div>
            <div className="sidebar-content" data-testid="run-inspector">
              <RunInspector
                run={selectedRun}
                detail={detail}
                error={detailError}
              />
            </div>
          </>
        )}
      </aside>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Run inspector (sidebar)                                            */
/* ------------------------------------------------------------------ */

function RunInspector(props: {
  run: DashboardRunSummary;
  detail?: RunDetail | undefined;
  error?: string | undefined;
}) {
  const { run, detail } = props;

  return (
    <>
      {/* Header */}
      <div className="panel">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span className={`mini-run is-${run.status}`}>{run.status}</span>
          <span
            style={{
              fontSize: "11px",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {run.runId.slice(0, 20)}…
          </span>
        </div>

        {/* Inline metadata row */}
        <div className="run-detail-meta">
          <div className="run-detail-field">
            <Play size={12} />
            <span className="run-detail-label">Agent</span>
            <strong>{run.agentType}</strong>
          </div>
          <div className="run-detail-field">
            <Hash size={12} />
            <span className="run-detail-label">Attempt</span>
            <strong>{run.attemptNumber}</strong>
          </div>
          <div className="run-detail-field">
            <Clock size={12} />
            <span className="run-detail-label">Updated</span>
            <strong>{formatTimestamp(run.updatedAt)}</strong>
          </div>
          {run.runtimeProvider && (
            <div className="run-detail-field">
              <span className="run-detail-label">Provider</span>
              <strong>{run.runtimeProvider}</strong>
            </div>
          )}
        </div>

        {/* Issue linkage */}
        {run.workItemId !== "none" && (
          <div className="run-issue-link">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <strong>{run.workItemIdentifier ?? run.workItemId}</strong>
              <Link
                to="/"
                search={{ issueId: run.workItemId }}
                className="ghost-button"
                style={{ padding: "4px 8px", fontSize: "11px" }}
              >
                Open issue <ArrowUpRight size={10} />
              </Link>
            </div>
            {run.summary && (
              <p className="support-copy" style={{ fontSize: "12px" }}>
                {run.summary}
              </p>
            )}
          </div>
        )}

        {props.error && (
          <p style={{ color: "var(--danger)", fontSize: "12px" }}>
            {props.error}
          </p>
        )}
      </div>

      {/* Transcript */}
      <div className="panel">
        <div className="eyebrow">Transcript</div>
        <pre className="transcript-block">
          {detail?.transcript ?? "No transcript captured yet."}
        </pre>
      </div>

      {/* Event tape */}
      <div className="panel" style={{ flexGrow: 1, borderBottom: "none" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div className="eyebrow">
            Events ({detail?.events.length ?? 0})
          </div>
        </div>
        <div className="event-timeline">
          {(detail?.events ?? [])
            .slice(-30)
            .reverse()
            .map((event) => (
              <div
                key={`${event.timestamp}-${event.event}`}
                className="event-row"
              >
                <span className="event-name">{event.event}</span>
                <span className="event-ts">
                  {formatTimestamp(event.timestamp)}
                </span>
                {event.data && Object.keys(event.data).length > 0 && (
                  <pre className="event-data">
                    {JSON.stringify(event.data, null, 2)}
                  </pre>
                )}
              </div>
            ))}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso.slice(0, 19);
  }
}
