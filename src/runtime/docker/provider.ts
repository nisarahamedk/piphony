import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { ExecutionExecResult, ExecutionTarget, ExecutionTargetHandle } from "../../core/types.js";

const execFileAsync = promisify(execFile);

export interface DockerComposeExecutionTargetOptions {
  projectDir: string;
  composeFile: string;
  service: string;
  workdir?: string;
  projectName: string;
  endpoints?: Record<string, string>;
}

export class DockerComposeExecutionTarget implements ExecutionTarget {
  readonly name = "execution-docker-compose";
  private readonly projectDir: string;
  private readonly composeFile: string;
  private readonly service: string;
  private readonly workdir: string | undefined;
  private readonly projectName: string;
  private readonly endpoints: Record<string, string> | undefined;

  constructor(options: DockerComposeExecutionTargetOptions) {
    this.projectDir = resolve(options.projectDir);
    this.composeFile = resolve(options.composeFile);
    this.service = options.service;
    this.workdir = options.workdir;
    this.projectName = options.projectName;
    this.endpoints = options.endpoints;
  }

  async selectTarget(input?: { preferredService?: string }): Promise<ExecutionTargetHandle> {
    const service = input?.preferredService ?? this.service;
    const workdir = service === this.service ? this.workdir : undefined;
    return workdir === undefined
      ? { id: service, service }
      : { id: service, service, workdir };
  }

  async execOnTarget(target: ExecutionTargetHandle, command: string, options?: { cwd?: string; timeoutMs?: number }): Promise<ExecutionExecResult> {
    const cwd = options?.cwd ?? target.workdir;
    const wrapped = cwd === undefined ? command : `cd ${shellQuote(cwd)} && ${command}`;
    const startedAt = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync(
        "docker",
        [
          "compose",
          "-f",
          this.composeFile,
          "-p",
          this.projectName,
          "exec",
          "-T",
          target.service,
          "bash",
          "-lc",
          wrapped,
        ],
        {
          cwd: this.projectDir,
          timeout: options?.timeoutMs ?? 60_000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
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
    return ({ command, cwd, env }) => {
      const targetCwd = this.workdir ?? cwd;
      const remoteCommand = targetCwd === undefined ? command : `cd ${shellQuote(targetCwd)} && ${command}`;
      return {
        command: [
          "docker",
          "compose",
          "-f",
          this.composeFile,
          "-p",
          this.projectName,
          "exec",
          "-T",
          this.service,
          "bash",
          "-lc",
          shellQuote(remoteCommand),
        ].join(" "),
        cwd: this.projectDir,
        env,
      };
    };
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

export function maybeWithEndpoints<T extends object>(base: T, endpoints: Record<string, string> | undefined): T & Partial<{ endpoints: Record<string, string> }> {
  return endpoints === undefined ? base : { ...base, endpoints };
}
