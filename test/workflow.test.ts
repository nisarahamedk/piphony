import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { createRuntimeProviderFromWorkflow, loadWorkflow } from "../src/workflow/index.js";

describe("workflow contract", () => {
  test("loads hosted-safe workflow and creates runtime provider", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "piphony-workflow-test-"));
    await mkdir(join(repoRoot, ".piphony"), { recursive: true });
    await writeFile(
      join(repoRoot, ".piphony", "workflow.json"),
      JSON.stringify({
        version: 1,
        runtime: {
          provider: "docker_compose",
          composeFile: "infra/docker-compose.local.yml",
          projectName: "infra",
          service: "runtime",
          workdir: "/workspace",
          build: false,
        },
        phases: {
          prepare: {
            scope: "control_plane",
            command: "bash scripts/piphony/prepare.sh",
          },
          validate: {
            scope: "runtime",
            command: "bash scripts/piphony/validate-runtime.sh",
          },
        },
      }),
      "utf8",
    );

    const loaded = await loadWorkflow(repoRoot);
    expect(loaded.workflow.phases.prepare?.scope).toBe("control_plane");
    const runtimeProvider = createRuntimeProviderFromWorkflow(repoRoot, loaded.workflow);
    expect(runtimeProvider.name).toBe("runtime-docker");
  });

  test("rejects repo toolchains in control-plane phases", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "piphony-workflow-bad-"));
    await mkdir(join(repoRoot, ".piphony"), { recursive: true });
    await writeFile(
      join(repoRoot, ".piphony", "workflow.json"),
      JSON.stringify({
        version: 1,
        runtime: {
          provider: "docker_compose",
          composeFile: "infra/docker-compose.local.yml",
          projectName: "infra",
          service: "runtime",
          build: false,
        },
        phases: {
          prepare: {
            scope: "control_plane",
            command: "pnpm install --frozen-lockfile",
          },
        },
      }),
      "utf8",
    );

    await expect(loadWorkflow(repoRoot)).rejects.toThrow("Move that work into the runtime");
  });
});
