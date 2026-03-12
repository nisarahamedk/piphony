import { runPiTask } from "../pi/runner.js";
import { repoRoot } from "./_common.js";

const result = await runPiTask({
  cwd: repoRoot,
  prompt: "Read package.json and respond with exactly one short sentence confirming the project name.",
});
if (!result.output.toLowerCase().includes("piphony")) {
  throw new Error(`pi smoke did not mention piphony: ${result.output}`);
}
console.log(JSON.stringify({ ok: true, usedModel: result.usedModel, output: result.output }, null, 2));
