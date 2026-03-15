import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunLogger } from "../observability/logger.js";
import { errorMessage } from "../core/errors.js";
import type { ExecutionTarget } from "../core/types.js";
import type { WorkflowDefinition, WorkflowHookDefinition, WorkflowLifecycleHookName } from "./types.js";

const execFileAsync = promisify(execFile);

export interface WorkflowExecutorOptions {
  repoRoot: string;
  workflow: WorkflowDefinition;
  executionTarget: ExecutionTarget;
  logger?: RunLogger;
}

export class WorkflowExecutor {
  private readonly repoRoot: string;
  private readonly workflow: WorkflowDefinition;
  private readonly executionTarget: ExecutionTarget;
  private readonly logger: RunLogger | undefined;

  constructor(options: WorkflowExecutorOptions) {
    this.repoRoot = options.repoRoot;
    this.workflow = options.workflow;
    this.executionTarget = options.executionTarget;
    this.logger = options.logger;
  }

  async runHook(name: WorkflowLifecycleHookName): Promise<void> {
    const hook = this.workflow.lifecycle?.[name];
    if (hook === undefined) {
      return;
    }

    await this.logger?.emit("workflow.hook.started", {
      hook: name,
      scope: hook.scope,
      command: hook.command,
      service: hook.service,
    });

    const startedAt = Date.now();
    try {
      const output = hook.scope === "control_plane"
        ? await this.runOnControlPlane(hook)
        : await this.runInExecutionTarget(hook);
      await this.logger?.emit("workflow.hook.completed", {
        hook: name,
        scope: hook.scope,
        durationMs: Date.now() - startedAt,
        outputPreview: output.slice(-500),
      });
    } catch (error: unknown) {
      const message = errorMessage(error);
      await this.logger?.emit("workflow.hook.failed", {
        hook: name,
        scope: hook.scope,
        durationMs: Date.now() - startedAt,
        message,
      });
      throw error;
    }
  }

  private async runOnControlPlane(hook: WorkflowHookDefinition): Promise<string> {
    const env = hook.env === undefined ? process.env : { ...process.env, ...hook.env };
    const { stdout, stderr } = await execFileAsync("bash", ["-lc", hook.command], {
      cwd: this.repoRoot,
      env,
      timeout: (hook.timeoutSeconds ?? 20 * 60) * 1000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return [stdout.toString(), stderr.toString()].filter(Boolean).join("\n").trim();
  }

  private async runInExecutionTarget(hook: WorkflowHookDefinition): Promise<string> {
    const target = await this.executionTarget.selectTarget(
      hook.service === undefined ? undefined : { preferredService: hook.service },
    );
    const envPrefix = hook.env === undefined
      ? ""
      : `${Object.entries(hook.env)
        .map(([key, value]) => `${key}=${shellQuote(value)}`)
        .join(" ")} `;
    const result = await this.executionTarget.execOnTarget(target, `${envPrefix}${hook.command}`, {
      timeoutMs: (hook.timeoutSeconds ?? 20 * 60) * 1000,
    });
    if (result.exitCode !== 0) {
      throw new Error([result.stderr, result.stdout].filter(Boolean).join("\n") || `Workflow hook failed with exit code ${result.exitCode}`);
    }
    return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}
