import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveTrackerSelectionConfig } from "../src/config/tracker-provider.js";
import { detectProjectOnboardingDefaults, onboardProject } from "../src/onboarding/project-onboarding.js";
import { resolveAgentType } from "../src/pi/agent-types.js";
import { readWorkflowSync } from "../src/workflow/loader.js";

describe("project onboarding", () => {
  test("detects onboarding defaults and writes repo-local config", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "piphony-onboard-test-"));
    await mkdir(join(projectRoot, "infra"), { recursive: true });
    await mkdir(join(projectRoot, "scripts", "piphony"), { recursive: true });
    await writeFile(join(projectRoot, "infra", "docker-compose.local.yml"), "services: {}\n", "utf8");
    await writeFile(join(projectRoot, "scripts", "piphony", "prepare.sh"), "#!/usr/bin/env bash\n", "utf8");
    await writeFile(join(projectRoot, "scripts", "piphony", "validate.sh"), "#!/usr/bin/env bash\n", "utf8");

    const defaults = detectProjectOnboardingDefaults(projectRoot);
    expect(defaults.runtime.composeFile).toBe("infra/docker-compose.local.yml");
    expect(defaults.phases.prepare?.command).toBe("bash scripts/piphony/prepare.sh");
    expect(defaults.phases.validate?.command).toBe("bash scripts/piphony/validate.sh");

    const result = await onboardProject({
      projectRoot,
      trackerProvider: "jira",
      trackerProjectKey: "APP",
      trackerBoardId: "42",
      model: "minimax/MiniMax-M2.5",
      runtime: defaults.runtime,
      phases: defaults.phases,
    });

    const workflow = readWorkflowSync(projectRoot);
    expect(workflow?.tracker?.provider).toBe("jira");
    expect(workflow?.tracker?.projectKey).toBe("APP");
    expect(workflow?.tracker?.boardId).toBe("42");
    expect(result.workflowPath).toBe(join(projectRoot, ".piphony", "workflow.json"));

    const selection = resolveTrackerSelectionConfig({}, projectRoot);
    expect(selection.trackerProvider).toBe("jira");
    expect(selection.trackerProjectKey).toBe("APP");
    expect(selection.trackerBoardId).toBe("42");

    const implementation = await resolveAgentType(projectRoot, "implementation");
    expect(implementation.model).toBe("minimax/MiniMax-M2.5");
    expect(implementation.tools).toEqual(["read", "bash", "grep", "find", "ls"]);

    const chiefOfStaff = await resolveAgentType(projectRoot, "chief_of_staff");
    expect(chiefOfStaff.model).toBe("minimax/MiniMax-M2.5");
    expect(chiefOfStaff.tools).toEqual([]);
  });
});
