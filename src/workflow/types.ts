import type { SupportedTrackerProvider } from "../tracker/types.js";

export type WorkflowLifecycleHookName = "prepare" | "teardown";
export type WorkflowHookScope = "control_plane" | "execution";

export interface WorkflowHookDefinition {
  scope: WorkflowHookScope;
  command: string;
  timeoutSeconds?: number;
  service?: string;
  env?: Record<string, string>;
}

export interface DockerComposeWorkflowExecution {
  kind: "docker_compose";
  composeFile: string;
  projectName: string;
  service: string;
  workdir?: string;
  endpoints?: Record<string, string>;
}

export interface HostWorkflowExecution {
  kind: "host";
  workdir?: string;
  endpoints?: Record<string, string>;
}

export type WorkflowExecutionDefinition = DockerComposeWorkflowExecution | HostWorkflowExecution;

export interface WorkflowLifecycleDefinition {
  prepare?: WorkflowHookDefinition;
  teardown?: WorkflowHookDefinition;
}

export interface WorkflowTrackerDefinition {
  provider: SupportedTrackerProvider;
  projectKey?: string;
  boardId?: string;
}

export interface WorkflowDefinition {
  version: 1;
  tracker?: WorkflowTrackerDefinition;
  execution: WorkflowExecutionDefinition;
  lifecycle?: WorkflowLifecycleDefinition;
}

export interface WorkflowLoadResult {
  repoRoot: string;
  path: string;
  workflow: WorkflowDefinition;
}
