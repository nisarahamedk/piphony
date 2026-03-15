export interface SmokeCommandDefinition {
  script: string;
  entrypoint: string;
  lane: "deterministic" | "live" | "manual";
  description: string;
  includedInAll: boolean;
}

export const smokeCommands: SmokeCommandDefinition[] = [
  {
    script: "smoke:tracker-local",
    entrypoint: "src/smoke/tracker-local.ts",
    lane: "deterministic",
    description: "Exercises the local tracker adapter against an onboarded temp repo fixture.",
    includedInAll: true,
  },
  {
    script: "smoke:orchestrator",
    entrypoint: "src/smoke/orchestrator.ts",
    lane: "deterministic",
    description: "Runs the orchestrator with a stub worker against an onboarded temp repo fixture.",
    includedInAll: true,
  },
  {
    script: "smoke:pi",
    entrypoint: "src/smoke/pi.ts",
    lane: "deterministic",
    description: "Validates embedded Pi project discovery against an onboarded temp repo fixture.",
    includedInAll: true,
  },
  {
    script: "smoke:local-e2e",
    entrypoint: "src/smoke/local-e2e.ts",
    lane: "deterministic",
    description: "Runs the local implementation worker end-to-end against an onboarded temp repo fixture.",
    includedInAll: true,
  },
  {
    script: "smoke:stack",
    entrypoint: "src/smoke/docker-openclawsseum.ts",
    lane: "live",
    description: "Clones and onboards OpenClawsseum in a temp repo, provisions the real runtime stack, runs the implementation agent inside it, and tears it down. Requires Docker.",
    includedInAll: true,
  },
  {
    script: "smoke:restart",
    entrypoint: "src/smoke/restart.ts",
    lane: "deterministic",
    description: "Verifies restart/worktree reuse semantics in an isolated temp git repo.",
    includedInAll: true,
  },
  {
    script: "smoke:observability",
    entrypoint: "src/smoke/observability.ts",
    lane: "deterministic",
    description: "Checks run artifact persistence and status inspection against an onboarded temp repo fixture.",
    includedInAll: true,
  },
  {
    script: "smoke:pull-based-workflow",
    entrypoint: "src/smoke/pull-based-workflow.ts",
    lane: "deterministic",
    description: "Exercises the pull-based workflow path against an onboarded temp repo fixture.",
    includedInAll: true,
  },
  {
    script: "smoke:web",
    entrypoint: "src/smoke/web-ui.ts",
    lane: "deterministic",
    description: "Drives the web UI against an onboarded temp repo fixture.",
    includedInAll: true,
  },
  {
    script: "smoke:session-control",
    entrypoint: "src/smoke/session-control.ts",
    lane: "live",
    description: "Exercises active Pi session steering against an onboarded temp repo fixture.",
    includedInAll: true,
  },
  {
    script: "smoke:cos",
    entrypoint: "src/smoke/cos-actor.ts",
    lane: "live",
    description: "Exercises the Chief of Staff actor against an onboarded temp repo fixture.",
    includedInAll: true,
  },
  {
    script: "smoke:extension-stack",
    entrypoint: "src/smoke/stack-ui.ts",
    lane: "manual",
    description: "Manual browser-extension smoke against the Piphony control-plane dev stack and a temp repo fixture.",
    includedInAll: false,
  },
  {
    script: "smoke:tracker-live:linear",
    entrypoint: "src/smoke/tracker-provider-live.ts linear",
    lane: "live",
    description: "Opt-in live Linear tracker validation when credentials and a default team/project selection are configured.",
    includedInAll: false,
  },
  {
    script: "smoke:tracker-live:jira",
    entrypoint: "src/smoke/tracker-provider-live.ts jira",
    lane: "live",
    description: "Opt-in live Jira tracker validation when credentials and a default project selection are configured.",
    includedInAll: false,
  },
];

export const smokeAllScripts = smokeCommands.filter((command) => command.includedInAll).map((command) => command.script);
