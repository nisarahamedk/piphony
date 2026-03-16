import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Type } from "@sinclair/typebox";
import { ActiveRunRegistry } from "../core/active-run-registry.js";
import { Orchestrator, type RunWorker, type RunWorkerContext } from "../core/orchestrator.js";
import { createPiSessionController } from "../pi/runner.js";
import { inspectLatestRun } from "../observability/index.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { resetTrackerState } from "../tracker/local/harness.js";
import { createOnboardedOpenclawsseumProject } from "../fixtures/project.js";

class SessionControlWorker implements RunWorker {
  readonly name = "session-control";

  constructor(
    private readonly tracker: ReturnType<typeof createLocalTrackerAdapter>,
    private readonly projectRoot: string,
  ) {}

  async execute(context: RunWorkerContext) {
    const controller = await createPiSessionController({
      cwd: this.projectRoot,
      agentType: "chief_of_staff",
      modelPreference: "minimax/MiniMax-M2.5",
      thinkingLevel: "off",
      sessionDir: join(context.runArtifacts.runDir, "sessions"),
      customTools: [
        {
          name: "hold_for_smoke",
          label: "hold_for_smoke",
          description: "Hold execution for 5 seconds so steering/follow-up can be tested during an active Pi session.",
          parameters: Type.Object({}),
          execute: async () => {
            await sleep(5_000);
            return {
              content: [{ type: "text", text: "held for smoke" }],
              details: { heldMs: 5000 },
            };
          },
        },
      ],
    });
    context.activeRunRegistry?.attachControl(context.run.runId, controller);
    const snapshot = controller.snapshot();
    await context.heartbeat?.({
      phase: "pi_session_ready",
      piSessionId: snapshot.sessionId,
      ...(snapshot.sessionFile === undefined ? {} : { piSessionFile: snapshot.sessionFile }),
    });

    try {
      const result = await controller.runPrompt([
        "You must call hold_for_smoke immediately before replying.",
        "hold_for_smoke is the only required operation for this smoke test.",
        "While that tool is running, you may receive steering and follow-up messages.",
        `When finished, reply with one sentence starting exactly with 'Session control smoke complete for ${context.workItem.identifier}:' and include any received guidance literally.`,
      ].join("\n"));
      await this.tracker.applyMutation(context.workItem.identifier, { type: "transition", state: "in_progress" });
      await this.tracker.applyMutation(context.workItem.identifier, { type: "transition", state: "human_review" });
      return result.usedModel === undefined
        ? { summary: result.output, output: result.output }
        : { summary: result.output, output: result.output, metadata: { usedModel: result.usedModel } };
    } finally {
      await controller.dispose();
    }
  }
}

const fixture = await createOnboardedOpenclawsseumProject();
const { trackerDir, runsRootDir } = fixture.paths;
await resetTrackerState({ trackerDir });
const adapter = createLocalTrackerAdapter(trackerDir);
await adapter.store.createIssue({ identifier: "LOCAL-950", title: "Session control smoke", state: "todo" });

function isSkippableSessionFailure(error: string | undefined): boolean {
  if (error === undefined) {
    return false;
  }
  return error.includes("permission_error") || error.includes("OAuth authentication is currently not allowed for this organization");
}

function isTransientRunArtifactError(error: unknown): boolean {
  return error instanceof Error
    && (error.message.includes("Failed to parse JSON artifact")
      || error.message.includes("Failed to parse JSONL artifact")
      || error.message.includes("Unexpected end of JSON input"));
}

async function safeInspectLatestRun() {
  try {
    return await inspectLatestRun(runsRootDir);
  } catch (error) {
    if (isTransientRunArtifactError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function emitSkippedFailure(reason: string): Promise<never> {
  const latest = await safeInspectLatestRun();
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason,
    runId: latest?.runId,
    error: latest?.summary?.error,
  }, null, 2));
  await fixture.cleanup();
  process.exit(0);
}

const activeRunRegistry = new ActiveRunRegistry();
const orchestrator = new Orchestrator({
  tracker: adapter,
  worker: new SessionControlWorker(adapter, fixture.projectRoot),
  runsRootDir,
  activeRunRegistry,
  pollIntervalMs: 100,
  instanceId: "session-control-smoke",
});

try {
  await orchestrator.pollOnce();
  let active = activeRunRegistry.getByIdentifier("LOCAL-950");
  for (let attempt = 0; attempt < 160 && active?.control === undefined; attempt += 1) {
    await sleep(150);
    active = activeRunRegistry.getByIdentifier("LOCAL-950");
  }
  if (active?.control === undefined) {
    const latest = await safeInspectLatestRun();
    if (latest?.status.status === "failed" && isSkippableSessionFailure(latest.summary?.error)) {
      await emitSkippedFailure("pi_session_unavailable");
    }
    throw new Error("Expected an active steerable Pi run");
  }

  const initial = active.control.snapshot();
  if (initial.sessionId.trim() === "") {
    throw new Error("Expected a real Pi session id");
  }

  try {
    await active.control.steer("Please include COS-STEERED in your final answer.");
    await sleep(300);
    await active.control.followUp("Also include FOLLOW-UP-OK in your final answer.");
  } catch (error) {
    const latest = await safeInspectLatestRun();
    if (latest?.status.status === "failed" && isSkippableSessionFailure(latest.summary?.error)) {
      await emitSkippedFailure("pi_session_ended_early");
    }
    throw error;
  }
  const queued = active.control.snapshot();
  if (queued.pendingMessageCount < 1) {
    throw new Error("Expected queued steering/follow-up messages while run is active");
  }

  for (let attempt = 0; attempt < 240; attempt += 1) {
    await sleep(250);
    await orchestrator.pollOnce();
    const latest = await safeInspectLatestRun();
    if (latest?.status.status === "failed" && isSkippableSessionFailure(latest.summary?.error)) {
      await emitSkippedFailure("pi_session_failed");
    }
    if (activeRunRegistry.getByIdentifier("LOCAL-950") === undefined) {
      break;
    }
  }

  if (activeRunRegistry.getByIdentifier("LOCAL-950") !== undefined) {
    throw new Error("Expected active run to complete and unregister");
  }

  const latest = await safeInspectLatestRun();
  if (latest === undefined) {
    throw new Error("Expected latest run details");
  }
  if (latest.status.status !== "completed") {
    if (latest.status.status === "failed" && isSkippableSessionFailure(latest.summary?.error)) {
      await emitSkippedFailure("pi_session_failed");
    }
    throw new Error(`Expected completed run, got ${latest.status.status}`);
  }
  if (!latest.events.some((event) => event.event === "run.completed")) {
    throw new Error("Expected run.completed event");
  }
  if (initial.sessionFile === undefined) {
    throw new Error("Expected a persisted session file for the active run");
  }

  console.log(JSON.stringify({
    ok: true,
    runId: latest.runId,
    sessionId: initial.sessionId,
    sessionFile: initial.sessionFile,
  }, null, 2));
} finally {
  await fixture.cleanup();
}
