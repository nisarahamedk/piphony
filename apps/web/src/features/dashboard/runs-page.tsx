import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, Bot, CopyCheck, FileText, LoaderCircle, MonitorPlay, RefreshCcw } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AppShell } from "./shell";
import type { DashboardRunSummary, RunDetail } from "@/lib/models";
import { getDashboardSnapshot, getRunDetail, getRunsSnapshot } from "@/lib/server/functions";
import { useLiveValue } from "@/lib/use-live-data";

export function RunsPage(props: { initialRuns: DashboardRunSummary[]; selectedRunId?: string | undefined }) {
  const navigate = useNavigate({ from: "/runs" });
  const runs = useLiveValue({
    initial: props.initialRuns,
    load: () => getRunsSnapshot(),
    intervalMs: 4_000,
  });
  const [detail, setDetail] = useState<RunDetail | undefined>(undefined);
  const [detailError, setDetailError] = useState<string | undefined>(undefined);
  const [stats, setStats] = useState(props.initialRuns);

  useEffect(() => {
    void getDashboardSnapshot().then((snapshot) => setStats(snapshot.recentRuns)).catch(() => undefined);
  }, []);

  const selectedRunId = props.selectedRunId ?? runs.value[0]?.runId;
  const selectedRun = useMemo(
    () => runs.value.find((run) => run.runId === selectedRunId) ?? runs.value[0],
    [runs.value, selectedRunId],
  );

  useEffect(() => {
    if (selectedRun === undefined) {
      setDetail(undefined);
      return;
    }

    let cancelled = false;
    const refreshDetail = async () => {
      try {
        const next = await getRunDetail({ data: { runId: selectedRun.runId } });
        if (!cancelled) {
          setDetail(next);
          setDetailError(undefined);
        }
      } catch (caught: unknown) {
        if (!cancelled) {
          setDetailError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    };

    void refreshDetail();
    const id = window.setInterval(() => {
      void refreshDetail();
    }, 2_500);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selectedRun]);

  return (
    <AppShell
      stats={{
        openIssues: stats.filter((run) => run.workItemId !== "none").length,
        activeRuns: runs.value.filter((run) => run.status === "running" || run.status === "created").length,
        draftPrs: runs.value.filter((run) => run.summary?.includes("http")).length,
        failedRuns: runs.value.filter((run) => run.status === "failed").length,
        updatedAt: new Date().toISOString(),
      }}
      masthead={
        <section className="masthead-grid">
          <div className="shell-card telemetry-banner">
            <div>
              <p className="eyebrow">Run registry</p>
              <h3>Transcript-grade observability for every attempt.</h3>
            </div>
            <p className="support-copy">
              Runs stream from <code>.piphony/runs</code>, including summaries, event logs, and transcripts. This page is optimized for operator forensics, not vanity charts.
            </p>
          </div>
        </section>
      }
    >
      <div className="workspace-grid runs-layout">
        <section className="shell-card run-list-surface">
          <div className="section-header">
            <div>
              <p className="eyebrow">Recent runs</p>
              <h3>Watch status, issue linkage, and summary drift.</h3>
            </div>
            <button className="ghost-button" type="button" onClick={() => void runs.refresh()}>
              {runs.isRefreshing ? <LoaderCircle size={16} className="spin" /> : <RefreshCcw size={16} />}
              Refresh
            </button>
          </div>
          <div className="run-list" data-testid="runs-list">
            {runs.value.map((run) => (
              <button
                key={run.runId}
                type="button"
                className={`run-list-card ${run.runId === selectedRun?.runId ? "is-selected" : ""}`}
                onClick={() => void navigate({ search: () => ({ runId: run.runId }) })}
                data-testid={`run-card-${run.runId}`}
              >
                <div className="run-list-topline">
                  <span className={`mini-run is-${run.status}`}>{run.status}</span>
                  <strong>{run.workItemIdentifier ?? run.runId.slice(0, 10)}</strong>
                </div>
                <p>{run.summary ?? run.transcriptPreview ?? "Awaiting transcript preview"}</p>
                <div className="run-list-meta">
                  <span>{run.agentType}</span>
                  <span>{run.updatedAt}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <aside className="shell-card run-detail-surface">
          {selectedRun === undefined ? (
            <div className="empty-inspector">
              <h3>No runs yet.</h3>
              <p>Once orchestration emits logs, this panel will surface the transcript, event timeline, and validation signals.</p>
            </div>
          ) : (
            <RunInspector run={selectedRun} detail={detail} error={detailError} />
          )}
        </aside>
      </div>
    </AppShell>
  );
}

function RunInspector(props: { run: DashboardRunSummary; detail?: RunDetail | undefined; error?: string | undefined }) {
  return (
    <div className="run-inspector" data-testid="run-inspector">
      <div className="inspector-header">
        <div>
          <p className="eyebrow">Selected run</p>
          <h3>{props.run.runId}</h3>
        </div>
        <span className={`mini-run is-${props.run.status}`}>{props.run.status}</span>
      </div>

      <div className="run-meta-grid">
        <StatCard icon={<Bot size={16} />} label="agent" value={props.run.agentType} />
        <StatCard icon={<MonitorPlay size={16} />} label="provider" value={props.run.runtimeProvider ?? "n/a"} />
        <StatCard icon={<CopyCheck size={16} />} label="attempt" value={String(props.run.attemptNumber)} />
        <StatCard icon={<FileText size={16} />} label="events" value={String(props.run.eventCount)} />
      </div>

      <div className="linked-run shell-inset">
        <div className="linked-run-header">
          <p className="eyebrow">Issue linkage</p>
          {props.run.workItemId !== "none" ? (
            <Link to="/" search={{ issueId: props.run.workItemId }} className="ghost-button subtle-link">
              Open issue
              <ArrowUpRight size={14} />
            </Link>
          ) : null}
        </div>
        <strong>{props.run.workItemIdentifier ?? props.run.workItemId}</strong>
        <p>{props.run.summary ?? props.run.transcriptPreview ?? "Awaiting summary"}</p>
      </div>

      {props.error ? <p className="form-error">{props.error}</p> : null}

      <section className="transcript-panel">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">Transcript</p>
            <h4>Final assistant text</h4>
          </div>
        </div>
        <pre className="transcript-block">{props.detail?.transcript ?? "No transcript captured yet."}</pre>
      </section>

      <section className="event-panel">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">Event tape</p>
            <h4>Structured run events</h4>
          </div>
        </div>
        <div className="event-timeline">
          {(props.detail?.events ?? []).slice(-24).reverse().map((event) => (
            <article key={`${event.timestamp}-${event.event}`} className="event-card">
              <div>
                <strong>{event.event}</strong>
                <span>{event.timestamp}</span>
              </div>
              <pre>{JSON.stringify(event.data ?? {}, null, 2)}</pre>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatCard(props: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="stat-pill iconified">
      <div className="stat-icon">{props.icon}</div>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
