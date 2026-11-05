import { Orchestrator } from "../core/orchestrator.js";
import { errorMessage } from "../core/errors.js";
import type { RunWorker, RunWorkerContext } from "../core/orchestrator.js";
import { createOnboardedOpenclawsseumProject, pickAvailablePort } from "../fixtures/project.js";
import { runPiTask } from "../pi/runner.js";
import { loadOnboardedProjectExecution, createProjectTracker } from "../project/execution.js";
import { resetTrackerState } from "../tracker/local/harness.js";

const fixture = await createOnboardedOpenclawsseumProject();
const { runsRootDir, trackerDir } = fixture.paths;
const projectExecution = loadOnboardedProjectExecution(fixture.projectRoot);
const runtimeProjectName = `openclawsseum-${Date.now().toString().slice(-6)}`;
const webPort = await pickAvailablePort();
const runtimePort = await pickAvailablePort();
const convexPort = await pickAvailablePort();
const convexSitePort = await pickAvailablePort();
const dashboardPort = await pickAvailablePort();

process.env.OPENCLAWSSEUM_COMPOSE_PROJECT = runtimeProjectName;
process.env.PIPHONY_DOCKER_COMPOSE_PROJECT_NAME = runtimeProjectName;
process.env.OPENCLAWSSEUM_WEB_PORT = String(webPort);
process.env.OPENCLAWSSEUM_RUNTIME_PORT = String(runtimePort);
process.env.OPENCLAWSSEUM_CONVEX_PORT = String(convexPort);
process.env.OPENCLAWSSEUM_CONVEX_SITE_PORT = String(convexSitePort);
process.env.OPENCLAWSSEUM_CONVEX_DASHBOARD_PORT = String(dashboardPort);
process.env.OPENCLAWSSEUM_HOST_WEB_URL = `http://127.0.0.1:${webPort}`;
process.env.OPENCLAWSSEUM_HOST_RUNTIME_URL = `http://127.0.0.1:${runtimePort}`;
process.env.OPENCLAWSSEUM_HOST_CONVEX_URL = `http://127.0.0.1:${convexPort}`;
process.env.OPENCLAWSSEUM_HOST_CONVEX_SITE_URL = `http://127.0.0.1:${convexSitePort}`;
process.env.OPENCLAWSSEUM_HOST_CONVEX_DASHBOARD_URL = `http://127.0.0.1:${dashboardPort}`;

await resetTrackerState({ trackerDir });
const tracker = createProjectTracker({
  context: projectExecution,
  trackerDir,
  env: process.env,
});
await tracker.createIssue({
  title: "OpenClawsseum runtime stack smoke",
  description: "Prepare the real OpenClawsseum stack, implement inside the declared execution target, and hand off for human review.",
  state: "todo",
});

class DockerOpenclawsseumWorker implements RunWorker {
  readonly name = "implementation";

  async execute(context: RunWorkerContext) {
    if (context.executionTarget === undefined) {
      throw new Error("execution target required for docker smoke");
    }

    const result = await runPiTask({
      cwd: fixture.projectRoot,
      agentType: "implementation",
      tracker,
      workItem: context.workItem,
      executionTarget: context.executionTarget,
      prompt: [
        `Use bash to run these checks inside the execution target:`,
        `1. pwd`,
        `2. ls apps`,
        `3. bash scripts/check-no-js.sh`,
        `4. curl -sf http://convex-backend:3210/version | head -c 120`,
        `If ${context.workItem.identifier} is still in todo or rework, transition it to in_progress before the final handoff.`,
        `Then append a tracker comment saying \"openclawsseum runtime smoke ok\" and transition ${context.workItem.identifier} to human_review.`,
        `Finally reply with one short sentence starting exactly with '${context.workItem.identifier}:'.`,
      ].join("\n"),
      onTrackerEvent: async (event) => {
        await context.logger.emit(event.event, event.details);
      },
    });

    await context.logger.emit("execution.target.ready", {
      name: context.executionTarget.name,
      endpoints: await context.executionTarget.getEndpoints(),
    });

    return result.usedModel === undefined
      ? { summary: result.output || "docker smoke complete", output: result.output }
      : {
          summary: result.output || "docker smoke complete",
          output: result.output,
          metadata: { usedModel: result.usedModel },
        };
  }
}

const orchestrator = new Orchestrator({
  tracker,
  worker: new DockerOpenclawsseumWorker(),
  projectExecution,
  runsRootDir,
  agentType: "implementation",
});

try {
  const result = await orchestrator.runOnce();
  const issue = await tracker.fetchWorkItemByIdentifier("LOCAL-101");
  if (issue?.state !== "human_review") {
    throw new Error(`Expected LOCAL-101 to reach human_review, got ${issue?.state ?? "missing"}`);
  }
  const events = await result.logger.readEvents();
  // Check for workspace lifecycle events (RuntimePlatformProvider)
  const hasPrepareCompleted = events.some((event) => 
    event.event === "workspace.lifecycle.prepare.completed"
  );
  if (!hasPrepareCompleted) {
    throw new Error("Expected workspace prepare to complete");
  }
  if (!events.some((event) => event.event === "execution.target.ready")) {
    throw new Error("Expected execution target event");
  }
  if (!events.some((event) => event.event === "tracker.transition" && event.data?.state === "human_review")) {
    throw new Error("Expected issue to transition to human_review");
  }
  // Check for teardown completion
  const hasTeardownCompleted = events.some((event) => 
    event.event === "workspace.lifecycle.teardown.completed"
  );
  if (!hasTeardownCompleted) {
    throw new Error("Expected workspace teardown to complete");
  }

  console.log(JSON.stringify({
    ok: true,
    runId: result.run.runId,
    issueState: issue.state,
    runtimeProjectName,
  }, null, 2));
} catch (error) {
  const message = errorMessage(error);
  if (isDockerUnavailable(message)) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: "docker_unavailable",
      runtimeProjectName,
      error: message,
    }, null, 2));
    process.exit(0);
  }
  throw error;
} finally {
  await fixture.cleanup();
}

function isDockerUnavailable(message: string): boolean {
  return /Cannot connect to the Docker daemon/i.test(message)
    || /docker daemon.*running/i.test(message)
    || /Cannot connect to the Docker daemon at/i.test(message)
    || /docker: command not found/i.test(message)
    || /spawn docker ENOENT/i.test(message);
}
