import { readWorkflowSync } from "../workflow/loader.js";
import { parseSupportedTrackerProvider, type SupportedTrackerProvider } from "../tracker/types.js";

export interface TrackerSelectionConfig {
  trackerProvider: SupportedTrackerProvider;
  trackerProjectKey?: string;
  trackerBoardId?: string;
}

export function resolveTrackerSelectionConfig(env: NodeJS.ProcessEnv = process.env, projectRoot?: string): TrackerSelectionConfig {
  const workflowTracker = projectRoot === undefined ? undefined : readWorkflowSync(projectRoot)?.tracker;
  const trackerProjectKey = normalizeOptionalString(env.PIPHONY_TRACKER_PROJECT_KEY) ?? workflowTracker?.projectKey;
  const trackerBoardId = normalizeOptionalString(env.PIPHONY_TRACKER_BOARD_ID) ?? workflowTracker?.boardId;
  return {
    trackerProvider: parseSupportedTrackerProvider(env.PIPHONY_TRACKER_PROVIDER, workflowTracker?.provider ?? "local"),
    ...(trackerProjectKey === undefined ? {} : { trackerProjectKey }),
    ...(trackerBoardId === undefined ? {} : { trackerBoardId }),
  };
}

function normalizeOptionalString(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
