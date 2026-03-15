import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createAgentModelOverrides, type AgentTypeOverride } from "../pi/agent-types.js";
import type { SupportedTrackerProvider } from "../tracker/types.js";
import type { WorkflowDefinition, WorkflowPhaseDefinition } from "../workflow/types.js";
import { resolveWorkflowPath } from "../workflow/loader.js";

export interface OnboardProjectOptions {
  projectRoot: string;
  trackerProvider: SupportedTrackerProvider;
  trackerProjectKey?: string;
  trackerBoardId?: string;
  model: string;
  runtime: WorkflowDefinition["runtime"];
  phases?: Partial<Record<"prepare" | "validate" | "teardown", WorkflowPhaseDefinition>>;
  force?: boolean;
}

export interface ProjectOnboardingDefaults {
  projectRoot: string;
  model: string;
  trackerProvider: SupportedTrackerProvider;
  runtime: WorkflowDefinition["runtime"];
  phases: Partial<Record<"prepare" | "validate" | "teardown", WorkflowPhaseDefinition>>;
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
  const service = "runtime";
  const phases = detectWorkflowPhases(resolvedProjectRoot);
  const servicesToStart = detectServicesToStart(resolvedProjectRoot, composeFile, service);
  return {
    projectRoot: resolvedProjectRoot,
    model: "minimax/MiniMax-M2.5",
    trackerProvider: "local",
    runtime: {
      provider: "docker_compose",
      composeFile,
      projectName: sanitizeProjectName(basename(resolvedProjectRoot)),
      service,
      workdir: "/workspace",
      build: false,
      ...(servicesToStart === undefined ? {} : { servicesToStart }),
    },
    phases,
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
    runtime: {
      ...options.runtime,
      composeFile: options.runtime.composeFile.trim(),
      projectName: options.runtime.projectName.trim(),
      service: options.runtime.service.trim(),
      ...(options.runtime.workdir === undefined ? {} : { workdir: options.runtime.workdir.trim() }),
      ...(options.runtime.servicesToStart === undefined ? {} : { servicesToStart: [...options.runtime.servicesToStart] }),
      ...(options.runtime.endpoints === undefined ? {} : { endpoints: { ...options.runtime.endpoints } }),
    },
    phases: options.phases ?? {},
  };
}

function detectComposeFile(projectRoot: string): string {
  const candidates = [
    "infra/docker-compose.local.yml",
    "infra/docker-compose.local.yaml",
    "docker-compose.local.yml",
    "docker-compose.local.yaml",
    "docker-compose.yml",
    "docker-compose.yaml",
  ];
  const found = candidates.find((candidate) => existsSync(join(projectRoot, candidate)));
  return found ?? "docker-compose.yml";
}

function detectWorkflowPhases(projectRoot: string): Partial<Record<"prepare" | "validate" | "teardown", WorkflowPhaseDefinition>> {
  const phases: Partial<Record<"prepare" | "validate" | "teardown", WorkflowPhaseDefinition>> = {};
  if (existsSync(join(projectRoot, "scripts", "piphony", "prepare.sh"))) {
    phases.prepare = {
      scope: "control_plane",
      command: "bash scripts/piphony/prepare.sh",
      timeoutSeconds: 2700,
    };
  }
  if (existsSync(join(projectRoot, "scripts", "piphony", "validate.sh"))) {
    phases.validate = {
      scope: "control_plane",
      command: "bash scripts/piphony/validate.sh",
      timeoutSeconds: 2700,
    };
  } else if (existsSync(join(projectRoot, "scripts", "piphony", "validate-runtime.sh"))) {
    phases.validate = {
      scope: "runtime",
      command: "bash scripts/piphony/validate-runtime.sh",
      timeoutSeconds: 2700,
    };
  }
  if (existsSync(join(projectRoot, "scripts", "piphony", "teardown.sh"))) {
    phases.teardown = {
      scope: "control_plane",
      command: "bash scripts/piphony/teardown.sh",
      timeoutSeconds: 2700,
    };
  }
  return phases;
}

function detectServicesToStart(projectRoot: string, composeFile: string, service: string): string[] | undefined {
  const normalized = composeFile.replace(/\\/g, "/");
  if (normalized === "infra/docker-compose.local.yml" && existsSync(join(projectRoot, composeFile))) {
    return [service, "convex-backend", "convex-dashboard", "web"];
  }
  return undefined;
}

function sanitizeProjectName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized === "" ? "piphony-project" : normalized;
}
