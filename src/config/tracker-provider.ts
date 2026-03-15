import { parseSupportedTrackerProvider, type SupportedTrackerProvider } from "../tracker/types.js";

export interface TrackerSelectionConfig {
  trackerProvider: SupportedTrackerProvider;
  trackerProjectKey?: string;
  trackerBoardId?: string;
}

export function resolveTrackerSelectionConfig(env: NodeJS.ProcessEnv = process.env): TrackerSelectionConfig {
  const trackerProjectKey = normalizeOptionalString(env.PIPHONY_TRACKER_PROJECT_KEY);
  const trackerBoardId = normalizeOptionalString(env.PIPHONY_TRACKER_BOARD_ID);
  return {
    trackerProvider: parseSupportedTrackerProvider(env.PIPHONY_TRACKER_PROVIDER, "local"),
    ...(trackerProjectKey === undefined ? {} : { trackerProjectKey }),
    ...(trackerBoardId === undefined ? {} : { trackerBoardId }),
  };
}

function normalizeOptionalString(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
