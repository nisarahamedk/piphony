import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { attemptCleanup, errorMessage } from "../core/index.js";
import { createOnboardedOpenclawsseumProject, pickAvailablePort, type OnboardedSmokeFixtureProject } from "../fixtures/project.js";
import { startLocalPiphonyStack } from "../stack/local-stack.js";

interface CliFlags {
  fixture?: "openclawsseum";
  keepFixture: boolean;
}

interface DevStackRuntimeConfig {
  packageRoot: string;
  projectRoot: string;
  webPort: number;
  cosPort: number;
  fixture?: OnboardedSmokeFixtureProject;
}

// Load .env.local for development
const envLocalPath = resolve(process.cwd(), ".env.local");
try {
  const envContent = readFileSync(envLocalPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && !line.startsWith("#")) {
      process.env[match[1]!.trim()] = match[2]!.trim();
    }
  }
} catch {
  // Ignore if .env.local doesn't exist
}

let stopping = false;

function usage(): never {
  console.log([
    "Usage: tsx src/cli/dev-stack.ts [options]",
    "",
    "Options:",
    "  --fixture openclawsseum   Run the dev stack against a temp onboarded OpenClawsseum fixture repo",
    "  --keep-fixture            Keep the temp fixture repo on disk after shutdown",
    "  --help, -h                Show this help",
    "",
    "Environment:",
    "  PIPHONY_PROJECT_ROOT      Managed onboarded project root (ignored when --fixture is used)",
    "  PIPHONY_WEB_PORT          Web UI port (defaults to 3333, or an available port in fixture mode)",
    "  PIPHONY_COS_PORT          Chief of Staff port (defaults to 6521, or an available port in fixture mode)",
  ].join("\n"));
  process.exit(0);
}

function parseArgs(args: string[]): CliFlags {
  const flags: CliFlags = { keepFixture: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--fixture": {
        const value = args[index + 1];
        if (value !== "openclawsseum") {
          throw new Error("--fixture must be 'openclawsseum'");
        }
        flags.fixture = value;
        index += 1;
        break;
      }
      case "--keep-fixture":
        flags.keepFixture = true;
        break;
      case "--help":
      case "-h":
        usage();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return flags;
}

function startWebDev(input: { packageRoot: string; projectRoot: string; webPort: number }) {
  return spawn("npm", ["run", "web:dev", "--", "--port", String(input.webPort)], {
    cwd: input.packageRoot,
    env: {
      ...process.env,
      PIPHONY_PROJECT_ROOT: input.projectRoot,
      PIPHONY_REPO_ROOT: input.projectRoot,
    },
    stdio: "inherit",
  });
}

async function resolveRuntimeConfig(flags: CliFlags, packageRoot: string): Promise<DevStackRuntimeConfig> {
  if (flags.fixture === undefined) {
    return {
      packageRoot,
      projectRoot: resolve(process.env.PIPHONY_PROJECT_ROOT?.trim() || packageRoot),
      webPort: parsePositiveInteger(process.env.PIPHONY_WEB_PORT, 3333, "PIPHONY_WEB_PORT"),
      cosPort: parsePositiveInteger(process.env.PIPHONY_COS_PORT, 6521, "PIPHONY_COS_PORT"),
    };
  }

  if (process.env.PIPHONY_PROJECT_ROOT !== undefined && process.env.PIPHONY_PROJECT_ROOT.trim() !== "") {
    throw new Error("Cannot combine --fixture with PIPHONY_PROJECT_ROOT. The fixture command chooses the managed project root automatically.");
  }

  const fixture = await createOnboardedOpenclawsseumProject();
  const webPort = process.env.PIPHONY_WEB_PORT === undefined
    ? await pickAvailablePort()
    : parsePositiveInteger(process.env.PIPHONY_WEB_PORT, 3333, "PIPHONY_WEB_PORT");
  const cosPort = process.env.PIPHONY_COS_PORT === undefined
    ? await pickAvailablePort()
    : parsePositiveInteger(process.env.PIPHONY_COS_PORT, 6521, "PIPHONY_COS_PORT");

  return {
    packageRoot,
    projectRoot: fixture.projectRoot,
    webPort,
    cosPort,
    fixture,
  };
}

async function cleanupFixture(flags: CliFlags, fixture: OnboardedSmokeFixtureProject | undefined, reason: string): Promise<void> {
  if (fixture === undefined) {
    return;
  }
  if (flags.keepFixture) {
    console.log(`Keeping fixture repo (${reason}): ${fixture.projectRoot}`);
    return;
  }
  await attemptCleanup(
    "dev_stack.fixture.cleanup",
    () => fixture.cleanup(),
    (failure) => {
      console.error("dev_stack_fixture_cleanup_error", failure);
    },
  );
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const packageRoot = resolve(process.cwd());
  const runtime = await resolveRuntimeConfig(flags, packageRoot);

  let stack: Awaited<ReturnType<typeof startLocalPiphonyStack>> | undefined;
  let web: ReturnType<typeof startWebDev> | undefined;

  const shutdown = async (signal: string) => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`Piphony dev stack stopping (${signal})`);
    web?.kill("SIGTERM");
    if (stack !== undefined) {
      const activeStack = stack;
      await attemptCleanup(
        "dev_stack.stop",
        () => activeStack.stop(),
        (failure) => {
          console.error("dev_stack_shutdown_error", failure);
        },
      );
    }
    await cleanupFixture(flags, runtime.fixture, signal);
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  try {
    stack = await startLocalPiphonyStack({ repoRoot: runtime.projectRoot, cosPort: runtime.cosPort });
    web = startWebDev({ packageRoot: runtime.packageRoot, projectRoot: runtime.projectRoot, webPort: runtime.webPort });

    web.on("exit", (code, signal) => {
      if (!stopping) {
        console.log(`web dev exited (${signal ?? code ?? 0})`);
        void shutdown("web_exit");
      }
    });

    console.log("Piphony dev stack ready");
    console.log(`Project root: ${runtime.projectRoot}`);
    console.log(`Extensions: ${stack.extensionsPath}`);
    console.log(`Execution target: ${stack.executionTarget}`);
    if (runtime.fixture !== undefined) {
      console.log(`Fixture temp root: ${runtime.fixture.tempRoot}`);
      console.log(flags.keepFixture
        ? `Fixture cleanup: manual (kept on shutdown)`
        : "Fixture cleanup: automatic on shutdown");
    }
    console.log(`Web UI: http://127.0.0.1:${runtime.webPort}`);
    console.log(`CoS endpoint: ${stack.cosEndpoint}`);
    console.log(`Implementation worker mode: ${stack.workerMode}`);
    console.log(`Tracker provider: ${stack.trackerProvider}`);
    if (stack.trackerProjectKey !== undefined) {
      console.log(`Tracker project key: ${stack.trackerProjectKey}`);
    }
    if (stack.trackerBoardId !== undefined) {
      console.log(`Tracker board id: ${stack.trackerBoardId}`);
    }
    console.log("Open the web UI and use the Chief of Staff panel directly in the sidebar.");
  } catch (error) {
    if (stack !== undefined) {
      const activeStack = stack;
      await attemptCleanup(
        "dev_stack.start_failure.stop",
        () => activeStack.stop(),
        (failure) => {
          console.error("dev_stack_shutdown_error", failure);
        },
      );
    }
    await cleanupFixture(flags, runtime.fixture, "start_failure");
    throw error;
  }
}

function parsePositiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

main().catch((error) => {
  console.error("dev_stack_start_error", errorMessage(error));
  process.exit(1);
});
