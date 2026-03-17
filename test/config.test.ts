import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseOrchestratorWatchConfig } from "../src/cli/orchestrator-watch-config.js";
import { resolveTrackerSelectionConfig } from "../src/config/tracker-provider.js";
import { parseStatusCliConfig } from "../src/cli/status-config.js";
import { resolveLocalPiphonyStackConfig } from "../src/stack/local-stack-config.js";
import { detectProjectOnboardingDefaults, onboardProject } from "../src/onboarding/project-onboarding.js";

async function createOnboardedProject(trackerProvider: "local" | "linear" | "jira" = "local") {
  const projectRoot = await mkdtemp(join(tmpdir(), "piphony-config-project-"));
  await mkdir(join(projectRoot, "infra"), { recursive: true });
  await writeFile(join(projectRoot, "infra", "docker-compose.local.yml"), "services: {}\n", "utf8");
  const defaults = detectProjectOnboardingDefaults(projectRoot);
  await onboardProject({
    projectRoot,
    trackerProvider,
    ...(trackerProvider === "local" ? {} : { trackerProjectKey: "PROJ" }),
    ...(trackerProvider === "jira" ? { trackerBoardId: "17" } : {}),
    model: defaults.model,
    execution: defaults.execution,
  });
  return projectRoot;
}

describe("config parsing", () => {
  test("parses orchestrator watch config from env with canonical repo paths", async () => {
    const projectRoot = await createOnboardedProject();
    const config = parseOrchestratorWatchConfig({
      PIPHONY_POLL_INTERVAL_MS: "5000",
      PIPHONY_MAX_CONCURRENT_WORKERS: "3",
      PIPHONY_ORCHESTRATOR_ID: "orch-123",
      PIPHONY_STACK_WORKER_MODE: "smoke",
    }, projectRoot);

    expect(config.repoRoot).toBe(projectRoot);
    expect(config.runsRootDir).toBe(`${projectRoot}/.piphony/runs`);
    expect(config.trackerDir).toBe(`${projectRoot}/.piphony/tracker-local`);
    expect(config.pollIntervalMs).toBe(5000);
    expect(config.maxConcurrentWorkers).toBe(3);
    expect(config.instanceId).toBe("orch-123");
    expect(config.workerMode).toBe("smoke");
    expect(config.trackerProvider).toBe("local");
  });

  test("rejects invalid positive integer env values", async () => {
    const projectRoot = await createOnboardedProject();
    expect(() => parseOrchestratorWatchConfig({ PIPHONY_POLL_INTERVAL_MS: "0" }, projectRoot)).toThrow(
      "PIPHONY_POLL_INTERVAL_MS must be a positive integer",
    );
    expect(() => resolveLocalPiphonyStackConfig({ repoRoot: projectRoot }, { PIPHONY_MAX_CONCURRENT_WORKERS: "-2" })).toThrow(
      "PIPHONY_MAX_CONCURRENT_WORKERS must be a positive integer",
    );
    expect(() => resolveLocalPiphonyStackConfig({ repoRoot: projectRoot }, { PIPHONY_STACK_WORKER_MODE: "weird" })).toThrow(
      "PIPHONY_STACK_WORKER_MODE must be one of: real, smoke",
    );
  });

  test("resolves local stack config from explicit options before env", async () => {
    const projectRoot = await createOnboardedProject();
    const config = resolveLocalPiphonyStackConfig({
      repoRoot: projectRoot,
      trackerDir: "/state/tracker",
      runsRootDir: "/state/runs",
      sessionRootDir: "/state/sessions",
      pollIntervalMs: 7000,
      maxConcurrentWorkers: 4,
      instanceId: "stack-1",
      cosHost: "0.0.0.0",
      cosPort: 7001,
      workerMode: "smoke",
    }, {
      PIPHONY_POLL_INTERVAL_MS: "3000",
      PIPHONY_MAX_CONCURRENT_WORKERS: "1",
      PIPHONY_ORCHESTRATOR_ID: "ignored",
    });

    expect(config.repoRoot).toBe(projectRoot);
    expect(config.trackerDir).toBe("/state/tracker");
    expect(config.runsRootDir).toBe("/state/runs");
    expect(config.sessionRootDir).toBe("/state/sessions");
    expect(config.pollIntervalMs).toBe(7000);
    expect(config.maxConcurrentWorkers).toBe(4);
    expect(config.instanceId).toBe("stack-1");
    expect(config.cosHost).toBe("0.0.0.0");
    expect(config.cosPort).toBe(7001);
    expect(config.workerMode).toBe("smoke");
    expect(config.trackerProvider).toBe("local");
  });

  test("parses shared tracker selection config from extensions", async () => {
    const jiraProjectRoot = await createOnboardedProject("jira");
    const config = resolveTrackerSelectionConfig({}, jiraProjectRoot);

    expect(config.trackerProvider).toBe("jira");
    expect(config.trackerProjectKey).toBe("PROJ");
    expect(config.trackerBoardId).toBe("17");
  });

  test("parses status cli args and rejects missing run id values", () => {
    const latest = parseStatusCliConfig([], "/repo");
    expect(latest.latest).toBe(true);
    expect(latest.runsRootDir).toBe("/repo/.piphony/runs");

    const explicit = parseStatusCliConfig(["--run-id", "run-123", "--runs-root-dir", "/tmp/runs"], "/repo");
    expect(explicit.latest).toBe(false);
    expect(explicit.runId).toBe("run-123");
    expect(explicit.runsRootDir).toBe("/tmp/runs");

    expect(() => parseStatusCliConfig(["--run-id"], "/repo")).toThrow("--run-id requires a value");
    expect(() => parseStatusCliConfig(["--runs-root-dir"], "/repo")).toThrow("--runs-root-dir requires a value");
  });

  test("resolves tracker selection config with env overrides taking precedence over extension defaults", async () => {
    const jiraProjectRoot = await createOnboardedProject("jira");

    // Extension defaults to jira with projectKey=PROJ, boardId=17
    const defaultConfig = resolveTrackerSelectionConfig({}, jiraProjectRoot);
    expect(defaultConfig.trackerProvider).toBe("jira");
    expect(defaultConfig.trackerProjectKey).toBe("PROJ");
    expect(defaultConfig.trackerBoardId).toBe("17");

    // Env override for provider
    const envProviderOverride = resolveTrackerSelectionConfig(
      { PIPHONY_TRACKER_PROVIDER: "linear" },
      jiraProjectRoot,
    );
    expect(envProviderOverride.trackerProvider).toBe("linear");
    expect(envProviderOverride.trackerProjectKey).toBe("PROJ"); // preserved from extension

    // Env override for projectKey
    const envProjectKeyOverride = resolveTrackerSelectionConfig(
      { PIPHONY_TRACKER_PROJECT_KEY: "OVERRIDE" },
      jiraProjectRoot,
    );
    expect(envProjectKeyOverride.trackerProvider).toBe("jira");
    expect(envProjectKeyOverride.trackerProjectKey).toBe("OVERRIDE");
    expect(envProjectKeyOverride.trackerBoardId).toBe("17"); // preserved from extension

    // Multiple env overrides
    const fullEnvOverride = resolveTrackerSelectionConfig(
      { PIPHONY_TRACKER_PROVIDER: "local", PIPHONY_TRACKER_PROJECT_KEY: "KEY", PIPHONY_TRACKER_BOARD_ID: "99" },
      jiraProjectRoot,
    );
    expect(fullEnvOverride.trackerProvider).toBe("local");
    expect(fullEnvOverride.trackerProjectKey).toBe("KEY");
    expect(fullEnvOverride.trackerBoardId).toBe("99");
  });

  test("rejects invalid tracker provider env value", async () => {
    const projectRoot = await createOnboardedProject();
    expect(() =>
      resolveTrackerSelectionConfig({ PIPHONY_TRACKER_PROVIDER: "invalid" }, projectRoot),
    ).toThrow("Unsupported tracker provider: invalid. Supported providers: local, linear, jira");
  });

  test("local stack config uses resolved tracker selection with env overrides", async () => {
    const jiraProjectRoot = await createOnboardedProject("jira");

    // Without env override - uses extension defaults
    const configNoEnv = resolveLocalPiphonyStackConfig({ repoRoot: jiraProjectRoot }, {});
    expect(configNoEnv.trackerProvider).toBe("jira");
    expect(configNoEnv.trackerProjectKey).toBe("PROJ");

    // With env override
    const configWithEnv = resolveLocalPiphonyStackConfig(
      { repoRoot: jiraProjectRoot },
      { PIPHONY_TRACKER_PROVIDER: "linear", PIPHONY_TRACKER_PROJECT_KEY: "ENV_KEY" },
    );
    expect(configWithEnv.trackerProvider).toBe("linear");
    expect(configWithEnv.trackerProjectKey).toBe("ENV_KEY");
  });
});
