import { execFile, spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { repoRoot } from "./_common.js";

const execFileAsync = promisify(execFile);

export function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/\u001b\(B/g, "");
}

export async function runSmokeShell(command: string, options?: { cwd?: string; timeoutMs?: number }): Promise<string> {
  const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
    cwd: options?.cwd ?? repoRoot,
    timeout: options?.timeoutMs ?? 120_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stripAnsi([stdout.toString(), stderr.toString()].filter(Boolean).join("\n").trim());
}

export async function waitForHttp(url: string, attempts = 180): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(1_000);
  }
  throw new Error(`service_not_ready:${url}`);
}

export function startSmokeWebServer(input: { projectRoot: string; webPort: number }): ChildProcess {
  return spawn("npm", ["run", "web:dev", "--", "--port", String(input.webPort)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PIPHONY_PROJECT_ROOT: input.projectRoot,
      PIPHONY_REPO_ROOT: input.projectRoot,
    },
    stdio: "inherit",
  });
}

export function startSmokeDevStack(input: {
  projectRoot: string;
  webPort: number;
  cosPort: number;
  workerMode?: string;
}): ChildProcess {
  return spawn("npm", ["run", "dev:stack"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PIPHONY_STACK_WORKER_MODE: input.workerMode ?? "smoke",
      PIPHONY_PROJECT_ROOT: input.projectRoot,
      PIPHONY_WEB_PORT: String(input.webPort),
      PIPHONY_COS_PORT: String(input.cosPort),
    },
    stdio: "inherit",
  });
}

export async function stopSmokeProcess(process: ChildProcess, timeoutMs = 10_000): Promise<void> {
  if (process.exitCode !== null) {
    return;
  }

  const exited = new Promise<void>((resolve) => {
    process.once("exit", () => resolve());
  });

  process.kill("SIGTERM");
  const timedOut = sleep(timeoutMs).then(() => false);
  const exitedGracefully = exited.then(() => true);
  if (await Promise.race([exitedGracefully, timedOut])) {
    return;
  }

  if (process.exitCode === null) {
    process.kill("SIGKILL");
  }
  await exited;
}
