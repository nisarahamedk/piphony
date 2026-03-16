import { resolve } from "node:path";
import type { ExecutionTarget } from "../core/types.js";
import { createExecutionTargetFromWorkflow } from "../workflow/runtime-provider.js";
import { loadWorkflow, resolveWorkflowPath } from "../workflow/loader.js";
import type { WorkflowDefinition } from "../workflow/types.js";

export interface ProjectExecutionContext {
  readonly projectRoot: string;
  readonly workflowPath: string;
  readonly workflow: WorkflowDefinition;
  readonly executionTarget: ExecutionTarget;
}

export interface LoadProjectExecutionOptions {
  transformWorkflow?: (workflow: WorkflowDefinition) => WorkflowDefinition;
}

export async function loadOnboardedProjectExecution(
  projectRoot: string,
  options: LoadProjectExecutionOptions = {},
): Promise<ProjectExecutionContext> {
  const resolvedProjectRoot = resolve(projectRoot);
  try {
    const loaded = await loadWorkflow(resolvedProjectRoot);
    const workflow = options.transformWorkflow === undefined
      ? loaded.workflow
      : options.transformWorkflow(loaded.workflow);
    return {
      projectRoot: loaded.repoRoot,
      workflowPath: loaded.path,
      workflow,
      executionTarget: createExecutionTargetFromWorkflow(loaded.repoRoot, workflow),
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Workflow file not found:")) {
      const workflowPath = resolveWorkflowPath(resolvedProjectRoot);
      throw new Error(
        `Project is not onboarded. Expected workflow config at ${workflowPath}. Run 'npm run onboard' inside the managed repo first.`,
      );
    }
    throw error;
  }
}
