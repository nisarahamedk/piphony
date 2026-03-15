import { describe, expect, it } from "vitest";
import {
  analyzeValidationResult,
  detectExternalDependencyBlocker,
  parseValidationSignal,
  resolveValidationCommands,
} from "../src/validation/validation-gate.js";

describe("validation gate classification", () => {
  it("classifies structured live skips as external transient blockers", () => {
    const result = analyzeValidationResult({
      lane: "live",
      exitCode: 0,
      stdout: JSON.stringify({ ok: true, skipped: true, reason: "pi_session_unavailable" }),
      stderr: "",
    });

    expect(result.classification).toBe("external_transient");
    expect(result.signal.skipped).toBe(true);
    expect(result.signal.skipReason).toBe("pi_session_unavailable");
  });

  it("classifies provider limit failures as external transient blockers", () => {
    const result = analyzeValidationResult({
      lane: "live",
      exitCode: 1,
      stdout: "Provider Limit Reached",
      stderr: "The provider is currently at its usage limit.",
    });

    expect(result.classification).toBe("external_transient");
    expect(result.blocker?.code).toBe("provider_limit_reached");
  });

  it("keeps deterministic failures fixable even when no external blocker is detected", () => {
    const result = analyzeValidationResult({
      lane: "deterministic",
      exitCode: 2,
      stdout: "",
      stderr: "src/example.ts(1,1): error TS1005: ';' expected.",
    });

    expect(result.classification).toBe("failed");
    expect(result.blocker).toBeUndefined();
  });

  it("detects auth blockers from provider error text", () => {
    const blocker = detectExternalDependencyBlocker(
      '403 {"type":"error","error":{"type":"permission_error","message":"OAuth authentication is currently not allowed for this organization."}}',
    );

    expect(blocker?.code).toBe("provider_auth_blocked");
  });

  it("detects docker daemon blockers from runtime smoke output", () => {
    const blocker = detectExternalDependencyBlocker(
      "Cannot connect to the Docker daemon at unix:///Users/example/.docker/run/docker.sock. Is the docker daemon running?",
    );

    expect(blocker?.code).toBe("docker_unavailable");
  });

  it("detects unavailable pinned model blockers from live smoke output", () => {
    const blocker = detectExternalDependencyBlocker(
      "Requested model 'minimax/MiniMax-M2.5' is not available. Available models: openai-codex/gpt-5.4",
    );

    expect(blocker?.code).toBe("provider_unavailable");
  });

  it("parses trailing structured skip json from mixed logs", () => {
    const signal = parseValidationSignal([
      "some log line",
      JSON.stringify({ ok: true, skipped: true, reason: "provider_limit_reached" }, null, 2),
    ].join("\n"));

    expect(signal.skipped).toBe(true);
    expect(signal.skipReason).toBe("provider_limit_reached");
  });

  it("adds live tracker validation commands only when provider env is configured", () => {
    const baseCommands = resolveValidationCommands("live", {});
    expect(baseCommands.map((command) => command.command)).toEqual([
      "npm run smoke:cos",
      "npm run smoke:stack",
      "npm run smoke:session-control",
    ]);

    const withLinear = resolveValidationCommands("live", {
      PIPHONY_LINEAR_API_KEY: "key",
      PIPHONY_LINEAR_TEAM_KEY: "ENG",
    });
    expect(withLinear.map((command) => command.command)).toContain("npm run smoke:tracker-live:linear");

    const withJira = resolveValidationCommands("live", {
      PIPHONY_JIRA_BASE_URL: "https://acme.atlassian.net",
      PIPHONY_JIRA_EMAIL: "jira@example.com",
      PIPHONY_JIRA_API_TOKEN: "token",
      PIPHONY_JIRA_PROJECT_KEY: "PROJ",
    });
    expect(withJira.map((command) => command.command)).toContain("npm run smoke:tracker-live:jira");
  });
});
