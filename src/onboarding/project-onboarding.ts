import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { generateEnvironmentExtension, generateTrackerExtension, type OnboardingEnvironmentTemplateInput } from "../extensions/templates.js";
import { createAgentModelOverrides, type AgentTypeOverride } from "../pi/agent-types.js";
import type { SupportedTrackerProvider } from "../tracker/types.js";

export interface OnboardProjectExecutionInput extends OnboardingEnvironmentTemplateInput {}

export interface OnboardProjectOptions {
  projectRoot: string;
  trackerProvider: SupportedTrackerProvider;
  trackerProjectKey?: string;
  trackerBoardId?: string;
  model: string;
  execution: OnboardProjectExecutionInput;
  force?: boolean;
}

export interface ProjectOnboardingDefaults {
  projectRoot: string;
  model: string;
  trackerProvider: SupportedTrackerProvider;
  execution: OnboardProjectExecutionInput;
}

export interface OnboardProjectResult {
  projectRoot: string;
  extensionsDir: string;
  environmentPath: string;
  trackerPath: string;
  agentTypesPath: string;
  agentOverrides: AgentTypeOverride[];
}

export function detectProjectOnboardingDefaults(projectRoot: string): ProjectOnboardingDefaults {
  const resolvedProjectRoot = resolve(projectRoot);
  const composeFile = detectComposeFile(resolvedProjectRoot);
  const prepareCommand = detectPrepareCommand(resolvedProjectRoot);
  const teardownCommand = detectTeardownCommand(resolvedProjectRoot);
  return {
    projectRoot: resolvedProjectRoot,
    model: "minimax/MiniMax-M2.5",
    trackerProvider: "local",
    execution: composeFile === undefined
      ? {
          kind: "host",
          workdir: resolvedProjectRoot,
          ...(prepareCommand === undefined ? {} : { prepareCommand }),
          ...(teardownCommand === undefined ? {} : { teardownCommand }),
        }
      : {
          kind: "docker_compose",
          composeFile,
          projectName: sanitizeProjectName(basename(resolvedProjectRoot)),
          service: "runtime",
          workdir: "/workspace",
          ...(prepareCommand === undefined ? {} : { prepareCommand }),
          ...(teardownCommand === undefined ? {} : { teardownCommand }),
        },
  };
}

export async function onboardProject(options: OnboardProjectOptions): Promise<OnboardProjectResult> {
  const projectRoot = resolve(options.projectRoot);
  const extensionsDir = resolve(join(projectRoot, ".piphony", "extensions"));
  const environmentPath = resolve(join(extensionsDir, "environment.ts"));
  const trackerPath = resolve(join(extensionsDir, "tracker.ts"));
  const agentTypesPath = resolve(join(projectRoot, ".piphony", "agent-types.json"));
  const legacyWorkflowPath = resolve(join(projectRoot, ".piphony", "workflow.json"));
  const legacyTrackerPath = resolve(join(projectRoot, ".piphony", "tracker.json"));
  const agentOverrides = createAgentModelOverrides(options.model);

  if (!options.force) {
    if (existsSync(environmentPath)) {
      throw new Error(`Refusing to overwrite existing environment extension: ${environmentPath}. Re-run with force=true to replace it.`);
    }
    if (existsSync(trackerPath)) {
      throw new Error(`Refusing to overwrite existing tracker extension: ${trackerPath}. Re-run with force=true to replace it.`);
    }
    if (existsSync(agentTypesPath)) {
      throw new Error(`Refusing to overwrite existing agent type config: ${agentTypesPath}. Re-run with force=true to replace it.`);
    }
  }

  await mkdir(extensionsDir, { recursive: true });
  await writeFile(environmentPath, `${generateEnvironmentExtension(options.execution)}\n`, "utf8");
  await writeFile(
    trackerPath,
    `${generateTrackerExtension({
      trackerProvider: options.trackerProvider,
      ...(options.trackerProjectKey === undefined ? {} : { trackerProjectKey: options.trackerProjectKey }),
      ...(options.trackerBoardId === undefined ? {} : { trackerBoardId: options.trackerBoardId }),
    })}\n`,
    "utf8",
  );
  await writeFile(agentTypesPath, `${JSON.stringify({ agents: agentOverrides }, null, 2)}\n`, "utf8");

  await rm(legacyWorkflowPath, { force: true });
  await rm(legacyTrackerPath, { force: true });

  return {
    projectRoot,
    extensionsDir,
    environmentPath,
    trackerPath,
    agentTypesPath,
    agentOverrides,
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

function detectPrepareCommand(projectRoot: string): string | undefined {
  if (existsSync(join(projectRoot, "scripts", "piphony", "stack-prepare.sh"))) {
    return "bash scripts/piphony/stack-prepare.sh";
  }
  if (existsSync(join(projectRoot, "scripts", "piphony", "prepare.sh"))) {
    return "bash scripts/piphony/prepare.sh";
  }
  return undefined;
}

function detectTeardownCommand(projectRoot: string): string | undefined {
  return existsSync(join(projectRoot, "scripts", "piphony", "teardown.sh"))
    ? "bash scripts/piphony/teardown.sh"
    : undefined;
}

function sanitizeProjectName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized === "" ? "piphony-project" : normalized;
}
