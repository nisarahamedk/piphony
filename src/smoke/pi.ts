import { runPiTask } from "../pi/runner.js";
import { createOnboardedOpenclawsseumProject } from "../fixtures/project.js";

const fixture = await createOnboardedOpenclawsseumProject();
try {
  const result = await runPiTask({
    cwd: fixture.projectRoot,
    prompt: "Read package.json and respond with exactly one short sentence confirming the project name.",
  });
  if (!result.output.toLowerCase().includes("openclawsseum")) {
    throw new Error(`pi smoke did not mention openclawsseum: ${result.output}`);
  }
  console.log(JSON.stringify({ ok: true, usedModel: result.usedModel, output: result.output }, null, 2));
} finally {
  await fixture.cleanup();
}
