#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { errorMessage } from "../core/errors.js";
import { detectProjectOnboardingDefaults, onboardProject, type OnboardProjectExecutionInput } from "../onboarding/project-onboarding.js";
import { parseSupportedTrackerProvider, type SupportedTrackerProvider } from "../tracker/types.js";

interface CliFlags {
  projectRoot?: string | undefined;
  trackerProvider?: SupportedTrackerProvider | undefined;
  trackerProjectKey?: string | undefined;
  trackerBoardId?: string | undefined;
  model?: string | undefined;
  executionKind?: OnboardProjectExecutionInput["kind"] | undefined;
  composeFile?: string | undefined;
  projectName?: string | undefined;
  service?: string | undefined;
  workdir?: string | undefined;
  prepareCommand?: string | undefined;
  teardownCommand?: string | undefined;
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
    "  --teardown-command <command>",
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
      case "--teardown-command":
        flags.teardownCommand = requireValue(args, ++index, arg);
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

function parseExecutionKind(raw: string, flag: string): OnboardProjectExecutionInput["kind"] {
  if (raw === "host" || raw === "docker_compose") {
    return raw;
  }
  throw new Error(`${flag} must be one of: host, docker_compose`);
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

async function gatherInteractiveFlags(flags: CliFlags): Promise<CliFlags> {
  const projectRoot = resolve(flags.projectRoot ?? process.cwd());
  const defaults = detectProjectOnboardingDefaults(projectRoot);
  const rl = createInterface({ input, output });
  try {
    console.log(`Onboarding Piphony for ${basename(projectRoot)} at ${projectRoot}`);
    const trackerProvider = flags.trackerProvider ?? parseSupportedTrackerProvider(
      await promptString(rl, "Tracker provider (local|linear|jira)", defaults.trackerProvider),
      defaults.trackerProvider,
    );
    const trackerProjectKey = trackerProvider === "local"
      ? undefined
      : (flags.trackerProjectKey ?? await promptOptional(rl, "Tracker project key"));
    const trackerBoardId = trackerProvider === "jira"
      ? (flags.trackerBoardId ?? await promptOptional(rl, "Tracker board id"))
      : undefined;
    const model = flags.model ?? await promptString(rl, "Pinned model", defaults.model);
    const executionKind = flags.executionKind ?? parseExecutionKind(
      await promptString(rl, "Execution kind (host|docker_compose)", defaults.execution.kind),
      "--execution-kind",
    );
    const workdir = flags.workdir ?? await promptOptional(
      rl,
      "Execution workdir",
      defaults.execution.workdir ?? projectRoot,
    );

    if (executionKind === "docker_compose") {
      const dockerDefaults: {
        composeFile: string;
        projectName: string;
        service: string;
        workdir?: string;
        endpoints?: Record<string, string>;
      } = defaults.execution.kind === "docker_compose"
        ? {
            composeFile: defaults.execution.composeFile!,
            projectName: defaults.execution.projectName!,
            service: defaults.execution.service!,
            ...(defaults.execution.workdir === undefined ? {} : { workdir: defaults.execution.workdir }),
            ...(defaults.execution.endpoints === undefined ? {} : { endpoints: defaults.execution.endpoints }),
          }
        : { composeFile: "docker-compose.yml", projectName: basename(projectRoot), service: "runtime", workdir: "/workspace" };
      return {
        ...flags,
        projectRoot,
        trackerProvider,
        ...(trackerProjectKey === undefined ? {} : { trackerProjectKey }),
        ...(trackerBoardId === undefined ? {} : { trackerBoardId }),
        model,
        executionKind,
        composeFile: flags.composeFile ?? await promptString(rl, "Docker Compose file", dockerDefaults.composeFile!),
        projectName: flags.projectName ?? await promptString(rl, "Docker project name", dockerDefaults.projectName!),
        service: flags.service ?? await promptString(rl, "Primary execution service", dockerDefaults.service!),
        ...(workdir === undefined ? {} : { workdir }),
        ...(flags.prepareCommand === undefined && defaults.execution.prepareCommand === undefined
          ? {}
          : { prepareCommand: flags.prepareCommand ?? await promptOptional(rl, "Prepare command", defaults.execution.prepareCommand) }),
        ...(flags.teardownCommand === undefined && defaults.execution.teardownCommand === undefined
          ? {}
          : { teardownCommand: flags.teardownCommand ?? await promptOptional(rl, "Teardown command", defaults.execution.teardownCommand) }),
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
      ...(flags.prepareCommand === undefined && defaults.execution.prepareCommand === undefined
        ? {}
        : { prepareCommand: flags.prepareCommand ?? await promptOptional(rl, "Prepare command", defaults.execution.prepareCommand) }),
      ...(flags.teardownCommand === undefined && defaults.execution.teardownCommand === undefined
        ? {}
        : { teardownCommand: flags.teardownCommand ?? await promptOptional(rl, "Teardown command", defaults.execution.teardownCommand) }),
    };
  } finally {
    rl.close();
  }
}

function buildExecution(flags: CliFlags, defaults: ReturnType<typeof detectProjectOnboardingDefaults>): OnboardProjectExecutionInput {
  const kind = flags.executionKind ?? defaults.execution.kind;
  if (kind === "host") {
    return {
      kind: "host",
      ...(flags.workdir === undefined && defaults.execution.workdir === undefined ? {} : { workdir: flags.workdir ?? defaults.execution.workdir }),
      ...(defaults.execution.endpoints === undefined ? {} : { endpoints: defaults.execution.endpoints }),
      ...(flags.prepareCommand === undefined && defaults.execution.prepareCommand === undefined ? {} : { prepareCommand: flags.prepareCommand ?? defaults.execution.prepareCommand }),
      ...(flags.teardownCommand === undefined && defaults.execution.teardownCommand === undefined ? {} : { teardownCommand: flags.teardownCommand ?? defaults.execution.teardownCommand }),
    };
  }

  const dockerDefaults: {
    composeFile: string;
    projectName: string;
    service: string;
    workdir?: string;
    endpoints?: Record<string, string>;
  } = defaults.execution.kind === "docker_compose"
    ? {
        composeFile: defaults.execution.composeFile!,
        projectName: defaults.execution.projectName!,
        service: defaults.execution.service!,
        ...(defaults.execution.workdir === undefined ? {} : { workdir: defaults.execution.workdir }),
        ...(defaults.execution.endpoints === undefined ? {} : { endpoints: defaults.execution.endpoints }),
      }
    : { composeFile: "docker-compose.yml", projectName: basename(resolve(flags.projectRoot ?? process.cwd())), service: "runtime", workdir: "/workspace" };
  return {
    kind: "docker_compose",
    composeFile: flags.composeFile ?? dockerDefaults.composeFile!,
    projectName: flags.projectName ?? dockerDefaults.projectName!,
    service: flags.service ?? dockerDefaults.service!,
    ...(flags.workdir === undefined && dockerDefaults.workdir === undefined ? {} : { workdir: flags.workdir ?? dockerDefaults.workdir }),
    ...(dockerDefaults.endpoints === undefined ? {} : { endpoints: dockerDefaults.endpoints }),
    ...(flags.prepareCommand === undefined && defaults.execution.prepareCommand === undefined ? {} : { prepareCommand: flags.prepareCommand ?? defaults.execution.prepareCommand }),
    ...(flags.teardownCommand === undefined && defaults.execution.teardownCommand === undefined ? {} : { teardownCommand: flags.teardownCommand ?? defaults.execution.teardownCommand }),
  };
}

async function main() {
  const initialFlags = parseArgs(process.argv.slice(2));
  const flags = initialFlags.nonInteractive ? initialFlags : await gatherInteractiveFlags(initialFlags);
  const projectRoot = resolve(flags.projectRoot ?? process.cwd());
  const defaults = detectProjectOnboardingDefaults(projectRoot);
  const trackerProvider = flags.trackerProvider ?? defaults.trackerProvider;
  const model = flags.model ?? defaults.model;

  const result = await onboardProject({
    projectRoot,
    trackerProvider,
    ...(flags.trackerProjectKey === undefined ? {} : { trackerProjectKey: flags.trackerProjectKey }),
    ...(flags.trackerBoardId === undefined ? {} : { trackerBoardId: flags.trackerBoardId }),
    model,
    execution: buildExecution(flags, defaults),
    force: flags.force,
  });

  console.log(JSON.stringify({
    ok: true,
    projectRoot: result.projectRoot,
    extensionsDir: result.extensionsDir,
    environmentPath: result.environmentPath,
    trackerPath: result.trackerPath,
    agentTypesPath: result.agentTypesPath,
    trackerProvider,
    model,
  }, null, 2));
}

main().catch((error) => {
  console.error("piphony_onboard_error", errorMessage(error));
  process.exit(1);
});
