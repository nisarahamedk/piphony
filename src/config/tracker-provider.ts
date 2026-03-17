import { loadOnboardedProjectExecution, getProjectTrackerSelection } from "../project/execution.js";
import { mergeTrackerSelection, resolveEnvTrackerSelectionOverride, type TrackerSelection } from "../project/tracker-selection.js";

export interface TrackerSelectionConfig extends TrackerSelection {}

export function resolveTrackerSelectionConfig(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
): TrackerSelectionConfig {
  const projectExecution = loadOnboardedProjectExecution(projectRoot);
  const defaultSelection = getProjectTrackerSelection(projectExecution);
  return mergeTrackerSelection(defaultSelection, resolveEnvTrackerSelectionOverride(env));
}
