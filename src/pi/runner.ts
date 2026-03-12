import {
  AuthStorage,
  createAgentSession,
  createBashTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import type { TrackerAdapter, RuntimeProvider, WorkItem } from "../core/types.js";
import { normalizeForMatch } from "../core/utils.js";
import type { AgentTypeDefinition, ThinkingLevel } from "./agent-types.js";
import { resolveAgentType } from "./agent-types.js";
import { createGitHubCliTool, type GitHubCliEvent } from "./github-cli.js";
import { createTrackerTools, type TrackerToolEvent } from "./tracker-tools.js";

export interface PiRunOptions {
  cwd: string;
  prompt: string;
  agentType?: string;
  workItem?: WorkItem;
  tracker?: TrackerAdapter;
  runtimeProvider?: RuntimeProvider;
  modelPreference?: string;
  thinkingLevel?: ThinkingLevel;
  githubCliCwd?: string;
  onTrackerEvent?: (event: TrackerToolEvent) => Promise<void> | void;
  onGitHubEvent?: (event: GitHubCliEvent) => Promise<void> | void;
}

export interface PiRunResult {
  output: string;
  usedModel?: string;
}

export async function runPiTask(options: PiRunOptions): Promise<PiRunResult> {
  const agentType = await resolveAgentType(options.cwd, options.agentType);
  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);
  const availableModels = await modelRegistry.getAvailable();
  const model = resolvePreferredModel(availableModels, options.modelPreference ?? agentType.model);

  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    appendSystemPromptOverride: (base) => {
      if (agentType.systemPromptAppend === undefined || agentType.systemPromptAppend.trim() === "") {
        return base;
      }
      return [...base, agentType.systemPromptAppend];
    },
  });
  await resourceLoader.reload();

  const tools = buildBuiltinTools(options.cwd, agentType, options.runtimeProvider);
  const customTools: any[] = [];
  if (options.tracker !== undefined && options.workItem !== undefined) {
    customTools.push(
      ...(options.onTrackerEvent === undefined
        ? createTrackerTools({ tracker: options.tracker, workItem: options.workItem })
        : createTrackerTools({ tracker: options.tracker, workItem: options.workItem, onEvent: options.onTrackerEvent })),
    );
  }
  if (options.githubCliCwd !== undefined) {
    customTools.push(
      options.onGitHubEvent === undefined
        ? createGitHubCliTool({ cwd: options.githubCliCwd })
        : createGitHubCliTool({ cwd: options.githubCliCwd, onEvent: options.onGitHubEvent }),
    );
  }

  const sessionConfig = {
    cwd: options.cwd,
    authStorage,
    modelRegistry,
    model,
    thinkingLevel: options.thinkingLevel ?? agentType.thinkingLevel,
    resourceLoader,
    tools,
    sessionManager: SessionManager.inMemory(options.cwd),
  };

  const { session } = await createAgentSession(
    customTools.length === 0 ? sessionConfig : { ...sessionConfig, customTools },
  );

  try {
    await session.prompt(options.prompt);
    await session.agent.waitForIdle();

    const finalOutput = session.getLastAssistantText() ?? "";
    const usedModel = model === undefined ? undefined : `${model.provider}/${model.id}`;
    return usedModel === undefined ? { output: finalOutput } : { output: finalOutput, usedModel };
  } finally {
    session.dispose();
  }
}

function buildBuiltinTools(cwd: string, agentType: AgentTypeDefinition, runtimeProvider?: RuntimeProvider): any[] {
  const wanted = new Set(agentType.tools);
  const tools: any[] = [];

  if (wanted.has("read")) {
    tools.push(createReadTool(cwd));
  }
  if (wanted.has("bash")) {
    const spawnHook = runtimeProvider?.createBashSpawnHook?.();
    tools.push(spawnHook === undefined ? createBashTool(cwd) : createBashTool(cwd, { spawnHook }));
  }
  if (wanted.has("grep")) {
    tools.push(createGrepTool(cwd));
  }
  if (wanted.has("find")) {
    tools.push(createFindTool(cwd));
  }
  if (wanted.has("ls")) {
    tools.push(createLsTool(cwd));
  }
  return tools;
}

function resolvePreferredModel(available: any[], preferred: string): any | undefined {
  const normalizedPreferred = normalizeForMatch(preferred);
  return (
    available.find((model) => normalizeForMatch(`${model.provider}/${model.id}`) === normalizedPreferred) ??
    available.find((model) => normalizeForMatch(model.id) === normalizedPreferred) ??
    available.find((model) => normalizeForMatch(String(model.label ?? "")) === normalizedPreferred) ??
    available.find((model) => normalizeForMatch(`${model.provider}/${model.id}`).includes(normalizedPreferred)) ??
    available.find((model) => normalizeForMatch(model.id).includes(normalizedPreferred)) ??
    available[0]
  );
}
