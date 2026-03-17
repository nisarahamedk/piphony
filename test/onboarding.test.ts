import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveTrackerSelectionConfig } from "../src/config/tracker-provider.js";
import { detectProjectOnboardingDefaults, onboardProject } from "../src/onboarding/project-onboarding.js";
import { resolveAgentType } from "../src/pi/agent-types.js";

describe("project onboarding", () => {
  test("detects onboarding defaults and writes repo-local extensions", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "piphony-onboard-test-"));
    await mkdir(join(projectRoot, "infra"), { recursive: true });
    await mkdir(join(projectRoot, "scripts", "piphony"), { recursive: true });
    await writeFile(join(projectRoot, "infra", "docker-compose.local.yml"), "services: {}\n", "utf8");
    await writeFile(join(projectRoot, "scripts", "piphony", "stack-prepare.sh"), "#!/usr/bin/env bash\n", "utf8");
    await writeFile(join(projectRoot, "scripts", "piphony", "teardown.sh"), "#!/usr/bin/env bash\n", "utf8");

    const defaults = detectProjectOnboardingDefaults(projectRoot);
    expect(defaults.execution.kind).toBe("docker_compose");
    if (defaults.execution.kind !== "docker_compose") {
      throw new Error("expected docker_compose defaults");
    }
    expect(defaults.execution.composeFile).toBe("infra/docker-compose.local.yml");
    expect(defaults.execution.prepareCommand).toBe("bash scripts/piphony/stack-prepare.sh");
    expect(defaults.execution.teardownCommand).toBe("bash scripts/piphony/teardown.sh");

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
    expect(existsSync(join(projectRoot, ".piphony", "agent-types.json"))).toBe(true);

    const trackerSource = await readFile(join(projectRoot, ".piphony", "extensions", "tracker.ts"), "utf8");
    expect(trackerSource).toContain('provider: "jira"');
    expect(trackerSource).toContain('defaultProjectKey: "APP"');
    expect(trackerSource).toContain('defaultBoardId: "42"');

    const selection = resolveTrackerSelectionConfig({}, projectRoot);
    expect(selection.trackerProvider).toBe("jira");
    expect(selection.trackerProjectKey).toBe("APP");
    expect(selection.trackerBoardId).toBe("42");

    const implementation = await resolveAgentType(projectRoot, "implementation");
    expect(implementation.model).toBe("minimax/MiniMax-M2.5");

    const chiefOfStaff = await resolveAgentType(projectRoot, "chief_of_staff");
    expect(chiefOfStaff.model).toBe("minimax/MiniMax-M2.5");
  });
});
