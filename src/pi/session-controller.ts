import type { AgentSessionEvent, PromptOptions } from "@mariozechner/pi-coding-agent";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { TrackerAdapter, RuntimeProvider, WorkItem } from "../core/types.js";
import type { ThinkingLevel } from "./agent-types.js";
import type { ProviderCapacityService, ProviderCapacitySnapshot, ProviderSchedulingKey } from "./provider-middleware.js";
import { createPiSession, type PiSessionFactoryOptions } from "./session-factory.js";

export interface PiSessionControllerOptions extends PiSessionFactoryOptions {}

export interface PiTurnResult {
  output: string;
  usedModel?: string;
}

export interface PiSessionSnapshot {
  sessionId: string;
  sessionFile?: string;
  isStreaming: boolean;
  pendingMessageCount: number;
  steeringMessages: readonly string[];
  followUpMessages: readonly string[];
  lastAssistantText?: string;
  messageCount: number;
  thinkingLevel: string;
  usedModel?: string;
}

export class PiSessionAbortedError extends Error {
  constructor(message = "Pi session aborted") {
    super(message);
    this.name = "PiSessionAbortedError";
  }
}

function getLastAssistantError(messages: any[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") {
      continue;
    }
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      return typeof message.errorMessage === "string" && message.errorMessage.trim() !== ""
        ? message.errorMessage
        : `Pi assistant turn ended with ${message.stopReason}`;
    }
    return undefined;
  }
  return undefined;
}

export class PiSessionController {
  private readonly listeners = new Set<(event: AgentSessionEvent) => void>();
  private readonly unsubscribe: () => void;
  private activeTurnPromise: Promise<PiTurnResult> | undefined;
  private abortedDuringTurn = false;
  private disposed = false;

  private constructor(
    private readonly session: any,
    readonly usedModel: string | undefined,
    private readonly providerCapacityService: ProviderCapacityService | undefined,
    private readonly schedulingKey: ProviderSchedulingKey | undefined,
  ) {
    this.unsubscribe = this.session.subscribe((event: AgentSessionEvent) => {
      for (const listener of this.listeners) {
        listener(event);
      }
    });
  }

  static async create(options: PiSessionControllerOptions): Promise<PiSessionController> {
    const { session, usedModel, schedulingKey } = await createPiSession(options);
    return new PiSessionController(session, usedModel, options.providerCapacityService, schedulingKey);
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async runPrompt(text: string, options?: PromptOptions): Promise<PiTurnResult> {
    if (this.disposed) {
      throw new Error("Pi session controller is disposed");
    }
    if (this.activeTurnPromise !== undefined) {
      throw new Error("Pi session controller already has an active turn");
    }

    this.abortedDuringTurn = false;
    this.activeTurnPromise = (async () => {
      try {
        if (this.abortedDuringTurn) {
          throw new PiSessionAbortedError();
        }
        await this.session.prompt(text, options);
        await this.session.agent.waitForIdle();
        if (this.abortedDuringTurn) {
          throw new PiSessionAbortedError();
        }
        const terminalError = getLastAssistantError(this.session.messages);
        if (terminalError !== undefined) {
          throw new Error(terminalError);
        }
        const output = this.session.getLastAssistantText() ?? "";
        return this.usedModel === undefined ? { output } : { output, usedModel: this.usedModel };
      } finally {
        this.activeTurnPromise = undefined;
      }
    })();

    return this.activeTurnPromise;
  }

  snapshot(): PiSessionSnapshot {
    return this.usedModel === undefined
      ? {
          sessionId: this.session.sessionId,
          ...(this.session.sessionFile === undefined ? {} : { sessionFile: this.session.sessionFile }),
          isStreaming: this.session.isStreaming,
          pendingMessageCount: this.session.pendingMessageCount,
          steeringMessages: this.session.getSteeringMessages(),
          followUpMessages: this.session.getFollowUpMessages(),
          ...(this.session.getLastAssistantText() === undefined ? {} : { lastAssistantText: this.session.getLastAssistantText() }),
          messageCount: this.session.messages.length,
          thinkingLevel: this.session.thinkingLevel,
        }
      : {
          sessionId: this.session.sessionId,
          ...(this.session.sessionFile === undefined ? {} : { sessionFile: this.session.sessionFile }),
          isStreaming: this.session.isStreaming,
          pendingMessageCount: this.session.pendingMessageCount,
          steeringMessages: this.session.getSteeringMessages(),
          followUpMessages: this.session.getFollowUpMessages(),
          ...(this.session.getLastAssistantText() === undefined ? {} : { lastAssistantText: this.session.getLastAssistantText() }),
          messageCount: this.session.messages.length,
          thinkingLevel: this.session.thinkingLevel,
          usedModel: this.usedModel,
        };
  }

  async steer(text: string): Promise<void> {
    await this.session.steer(text);
  }

  async followUp(text: string): Promise<void> {
    await this.session.followUp(text);
  }

  async abort(): Promise<void> {
    this.abortedDuringTurn = true;
    await this.session.abort();
  }

  async waitForIdle(): Promise<void> {
    await this.session.agent.waitForIdle();
  }

  getProviderStatus(): ProviderCapacitySnapshot | undefined {
    return this.providerCapacityService !== undefined && this.schedulingKey !== undefined
      ? this.providerCapacityService.getStatus(this.schedulingKey)
      : undefined;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unsubscribe();
    this.session.dispose();
  }
}
