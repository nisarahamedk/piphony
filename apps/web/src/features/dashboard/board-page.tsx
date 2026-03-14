import { useNavigate } from "@tanstack/react-router";
import { LoaderCircle, Plus, RefreshCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { errorMessage } from "@piphony/core/errors";
import type { CanonicalState } from "@piphony/core/types";
import { AppShell } from "./shell";
import type { CreateIssueInput, DashboardIssue, DashboardSnapshot } from "@/lib/models";
import {
  appendIssueComment,
  createIssue,
  getDashboardSnapshot as getDashboardSnapshotServer,
  transitionIssue,
  updateIssue,
} from "@/lib/server/functions";
import { useLiveValue } from "@/lib/use-live-data";
import { BoardColumn, IssueComposer, IssueInspectorModal } from "./board-page-parts";
import { CANONICAL_STATES, groupIssuesByState } from "./board-page-shared";

export function BoardPage(props: {
  initialSnapshot: DashboardSnapshot;
  selectedIssueId?: string | undefined;
  selectedIssueIdentifier?: string | undefined;
}) {
  const navigate = useNavigate({ from: "/" });
  const dashboard = useLiveValue({
    initial: props.initialSnapshot,
    load: () => getDashboardSnapshotServer(),
    intervalMs: 3_500,
  });
  const selectedIssue = dashboard.value.issues.find(
    (issue) => issue.id === props.selectedIssueId || issue.identifier === props.selectedIssueIdentifier,
  );
  const issuesByState = useMemo(() => groupIssuesByState(dashboard.value.issues), [dashboard.value.issues]);
  const [composeError, setComposeError] = useState<string | undefined>();
  const [showCreate, setShowCreate] = useState(false);
  const [dragState, setDragState] = useState<{ issueId: string; fromState: CanonicalState } | null>(null);

  const handleSelectIssue = async (issue?: DashboardIssue) => {
    await navigate({
      search: (current) => {
        const { issueId: _ignoredIssueId, issue: _ignoredIssue, ...rest } = current;
        if (issue === undefined) {
          return rest;
        }
        return { ...rest, issue: issue.identifier };
      },
    });
  };

  const handleCreateIssue = async (input: CreateIssueInput) => {
    try {
      setComposeError(undefined);
      const next = await createIssue({ data: input });
      dashboard.setValue(next);
      setShowCreate(false);
    } catch (caught: unknown) {
      setComposeError(errorMessage(caught));
    }
  };

  const handleDragTransition = async (issueId: string, targetState: CanonicalState) => {
    try {
      const next = await transitionIssue({ data: { id: issueId, state: targetState } });
      dashboard.setValue(next);
    } catch (caught: unknown) {
      console.error("Transition failed:", caught);
    }
  };

  return (
    <AppShell
      stats={dashboard.value.stats}
      masthead={(
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>{dashboard.value.issues.length} issues</span>
          <button className="ghost-button" type="button" onClick={() => setShowCreate((prev) => !prev)} data-testid="toggle-create-issue">
            <Plus size={12} />
            New Issue
          </button>
          <button className="ghost-button" type="button" onClick={() => void dashboard.refresh()}>
            {dashboard.isRefreshing ? <LoaderCircle size={12} className="spin" /> : <RefreshCcw size={12} />}
            Sync
          </button>
        </div>
      )}
    >
      {showCreate && (
        <div className="create-issue-banner" data-testid="create-issue-banner">
          <IssueComposer onSubmit={handleCreateIssue} onCancel={() => setShowCreate(false)} error={composeError} />
        </div>
      )}

      <section className="board-surface">
        <div className="board-columns" data-testid="board-columns">
          {CANONICAL_STATES.map((state) => (
            <BoardColumn
              key={state}
              state={state}
              issues={issuesByState[state] ?? []}
              selectedIssueId={selectedIssue?.id}
              onSelectIssue={handleSelectIssue}
              dragState={dragState}
              onDragStart={(issueId, fromState) => setDragState({ issueId, fromState })}
              onDragEnd={() => setDragState(null)}
              onDrop={handleDragTransition}
              workers={dashboard.value.workers}
            />
          ))}
        </div>
      </section>

      {selectedIssue !== undefined ? (
        <IssueInspectorModal
          issue={selectedIssue}
          workers={dashboard.value.workers}
          onClose={() => void handleSelectIssue(undefined)}
          onSave={async (input) => {
            const next = await updateIssue({ data: input });
            dashboard.setValue(next);
          }}
          onTransition={async (state) => {
            const next = await transitionIssue({ data: { id: selectedIssue.id, state } });
            dashboard.setValue(next);
          }}
          onComment={async (body) => {
            const next = await appendIssueComment({ data: { id: selectedIssue.id, body, author: "human" } });
            dashboard.setValue(next);
          }}
        />
      ) : null}
    </AppShell>
  );
}
