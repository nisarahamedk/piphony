import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorMessage } from "../core/errors.js";
import { hasJiraTrackerLiveValidationConfig, hasLinearTrackerLiveValidationConfig } from "../tracker/live-validation.js";
import { resolveTrackerRuntime } from "../tracker/runtime.js";
import { parseSupportedTrackerProvider } from "../tracker/types.js";
import { detectExternalDependencyBlocker } from "../validation/validation-gate.js";

const provider = parseSupportedTrackerProvider(process.argv[2], "local");
if (provider === "local") {
  throw new Error("tracker-provider-live smoke requires an explicit external provider: linear or jira");
}

if ((provider === "linear" && !hasLinearTrackerLiveValidationConfig(process.env)) || (provider === "jira" && !hasJiraTrackerLiveValidationConfig(process.env))) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: "tracker_validation_not_configured",
    provider,
  }, null, 2));
  process.exit(0);
}

const trackerDir = await mkdtemp(join(tmpdir(), `piphony-${provider}-tracker-live-`));

try {
  // Use explicitProvider to bypass onboarded project requirement
  // This allows live validation of external providers without project onboarding
  const trackerRuntime = resolveTrackerRuntime({
    trackerDir,
    env: process.env,
    explicitProvider: provider,
  });
  const tracker = trackerRuntime.resolve(provider);
  const issues = await tracker.fetchBoardWorkItems();
  const sample = issues[0];
  const fetchedByIdentifier = sample === undefined ? undefined : await tracker.fetchWorkItemByIdentifier(sample.identifier);

  console.log(JSON.stringify({
    ok: true,
    provider,
    issueCount: issues.length,
    ...(trackerRuntime.selection.trackerProjectKey === undefined ? {} : { projectKey: trackerRuntime.selection.trackerProjectKey }),
    ...(sample === undefined ? {} : { sampleIssueIdentifier: sample.identifier }),
    ...(fetchedByIdentifier === undefined ? {} : { roundTripIdentifier: fetchedByIdentifier.identifier }),
  }, null, 2));
} catch (error) {
  const message = errorMessage(error);
  const blocker = detectExternalDependencyBlocker(message);
  if (blocker?.code === "provider_auth_blocked") {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: blocker.code,
      provider,
      error: message,
    }, null, 2));
    process.exit(0);
  }
  throw error;
} finally {
  await rm(trackerDir, { recursive: true, force: true });
}
