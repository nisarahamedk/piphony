import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExecutionExecResult, ExecutionTarget, ExecutionTargetHandle } from "../../core/types.js";

const execFileAsync = promisify(execFile);

export interface HostExecutionTargetOptions {
  projectDir: string;
  workdir?: string;
  endpoints?: Record<string, string>;
}

export class HostExecutionTarget implements ExecutionTarget {
  readonly name = "execution-host";
  private readonly projectDir: string;
  private readonly workdir: string | undefined;
  private readonly endpoints: Record<string, string> | undefined;

  constructor(options: HostExecutionTargetOptions) {
    this.projectDir = options.projectDir;
    this.workdir = options.workdir;
    this.endpoints = options.endpoints;
  }

  async selectTarget(): Promise<ExecutionTargetHandle> {
    return this.workdir === undefined
      ? { id: "host", service: "host" }
      : { id: "host", service: "host", workdir: this.workdir };
  }

  async execOnTarget(_target: ExecutionTargetHandle, command: string, options?: { cwd?: string; timeoutMs?: number }): Promise<ExecutionExecResult> {
    const startedAt = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
        cwd: options?.cwd ?? this.workdir ?? this.projectDir,
        timeout: options?.timeoutMs ?? 60_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        exitCode: 0,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        durationMs: Date.now() - startedAt,
      };
    } catch (error: unknown) {
      const anyError = error as { code?: number; message?: string; stdout?: { toString(): string }; stderr?: { toString(): string } };
      return {
        exitCode: anyError.code ?? 1,
        stdout: anyError.stdout?.toString() ?? "",
        stderr: anyError.stderr?.toString() ?? anyError.message ?? "",
        durationMs: Date.now() - startedAt,
      };
    }
  }

  async getEndpoints(): Promise<Record<string, string>> {
    return this.endpoints ?? {};
  }

  async collectArtifacts(_destinationDir: string): Promise<string[]> {
    return [];
  }

  createBashSpawnHook(): ({ command, cwd, env }: { command: string; cwd: string; env: Record<string, string | undefined> }) => { command: string; cwd: string; env: Record<string, string | undefined> } {
    return ({ command, cwd, env }) => ({
      command,
      cwd: this.workdir ?? cwd,
      env,
    });
  }
}
