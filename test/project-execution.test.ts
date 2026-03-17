import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadOnboardedProjectExecution } from "../src/project/execution.js";
import { detectProjectOnboardingDefaults, onboardProject } from "../src/onboarding/project-onboarding.js";
import { isProjectOnboarded } from "../src/extensions/runtime.js";

describe("project execution bootstrap", () => {
  test("onboarding generates extension files and runtime bootstrap loads them", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "piphony-project-onboard-"));
    await mkdir(join(projectRoot, "infra"), { recursive: true });
    await writeFile(join(projectRoot, "infra", "docker-compose.local.yml"), "services: {}\n", "utf8");

    const defaults = detectProjectOnboardingDefaults(projectRoot);
    const result = await onboardProject({
      projectRoot,
      trackerProvider: "jira",
      trackerProjectKey: "APP",
      trackerBoardId: "42",
      model: "minimax/MiniMax-M2.5",
      execution: defaults.execution,
    });

    expect(result.extensionsDir).toBe(join(projectRoot, ".piphony", "extensions"));
    expect(existsSync(join(projectRoot, ".piphony", "extensions", "environment.ts"))).toBe(true);
    expect(existsSync(join(projectRoot, ".piphony", "extensions", "tracker.ts"))).toBe(true);
    expect(existsSync(join(projectRoot, ".piphony", "workflow.json"))).toBe(false);

    const execution = loadOnboardedProjectExecution(projectRoot);
    expect(execution.projectRoot).toBe(projectRoot);
    expect(execution.runtime.environmentProvider.id).toBe("repo/docker-compose");
    expect(execution.runtime.trackerProvider.provider).toBe("jira");

    await rm(projectRoot, { recursive: true, force: true });
  });

  test("loads user-global extensions when the repo has no project-local extensions", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "piphony-project-global-only-"));
    const fakeHome = await mkdtemp(join(tmpdir(), "piphony-home-"));
    const originalHome = process.env.HOME;
    const userExtensionsDir = join(fakeHome, ".piphony", "extensions");

    await mkdir(userExtensionsDir, { recursive: true });
    await writeFile(join(userExtensionsDir, "environment.ts"), `export default function (piphony) {
  piphony.environments.provide({
    id: "user/host",
    async prepareEnv(ctx) {
      return {
        executionTargets: {
          host: ctx.helpers.createHostExecutionTarget({ projectRoot: ctx.projectRoot }),
        },
        defaultExecutionTarget: "host",
      };
    },
    async tearDownEnv() {},
  });
}
`, "utf8");
    await writeFile(join(userExtensionsDir, "tracker.ts"), `export default function (piphony) {
  piphony.trackers.provide({
    id: "user/local",
    provider: "local",
    createTracker(ctx) {
      return ctx.helpers.createLocalTracker({ trackerDir: ctx.trackerDir });
    },
  });
}
`, "utf8");

    process.env.HOME = fakeHome;
    try {
      expect(isProjectOnboarded(projectRoot)).toBe(true);
      const execution = loadOnboardedProjectExecution(projectRoot);
      expect(execution.projectRoot).toBe(projectRoot);
      expect(execution.runtime.environmentProvider.id).toBe("user/host");
      expect(execution.runtime.trackerProvider.provider).toBe("local");
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      await rm(projectRoot, { recursive: true, force: true });
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  test("fails fast when the managed project is not onboarded", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "piphony-project-missing-ext-"));

    expect(isProjectOnboarded(projectRoot)).toBe(false);
    expect(() => loadOnboardedProjectExecution(projectRoot)).toThrow("Project is not onboarded");

    await rm(projectRoot, { recursive: true, force: true });
  });
});
