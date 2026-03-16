import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Type } from "@sinclair/typebox";
import { createClient } from "rivetkit/client";
import { ActiveRunRegistry } from "../core/active-run-registry.js";
import { Orchestrator, type RunWorker, type RunWorkerContext } from "../core/orchestrator.js";
import { createChiefOfStaffRegistry } from "../cos/actor.js";
import { createLocalChiefOfStaffServices } from "../cos/local-services.js";
import { startChiefOfStaffServer } from "../cos/server.js";
import { createPiSessionController } from "../pi/runner.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { resetTrackerState } from "../tracker/local/harness.js";
import { createOnboardedOpenclawsseumProject, pickAvailablePort } from "../fixtures/project.js";

class SteerableWorker implements RunWorker {
  readonly name = "steerable-worker";

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
          description: "Hold execution for 6 seconds so steering can be tested during an active worker session.",
          parameters: Type.Object({}),
          execute: async () => {
            await sleep(6_000);
            return {
              content: [{ type: "text", text: "held for smoke" }],
              details: { heldMs: 6000 },
            };
          },
        },
      ],
    });
    context.activeRunRegistry?.attachControl(context.run.runId, controller);
    try {
      const result = await controller.runPrompt([
        "You must call hold_for_smoke immediately before replying.",
        "You may receive steering or follow-up messages while that tool runs.",
        `When finished, reply with one sentence starting exactly with 'Chief of Staff worker complete for ${context.workItem.identifier}:' and include any steering guidance literally.`,
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

async function waitForCompletedTurn(handle: any, completedResponses: () => number, previousCount: number, minimumMessages: number): Promise<void> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const [history, status] = await Promise.all([handle.getHistory(), handle.getStatus()]);
    const statusMessage = typeof status?.message === "string" ? status.message : "";
    const statusError = typeof status?.error === "string" ? status.error : "";
    const combinedStatus = `${statusMessage}\n${statusError}`.trim();
    if (/(usage limit|rate limit|under heavy load|temporarily unavailable|capacity|429)/i.test(combinedStatus)) {
      throw new Error(`ChiefOfStaff provider blocked: ${combinedStatus}`);
    }
    if (status?.state === "error" && combinedStatus !== "") {
      throw new Error(`ChiefOfStaff turn failed: ${combinedStatus}`);
    }
    if (completedResponses() > previousCount && status.state !== "thinking" && Array.isArray(history) && history.length >= minimumMessages) {
      return;
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for ChiefOfStaff turn completion");
}

const fixture = await createOnboardedOpenclawsseumProject();
const { trackerDir, runsRootDir, sessionRootDir } = fixture.paths;
await resetTrackerState({ trackerDir });
const adapter = createLocalTrackerAdapter(trackerDir);
await adapter.store.createIssue({ identifier: "LOCAL-960", title: "Chief of Staff smoke", state: "todo" });

const activeRunRegistry = new ActiveRunRegistry();
const orchestrator = new Orchestrator({
  tracker: adapter,
  worker: new SteerableWorker(adapter, fixture.projectRoot),
  runsRootDir,
  activeRunRegistry,
  pollIntervalMs: 100,
  instanceId: "cos-actor-smoke",
});
await orchestrator.pollOnce();

const cosRegistry = createChiefOfStaffRegistry({
  cwd: fixture.projectRoot,
  sessionRootDir,
  services: createLocalChiefOfStaffServices({ trackerDir, runsRootDir, activeRunRegistry, projectRoot: fixture.projectRoot }),
  modelPreference: "minimax/MiniMax-M2.5",
});
const server = await startChiefOfStaffServer({ registry: cosRegistry, port: await pickAvailablePort() });

try {
  const client = createClient<any>({ endpoint: server.endpoint }) as any;
  const userKey = ["user", `cos-actor-smoke-${Date.now()}`];
  const handle = client.chiefOfStaff.getOrCreate(userKey) as any;
  const conn = handle.connect();
  const responses: string[] = [];
  conn.on("response", (event: { content: string; done: boolean }) => {
    if (event.done) {
      responses.push(event.content);
    }
  });

  await handle.setPageContext({ kind: "issue", provider: "local", identifier: "LOCAL-960" });
  let completedCount = responses.length;
  await handle.send("prompt", { text: "Use the issue context tools to inspect the current issue and active run." });
  await waitForCompletedTurn(handle, () => responses.length, completedCount, 2);

  completedCount = responses.length;
  await handle.send("prompt", { text: "Steer the active run for LOCAL-960 using the run-control tools if it is still active." });
  await waitForCompletedTurn(handle, () => responses.length, completedCount, 4);

  await handle.setPageContext({ kind: "board", provider: "local", url: "http://localhost:3333/dashboard" });
  completedCount = responses.length;
  await handle.send("prompt", { text: "Use the board overview tools to summarize what needs attention across the board." });
  await waitForCompletedTurn(handle, () => responses.length, completedCount, 6);

  for (let attempt = 0; attempt < 80; attempt += 1) {
    await sleep(150);
    await orchestrator.pollOnce();
    if (activeRunRegistry.getByIdentifier("LOCAL-960") === undefined) {
      break;
    }
  }
  const history = await handle.getHistory();
  if (!Array.isArray(history) || history.length < 6) {
    throw new Error("Expected CoS actor to accumulate conversation history across issue and board turns");
  }
  await conn.dispose();
  console.log(JSON.stringify({ ok: true, responses: responses.length, historyLength: history.length }, null, 2));
} finally {
  await server.close();
  await fixture.cleanup();
}

process.exit(0);
