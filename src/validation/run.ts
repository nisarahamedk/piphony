import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  analyzeValidationResult,
  DETERMINISTIC_VALIDATION_COMMANDS,
  LIVE_VALIDATION_COMMANDS,
  type ValidationCommandSpec,
  type ValidationLaneKind,
} from "./validation-gate.js";

const execFileAsync = promisify(execFile);

const lanes: Record<ValidationLaneKind, readonly ValidationCommandSpec[]> = {
  deterministic: DETERMINISTIC_VALIDATION_COMMANDS,
  live: LIVE_VALIDATION_COMMANDS,
};

function usage(): never {
  console.error("Usage: tsx src/validation/run.ts <deterministic|live>");
  process.exit(1);
}

function normalizeExecutionError(error: unknown): { code: number; stdout: string; stderr: string } {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      code: typeof candidate.code === "number" ? candidate.code : 1,
      stdout: typeof candidate.stdout === "string" ? candidate.stdout : "",
      stderr: typeof candidate.stderr === "string" ? candidate.stderr : String(error),
    };
  }
  return {
    code: 1,
    stdout: "",
    stderr: String(error),
  };
}

async function runCommand(spec: ValidationCommandSpec): Promise<void> {
  console.log(`\n==> ${spec.command}`);

  let code = 0;
  let stdout = "";
  let stderr = "";

  try {
    const result = await execFileAsync("bash", ["-lc", spec.command], {
      cwd: process.cwd(),
      maxBuffer: 20 * 1024 * 1024,
      timeout: 300_000,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const normalized = normalizeExecutionError(error);
    code = normalized.code;
    stdout = normalized.stdout;
    stderr = normalized.stderr;
  }

  if (stdout.trim() !== "") {
    process.stdout.write(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
  }
  if (stderr.trim() !== "") {
    process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
  }

  const analysis = analyzeValidationResult({
    lane: spec.lane,
    exitCode: code,
    stdout,
    stderr,
  });

  if (analysis.classification === "passed") {
    console.log(`validation_runner_passed lane=${spec.lane} command=${JSON.stringify(spec.command)}`);
    return;
  }

  if (analysis.classification === "external_transient") {
    console.error(
      `validation_runner_external_block lane=${spec.lane} command=${JSON.stringify(spec.command)} blocker=${analysis.blocker?.code ?? analysis.signal.skipReason ?? "external_dependency"}`,
    );
    console.error(analysis.blocker?.headline ?? "Live validation was blocked by an external dependency.");
    console.error(analysis.blocker?.escalationHint ?? "Ask the user to restore the external dependency and rerun this validation lane.");
    process.exit(1);
  }

  console.error(`validation_runner_failed lane=${spec.lane} command=${JSON.stringify(spec.command)} exitCode=${code}`);
  process.exit(code === 0 ? 1 : code);
}

const laneArg = process.argv[2];
if (laneArg !== "deterministic" && laneArg !== "live") {
  usage();
}

for (const spec of lanes[laneArg]) {
  await runCommand(spec);
}

console.log(`validation_runner_lane_passed lane=${laneArg}`);
