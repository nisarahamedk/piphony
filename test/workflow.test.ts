import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { createExecutionTargetFromWorkflow, loadWorkflow } from "../src/workflow/index.js";

describe("workflow contract", () => {
  test("loads hosted-safe workflow and creates execution target", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "piphony-workflow-test-"));
    await mkdir(join(repoRoot, ".piphony"), { recursive: true });
    await writeFile(
      join(repoRoot, ".piphony", "workflow.json"),
      JSON.stringify({
        version: 1,
        execution: {
          kind: "docker_compose",
          composeFile: "infra/docker-compose.local.yml",
          projectName: "infra",
          service: "runtime",
          workdir: "/workspace",
        },
        lifecycle: {
          prepare: {
            scope: "control_plane",
            command: "bash scripts/piphony/stack-prepare.sh",
          },
          teardown: {
            scope: "control_plane",
            command: "bash scripts/piphony/teardown.sh",
          },
        },
      }),
      "utf8",
    );

    const loaded = await loadWorkflow(repoRoot);
    expect(loaded.workflow.lifecycle?.prepare?.scope).toBe("control_plane");
    const executionTarget = createExecutionTargetFromWorkflow(repoRoot, loaded.workflow);
    expect(executionTarget.name).toBe("execution-docker-compose");
  });

  test("rejects repo toolchains in control-plane hooks", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "piphony-workflow-bad-"));
    await mkdir(join(repoRoot, ".piphony"), { recursive: true });
    await writeFile(
      join(repoRoot, ".piphony", "workflow.json"),
      JSON.stringify({
        version: 1,
        execution: {
          kind: "host",
          workdir: repoRoot,
        },
        lifecycle: {
          prepare: {
            scope: "control_plane",
            command: "pnpm install --frozen-lockfile",
          },
        },
      }),
      "utf8",
    );

    await expect(loadWorkflow(repoRoot)).rejects.toThrow("Move that work into the execution target");
  });
});
