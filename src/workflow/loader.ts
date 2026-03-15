import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseSupportedTrackerProvider } from "../tracker/types.js";
import type { WorkflowDefinition, WorkflowLoadResult, WorkflowPhaseDefinition } from "./types.js";

const ALLOWED_CONTROL_PLANE_EXECUTABLES = new Set([
  "bash",
  "sh",
  "git",
  "gh",
  "docker",
  "docker-compose",
  "curl",
  "env",
  "timeout",
]);

const DISALLOWED_REPO_TOOLCHAIN_EXECUTABLES = new Set([
  "pnpm",
  "npm",
  "npx",
  "yarn",
  "bun",
  "node",
  "tsx",
  "ts-node",
  "tsc",
  "python",
  "python3",
  "pip",
  "pip3",
  "poetry",
  "ruby",
  "bundle",
  "cargo",
  "go",
  "java",
  "javac",
  "mvn",
  "gradle",
  "dotnet",
]);

export function resolveWorkflowPath(repoRoot: string): string {
  return resolve(join(repoRoot, ".piphony", "workflow.json"));
}

export function readWorkflowSync(repoRoot: string): WorkflowDefinition | undefined {
  const path = resolveWorkflowPath(repoRoot);
  if (!existsSync(path)) {
    return undefined;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as WorkflowDefinition;
  validateWorkflow(parsed, path);
  return parsed;
}

export async function loadWorkflow(repoRoot: string): Promise<WorkflowLoadResult> {
  const path = resolveWorkflowPath(repoRoot);
  if (!existsSync(path)) {
    throw new Error(`Workflow file not found: ${path}`);
  }
  const parsed = JSON.parse(await readFile(path, "utf8")) as WorkflowDefinition;
  validateWorkflow(parsed, path);
  return { repoRoot: resolve(repoRoot), path, workflow: parsed };
}

function validateWorkflow(workflow: WorkflowDefinition, path: string): void {
  if (workflow.version !== 1) {
    throw new Error(`Unsupported workflow version in ${path}: ${String((workflow as { version?: unknown }).version)}`);
  }
  if (workflow.tracker !== undefined) {
    parseSupportedTrackerProvider(workflow.tracker.provider, "local");
    if (workflow.tracker.projectKey !== undefined && workflow.tracker.projectKey.trim() === "") {
      throw new Error(`Workflow tracker projectKey must not be empty when provided: ${path}`);
    }
    if (workflow.tracker.boardId !== undefined && workflow.tracker.boardId.trim() === "") {
      throw new Error(`Workflow tracker boardId must not be empty when provided: ${path}`);
    }
  }
  if (workflow.runtime.provider !== "docker_compose") {
    throw new Error(`Unsupported workflow runtime provider in ${path}: ${String((workflow.runtime as { provider?: unknown }).provider)}`);
  }
  if (workflow.runtime.composeFile.trim() === "") {
    throw new Error(`Workflow runtime composeFile must not be empty: ${path}`);
  }
  if (workflow.runtime.projectName.trim() === "") {
    throw new Error(`Workflow runtime projectName must not be empty: ${path}`);
  }
  if (workflow.runtime.service.trim() === "") {
    throw new Error(`Workflow runtime service must not be empty: ${path}`);
  }
  for (const [phaseName, phase] of Object.entries(workflow.phases)) {
    if (phase === undefined) {
      continue;
    }
    validatePhase(path, phaseName, phase);
  }
}

function validatePhase(path: string, phaseName: string, phase: WorkflowPhaseDefinition): void {
  if (phase.command.trim() === "") {
    throw new Error(`Workflow phase '${phaseName}' command must not be empty: ${path}`);
  }
  if (phase.scope === "control_plane") {
    assertHostedSafeControlPlaneCommand(phase.command, path, phaseName);
  }
}

function assertHostedSafeControlPlaneCommand(command: string, path: string, phaseName: string): void {
  const executable = extractLeadingExecutable(command);
  if (executable === undefined) {
    throw new Error(`Could not determine executable for control-plane phase '${phaseName}' in ${path}`);
  }
  if (DISALLOWED_REPO_TOOLCHAIN_EXECUTABLES.has(executable)) {
    throw new Error(
      `Control-plane phase '${phaseName}' in ${path} uses repo/toolchain executable '${executable}'. Move that work into the runtime.`,
    );
  }
  if (!ALLOWED_CONTROL_PLANE_EXECUTABLES.has(executable)) {
    throw new Error(
      `Control-plane phase '${phaseName}' in ${path} must start with a hosted-safe executable (${[...ALLOWED_CONTROL_PLANE_EXECUTABLES].join(", ")}). Got '${executable}'.`,
    );
  }
}

function extractLeadingExecutable(command: string): string | undefined {
  const trimmed = command.trim();
  if (trimmed === "") {
    return undefined;
  }
  const match = trimmed.match(/^[A-Za-z0-9_.-]+/);
  return match === null ? undefined : match[0];
}
