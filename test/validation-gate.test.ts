import { describe, expect, it } from "vitest";
import {
  analyzeValidationResult,
  detectExternalDependencyBlocker,
  parseValidationSignal,
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

  it("parses trailing structured skip json from mixed logs", () => {
    const signal = parseValidationSignal([
      "some log line",
      JSON.stringify({ ok: true, skipped: true, reason: "provider_limit_reached" }, null, 2),
    ].join("\n"));

    expect(signal.skipped).toBe(true);
    expect(signal.skipReason).toBe("provider_limit_reached");
  });
});
