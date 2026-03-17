import { parseSupportedTrackerProvider, type SupportedTrackerProvider } from "../tracker/types.js";

export interface TrackerSelection {
  trackerProvider: SupportedTrackerProvider;
  trackerProjectKey?: string;
  trackerBoardId?: string;
}

export interface TrackerSelectionOverride {
  trackerProvider?: SupportedTrackerProvider;
  trackerProjectKey?: string;
  trackerBoardId?: string;
}

export function mergeTrackerSelection(
  base: TrackerSelection,
  override: TrackerSelectionOverride,
): TrackerSelection {
  return {
    trackerProvider: override.trackerProvider ?? base.trackerProvider,
    ...((override.trackerProjectKey ?? base.trackerProjectKey) === undefined
      ? {}
      : { trackerProjectKey: override.trackerProjectKey ?? base.trackerProjectKey }),
    ...((override.trackerBoardId ?? base.trackerBoardId) === undefined
      ? {}
      : { trackerBoardId: override.trackerBoardId ?? base.trackerBoardId }),
  };
}

export function resolveEnvTrackerSelectionOverride(
  env: NodeJS.ProcessEnv = process.env,
): TrackerSelectionOverride {
  const trackerProvider = normalizeOptionalString(env.PIPHONY_TRACKER_PROVIDER);
  const trackerProjectKey = normalizeOptionalString(env.PIPHONY_TRACKER_PROJECT_KEY);
  const trackerBoardId = normalizeOptionalString(env.PIPHONY_TRACKER_BOARD_ID);

  return {
    ...(trackerProvider === undefined
      ? {}
      : { trackerProvider: parseSupportedTrackerProvider(trackerProvider) }),
    ...(trackerProjectKey === undefined ? {} : { trackerProjectKey }),
    ...(trackerBoardId === undefined ? {} : { trackerBoardId }),
  };
}

export function trackerSelectionsEqual(left: TrackerSelection, right: TrackerSelection): boolean {
  return left.trackerProvider === right.trackerProvider
    && left.trackerProjectKey === right.trackerProjectKey
    && left.trackerBoardId === right.trackerBoardId;
}

function normalizeOptionalString(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
