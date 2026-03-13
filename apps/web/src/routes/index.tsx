import { createFileRoute } from "@tanstack/react-router";
import { BoardPage } from "@/features/dashboard/board-page";
import { getDashboardSnapshot } from "@/lib/server/functions";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { issueId?: string; issue?: string } => ({
    ...(typeof search.issueId === "string" ? { issueId: search.issueId } : {}),
    ...(typeof search.issue === "string" ? { issue: search.issue } : {}),
  }),
  loader: () => getDashboardSnapshot(),
  component: BoardRoute,
});

function BoardRoute() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  return search.issueId === undefined && search.issue === undefined
    ? <BoardPage initialSnapshot={data} />
    : <BoardPage initialSnapshot={data} selectedIssueId={search.issueId} selectedIssueIdentifier={search.issue} />;
}
