import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CanonicalState, WorktreePreparationResult } from "../core/types.js";
import { ensureDir, sanitizeBranchName } from "../core/utils.js";

const execFileAsync = promisify(execFile);

export interface BranchReuseInput {
  repoPath: string;
  issueIdentifier: string;
  issueState: CanonicalState;
  prState?: "open" | "closed" | "merged" | "absent";
}

export async function runGit(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repoPath });
  return stdout.toString().trim();
}

export async function branchExists(repoPath: string, branchName: string): Promise<boolean> {
  try {
    await runGit(repoPath, ["show-ref", "--verify", `refs/heads/${branchName}`]);
    return true;
  } catch {
    return false;
  }
}

export async function validateBranchReuse(input: BranchReuseInput): Promise<{ reuse: boolean; reason: string; branchName: string }> {
  const branchName = sanitizeBranchName(input.issueIdentifier);
  const exists = await branchExists(input.repoPath, branchName);

  if (!exists) {
    return { reuse: false, reason: "branch_missing", branchName };
  }
  if (input.issueState === "done" || input.issueState === "cancelled") {
    return { reuse: false, reason: "issue_terminal", branchName };
  }
  if (input.prState === "merged" || input.prState === "closed") {
    return { reuse: false, reason: "pr_invalid", branchName };
  }
  return { reuse: true, reason: "branch_reusable", branchName };
}

export async function prepareWorktree(input: {
  repoPath: string;
  runtimeRoot: string;
  issueIdentifier: string;
  issueState: CanonicalState;
  prState?: "open" | "closed" | "merged" | "absent";
}): Promise<WorktreePreparationResult> {
  const branchName = sanitizeBranchName(input.issueIdentifier);
  const result = await validateBranchReuse(input);
  await ensureDir(input.runtimeRoot);
  const worktreePath = join(input.runtimeRoot, branchName.toLowerCase());

  try {
    await execFileAsync("git", ["worktree", "remove", worktreePath, "--force"], { cwd: input.repoPath });
  } catch {
    // noop
  }

  if (result.reuse) {
    await execFileAsync("git", ["worktree", "add", worktreePath, branchName], { cwd: input.repoPath });
    return {
      branchName,
      worktreePath,
      reusedExistingBranch: true,
      reason: result.reason,
    };
  }

  if (await branchExists(input.repoPath, branchName)) {
    await execFileAsync("git", ["branch", "-D", branchName], { cwd: input.repoPath });
  }
  await execFileAsync("git", ["worktree", "add", "-b", branchName, worktreePath, "HEAD"], { cwd: input.repoPath });
  return {
    branchName,
    worktreePath,
    reusedExistingBranch: false,
    reason: result.reason,
  };
}
