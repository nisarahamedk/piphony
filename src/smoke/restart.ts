import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ensureProgressFile, prepareWorktree, readProgressFile } from "../index.js";

const execFileAsync = promisify(execFile);
const repoPath = await mkdtemp(join(tmpdir(), "piphony-restart-repo-"));
const runtimeRoot = await mkdtemp(join(tmpdir(), "piphony-runtime-"));
await execFileAsync("git", ["init", "-b", "main"], { cwd: repoPath });
await execFileAsync("git", ["config", "user.email", "smoke@example.com"], { cwd: repoPath });
await execFileAsync("git", ["config", "user.name", "Smoke Test"], { cwd: repoPath });
await writeFile(join(repoPath, "README.md"), "# Restart Smoke\n", "utf8");
await execFileAsync("git", ["add", "."], { cwd: repoPath });
await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoPath });
await execFileAsync("git", ["checkout", "-b", "LOCAL-401"], { cwd: repoPath });
await ensureProgressFile(repoPath, {
  issueContext: "LOCAL-401 existing branch",
  completedWork: ["created branch"],
  currentPlan: ["reuse branch in fresh runtime"],
  latestValidation: ["not run"],
  currentBlocker: "None",
  nextBestStep: "Prepare fresh runtime",
  importantFiles: [".symphony/PROGRESS.md"],
});
await execFileAsync("git", ["add", "."], { cwd: repoPath });
await execFileAsync("git", ["commit", "-m", "progress"], { cwd: repoPath });
await execFileAsync("git", ["checkout", "main"], { cwd: repoPath });

const reused = await prepareWorktree({
  repoPath,
  runtimeRoot,
  issueIdentifier: "LOCAL-401",
  issueState: "in_progress",
  prState: "open",
});
if (!reused.reusedExistingBranch) throw new Error("Expected existing branch to be reused");
const progress = await readProgressFile(reused.worktreePath);
if (!progress?.includes("LOCAL-401 existing branch")) throw new Error("Expected PROGRESS.md to be available in reused worktree");

const fresh = await prepareWorktree({
  repoPath,
  runtimeRoot,
  issueIdentifier: "LOCAL-402",
  issueState: "todo",
  prState: "merged",
});
if (fresh.reusedExistingBranch) throw new Error("Expected fresh branch path for invalid reuse case");
console.log(JSON.stringify({ ok: true, reused, fresh }, null, 2));
