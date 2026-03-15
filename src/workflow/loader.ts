import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseSupportedTrackerProvider } from "../tracker/types.js";
import type { WorkflowDefinition, WorkflowHookDefinition } from "./types.js";

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

export async function loadWorkflow(repoRoot: string) {
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

  validateExecution(workflow, path);

  if (workflow.lifecycle?.prepare !== undefined) {
    validateHook(path, "prepare", workflow.lifecycle.prepare);
  }
  if (workflow.lifecycle?.teardown !== undefined) {
    validateHook(path, "teardown", workflow.lifecycle.teardown);
  }
}

function validateExecution(workflow: WorkflowDefinition, path: string): void {
  const execution = workflow.execution;
  if (execution.kind === "host") {
    if (execution.workdir !== undefined && execution.workdir.trim() === "") {
      throw new Error(`Workflow execution workdir must not be empty when provided: ${path}`);
    }
    return;
  }

  if (execution.kind !== "docker_compose") {
    throw new Error(`Unsupported workflow execution kind in ${path}: ${String((execution as { kind?: unknown }).kind)}`);
  }
  if (execution.composeFile.trim() === "") {
    throw new Error(`Workflow docker_compose composeFile must not be empty: ${path}`);
  }
  if (execution.projectName.trim() === "") {
    throw new Error(`Workflow docker_compose projectName must not be empty: ${path}`);
  }
  if (execution.service.trim() === "") {
    throw new Error(`Workflow docker_compose service must not be empty: ${path}`);
  }
  if (execution.workdir !== undefined && execution.workdir.trim() === "") {
    throw new Error(`Workflow docker_compose workdir must not be empty when provided: ${path}`);
  }
}

function validateHook(path: string, hookName: string, hook: WorkflowHookDefinition): void {
  if (hook.command.trim() === "") {
    throw new Error(`Workflow hook '${hookName}' command must not be empty: ${path}`);
  }
  if (hook.scope === "control_plane") {
    assertHostedSafeControlPlaneCommand(hook.command, path, hookName);
  }
}

function assertHostedSafeControlPlaneCommand(command: string, path: string, hookName: string): void {
  const executable = extractLeadingExecutable(command);
  if (executable === undefined) {
    throw new Error(`Could not determine executable for control-plane hook '${hookName}' in ${path}`);
  }
  if (DISALLOWED_REPO_TOOLCHAIN_EXECUTABLES.has(executable)) {
    throw new Error(
      `Control-plane hook '${hookName}' in ${path} uses repo/toolchain executable '${executable}'. Move that work into the execution target.`,
    );
  }
  if (!ALLOWED_CONTROL_PLANE_EXECUTABLES.has(executable)) {
    throw new Error(
      `Control-plane hook '${hookName}' in ${path} must start with a hosted-safe executable (${[...ALLOWED_CONTROL_PLANE_EXECUTABLES].join(", ")}). Got '${executable}'.`,
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
