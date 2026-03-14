import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import { actor, event, queue, setup } from "rivetkit";
import { createPiSessionController } from "../pi/runner.js";
import type { PiSessionController } from "../pi/session-controller.js";
import { createChiefOfStaffExtension } from "./pi-extension.js";
import { errorMessage } from "../core/errors.js";
import type { ProviderCapacityService } from "../pi/provider-middleware.js";
import type { ChiefOfStaffServices, TrackerPageContext } from "./types.js";

export interface ChiefOfStaffActorOptions {
  cwd: string;
  sessionRootDir: string;
  userId?: string;
  services: ChiefOfStaffServices;
  providerCapacityService?: ProviderCapacityService;
  modelPreference?: string;
}

export interface ChiefOfStaffMessage {
  id: string;
  role: "user" | "assistant";
  sender: string;
  content: string;
  createdAt: number;
}

export interface ChiefOfStaffStatus {
  state: "idle" | "thinking" | "retrying" | "error";
  updatedAt: number;
  error?: string;
  message?: string;
  retryAt?: number;
  provider?: string;
}

export interface ChiefOfStaffPromptMessage {
  text: string;
  sender?: string;
}

export interface ChiefOfStaffResponseEvent {
  messageId: string;
  delta: string;
  content: string;
  done: boolean;
  error?: string;
}

export interface ChiefOfStaffActorState {
  messages: ChiefOfStaffMessage[];
  status: ChiefOfStaffStatus;
  pageContext: TrackerPageContext | null;
}

interface ChiefOfStaffActorVars {
  controller: PiSessionController | null;
}

const MAX_MESSAGES = 50;

export function createChiefOfStaffRegistry(options: ChiefOfStaffActorOptions): any {
  const chiefOfStaff = actor({
    state: {
      messages: [] as ChiefOfStaffMessage[],
      status: {
        state: "idle",
        updatedAt: Date.now(),
      } as ChiefOfStaffStatus,
      pageContext: null as TrackerPageContext | null,
    },
    createVars: (): ChiefOfStaffActorVars => ({
      controller: null,
    }),
    queues: {
      prompt: queue<ChiefOfStaffPromptMessage>(),
    },
    events: {
      messageAdded: event<ChiefOfStaffMessage>(),
      status: event<ChiefOfStaffStatus>(),
      response: event<ChiefOfStaffResponseEvent>(),
      pageContextUpdated: event<TrackerPageContext | null>(),
    },
    run: async (c) => {
      for await (const queued of c.queue.iter()) {
        if (queued.name !== "prompt") {
          continue;
        }
        const text = queued.body?.text?.trim();
        if (!text) {
          continue;
        }

        const sender = queued.body.sender?.trim() || "Operator";
        const userMessage = appendMessage(c.state, {
          id: buildId("cos-user"),
          role: "user",
          sender,
          content: text,
          createdAt: Date.now(),
        });
        c.broadcast("messageAdded", userMessage);

        const assistantMessage = appendMessage(c.state, {
          id: buildId("cos-assistant"),
          role: "assistant",
          sender: "Chief of Staff",
          content: "",
          createdAt: Date.now(),
        });
        c.broadcast("messageAdded", assistantMessage);

        c.state.status = {
          state: "thinking",
          updatedAt: Date.now(),
        };
        c.broadcast("status", c.state.status);

        const controller = await ensureController(c, options);
        const unsubscribe = controller.subscribe((event: AgentSessionEvent) => {
          const anyEvent = event as any;
          if (event.type === "message_update" && anyEvent.assistantMessageEvent?.type === "text_delta") {
            assistantMessage.content += anyEvent.assistantMessageEvent.delta;
            c.broadcast("response", {
              messageId: assistantMessage.id,
              delta: anyEvent.assistantMessageEvent.delta,
              content: assistantMessage.content,
              done: false,
            });
            return;
          }
          if (event.type === "auto_retry_start") {
            const providerStatus = controller.getProviderStatus();
            const provider = providerStatus?.provider ?? controller.usedModel?.split("/")[0];
            c.state.status = {
              state: "retrying",
              updatedAt: Date.now(),
              error: event.errorMessage,
              message: formatRetryMessage(provider, providerStatus?.cooldownUntil ?? Date.now() + event.delayMs),
              retryAt: providerStatus?.cooldownUntil ?? Date.now() + event.delayMs,
              ...(provider === undefined ? {} : { provider }),
            };
            c.broadcast("status", c.state.status);
          }
        });

        try {
          const result = await controller.runPrompt(buildPrompt(c.state.pageContext, text));
          assistantMessage.content = result.output || assistantMessage.content;
          c.broadcast("response", {
            messageId: assistantMessage.id,
            delta: "",
            content: assistantMessage.content,
            done: true,
          });
          c.state.status = {
            state: "idle",
            updatedAt: Date.now(),
          };
          c.broadcast("status", c.state.status);
        } catch (error) {
          const message = errorMessage(error);
          const providerStatus = controller.getProviderStatus();
          assistantMessage.content = assistantMessage.content || humanizeChiefOfStaffError(message, providerStatus?.provider, providerStatus?.cooldownUntil);
          c.state.status = {
            state: "error",
            updatedAt: Date.now(),
            error: message,
            message: assistantMessage.content,
            ...(providerStatus?.cooldownUntil === undefined ? {} : { retryAt: providerStatus.cooldownUntil }),
            ...(providerStatus?.provider === undefined ? {} : { provider: providerStatus.provider }),
          };
          c.broadcast("response", {
            messageId: assistantMessage.id,
            delta: "",
            content: assistantMessage.content,
            done: true,
            error: message,
          });
          c.broadcast("status", c.state.status);
        } finally {
          unsubscribe();
        }
      }
    },
    actions: {
      getHistory: (c) => c.state.messages,
      getStatus: (c) => c.state.status,
      getPageContext: (c) => c.state.pageContext,
      setPageContext: (c, pageContext: TrackerPageContext | null) => {
        c.state.pageContext = pageContext;
        c.broadcast("pageContextUpdated", pageContext);
        return pageContext;
      },
    },
  });

  return setup({ use: { chiefOfStaff } });
}

async function ensureController(c: { key: string[]; vars: ChiefOfStaffActorVars }, options: ChiefOfStaffActorOptions): Promise<PiSessionController> {
  if (c.vars.controller !== null) {
    return c.vars.controller;
  }
  c.vars.controller = await createPiSessionController({
    cwd: options.cwd,
    agentType: "chief_of_staff",
    modelPreference: options.modelPreference ?? "minimax/MiniMax-M2.5",
    thinkingLevel: "off",
    extensionFactories: [createChiefOfStaffExtension(options.services)],
    ...(options.providerCapacityService === undefined ? {} : { providerCapacityService: options.providerCapacityService }),
    requestClass: "interactive",
    sessionDir: `${options.sessionRootDir.replace(/\/$/, "")}/${c.key.join("-")}`,
  });
  return c.vars.controller;
}

function buildPrompt(pageContext: TrackerPageContext | null, text: string): string {
  if (pageContext === null) {
    return text;
  }
  if (pageContext.kind === "issue") {
    return [
      `Current tracker page context: issue ${pageContext.provider}/${pageContext.identifier}.`,
      text,
    ].join("\n\n");
  }
  return [
    `Current tracker page context: board overview for ${pageContext.provider}${pageContext.projectKey === undefined ? "" : ` project ${pageContext.projectKey}`}.`,
    text,
  ].join("\n\n");
}

function humanizeChiefOfStaffError(message: string, provider: string | undefined, retryAt: number | undefined): string {
  if (message.includes("usage limit")) {
    return `${provider ?? "The provider"} is currently at its usage limit. Try again after approximately ${formatRetryTime(retryAt)}.`;
  }
  if (message.includes("capacity") || message.includes("Traffic is currently high") || message.includes("rate_limit_error")) {
    return `${provider ?? "The provider"} is under heavy load right now. Try again after approximately ${formatRetryTime(retryAt)}.`;
  }
  return "I hit a snag while working on that.";
}

function formatRetryMessage(provider: string | undefined, retryAt: number | undefined): string {
  return `${provider ?? "Provider"} is retrying. Next attempt around ${formatRetryTime(retryAt)}.`;
}

function formatRetryTime(retryAt: number | undefined): string {
  return retryAt === undefined ? "later" : new Date(retryAt).toLocaleTimeString();
}

function appendMessage(state: ChiefOfStaffActorState, message: ChiefOfStaffMessage): ChiefOfStaffMessage {
  state.messages.push(message);
  if (state.messages.length > MAX_MESSAGES) {
    state.messages.splice(0, state.messages.length - MAX_MESSAGES);
  }
  return message;
}

function buildId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
