import { describe, expect, test } from "vitest";
import { parseOrchestratorWatchConfig } from "../src/cli/orchestrator-watch-config.js";
import { parseStatusCliConfig } from "../src/cli/status-config.js";
import { resolveLocalPiphonyStackConfig } from "../src/stack/local-stack-config.js";

describe("config parsing", () => {
  test("parses orchestrator watch config from env with canonical repo paths", () => {
    const config = parseOrchestratorWatchConfig({
      PIPHONY_POLL_INTERVAL_MS: "5000",
      PIPHONY_MAX_CONCURRENT_WORKERS: "3",
      PIPHONY_ORCHESTRATOR_ID: "orch-123",
    }, "/repo");

    expect(config.repoRoot).toBe("/repo");
    expect(config.runsRootDir).toBe("/repo/.piphony/runs");
    expect(config.trackerDir).toBe("/repo/.piphony/tracker-local");
    expect(config.pollIntervalMs).toBe(5000);
    expect(config.maxConcurrentWorkers).toBe(3);
    expect(config.instanceId).toBe("orch-123");
  });

  test("rejects invalid positive integer env values", () => {
    expect(() => parseOrchestratorWatchConfig({ PIPHONY_POLL_INTERVAL_MS: "0" }, "/repo")).toThrow(
      "PIPHONY_POLL_INTERVAL_MS must be a positive integer",
    );
    expect(() => resolveLocalPiphonyStackConfig({}, { PIPHONY_MAX_CONCURRENT_WORKERS: "-2" })).toThrow(
      "PIPHONY_MAX_CONCURRENT_WORKERS must be a positive integer",
    );
  });

  test("resolves local stack config from explicit options before env", () => {
    const config = resolveLocalPiphonyStackConfig({
      repoRoot: "/workspace",
      trackerDir: "/state/tracker",
      runsRootDir: "/state/runs",
      sessionRootDir: "/state/sessions",
      pollIntervalMs: 7000,
      maxConcurrentWorkers: 4,
      instanceId: "stack-1",
      cosHost: "0.0.0.0",
      cosPort: 7001,
    }, {
      PIPHONY_POLL_INTERVAL_MS: "3000",
      PIPHONY_MAX_CONCURRENT_WORKERS: "1",
      PIPHONY_ORCHESTRATOR_ID: "ignored",
    });

    expect(config.repoRoot).toBe("/workspace");
    expect(config.trackerDir).toBe("/state/tracker");
    expect(config.runsRootDir).toBe("/state/runs");
    expect(config.sessionRootDir).toBe("/state/sessions");
    expect(config.pollIntervalMs).toBe(7000);
    expect(config.maxConcurrentWorkers).toBe(4);
    expect(config.instanceId).toBe("stack-1");
    expect(config.cosHost).toBe("0.0.0.0");
    expect(config.cosPort).toBe(7001);
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
});
