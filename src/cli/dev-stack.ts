import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { attemptCleanup, errorMessage } from "../core/index.js";
import { startLocalPiphonyStack } from "../stack/local-stack.js";

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

const repoRoot = resolve(process.cwd());
let stopping = false;

function startWebDev() {
  return spawn("npm", ["run", "web:dev"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
}

async function main() {
  const stack = await startLocalPiphonyStack({ repoRoot });
  const web = startWebDev();

  const shutdown = async (signal: string) => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`Piphony dev stack stopping (${signal})`);
    web.kill("SIGTERM");
    await attemptCleanup(
      "dev_stack.stop",
      () => stack.stop(),
      (failure) => {
        console.error("dev_stack_shutdown_error", failure);
      },
    );
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  web.on("exit", (code, signal) => {
    if (!stopping) {
      console.log(`web dev exited (${signal ?? code ?? 0})`);
      void shutdown("web_exit");
    }
  });

  console.log("Piphony dev stack ready");
  console.log(`Web UI: http://127.0.0.1:3333`);
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
}

main().catch((error) => {
  console.error("dev_stack_start_error", errorMessage(error));
  process.exit(1);
});
