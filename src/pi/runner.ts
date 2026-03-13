import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { TrackerAdapter, RuntimeProvider, WorkItem } from "../core/types.js";
import type { ThinkingLevel } from "./agent-types.js";
import type { GitHubCliEvent } from "./github-cli.js";
import type { TrackerToolEvent } from "./tracker-tools.js";
import { PiSessionController, type PiSessionControllerOptions, type PiTurnResult } from "./session-controller.js";

export interface PiRunOptions extends PiSessionControllerOptions {
  prompt: string;
}

export interface PiRunResult {
  output: string;
  usedModel?: string;
}

export async function createPiSessionController(options: PiSessionControllerOptions): Promise<PiSessionController> {
  return PiSessionController.create(options);
}

export async function runPiTask(options: PiRunOptions): Promise<PiRunResult> {
  const controller = await createPiSessionController(options);
  try {
    const result = await controller.runPrompt(options.prompt);
    return result.usedModel === undefined ? { output: result.output } : { output: result.output, usedModel: result.usedModel };
  } finally {
    await controller.dispose();
  }
}

export type { PiSessionControllerOptions, PiTurnResult };
