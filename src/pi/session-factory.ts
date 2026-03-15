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
  SettingsManager,
  type ExtensionFactory,
} from "@mariozechner/pi-coding-agent";
import { createHash } from "node:crypto";
import type { RuntimeProvider, TrackerAdapter, WorkItem } from "../core/types.js";
import { normalizeForMatch } from "../core/utils.js";
import type { AgentTypeDefinition, ThinkingLevel } from "./agent-types.js";
import { resolveAgentType } from "./agent-types.js";
import { createGitHubCliTool, type GitHubCliEvent } from "./github-cli.js";
import { createProviderCapacityExtension } from "./provider-capacity-extension.js";
import {
  type ProviderCapacityService,
  type ProviderRequestClass,
  type ProviderSchedulingKey,
} from "./provider-middleware.js";
import { createTrackerTools, type TrackerToolEvent } from "./tracker-tools.js";

export interface PiSessionFactoryOptions {
  cwd: string;
  agentType?: string;
  workItem?: WorkItem;
  tracker?: TrackerAdapter;
  runtimeProvider?: RuntimeProvider;
  modelPreference?: string;
  thinkingLevel?: ThinkingLevel;
  githubCliCwd?: string;
  onTrackerEvent?: (event: TrackerToolEvent) => Promise<void> | void;
  onGitHubEvent?: (event: GitHubCliEvent) => Promise<void> | void;
  customTools?: any[];
  extensionFactories?: ExtensionFactory[];
  providerCapacityService?: ProviderCapacityService;
  requestClass?: ProviderRequestClass;
  sessionDir?: string;
}

export interface CreatedPiSession {
  session: any;
  usedModel?: string;
  schedulingKey?: ProviderSchedulingKey;
  agentType: AgentTypeDefinition;
}

export async function createPiSession(options: PiSessionFactoryOptions): Promise<CreatedPiSession> {
  const agentType = await resolveAgentType(options.cwd, options.agentType);
  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);
  const availableModels = await modelRegistry.getAvailable();
  const model = resolvePreferredModel(availableModels, options.modelPreference ?? agentType.model);
  const schedulingKey = await buildSchedulingKey(modelRegistry, model);
  const requestClass = options.requestClass ?? resolveRequestClass(agentType.name);
  const settingsManager = SettingsManager.inMemory({
    retry: resolveRetrySettings(requestClass, model?.provider),
  });
  const extensionFactories = mergeExtensionFactories({
    ...(options.extensionFactories === undefined ? {} : { extensionFactories: options.extensionFactories }),
    ...(options.providerCapacityService === undefined ? {} : { providerCapacityService: options.providerCapacityService }),
    ...(schedulingKey === undefined ? {} : { schedulingKey }),
    requestClass,
  });

  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    settingsManager,
    ...(extensionFactories.length === 0 ? {} : { extensionFactories }),
    appendSystemPromptOverride: (base) => {
      if (agentType.systemPromptAppend === undefined || agentType.systemPromptAppend.trim() === "") {
        return base;
      }
      return [...base, agentType.systemPromptAppend];
    },
  });
  await resourceLoader.reload();

  const tools = buildBuiltinTools(options.cwd, agentType, options.runtimeProvider);
  const customTools: any[] = [...(options.customTools ?? [])];
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

  const sessionManager = options.sessionDir === undefined
    ? SessionManager.inMemory(options.cwd)
    : SessionManager.create(options.cwd, options.sessionDir);

  const sessionConfig = {
    cwd: options.cwd,
    authStorage,
    modelRegistry,
    model,
    thinkingLevel: options.thinkingLevel ?? agentType.thinkingLevel,
    resourceLoader,
    tools,
    sessionManager,
    settingsManager,
  };

  const { session } = await createAgentSession(
    customTools.length === 0 ? sessionConfig : { ...sessionConfig, customTools },
  );

  const usedModel = model === undefined ? undefined : `${model.provider}/${model.id}`;
  if (usedModel === undefined) {
    return schedulingKey === undefined ? { session, agentType } : { session, schedulingKey, agentType };
  }
  return schedulingKey === undefined
    ? { session, usedModel, agentType }
    : { session, usedModel, schedulingKey, agentType };
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

async function buildSchedulingKey(modelRegistry: ModelRegistry, model: any | undefined): Promise<ProviderSchedulingKey | undefined> {
  if (model === undefined || typeof model.provider !== "string" || model.provider.trim() === "") {
    return undefined;
  }
  const apiKey = await modelRegistry.getApiKey(model);
  return {
    provider: model.provider,
    credentialFingerprint: fingerprintCredential(apiKey),
  };
}

function fingerprintCredential(apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey.trim() === "") {
    return "anonymous";
  }
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

function mergeExtensionFactories(input: {
  extensionFactories?: ExtensionFactory[];
  providerCapacityService?: ProviderCapacityService;
  schedulingKey?: ProviderSchedulingKey;
  requestClass: ProviderRequestClass;
}): ExtensionFactory[] {
  const factories = [...(input.extensionFactories ?? [])];
  if (input.providerCapacityService !== undefined && input.schedulingKey !== undefined) {
    factories.unshift(createProviderCapacityExtension({
      service: input.providerCapacityService,
      key: input.schedulingKey,
      requestClass: input.requestClass,
      ...(input.requestClass === "interactive" ? { maxWaitMs: 90_000 } : { maxWaitMs: 20 * 60_000 }),
    }));
  }
  return factories;
}

function resolveRequestClass(agentTypeName: string): ProviderRequestClass {
  return agentTypeName === "chief_of_staff" ? "interactive" : "background";
}

function resolveRetrySettings(requestClass: ProviderRequestClass, provider: string | undefined) {
  if (normalizeForMatch(provider ?? "") === "minimax") {
    return requestClass === "interactive"
      ? { enabled: true, maxRetries: 4, baseDelayMs: 10_000, maxDelayMs: 60_000 }
      : { enabled: true, maxRetries: 10, baseDelayMs: 10_000, maxDelayMs: 60_000 };
  }
  return requestClass === "interactive"
    ? { enabled: true, maxRetries: 3, baseDelayMs: 2_000, maxDelayMs: 30_000 }
    : { enabled: true, maxRetries: 5, baseDelayMs: 2_000, maxDelayMs: 60_000 };
}

function resolvePreferredModel(available: any[], preferred: string): any | undefined {
  const normalizedPreferred = normalizeForMatch(preferred);
  const found =
    available.find((model) => normalizeForMatch(`${model.provider}/${model.id}`) === normalizedPreferred) ??
    available.find((model) => normalizeForMatch(model.id) === normalizedPreferred) ??
    available.find((model) => normalizeForMatch(String(model.label ?? "")) === normalizedPreferred) ??
    available.find((model) => normalizeForMatch(`${model.provider}/${model.id}`).includes(normalizedPreferred)) ??
    available.find((model) => normalizeForMatch(model.id).includes(normalizedPreferred));

  if (found === undefined) {
    throw new Error(
      `Requested model '${preferred}' is not available. ` +
      `Available models: ${available.map((m) => `${m.provider}/${m.id}`).join(", ")}`,
    );
  }

  return found;
}
