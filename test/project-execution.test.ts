import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadOnboardedProjectExecution } from "../src/project/execution.js";

describe("project execution bootstrap", () => {
  test("loads the onboarded project workflow and execution target", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "piphony-project-execution-"));
    await mkdir(join(projectRoot, ".piphony"), { recursive: true });
    await writeFile(
      join(projectRoot, ".piphony", "workflow.json"),
      JSON.stringify({
        version: 1,
        execution: {
          kind: "host",
          workdir: projectRoot,
        },
        lifecycle: {
          prepare: {
            scope: "control_plane",
            command: "bash scripts/piphony/prepare.sh",
          },
        },
      }),
      "utf8",
    );

    const execution = await loadOnboardedProjectExecution(projectRoot);

    expect(execution.projectRoot).toBe(projectRoot);
    expect(execution.workflowPath).toBe(join(projectRoot, ".piphony", "workflow.json"));
    expect(execution.workflow.execution.kind).toBe("host");
    expect(execution.executionTarget.name).toBe("execution-host");
  });

  test("fails fast when the managed project is not onboarded", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "piphony-project-missing-workflow-"));

    await expect(loadOnboardedProjectExecution(projectRoot)).rejects.toThrow(
      "Project is not onboarded. Expected workflow config",
    );
  });

  test("applies workflow transforms before creating the execution target", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "piphony-project-transform-"));
    await mkdir(join(projectRoot, ".piphony"), { recursive: true });
    await writeFile(
      join(projectRoot, ".piphony", "workflow.json"),
      JSON.stringify({
        version: 1,
        execution: {
          kind: "host",
          workdir: projectRoot,
        },
      }),
      "utf8",
    );

    const execution = await loadOnboardedProjectExecution(projectRoot, {
      transformWorkflow: (workflow) => ({
        ...workflow,
        execution: {
          kind: "docker_compose",
          composeFile: "infra/docker-compose.local.yml",
          projectName: "fixture-123",
          service: "runtime",
          workdir: "/workspace",
        },
      }),
    });

    expect(execution.workflow.execution.kind).toBe("docker_compose");
    expect(execution.executionTarget.name).toBe("execution-docker-compose");
  });
});
