import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createAgentModelOverrides, type AgentTypeOverride } from "../pi/agent-types.js";
import type { SupportedTrackerProvider } from "../tracker/types.js";
import type { WorkflowDefinition, WorkflowExecutionDefinition, WorkflowHookDefinition } from "../workflow/types.js";
import { resolveWorkflowPath } from "../workflow/loader.js";

export interface OnboardProjectOptions {
  projectRoot: string;
  trackerProvider: SupportedTrackerProvider;
  trackerProjectKey?: string;
  trackerBoardId?: string;
  model: string;
  execution: WorkflowDefinition["execution"];
  lifecycle?: WorkflowDefinition["lifecycle"];
  force?: boolean;
}

export interface ProjectOnboardingDefaults {
  projectRoot: string;
  model: string;
  trackerProvider: SupportedTrackerProvider;
  execution: WorkflowDefinition["execution"];
  lifecycle: NonNullable<WorkflowDefinition["lifecycle"]>;
}

export interface OnboardProjectResult {
  projectRoot: string;
  workflowPath: string;
  agentTypesPath: string;
  workflow: WorkflowDefinition;
  agentOverrides: AgentTypeOverride[];
}

export function detectProjectOnboardingDefaults(projectRoot: string): ProjectOnboardingDefaults {
  const resolvedProjectRoot = resolve(projectRoot);
  const composeFile = detectComposeFile(resolvedProjectRoot);
  const lifecycle = detectWorkflowLifecycle(resolvedProjectRoot);
  return {
    projectRoot: resolvedProjectRoot,
    model: "minimax/MiniMax-M2.5",
    trackerProvider: "local",
    execution: composeFile === undefined
      ? {
          kind: "host",
          workdir: resolvedProjectRoot,
        }
      : {
          kind: "docker_compose",
          composeFile,
          projectName: sanitizeProjectName(basename(resolvedProjectRoot)),
          service: "runtime",
          workdir: "/workspace",
        },
    lifecycle,
  };
}

export async function onboardProject(options: OnboardProjectOptions): Promise<OnboardProjectResult> {
  const projectRoot = resolve(options.projectRoot);
  const workflowPath = resolveWorkflowPath(projectRoot);
  const agentTypesPath = resolve(join(projectRoot, ".piphony", "agent-types.json"));
  const workflow = buildWorkflowDefinition(options);
  const agentOverrides = createAgentModelOverrides(options.model);

  if (!options.force) {
    if (existsSync(workflowPath)) {
      throw new Error(`Refusing to overwrite existing workflow config: ${workflowPath}. Re-run with force=true to replace it.`);
    }
    if (existsSync(agentTypesPath)) {
      throw new Error(`Refusing to overwrite existing agent type config: ${agentTypesPath}. Re-run with force=true to replace it.`);
    }
  }

  await mkdir(join(projectRoot, ".piphony"), { recursive: true });
  await writeFile(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  await writeFile(agentTypesPath, `${JSON.stringify({ agents: agentOverrides }, null, 2)}\n`, "utf8");

  return {
    projectRoot,
    workflowPath,
    agentTypesPath,
    workflow,
    agentOverrides,
  };
}

export function buildWorkflowDefinition(options: OnboardProjectOptions): WorkflowDefinition {
  return {
    version: 1,
    tracker: {
      provider: options.trackerProvider,
      ...(options.trackerProjectKey === undefined ? {} : { projectKey: options.trackerProjectKey }),
      ...(options.trackerBoardId === undefined ? {} : { boardId: options.trackerBoardId }),
    },
    execution: cloneExecutionDefinition(options.execution),
    ...(options.lifecycle === undefined ? {} : { lifecycle: cloneLifecycleDefinition(options.lifecycle) }),
  };
}

function detectComposeFile(projectRoot: string): string | undefined {
  const candidates = [
    "infra/docker-compose.local.yml",
    "infra/docker-compose.local.yaml",
    "docker-compose.local.yml",
    "docker-compose.local.yaml",
    "docker-compose.yml",
    "docker-compose.yaml",
  ];
  return candidates.find((candidate) => existsSync(join(projectRoot, candidate)));
}

function detectWorkflowLifecycle(projectRoot: string): NonNullable<WorkflowDefinition["lifecycle"]> {
  const lifecycle: NonNullable<WorkflowDefinition["lifecycle"]> = {};
  const prepareCommand = existsSync(join(projectRoot, "scripts", "piphony", "stack-prepare.sh"))
    ? "bash scripts/piphony/stack-prepare.sh"
    : existsSync(join(projectRoot, "scripts", "piphony", "prepare.sh"))
      ? "bash scripts/piphony/prepare.sh"
      : undefined;
  if (prepareCommand !== undefined) {
    lifecycle.prepare = {
      scope: "control_plane",
      command: prepareCommand,
      timeoutSeconds: 2700,
    };
  }
  if (existsSync(join(projectRoot, "scripts", "piphony", "teardown.sh"))) {
    lifecycle.teardown = {
      scope: "control_plane",
      command: "bash scripts/piphony/teardown.sh",
      timeoutSeconds: 2700,
    };
  }
  return lifecycle;
}

function cloneExecutionDefinition(execution: WorkflowExecutionDefinition): WorkflowExecutionDefinition {
  if (execution.kind === "host") {
    return {
      kind: "host",
      ...(execution.workdir === undefined ? {} : { workdir: execution.workdir.trim() }),
      ...(execution.endpoints === undefined ? {} : { endpoints: { ...execution.endpoints } }),
    };
  }

  return {
    kind: "docker_compose",
    composeFile: execution.composeFile.trim(),
    projectName: execution.projectName.trim(),
    service: execution.service.trim(),
    ...(execution.workdir === undefined ? {} : { workdir: execution.workdir.trim() }),
    ...(execution.endpoints === undefined ? {} : { endpoints: { ...execution.endpoints } }),
  };
}

function cloneLifecycleDefinition(lifecycle: NonNullable<WorkflowDefinition["lifecycle"]>): NonNullable<WorkflowDefinition["lifecycle"]> {
  return {
    ...(lifecycle.prepare === undefined ? {} : { prepare: cloneHookDefinition(lifecycle.prepare) }),
    ...(lifecycle.teardown === undefined ? {} : { teardown: cloneHookDefinition(lifecycle.teardown) }),
  };
}

function cloneHookDefinition(hook: WorkflowHookDefinition): WorkflowHookDefinition {
  return {
    scope: hook.scope,
    command: hook.command,
    ...(hook.timeoutSeconds === undefined ? {} : { timeoutSeconds: hook.timeoutSeconds }),
    ...(hook.service === undefined ? {} : { service: hook.service }),
    ...(hook.env === undefined ? {} : { env: { ...hook.env } }),
  };
}

function sanitizeProjectName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized === "" ? "piphony-project" : normalized;
}
