#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { detectProjectOnboardingDefaults, onboardProject } from "../onboarding/project-onboarding.js";
import { errorMessage } from "../core/errors.js";
import { parseSupportedTrackerProvider, type SupportedTrackerProvider } from "../tracker/types.js";
import type { WorkflowDefinition, WorkflowPhaseDefinition } from "../workflow/types.js";

interface CliFlags {
  projectRoot?: string | undefined;
  trackerProvider?: SupportedTrackerProvider | undefined;
  trackerProjectKey?: string | undefined;
  trackerBoardId?: string | undefined;
  model?: string | undefined;
  runtimeComposeFile?: string | undefined;
  runtimeProjectName?: string | undefined;
  runtimeService?: string | undefined;
  runtimeWorkdir?: string | undefined;
  runtimeBuild?: boolean | undefined;
  runtimeServicesToStart?: string[] | undefined;
  prepareCommand?: string | undefined;
  prepareScope?: WorkflowPhaseDefinition["scope"] | undefined;
  validateCommand?: string | undefined;
  validateScope?: WorkflowPhaseDefinition["scope"] | undefined;
  teardownCommand?: string | undefined;
  teardownScope?: WorkflowPhaseDefinition["scope"] | undefined;
  force: boolean;
  nonInteractive: boolean;
}

function usage(): never {
  console.log([
    "Usage: tsx src/cli/onboard.ts [options]",
    "",
    "Options:",
    "  --project-root <path>",
    "  --tracker-provider <local|linear|jira>",
    "  --tracker-project-key <key>",
    "  --tracker-board-id <id>",
    "  --model <provider/model>",
    "  --runtime-compose-file <path>",
    "  --runtime-project-name <name>",
    "  --runtime-service <name>",
    "  --runtime-workdir <path>",
    "  --runtime-build <true|false>",
    "  --runtime-services-to-start <comma,separated,list>",
    "  --prepare-command <command>",
    "  --prepare-scope <control_plane|runtime>",
    "  --validate-command <command>",
    "  --validate-scope <control_plane|runtime>",
    "  --teardown-command <command>",
    "  --teardown-scope <control_plane|runtime>",
    "  --force",
    "  --non-interactive",
  ].join("\n"));
  process.exit(1);
}

function parseArgs(args: string[]): CliFlags {
  const flags: CliFlags = { force: false, nonInteractive: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--project-root":
        flags.projectRoot = requireValue(args, ++index, arg);
        break;
      case "--tracker-provider":
        flags.trackerProvider = parseSupportedTrackerProvider(requireValue(args, ++index, arg), "local");
        break;
      case "--tracker-project-key":
        flags.trackerProjectKey = requireValue(args, ++index, arg);
        break;
      case "--tracker-board-id":
        flags.trackerBoardId = requireValue(args, ++index, arg);
        break;
      case "--model":
        flags.model = requireValue(args, ++index, arg);
        break;
      case "--runtime-compose-file":
        flags.runtimeComposeFile = requireValue(args, ++index, arg);
        break;
      case "--runtime-project-name":
        flags.runtimeProjectName = requireValue(args, ++index, arg);
        break;
      case "--runtime-service":
        flags.runtimeService = requireValue(args, ++index, arg);
        break;
      case "--runtime-workdir":
        flags.runtimeWorkdir = requireValue(args, ++index, arg);
        break;
      case "--runtime-build":
        flags.runtimeBuild = parseBoolean(requireValue(args, ++index, arg), arg);
        break;
      case "--runtime-services-to-start":
        flags.runtimeServicesToStart = parseCsv(requireValue(args, ++index, arg));
        break;
      case "--prepare-command":
        flags.prepareCommand = requireValue(args, ++index, arg);
        break;
      case "--prepare-scope":
        flags.prepareScope = parsePhaseScope(requireValue(args, ++index, arg), arg);
        break;
      case "--validate-command":
        flags.validateCommand = requireValue(args, ++index, arg);
        break;
      case "--validate-scope":
        flags.validateScope = parsePhaseScope(requireValue(args, ++index, arg), arg);
        break;
      case "--teardown-command":
        flags.teardownCommand = requireValue(args, ++index, arg);
        break;
      case "--teardown-scope":
        flags.teardownScope = parsePhaseScope(requireValue(args, ++index, arg), arg);
        break;
      case "--force":
        flags.force = true;
        break;
      case "--non-interactive":
        flags.nonInteractive = true;
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

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseBoolean(raw: string, flag: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${flag} must be 'true' or 'false'`);
}

function parseCsv(raw: string): string[] {
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function parsePhaseScope(raw: string, flag: string): WorkflowPhaseDefinition["scope"] {
  if (raw === "control_plane" || raw === "runtime") {
    return raw;
  }
  throw new Error(`${flag} must be one of: control_plane, runtime`);
}

async function promptString(rl: ReturnType<typeof createInterface>, label: string, fallback: string): Promise<string> {
  const answer = (await rl.question(`${label} [${fallback}]: `)).trim();
  return answer === "" ? fallback : answer;
}

async function promptOptional(rl: ReturnType<typeof createInterface>, label: string, fallback?: string): Promise<string | undefined> {
  const suffix = fallback === undefined ? "" : ` [${fallback}]`;
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  if (answer !== "") {
    return answer;
  }
  return fallback;
}

async function promptProvider(rl: ReturnType<typeof createInterface>, fallback: SupportedTrackerProvider): Promise<SupportedTrackerProvider> {
  return parseSupportedTrackerProvider(await promptString(rl, "Tracker provider (local|linear|jira)", fallback), fallback);
}

async function gatherInteractiveFlags(flags: CliFlags): Promise<CliFlags> {
  const projectRoot = resolve(flags.projectRoot ?? process.cwd());
  const defaults = detectProjectOnboardingDefaults(projectRoot);
  const rl = createInterface({ input, output });
  try {
    console.log(`Onboarding Piphony for ${basename(projectRoot)} at ${projectRoot}`);
    const trackerProvider = flags.trackerProvider ?? await promptProvider(rl, defaults.trackerProvider);
    const trackerProjectKey = trackerProvider === "local"
      ? undefined
      : (flags.trackerProjectKey ?? await promptOptional(rl, "Tracker project key", undefined));
    const trackerBoardId = trackerProvider === "jira"
      ? (flags.trackerBoardId ?? await promptOptional(rl, "Tracker board id", undefined))
      : undefined;
    const model = flags.model ?? await promptString(rl, "Pinned model", defaults.model);
    const runtimeComposeFile = flags.runtimeComposeFile ?? await promptString(rl, "Docker Compose file", defaults.runtime.composeFile);
    const runtimeProjectName = flags.runtimeProjectName ?? await promptString(rl, "Docker project name", defaults.runtime.projectName);
    const runtimeService = flags.runtimeService ?? await promptString(rl, "Primary runtime service", defaults.runtime.service);
    const runtimeWorkdir = flags.runtimeWorkdir ?? await promptString(rl, "Runtime workdir", defaults.runtime.workdir ?? "/workspace");
    const runtimeBuild = flags.runtimeBuild ?? parseBoolean(await promptString(rl, "Build runtime before start (true|false)", String(defaults.runtime.build)), "runtimeBuild");
    const runtimeServicesToStart = flags.runtimeServicesToStart
      ?? parseCsv((await promptOptional(rl, "Additional services to start (comma separated)", defaults.runtime.servicesToStart?.join(",") ?? "")) ?? "");
    return {
      ...flags,
      projectRoot,
      trackerProvider,
      ...(trackerProjectKey === undefined ? {} : { trackerProjectKey }),
      ...(trackerBoardId === undefined ? {} : { trackerBoardId }),
      model,
      runtimeComposeFile,
      runtimeProjectName,
      runtimeService,
      runtimeWorkdir,
      runtimeBuild,
      ...(runtimeServicesToStart.length === 0 ? {} : { runtimeServicesToStart }),
      ...((flags.prepareCommand ?? defaults.phases.prepare?.command) === undefined
        ? {}
        : { prepareCommand: flags.prepareCommand ?? defaults.phases.prepare?.command }),
      ...((flags.prepareScope ?? defaults.phases.prepare?.scope) === undefined
        ? {}
        : { prepareScope: flags.prepareScope ?? defaults.phases.prepare?.scope }),
      ...((flags.validateCommand ?? defaults.phases.validate?.command) === undefined
        ? {}
        : { validateCommand: flags.validateCommand ?? defaults.phases.validate?.command }),
      ...((flags.validateScope ?? defaults.phases.validate?.scope) === undefined
        ? {}
        : { validateScope: flags.validateScope ?? defaults.phases.validate?.scope }),
      ...((flags.teardownCommand ?? defaults.phases.teardown?.command) === undefined
        ? {}
        : { teardownCommand: flags.teardownCommand ?? defaults.phases.teardown?.command }),
      ...((flags.teardownScope ?? defaults.phases.teardown?.scope) === undefined
        ? {}
        : { teardownScope: flags.teardownScope ?? defaults.phases.teardown?.scope }),
    };
  } finally {
    rl.close();
  }
}

function flagsToPhases(flags: CliFlags): WorkflowDefinition["phases"] {
  return {
    ...(flags.prepareCommand === undefined ? {} : {
      prepare: {
        scope: flags.prepareScope ?? "control_plane",
        command: flags.prepareCommand,
        timeoutSeconds: 2700,
      },
    }),
    ...(flags.validateCommand === undefined ? {} : {
      validate: {
        scope: flags.validateScope ?? "control_plane",
        command: flags.validateCommand,
        timeoutSeconds: 2700,
      },
    }),
    ...(flags.teardownCommand === undefined ? {} : {
      teardown: {
        scope: flags.teardownScope ?? "control_plane",
        command: flags.teardownCommand,
        timeoutSeconds: 2700,
      },
    }),
  };
}

async function main() {
  const initialFlags = parseArgs(process.argv.slice(2));
  const flags = initialFlags.nonInteractive ? initialFlags : await gatherInteractiveFlags(initialFlags);
  const projectRoot = resolve(flags.projectRoot ?? process.cwd());
  const defaults = detectProjectOnboardingDefaults(projectRoot);

  const trackerProvider = flags.trackerProvider ?? defaults.trackerProvider;
  const model = flags.model ?? defaults.model;
  const phases = flagsToPhases({
    ...flags,
    ...((flags.prepareCommand ?? defaults.phases.prepare?.command) === undefined
      ? {}
      : { prepareCommand: flags.prepareCommand ?? defaults.phases.prepare?.command }),
    ...((flags.prepareScope ?? defaults.phases.prepare?.scope) === undefined
      ? {}
      : { prepareScope: flags.prepareScope ?? defaults.phases.prepare?.scope }),
    ...((flags.validateCommand ?? defaults.phases.validate?.command) === undefined
      ? {}
      : { validateCommand: flags.validateCommand ?? defaults.phases.validate?.command }),
    ...((flags.validateScope ?? defaults.phases.validate?.scope) === undefined
      ? {}
      : { validateScope: flags.validateScope ?? defaults.phases.validate?.scope }),
    ...((flags.teardownCommand ?? defaults.phases.teardown?.command) === undefined
      ? {}
      : { teardownCommand: flags.teardownCommand ?? defaults.phases.teardown?.command }),
    ...((flags.teardownScope ?? defaults.phases.teardown?.scope) === undefined
      ? {}
      : { teardownScope: flags.teardownScope ?? defaults.phases.teardown?.scope }),
  });
  const result = await onboardProject({
    projectRoot,
    trackerProvider,
    ...(flags.trackerProjectKey === undefined ? {} : { trackerProjectKey: flags.trackerProjectKey }),
    ...(flags.trackerBoardId === undefined ? {} : { trackerBoardId: flags.trackerBoardId }),
    model,
    runtime: {
      provider: "docker_compose",
      composeFile: flags.runtimeComposeFile ?? defaults.runtime.composeFile,
      projectName: flags.runtimeProjectName ?? defaults.runtime.projectName,
      service: flags.runtimeService ?? defaults.runtime.service,
      ...((flags.runtimeWorkdir ?? defaults.runtime.workdir) === undefined
        ? {}
        : { workdir: flags.runtimeWorkdir ?? defaults.runtime.workdir }),
      build: flags.runtimeBuild ?? defaults.runtime.build,
      ...(flags.runtimeServicesToStart === undefined || flags.runtimeServicesToStart.length === 0
        ? {}
        : { servicesToStart: flags.runtimeServicesToStart }),
      ...(defaults.runtime.endpoints === undefined ? {} : { endpoints: defaults.runtime.endpoints }),
    },
    phases,
    force: flags.force,
  });

  console.log(JSON.stringify({
    ok: true,
    projectRoot: result.projectRoot,
    workflowPath: result.workflowPath,
    agentTypesPath: result.agentTypesPath,
    trackerProvider,
    model,
  }, null, 2));
}

main().catch((error) => {
  console.error("piphony_onboard_error", errorMessage(error));
  process.exit(1);
});
