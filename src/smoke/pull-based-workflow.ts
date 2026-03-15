import { Orchestrator } from "../core/orchestrator.js";
import { LocalTrackerSmokeWorker } from "../stack/local-smoke-worker.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { resetTrackerState } from "../tracker/local/harness.js";
import { createOnboardedOpenclawsseumProject } from "./fixture-project.js";

const fixture = await createOnboardedOpenclawsseumProject();
const { runsRootDir, trackerDir } = fixture.paths;

try {
  await resetTrackerState({ trackerDir });

  const trackerAdapter = createLocalTrackerAdapter(trackerDir);
  const worker = new LocalTrackerSmokeWorker(trackerDir);
  const orchestrator = new Orchestrator({
    tracker: trackerAdapter,
    worker: worker,
    runsRootDir,
    agentType: "smoke",
  });

  await trackerAdapter.store.createIssue({
    identifier: "LOCAL-450",
    title: "Pull-based workflow smoke",
    description: "Created from the browser smoke to prove the Symphony-style workflow: create issue, transition to Todo, let the orchestrator claim it, observe tracker comments, and finish in Human Review.",
    state: "todo",
  });

  const result = await orchestrator.runOnce();

  const inspected = await trackerAdapter.inspectIssue("LOCAL-450");

  if (inspected.state !== "human_review") {
    throw new Error(`Expected human_review, got ${inspected.state}`);
  }

  const hasPlan = inspected.comments.some((c) => c.body.startsWith("Plan"));
  const hasProgress = inspected.comments.some((c) => c.body.startsWith("Progress"));
  const hasReviewHandoff = inspected.comments.some((c) => c.body.startsWith("Review handoff"));

  if (!hasPlan) throw new Error("Missing Plan comment");
  if (!hasProgress) throw new Error("Missing Progress comment");
  if (!hasReviewHandoff) throw new Error("Missing Review handoff comment");

  console.log(
    JSON.stringify(
      {
        ok: true,
        runId: result.run.runId,
        issueState: inspected.state,
        comments: inspected.comments.length,
        hasPlan,
        hasProgress,
        hasReviewHandoff,
      },
      null,
    ),
  );
} finally {
  await fixture.cleanup();
}
