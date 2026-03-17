import type { SupportedTrackerProvider } from "../tracker/types.js";

export interface OnboardingEnvironmentTemplateInput {
  readonly kind: "host" | "docker_compose";
  readonly workdir?: string;
  readonly endpoints?: Record<string, string>;
  readonly composeFile?: string;
  readonly projectName?: string;
  readonly service?: string;
  readonly prepareCommand?: string;
  readonly teardownCommand?: string;
}

export function generateEnvironmentExtension(input: OnboardingEnvironmentTemplateInput): string {
  return input.kind === "docker_compose"
    ? generateDockerComposeEnvironmentExtension(input)
    : generateHostEnvironmentExtension(input);
}

export function generateTrackerExtension(input: {
  readonly trackerProvider: SupportedTrackerProvider;
  readonly trackerProjectKey?: string;
  readonly trackerBoardId?: string;
}): string {
  if (input.trackerProvider === "local") {
    return [
      "export default function (piphony) {",
      "  piphony.trackers.provide({",
      "    id: \"repo/local\",",
      "    provider: \"local\",",
      "    createTracker(ctx) {",
      "      return ctx.helpers.createLocalTracker({ trackerDir: ctx.trackerDir });",
      "    },",
      "  });",
      "}",
      "",
    ].join("\n");
  }

  if (input.trackerProvider === "linear") {
    return [
      "export default function (piphony) {",
      "  piphony.trackers.provide({",
      "    id: \"repo/linear\",",
      "    provider: \"linear\",",
      input.trackerProjectKey === undefined ? undefined : `    defaultProjectKey: ${quote(input.trackerProjectKey)},`,
      "    createTracker(ctx) {",
      "      return ctx.helpers.createLinearTracker({",
      "        env: ctx.env,",
      "        fetchImpl: ctx.fetchImpl,",
      input.trackerProjectKey === undefined ? undefined : `        defaultTeamKey: ${quote(input.trackerProjectKey)},`,
      "      });",
      "    },",
      "  });",
      "}",
      "",
    ].filter(Boolean).join("\n");
  }

  return [
    "export default function (piphony) {",
    "  piphony.trackers.provide({",
    "    id: \"repo/jira\",",
    "    provider: \"jira\",",
    input.trackerProjectKey === undefined ? undefined : `    defaultProjectKey: ${quote(input.trackerProjectKey)},`,
    input.trackerBoardId === undefined ? undefined : `    defaultBoardId: ${quote(input.trackerBoardId)},`,
    "    createTracker(ctx) {",
    "      return ctx.helpers.createJiraTracker({",
    "        env: ctx.env,",
    "        fetchImpl: ctx.fetchImpl,",
    input.trackerProjectKey === undefined ? undefined : `        defaultProjectKey: ${quote(input.trackerProjectKey)},`,
    "      });",
    "    },",
    "  });",
    "}",
    "",
  ].filter(Boolean).join("\n");
}

export function generateValidationTransitionExtension(command = "DOCKER_CONFIG=/tmp/piphony-docker-config npm run validate:main"): string {
  return [
    "export default function (piphony) {",
    "  piphony.transitions.preWorkItemTransition(async (event, ctx) => {",
    "    if (event.toState !== \"human_review\") {",
    "      return;",
    "    }",
    `    await ctx.helpers.execControlPlane({ projectRoot: ctx.projectRoot, command: ${quote(command)} });`,
    "  });",
    "}",
    "",
  ].join("\n");
}

function generateDockerComposeEnvironmentExtension(input: OnboardingEnvironmentTemplateInput): string {
  return [
    "export default function (piphony) {",
    "  piphony.environments.provide({",
    "    id: \"repo/docker-compose\",",
    "    async prepareEnv(ctx) {",
    input.prepareCommand === undefined
      ? undefined
      : `      await ctx.helpers.execControlPlane({ projectRoot: ctx.projectRoot, command: ${quote(input.prepareCommand)}, timeoutSeconds: 2700 });`,
    "      const projectName = (process.env.PIPHONY_DOCKER_COMPOSE_PROJECT_NAME?.trim() || process.env.OPENCLAWSSEUM_COMPOSE_PROJECT?.trim() || " + quote(input.projectName ?? "piphony-project") + ");",
    "      return {",
    "        executionTargets: {",
    `          [${quote(input.service ?? "runtime")}]: ctx.helpers.createDockerComposeExecutionTarget({`,
    "            projectRoot: ctx.projectRoot,",
    `            composeFile: ${quote(input.composeFile ?? "docker-compose.yml")},`,
    "            projectName,",
    `            service: ${quote(input.service ?? "runtime")},`,
    input.workdir === undefined ? undefined : `            workdir: ${quote(input.workdir)},`,
    input.endpoints === undefined ? undefined : `            endpoints: ${JSON.stringify(input.endpoints)},`,
    "          }),",
    "        },",
    `        defaultExecutionTarget: ${quote(input.service ?? "runtime")},`,
    input.endpoints === undefined ? undefined : `        endpoints: ${JSON.stringify(input.endpoints)},`,
    "      };",
    "    },",
    "    async tearDownEnv(_prepared, ctx) {",
    input.teardownCommand === undefined
      ? "      return;"
      : `      await ctx.helpers.execControlPlane({ projectRoot: ctx.projectRoot, command: ${quote(input.teardownCommand)}, timeoutSeconds: 2700 });`,
    "    },",
    "  });",
    "}",
    "",
  ].filter(Boolean).join("\n");
}

function generateHostEnvironmentExtension(input: OnboardingEnvironmentTemplateInput): string {
  return [
    "export default function (piphony) {",
    "  piphony.environments.provide({",
    "    id: \"repo/host\",",
    "    async prepareEnv(ctx) {",
    input.prepareCommand === undefined
      ? undefined
      : `      await ctx.helpers.execControlPlane({ projectRoot: ctx.projectRoot, command: ${quote(input.prepareCommand)}, timeoutSeconds: 2700 });`,
    "      return {",
    "        executionTargets: {",
    "          host: ctx.helpers.createHostExecutionTarget({",
    "            projectRoot: ctx.projectRoot,",
    input.workdir === undefined ? undefined : `            workdir: ${quote(input.workdir)},`,
    input.endpoints === undefined ? undefined : `            endpoints: ${JSON.stringify(input.endpoints)},`,
    "          }),",
    "        },",
    "        defaultExecutionTarget: \"host\",",
    input.endpoints === undefined ? undefined : `        endpoints: ${JSON.stringify(input.endpoints)},`,
    "      };",
    "    },",
    "    async tearDownEnv(_prepared, ctx) {",
    input.teardownCommand === undefined
      ? "      return;"
      : `      await ctx.helpers.execControlPlane({ projectRoot: ctx.projectRoot, command: ${quote(input.teardownCommand)}, timeoutSeconds: 2700 });`,
    "    },",
    "  });",
    "}",
    "",
  ].filter(Boolean).join("\n");
}

function quote(value: string): string {
  return JSON.stringify(value);
}

