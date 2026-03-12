import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

const execFileAsync = promisify(execFile);

export interface GitHubCliEvent {
  event: string;
  details?: Record<string, unknown>;
}

const schema = Type.Object({
  driver: Type.Union([
    Type.Literal("git"),
    Type.Literal("gh"),
  ], {
    description:
      "Command driver for control-plane repository housekeeping. Use 'git' for branch/status/commit/push operations and 'gh' for pull request and GitHub operations. Do not include the driver again in args.",
  }),
  args: Type.String({
    description:
      "Arguments passed to the selected driver only. Example for driver='git': 'checkout -b PIPHONY-123'. Example for driver='gh': 'pr create --draft --head PIPHONY-123 --title ...'. Do not prefix args with 'git' or 'gh'.",
  }),
  cwd: Type.Optional(Type.String({ description: "Working directory on the control plane. Defaults to the configured repository path." })),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds." })),
});

export function createGitHubCliTool(input: {
  cwd: string;
  onEvent?: (event: GitHubCliEvent) => Promise<void> | void;
}): ToolDefinition {
  return {
    name: "github_cli",
    label: "github_cli",
    description:
      "Run control-plane git and GitHub CLI housekeeping commands. Use this instead of bash for branch creation, checkout, status, commit, push, pull request creation/update, PR inspection, and PR comments. Set driver='git' or driver='gh', and pass only the remaining arguments in args. Do not call bash for git/gh when this tool is available.",
    parameters: schema,
    execute: async (_toolCallId, params: { driver: "git" | "gh"; args: string; cwd?: string; timeout?: number }) => {
      const args = params.args.trim();
      if (args === "") {
        throw new Error("github_cli args must not be empty");
      }
      if (args === params.driver || args.startsWith(`${params.driver} `)) {
        throw new Error(`github_cli args must not repeat the '${params.driver}' driver prefix`);
      }

      const cwd = params.cwd ?? input.cwd;
      const timeoutMs = (params.timeout ?? 120) * 1000;
      const command = `${params.driver} ${args}`;
      await input.onEvent?.({ event: "github_cli.call", details: { driver: params.driver, args, command, cwd } });
      try {
        const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
          cwd,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
        });
        await input.onEvent?.({ event: "github_cli.complete", details: { driver: params.driver, args, command, cwd } });
        const text = [stdout.toString().trim(), stderr.toString().trim()].filter(Boolean).join("\n");
        return {
          content: [{ type: "text", text: text || "OK" }],
          details: { cwd, driver: params.driver, args, command },
        };
      } catch (error: unknown) {
        const anyError = error as { message?: string; stdout?: { toString(): string }; stderr?: { toString(): string } };
        await input.onEvent?.({
          event: "github_cli.failed",
          details: { driver: params.driver, args, command, cwd, message: anyError.message ?? "unknown_error" },
        });
        const text = [anyError.stdout?.toString().trim() ?? "", anyError.stderr?.toString().trim() ?? anyError.message ?? ""]
          .filter(Boolean)
          .join("\n");
        return {
          content: [{ type: "text", text }],
          details: { cwd, driver: params.driver, args, command, failed: true },
        };
      }
    },
  };
}
