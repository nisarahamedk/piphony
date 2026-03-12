import { describe, expect, test, vi } from "vitest";
import { createGitHubCliTool } from "../src/pi/github-cli.js";

describe("github_cli tool", () => {
  test("runs structured git commands without repeating the driver prefix", async () => {
    const onEvent = vi.fn();
    const tool = createGitHubCliTool({ cwd: process.cwd(), onEvent });

    const result = await (tool.execute as any)("tool-call-1", {
      driver: "git",
      args: "--version",
    }, undefined, undefined, undefined);

    const textParts = result.content.filter(
      (part: unknown): part is { type: "text"; text: string } =>
        typeof part === "object" && part !== null && (part as { type?: string }).type === "text",
    );
    expect(textParts.map((part: { type: "text"; text: string }) => part.text).join("\n")).toContain("git version");
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "github_cli.call" }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "github_cli.complete" }));
  });

  test("rejects args that repeat the selected driver", async () => {
    const tool = createGitHubCliTool({ cwd: process.cwd() });

    await expect(
      (tool.execute as any)("tool-call-2", {
        driver: "gh",
        args: "gh pr status",
      }, undefined, undefined, undefined),
    ).rejects.toThrow("must not repeat the 'gh' driver prefix");
  });
});
