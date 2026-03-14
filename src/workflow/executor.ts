import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunLogger } from "../observability/logger.js";
import { errorMessage } from "../core/errors.js";
import type { RuntimeProvider } from "../core/types.js";
import type { WorkflowDefinition, WorkflowPhaseDefinition, WorkflowPhaseName } from "./types.js";

const execFileAsync = promisify(execFile);

export interface WorkflowExecutorOptions {
  repoRoot: string;
  workflow: WorkflowDefinition;
  runtimeProvider: RuntimeProvider;
  logger?: RunLogger;
}

export class WorkflowExecutor {
  private readonly repoRoot: string;
  private readonly workflow: WorkflowDefinition;
  private readonly runtimeProvider: RuntimeProvider;
  private readonly logger: RunLogger | undefined;

  constructor(options: WorkflowExecutorOptions) {
    this.repoRoot = options.repoRoot;
    this.workflow = options.workflow;
    this.runtimeProvider = options.runtimeProvider;
    this.logger = options.logger;
  }

  async runPhase(name: WorkflowPhaseName): Promise<void> {
    const phase = this.workflow.phases[name];
    if (phase === undefined) {
      return;
    }

    await this.logger?.emit("workflow.phase.started", {
      phase: name,
      scope: phase.scope,
      command: phase.command,
      service: phase.service,
    });

    const startedAt = Date.now();
    try {
      const output = phase.scope === "control_plane"
        ? await this.runOnControlPlane(phase)
        : await this.runInRuntime(phase);
      await this.logger?.emit("workflow.phase.completed", {
        phase: name,
        scope: phase.scope,
        durationMs: Date.now() - startedAt,
        outputPreview: output.slice(-500),
      });
    } catch (error: unknown) {
      const message = errorMessage(error);
      await this.logger?.emit("workflow.phase.failed", {
        phase: name,
        scope: phase.scope,
        durationMs: Date.now() - startedAt,
        message,
      });
      throw error;
    }
  }

  private async runOnControlPlane(phase: WorkflowPhaseDefinition): Promise<string> {
    const env = phase.env === undefined ? process.env : { ...process.env, ...phase.env };
    const { stdout, stderr } = await execFileAsync("bash", ["-lc", phase.command], {
      cwd: this.repoRoot,
      env,
      timeout: (phase.timeoutSeconds ?? 20 * 60) * 1000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return [stdout.toString(), stderr.toString()].filter(Boolean).join("\n").trim();
  }

  private async runInRuntime(phase: WorkflowPhaseDefinition): Promise<string> {
    const target = await this.runtimeProvider.selectTarget(
      phase.service === undefined ? undefined : { preferredService: phase.service },
    );
    const envPrefix = phase.env === undefined
      ? ""
      : `${Object.entries(phase.env)
        .map(([key, value]) => `${key}=${shellQuote(value)}`)
        .join(" ")} `;
    const result = await this.runtimeProvider.execOnTarget(target, `${envPrefix}${phase.command}`, {
      timeoutMs: (phase.timeoutSeconds ?? 20 * 60) * 1000,
    });
    if (result.exitCode !== 0) {
      throw new Error([result.stderr, result.stdout].filter(Boolean).join("\n") || `Workflow phase failed with exit code ${result.exitCode}`);
    }
    return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}
