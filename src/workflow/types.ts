export type WorkflowPhaseName = "prepare" | "validate" | "teardown";
export type WorkflowPhaseScope = "control_plane" | "runtime";

export interface WorkflowPhaseDefinition {
  scope: WorkflowPhaseScope;
  command: string;
  timeoutSeconds?: number;
  service?: string;
  env?: Record<string, string>;
}

export interface DockerComposeWorkflowRuntime {
  provider: "docker_compose";
  composeFile: string;
  projectName: string;
  service: string;
  workdir?: string;
  build: boolean;
  servicesToStart?: string[];
  endpoints?: Record<string, string>;
}

export interface WorkflowDefinition {
  version: 1;
  runtime: DockerComposeWorkflowRuntime;
  phases: Partial<Record<WorkflowPhaseName, WorkflowPhaseDefinition>>;
}

export interface WorkflowLoadResult {
  repoRoot: string;
  path: string;
  workflow: WorkflowDefinition;
}
