import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { RuntimeExecResult, RuntimeProvider, RuntimeTarget, WorkItem } from "../../core/types.js";

const execFileAsync = promisify(execFile);

export interface DockerRuntimeOptions {
  projectDir: string;
  composeFile: string;
  service: string;
  workdir?: string;
  projectName: string;
  endpoints?: Record<string, string>;
  build: boolean;
  servicesToStart?: string[];
}

export class DockerComposeRuntimeProvider implements RuntimeProvider {
  readonly name = "runtime-docker";
  private readonly projectDir: string;
  private readonly composeFile: string;
  private readonly service: string;
  private readonly workdir: string | undefined;
  private readonly projectName: string;
  private readonly endpoints: Record<string, string> | undefined;
  private readonly build: boolean;
  private readonly servicesToStart: string[] | undefined;

  constructor(options: DockerRuntimeOptions) {
    this.projectDir = resolve(options.projectDir);
    this.composeFile = resolve(options.composeFile);
    this.service = options.service;
    this.workdir = options.workdir;
    this.projectName = options.projectName;
    this.endpoints = options.endpoints;
    this.build = options.build;
    this.servicesToStart = options.servicesToStart;
  }

  async prepare(_input: { runId: string; workItem: WorkItem }): Promise<void> {
    if (!existsSync(this.composeFile)) {
      throw new Error(`Docker Compose file not found: ${this.composeFile}`);
    }
  }

  async start(): Promise<void> {
    await this.runCompose(["up", "-d", ...(this.build ? ["--build"] : []), ...(this.servicesToStart ?? [])]);
  }

  async waitUntilReady(): Promise<void> {
    await this.runCompose(["ps"]);
    const target = await this.selectTarget();
    const result = await this.execOnTarget(target, "pwd", { timeoutMs: 30_000 });
    if (result.exitCode !== 0) {
      throw new Error(`Runtime target not ready: ${result.stderr || result.stdout}`);
    }
  }

  async selectTarget(input?: { preferredService?: string }): Promise<RuntimeTarget> {
    const service = input?.preferredService ?? this.service;
    const workdir = service === this.service ? this.workdir : undefined;
    return workdir === undefined
      ? { id: service, service }
      : { id: service, service, workdir };
  }

  async execOnTarget(target: RuntimeTarget, command: string, options?: { cwd?: string; timeoutMs?: number }): Promise<RuntimeExecResult> {
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

  async stop(): Promise<void> {
    await this.runCompose(["stop"]);
  }

  async destroy(): Promise<void> {
    await this.runCompose(["down", "-v", "--remove-orphans"]);
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

  private async runCompose(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "-f", this.composeFile, "-p", this.projectName, ...args],
      {
        cwd: this.projectDir,
        timeout: 20 * 60_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return stdout.toString();
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

export function maybeWithEndpoints<T extends object>(base: T, endpoints: Record<string, string> | undefined): T & Partial<{ endpoints: Record<string, string> }> {
  return endpoints === undefined ? base : { ...base, endpoints };
}
