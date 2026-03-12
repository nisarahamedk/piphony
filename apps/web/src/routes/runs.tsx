import { createFileRoute } from "@tanstack/react-router";
import { RunsPage } from "@/features/dashboard/runs-page";
import { getRunsSnapshot } from "@/lib/server/functions";

export const Route = createFileRoute("/runs")({
  validateSearch: (search: Record<string, unknown>): { runId?: string } =>
    typeof search.runId === "string" ? { runId: search.runId } : {},
  loader: () => getRunsSnapshot(),
  component: RunsRoute,
});

function RunsRoute() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  return search.runId === undefined
    ? <RunsPage initialRuns={data} />
    : <RunsPage initialRuns={data} selectedRunId={search.runId} />;
}
