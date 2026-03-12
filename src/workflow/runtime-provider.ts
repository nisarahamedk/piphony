import { join, resolve } from "node:path";
import type { RuntimeProvider } from "../core/types.js";
import { DockerComposeRuntimeProvider } from "../runtime/docker/provider.js";
import type { WorkflowDefinition } from "./types.js";

export function createRuntimeProviderFromWorkflow(repoRoot: string, workflow: WorkflowDefinition): RuntimeProvider {
  if (workflow.runtime.provider !== "docker_compose") {
    throw new Error(`Unsupported workflow runtime provider: ${workflow.runtime.provider}`);
  }
  return new DockerComposeRuntimeProvider({
    projectDir: resolve(repoRoot),
    composeFile: resolve(join(repoRoot, workflow.runtime.composeFile)),
    projectName: workflow.runtime.projectName,
    service: workflow.runtime.service,
    build: workflow.runtime.build,
    ...(workflow.runtime.workdir === undefined ? {} : { workdir: workflow.runtime.workdir }),
    ...(workflow.runtime.servicesToStart === undefined ? {} : { servicesToStart: workflow.runtime.servicesToStart }),
    ...(workflow.runtime.endpoints === undefined ? {} : { endpoints: workflow.runtime.endpoints }),
  });
}
