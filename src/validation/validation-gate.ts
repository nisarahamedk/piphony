export type ValidationLaneKind = "deterministic" | "live";

export interface ValidationCommandSpec {
  readonly command: string;
  readonly lane: ValidationLaneKind;
  readonly shouldRun?: (env: NodeJS.ProcessEnv) => boolean;
}

import { hasJiraTrackerLiveValidationConfig, hasLinearTrackerLiveValidationConfig } from "../tracker/live-validation.js";

export type ValidationResultClassification = "passed" | "failed" | "external_transient";

export interface ExternalDependencyBlocker {
  readonly code:
    | "provider_limit_reached"
    | "provider_rate_limited"
    | "provider_capacity_unavailable"
    | "provider_auth_blocked"
    | "provider_unavailable";
  readonly headline: string;
  readonly escalationHint: string;
}

export interface ValidationSignal {
  readonly skipped: boolean;
  readonly skipReason?: string;
}

export interface ValidationResultAnalysis {
  readonly classification: ValidationResultClassification;
  readonly signal: ValidationSignal;
  readonly blocker?: ExternalDependencyBlocker;
}

export const DETERMINISTIC_VALIDATION_COMMANDS: readonly ValidationCommandSpec[] = [
  { command: "npm run typecheck", lane: "deterministic" },
  { command: "npm test", lane: "deterministic" },
  { command: "npm run build:extension", lane: "deterministic" },
  { command: "npm run smoke:web", lane: "deterministic" },
  { command: "npm run smoke:observability", lane: "deterministic" },
  { command: "npm run smoke:tracker-local", lane: "deterministic" },
] as const;

export const LIVE_VALIDATION_COMMANDS: readonly ValidationCommandSpec[] = [
  { command: "npm run smoke:cos", lane: "live" },
  { command: "npm run smoke:stack", lane: "live" },
  { command: "npm run smoke:session-control", lane: "live" },
  { command: "npm run smoke:tracker-live:linear", lane: "live", shouldRun: hasLinearTrackerLiveValidationConfig },
  { command: "npm run smoke:tracker-live:jira", lane: "live", shouldRun: hasJiraTrackerLiveValidationConfig },
] as const;

interface BlockerPattern {
  readonly code: ExternalDependencyBlocker["code"];
  readonly headline: string;
  readonly escalationHint: string;
  readonly patterns: readonly RegExp[];
}

const EXTERNAL_BLOCKER_PATTERNS: readonly BlockerPattern[] = [
  {
    code: "provider_auth_blocked",
    headline: "Provider authentication or organization access is blocked",
    escalationHint: "Ask the user to restore Pi/provider authentication or org access, then rerun the live validation suite.",
    patterns: [
      /permission_error/i,
      /OAuth authentication is currently not allowed for this organization/i,
      /authentication is currently not allowed for this organization/i,
      /not authorized/i,
    ],
  },
  {
    code: "provider_limit_reached",
    headline: "Provider usage limit has been reached",
    escalationHint: "Ask the user to restore provider quota or switch to a provider/model with available capacity before rerunning live validation.",
    patterns: [
      /Provider Limit Reached/i,
      /usage limit/i,
      /credit balance is too low/i,
      /insufficient credits/i,
    ],
  },
  {
    code: "provider_rate_limited",
    headline: "Provider is rate limited",
    escalationHint: "Ask the user to wait for capacity to recover or choose a different provider, then rerun live validation.",
    patterns: [
      /rate_limit_error/i,
      /rate limit/i,
      /too many requests/i,
      /\b429\b/,
    ],
  },
  {
    code: "provider_capacity_unavailable",
    headline: "Provider capacity is temporarily unavailable",
    escalationHint: "Ask the user to wait for provider capacity to recover or choose another provider, then rerun live validation.",
    patterns: [
      /Traffic is currently high/i,
      /under heavy load/i,
      /provider .* retrying/i,
      /temporarily unavailable/i,
      /capacity exceeded/i,
      /capacity unavailable/i,
    ],
  },
  {
    code: "provider_unavailable",
    headline: "Provider or network dependency is temporarily unavailable",
    escalationHint: "Ask the user to restore the external dependency or rerun live validation later.",
    patterns: [
      /ECONNRESET/i,
      /ETIMEDOUT/i,
      /ENOTFOUND/i,
      /network error/i,
      /fetch failed/i,
      /Service Unavailable/i,
      /\b503\b/,
    ],
  },
] as const;

export function resolveValidationCommands(
  lane: ValidationLaneKind,
  env: NodeJS.ProcessEnv = process.env,
): readonly ValidationCommandSpec[] {
  const commands = lane === "deterministic" ? DETERMINISTIC_VALIDATION_COMMANDS : LIVE_VALIDATION_COMMANDS;
  return commands.filter((command) => command.shouldRun?.(env) ?? true);
}

export function extractStructuredJson(raw: string): unknown | undefined {
  const lines = raw.trim().split(/\r?\n/);
  for (let start = lines.length - 1; start >= 0; start -= 1) {
    const candidate = lines.slice(start).join("\n").trim();
    if (!candidate.startsWith("{")) {
      continue;
    }
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // keep scanning earlier lines
    }
  }
  return undefined;
}

export function parseValidationSignal(raw: string): ValidationSignal {
  const parsed = extractStructuredJson(raw);
  if (parsed === undefined || parsed === null || typeof parsed !== "object") {
    return { skipped: false };
  }
  const record = parsed as Record<string, unknown>;
  if (record.ok === true && record.skipped === true) {
    return {
      skipped: true,
      ...(typeof record.reason === "string" ? { skipReason: record.reason } : {}),
    };
  }
  return { skipped: false };
}

export function detectExternalDependencyBlocker(raw: string): ExternalDependencyBlocker | undefined {
  const normalized = raw.trim();
  if (normalized === "") {
    return undefined;
  }

  for (const blocker of EXTERNAL_BLOCKER_PATTERNS) {
    if (blocker.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        code: blocker.code,
        headline: blocker.headline,
        escalationHint: blocker.escalationHint,
      };
    }
  }

  return undefined;
}

export function analyzeValidationResult(input: {
  lane: ValidationLaneKind;
  exitCode: number;
  stdout: string;
  stderr: string;
}): ValidationResultAnalysis {
  const combinedOutput = [input.stdout, input.stderr].filter(Boolean).join("\n");
  const signal = parseValidationSignal(combinedOutput);
  const blocker = detectExternalDependencyBlocker(combinedOutput);

  if (input.exitCode === 0 && !signal.skipped) {
    return {
      classification: "passed",
      signal,
    };
  }

  if (input.lane === "live" && (signal.skipped || blocker !== undefined)) {
    return {
      classification: "external_transient",
      signal,
      ...(blocker === undefined ? {} : { blocker }),
    };
  }

  return {
    classification: "failed",
    signal,
    ...(blocker === undefined ? {} : { blocker }),
  };
}
