import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { DockerComposeExecutionTarget } from "../runtime/docker/provider.js";
import { HostExecutionTarget } from "../runtime/host/provider.js";
import { createLocalTrackerProviderClient } from "../tracker/local/provider.js";
import { requireLinearTrackerConfig } from "../tracker/linear/config.js";
import { LinearTrackerAdapter } from "../tracker/linear/adapter.js";
import { requireJiraTrackerConfig } from "../tracker/jira/config.js";
import { JiraTrackerAdapter } from "../tracker/jira/adapter.js";
import type { PiphonyExtensionAPI, ExtensionHelperAPI, TransitionHook, RuntimePlatformProvider, TrackerProviderDefinition } from "./types.js";
import type { ExtensionRegistry } from "./registry.js";

const execFileAsync = promisify(execFile);

export function createExtensionHelpers(): ExtensionHelperAPI {
  return {
    async execControlPlane(input) {
      const { stdout, stderr } = await execFileAsync("bash", ["-lc", input.command], {
        cwd: input.projectRoot,
        env: input.env === undefined ? process.env : { ...process.env, ...input.env },
        timeout: (input.timeoutSeconds ?? 20 * 60) * 1000,
        maxBuffer: 20 * 1024 * 1024,
      });
      return [stdout.toString(), stderr.toString()].filter(Boolean).join("\n").trim();
    },

    createDockerComposeExecutionTarget(input) {
      return new DockerComposeExecutionTarget({
        projectDir: input.projectRoot,
        composeFile: resolveProjectPath(input.projectRoot, input.composeFile),
        projectName: input.projectName,
        service: input.service,
        ...(input.workdir === undefined ? {} : { workdir: input.workdir }),
        ...(input.endpoints === undefined ? {} : { endpoints: input.endpoints }),
      });
    },

    createHostExecutionTarget(input) {
      return new HostExecutionTarget({
        projectDir: input.projectRoot,
        ...(input.workdir === undefined ? {} : { workdir: input.workdir }),
        ...(input.endpoints === undefined ? {} : { endpoints: input.endpoints }),
      });
    },

    createLocalTracker(input) {
      return createLocalTrackerProviderClient(input.trackerDir);
    },

    createLinearTracker(input) {
      const config = requireLinearTrackerConfig(input.env);
      return new LinearTrackerAdapter({
        ...config,
        ...(input.defaultTeamKey === undefined ? {} : { defaultTeamKey: input.defaultTeamKey }),
      }, input.fetchImpl);
    },

    createJiraTracker(input) {
      const config = requireJiraTrackerConfig(input.env);
      return new JiraTrackerAdapter({
        ...config,
        ...(input.defaultProjectKey === undefined ? {} : { defaultProjectKey: input.defaultProjectKey }),
      }, input.fetchImpl);
    },
  };
}

export function createExtensionApi(registry: ExtensionRegistry): PiphonyExtensionAPI {
  const helpers = createExtensionHelpers();
  return {
    runtimePlatforms: {
      provide(provider: RuntimePlatformProvider) {
        registry.registerRuntimePlatform(provider);
      },
    },
    trackers: {
      provide(provider: TrackerProviderDefinition) {
        registry.registerTracker(provider);
      },
    },
    transitions: {
      preWorkItemTransition(hook: TransitionHook) {
        registry.registerPreTransitionHook(hook);
      },
      postWorkItemTransition(hook: TransitionHook) {
        registry.registerPostTransitionHook(hook);
      },
    },
    helpers,
  };
}

function resolveProjectPath(projectRoot: string, candidate: string): string {
  return resolve(projectRoot, candidate);
}
