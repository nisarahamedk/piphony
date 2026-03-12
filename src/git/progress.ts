import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ensureDir } from "../core/utils.js";

export interface ProgressSections {
  issueContext: string;
  completedWork: string[];
  currentPlan: string[];
  latestValidation: string[];
  currentBlocker: string;
  nextBestStep: string;
  importantFiles: string[];
}

export const DEFAULT_PROGRESS: ProgressSections = {
  issueContext: "Pending issue context.",
  completedWork: [],
  currentPlan: [],
  latestValidation: [],
  currentBlocker: "None",
  nextBestStep: "Define the next concrete action.",
  importantFiles: [],
};

export function progressFilePath(workspacePath: string): string {
  return join(workspacePath, ".symphony", "PROGRESS.md");
}

export function renderProgress(sections: ProgressSections): string {
  const bullet = (items: string[]) => (items.length === 0 ? "- None" : items.map((item) => `- ${item}`).join("\n"));
  return `# Symphony Progress\n\n## Issue / Branch Context\n${sections.issueContext}\n\n## Completed Work\n${bullet(sections.completedWork)}\n\n## Current Plan\n${bullet(sections.currentPlan)}\n\n## Latest Validation Results\n${bullet(sections.latestValidation)}\n\n## Current Blocker\n${sections.currentBlocker}\n\n## Next Best Step\n${sections.nextBestStep}\n\n## Important Files\n${bullet(sections.importantFiles)}\n`;
}

export async function ensureProgressFile(workspacePath: string, sections: ProgressSections = DEFAULT_PROGRESS): Promise<string> {
  const path = progressFilePath(workspacePath);
  await ensureDir(dirname(path));
  await writeFile(path, renderProgress(sections), "utf8");
  return path;
}

export async function readProgressFile(workspacePath: string): Promise<string | undefined> {
  try {
    return await readFile(progressFilePath(workspacePath), "utf8");
  } catch {
    return undefined;
  }
}
