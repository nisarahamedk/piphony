#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { detectProjectOnboardingDefaults, onboardProject } from "../onboarding/project-onboarding.js";
import { errorMessage } from "../core/errors.js";
import { parseSupportedTrackerProvider, type SupportedTrackerProvider } from "../tracker/types.js";
import type { WorkflowDefinition, WorkflowExecutionDefinition, WorkflowHookDefinition } from "../workflow/types.js";

interface CliFlags {
  projectRoot?: string | undefined;
  trackerProvider?: SupportedTrackerProvider | undefined;
  trackerProjectKey?: string | undefined;
  trackerBoardId?: string | undefined;
  model?: string | undefined;
  executionKind?: WorkflowExecutionDefinition["kind"] | undefined;
  composeFile?: string | undefined;
  projectName?: string | undefined;
  service?: string | undefined;
  workdir?: string | undefined;
  prepareCommand?: string | undefined;
  prepareScope?: WorkflowHookDefinition["scope"] | undefined;
  teardownCommand?: string | undefined;
  teardownScope?: WorkflowHookDefinition["scope"] | undefined;
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
    "  --execution-kind <host|docker_compose>",
    "  --compose-file <path>",
    "  --project-name <name>",
    "  --service <name>",
    "  --workdir <path>",
    "  --prepare-command <command>",
    "  --prepare-scope <control_plane|execution>",
    "  --teardown-command <command>",
    "  --teardown-scope <control_plane|execution>",
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
      case "--execution-kind":
        flags.executionKind = parseExecutionKind(requireValue(args, ++index, arg), arg);
        break;
      case "--compose-file":
        flags.composeFile = requireValue(args, ++index, arg);
        break;
      case "--project-name":
        flags.projectName = requireValue(args, ++index, arg);
        break;
      case "--service":
        flags.service = requireValue(args, ++index, arg);
        break;
      case "--workdir":
        flags.workdir = requireValue(args, ++index, arg);
        break;
      case "--prepare-command":
        flags.prepareCommand = requireValue(args, ++index, arg);
        break;
      case "--prepare-scope":
        flags.prepareScope = parseHookScope(requireValue(args, ++index, arg), arg);
        break;
      case "--teardown-command":
        flags.teardownCommand = requireValue(args, ++index, arg);
        break;
      case "--teardown-scope":
        flags.teardownScope = parseHookScope(requireValue(args, ++index, arg), arg);
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

function parseExecutionKind(raw: string, flag: string): WorkflowExecutionDefinition["kind"] {
  if (raw === "host" || raw === "docker_compose") {
    return raw;
  }
  throw new Error(`${flag} must be one of: host, docker_compose`);
}

function parseHookScope(raw: string, flag: string): WorkflowHookDefinition["scope"] {
  if (raw === "control_plane" || raw === "execution") {
    return raw;
  }
  throw new Error(`${flag} must be one of: control_plane, execution`);
}

async function promptString(rl: ReturnType<typeof createInterface>, label: string, fallback: string): Promise<string> {
  const answer = (await rl.question(`${label} [${fallback}]: `)).trim();
  return answer === "" ? fallback : answer;
}

async function promptOptional(rl: ReturnType<typeof createInterface>, label: string, fallback?: string): Promise<string | undefined> {
  const suffix = fallback === undefined ? "" : ` [${fallback}]`;
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer === "" ? fallback : answer;
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
    const executionKind = flags.executionKind ?? parseExecutionKind(
      await promptString(rl, "Execution kind (host|docker_compose)", defaults.execution.kind),
      "executionKind",
    );
    const workdir = flags.workdir ?? await promptOptional(rl, "Execution workdir", defaults.execution.workdir ?? projectRoot);

    if (executionKind === "docker_compose") {
      const composeDefaults = defaults.execution.kind === "docker_compose"
        ? defaults.execution
        : { composeFile: "docker-compose.yml", projectName: basename(projectRoot), service: "runtime", workdir: "/workspace" };
      return {
        ...flags,
        projectRoot,
        trackerProvider,
        ...(trackerProjectKey === undefined ? {} : { trackerProjectKey }),
        ...(trackerBoardId === undefined ? {} : { trackerBoardId }),
        model,
        executionKind,
        composeFile: flags.composeFile ?? await promptString(rl, "Docker Compose file", composeDefaults.composeFile),
        projectName: flags.projectName ?? await promptString(rl, "Docker project name", composeDefaults.projectName),
        service: flags.service ?? await promptString(rl, "Primary execution service", composeDefaults.service),
        ...(workdir === undefined ? {} : { workdir }),
        ...withLifecycleDefaults(flags, defaults.lifecycle),
      };
    }

    return {
      ...flags,
      projectRoot,
      trackerProvider,
      ...(trackerProjectKey === undefined ? {} : { trackerProjectKey }),
      ...(trackerBoardId === undefined ? {} : { trackerBoardId }),
      model,
      executionKind,
      ...(workdir === undefined ? {} : { workdir }),
      ...withLifecycleDefaults(flags, defaults.lifecycle),
    };
  } finally {
    rl.close();
  }
}

function withLifecycleDefaults(flags: CliFlags, lifecycle: NonNullable<WorkflowDefinition["lifecycle"]>) {
  return {
    ...((flags.prepareCommand ?? lifecycle.prepare?.command) === undefined
      ? {}
      : { prepareCommand: flags.prepareCommand ?? lifecycle.prepare?.command }),
    ...((flags.prepareScope ?? lifecycle.prepare?.scope) === undefined
      ? {}
      : { prepareScope: flags.prepareScope ?? lifecycle.prepare?.scope }),
    ...((flags.teardownCommand ?? lifecycle.teardown?.command) === undefined
      ? {}
      : { teardownCommand: flags.teardownCommand ?? lifecycle.teardown?.command }),
    ...((flags.teardownScope ?? lifecycle.teardown?.scope) === undefined
      ? {}
      : { teardownScope: flags.teardownScope ?? lifecycle.teardown?.scope }),
  };
}

function flagsToLifecycle(flags: CliFlags): WorkflowDefinition["lifecycle"] {
  return {
    ...(flags.prepareCommand === undefined ? {} : {
      prepare: {
        scope: flags.prepareScope ?? "control_plane",
        command: flags.prepareCommand,
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

function buildExecution(flags: CliFlags, defaults: ReturnType<typeof detectProjectOnboardingDefaults>): WorkflowDefinition["execution"] {
  const kind = flags.executionKind ?? defaults.execution.kind;
  if (kind === "host") {
    const workdir = flags.workdir ?? defaults.execution.workdir;
    return {
      kind: "host",
      ...(workdir === undefined ? {} : { workdir }),
      ...(defaults.execution.endpoints === undefined ? {} : { endpoints: defaults.execution.endpoints }),
    };
  }

  const composeDefaults: {
    composeFile: string;
    projectName: string;
    service: string;
    workdir?: string;
    endpoints?: Record<string, string>;
  } = defaults.execution.kind === "docker_compose"
    ? defaults.execution
    : { composeFile: "docker-compose.yml", projectName: basename(resolve(flags.projectRoot ?? process.cwd())), service: "runtime", workdir: "/workspace" };
  return {
    kind: "docker_compose",
    composeFile: flags.composeFile ?? composeDefaults.composeFile,
    projectName: flags.projectName ?? composeDefaults.projectName,
    service: flags.service ?? composeDefaults.service,
    ...(flags.workdir === undefined && composeDefaults.workdir === undefined ? {} : { workdir: flags.workdir ?? composeDefaults.workdir }),
    ...(composeDefaults.endpoints === undefined ? {} : { endpoints: composeDefaults.endpoints }),
  };
}

async function main() {
  const initialFlags = parseArgs(process.argv.slice(2));
  const flags = initialFlags.nonInteractive ? initialFlags : await gatherInteractiveFlags(initialFlags);
  const projectRoot = resolve(flags.projectRoot ?? process.cwd());
  const defaults = detectProjectOnboardingDefaults(projectRoot);
  const trackerProvider = flags.trackerProvider ?? defaults.trackerProvider;
  const model = flags.model ?? defaults.model;
  const lifecycle = flagsToLifecycle({
    ...flags,
    ...withLifecycleDefaults(flags, defaults.lifecycle),
  });

  const result = await onboardProject({
    projectRoot,
    trackerProvider,
    ...(flags.trackerProjectKey === undefined ? {} : { trackerProjectKey: flags.trackerProjectKey }),
    ...(flags.trackerBoardId === undefined ? {} : { trackerBoardId: flags.trackerBoardId }),
    model,
    execution: buildExecution(flags, defaults),
    lifecycle,
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
