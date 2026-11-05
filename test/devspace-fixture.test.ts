import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { cloneDevSpaceFixtureProject } from "../src/fixtures/devspace-fixture.js";

const execFileAsync = promisify(execFile);

describe("cloneDevSpaceFixtureProject", () => {
  it("materializes all sibling repos as clean temp git repositories", async () => {
    const fixture = await cloneDevSpaceFixtureProject();

    try {
      expect(fixture.workspaceRoot).toContain(fixture.tempRoot);
      expect(fixture.frontendRoot).toContain(fixture.tempRoot);
      expect(fixture.gatewayRoot).toContain(fixture.tempRoot);
      expect(fixture.backendRoot).toContain(fixture.tempRoot);

      await expect(stat(`${fixture.workspaceRoot}/.git`)).resolves.toBeDefined();
      await expect(stat(`${fixture.frontendRoot}/.git`)).resolves.toBeDefined();
      await expect(stat(`${fixture.gatewayRoot}/.git`)).resolves.toBeDefined();
      await expect(stat(`${fixture.backendRoot}/.git`)).resolves.toBeDefined();

      // DevSpace may convert relative paths to absolute paths during smoke run
      // Check for project name which is consistent regardless of path format
      const workspaceConfig = await readFile(`${fixture.workspaceRoot}/devspace.yaml`, "utf8");
      expect(workspaceConfig).toContain("devspace-fixture-frontend");
      expect(workspaceConfig).toContain("devspace-fixture-gateway");
      expect(workspaceConfig).toContain("devspace-fixture-backend");

      const frontendStatus = await execFileAsync("git", ["-C", fixture.frontendRoot, "status", "--short"]);
      const gatewayStatus = await execFileAsync("git", ["-C", fixture.gatewayRoot, "status", "--short"]);
      const backendStatus = await execFileAsync("git", ["-C", fixture.backendRoot, "status", "--short"]);
      const workspaceStatus = await execFileAsync("git", ["-C", fixture.workspaceRoot, "status", "--short"]);

      expect(frontendStatus.stdout).toBe("");
      expect(gatewayStatus.stdout).toBe("");
      expect(backendStatus.stdout).toBe("");
      expect(workspaceStatus.stdout).toBe("");
    } finally {
      await fixture.cleanup();
    }

    await expect(stat(fixture.tempRoot)).rejects.toThrow();
  });
});
