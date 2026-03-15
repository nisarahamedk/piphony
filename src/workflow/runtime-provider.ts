import { resolve } from "node:path";
import type { ExecutionTarget } from "../core/types.js";
import { DockerComposeExecutionTarget } from "../runtime/docker/provider.js";
import { HostExecutionTarget } from "../runtime/host/provider.js";
import type { WorkflowDefinition } from "./types.js";

export function createExecutionTargetFromWorkflow(repoRoot: string, workflow: WorkflowDefinition): ExecutionTarget {
  if (workflow.execution.kind === "host") {
    return new HostExecutionTarget({
      projectDir: resolve(repoRoot),
      ...(workflow.execution.workdir === undefined ? {} : { workdir: workflow.execution.workdir }),
      ...(workflow.execution.endpoints === undefined ? {} : { endpoints: workflow.execution.endpoints }),
    });
  }

  return new DockerComposeExecutionTarget({
    projectDir: resolve(repoRoot),
    composeFile: resolve(repoRoot, workflow.execution.composeFile),
    projectName: workflow.execution.projectName,
    service: workflow.execution.service,
    ...(workflow.execution.workdir === undefined ? {} : { workdir: workflow.execution.workdir }),
    ...(workflow.execution.endpoints === undefined ? {} : { endpoints: workflow.execution.endpoints }),
  });
}
