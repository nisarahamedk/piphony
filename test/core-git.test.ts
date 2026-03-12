import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { branchExists, ensureProgressFile, prepareWorktree, readProgressFile } from "../src/index.js";

const execFileAsync = promisify(execFile);

describe("git helpers", () => {
  test("prepareWorktree reuses valid branch and exposes progress file", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "piphony-git-test-"));
    const runtimeRoot = await mkdtemp(join(tmpdir(), "piphony-git-runtime-"));
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoPath });
    await execFileAsync("git", ["config", "user.email", "smoke@example.com"], { cwd: repoPath });
    await execFileAsync("git", ["config", "user.name", "Smoke Test"], { cwd: repoPath });
    await writeFile(join(repoPath, "README.md"), "# Test\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: repoPath });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoPath });
    await execFileAsync("git", ["checkout", "-b", "LOCAL-T2"], { cwd: repoPath });
    await ensureProgressFile(repoPath);
    await execFileAsync("git", ["add", "."], { cwd: repoPath });
    await execFileAsync("git", ["commit", "-m", "progress"], { cwd: repoPath });
    await execFileAsync("git", ["checkout", "main"], { cwd: repoPath });

    expect(await branchExists(repoPath, "LOCAL-T2")).toBe(true);
    const prepared = await prepareWorktree({
      repoPath,
      runtimeRoot,
      issueIdentifier: "LOCAL-T2",
      issueState: "in_progress",
      prState: "open",
    });
    expect(prepared.reusedExistingBranch).toBe(true);
    expect(await readProgressFile(prepared.workspacePath)).toContain("Symphony Progress");
  });
});
