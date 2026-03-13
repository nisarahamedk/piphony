import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inspectLatestRun, inspectRun } from "../observability/index.js";
import { Orchestrator } from "../core/orchestrator.js";
import type { RunWorker, RunWorkerContext } from "../core/orchestrator.js";
import { ensureDir } from "../core/utils.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { resetTrackerState } from "../tracker/local/harness.js";
import { runPiTask } from "../pi/runner.js";
import { repoRoot, runsRootDir, trackerDir } from "./_common.js";

const execFileAsync = promisify(execFile);

class SuccessWorker implements RunWorker {
  readonly name = "implementation";
  constructor(private readonly adapter: ReturnType<typeof createLocalTrackerAdapter>) {}

  async execute(context: RunWorkerContext) {
    const result = await runPiTask({
      cwd: repoRoot,
      agentType: "implementation",
      tracker: this.adapter,
      workItem: context.workItem,
      prompt: `Use tracker_get_issue on ${context.workItem.identifier}. Add a comment saying \"observability success\". Transition the issue to human_review. Reply with one sentence.`,
      onTrackerEvent: async (event) => {
        await context.logger.emit(event.event, event.details);
      },
    });
    return result.usedModel === undefined
      ? { summary: result.output, output: result.output }
      : { summary: result.output, output: result.output, metadata: { usedModel: result.usedModel } };
  }
}

class FailingWorker implements RunWorker {
  readonly name = "failing-worker";
  async execute(context: RunWorkerContext): Promise<never> {
    await context.logger.emit("worker.intentional_failure", { identifier: context.workItem.identifier });
    throw new Error("intentional smoke failure");
  }
}

await ensureDir(runsRootDir);
await resetTrackerState({ trackerDir });
const adapter = createLocalTrackerAdapter(trackerDir);
await adapter.store.createIssue({ identifier: "LOCAL-901", title: "Observability success", state: "todo" });
await adapter.store.createIssue({ identifier: "LOCAL-902", title: "Observability failure", state: "todo" });

const successRun = await new Orchestrator({
  tracker: adapter,
  worker: new SuccessWorker(adapter),
  runsRootDir,
  agentType: "implementation",
}).runOnce();

try {
  await new Orchestrator({
    tracker: adapter,
    worker: new FailingWorker(),
    runsRootDir,
    agentType: "failing-worker",
  }).runOnce();
} catch {
  // expected
}

const inspectedSuccess = await inspectRun(runsRootDir, successRun.run.runId);
if (!inspectedSuccess.events.some((event) => event.event === "run.completed")) throw new Error("Expected run.completed event");
if (!inspectedSuccess.events.some((event) => event.event === "tracker.transition")) throw new Error("Expected tracker transition event");
if ((inspectedSuccess.transcript?.length ?? 0) === 0) throw new Error("Expected transcript to be captured");

const latest = await inspectLatestRun(runsRootDir);
if (latest === undefined || latest.status.status !== "failed") throw new Error("Expected latest run to be the intentional failure");
if (!latest.events.some((event) => event.event === "run.failed")) throw new Error("Expected run.failed event");

const { stdout } = await execFileAsync("npm", ["run", "status", "--", "--latest"], { cwd: repoRoot });
if (!stdout.includes(latest.runId)) throw new Error("Expected status command to report latest failed run");

console.log(JSON.stringify({ ok: true, successRun: successRun.run.runId, failedRun: latest.runId }, null, 2));
