import type { AgentSessionEvent, PromptOptions } from "@mariozechner/pi-coding-agent";
import type { ProviderCapacityService, ProviderCapacitySnapshot, ProviderSchedulingKey } from "./provider-middleware.js";
import { createPiSession, type PiSessionFactoryOptions } from "./session-factory.js";

export interface PiSessionControllerOptions extends PiSessionFactoryOptions {}

export interface PiTurnResult {
  output: string;
  usedModel?: string;
}

export type PiSessionLifecycleStateKind = "ready" | "running" | "aborting" | "disposed";

export interface PiSessionSnapshot {
  state: PiSessionLifecycleStateKind;
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

type ControllerLifecycleState =
  | { kind: "ready" }
  | { kind: "running"; turnPromise: Promise<PiTurnResult> }
  | { kind: "aborting"; turnPromise: Promise<PiTurnResult> }
  | { kind: "disposed" };

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
  private lifecycle: ControllerLifecycleState = { kind: "ready" };
  private abortedDuringTurn = false;

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

  static fromCreatedSession(input: {
    session: any;
    usedModel?: string;
    providerCapacityService?: ProviderCapacityService;
    schedulingKey?: ProviderSchedulingKey;
  }): PiSessionController {
    return new PiSessionController(input.session, input.usedModel, input.providerCapacityService, input.schedulingKey);
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.assertNotDisposed();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async runPrompt(text: string, options?: PromptOptions): Promise<PiTurnResult> {
    this.assertState("ready", "Pi session controller is not ready for a new turn");
    this.abortedDuringTurn = false;

    const turnPromise = (async () => {
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
        if (this.lifecycle.kind !== "disposed") {
          this.lifecycle = { kind: "ready" };
        }
      }
    })();

    this.lifecycle = { kind: "running", turnPromise };
    return turnPromise;
  }

  snapshot(): PiSessionSnapshot {
    const snapshot: PiSessionSnapshot = {
      state: this.lifecycle.kind,
      sessionId: this.session.sessionId,
      ...(this.session.sessionFile === undefined ? {} : { sessionFile: this.session.sessionFile }),
      isStreaming: this.session.isStreaming,
      pendingMessageCount: this.session.pendingMessageCount,
      steeringMessages: this.session.getSteeringMessages(),
      followUpMessages: this.session.getFollowUpMessages(),
      ...(this.session.getLastAssistantText() === undefined ? {} : { lastAssistantText: this.session.getLastAssistantText() }),
      messageCount: this.session.messages.length,
      thinkingLevel: this.session.thinkingLevel,
      ...(this.usedModel === undefined ? {} : { usedModel: this.usedModel }),
    };
    return snapshot;
  }

  async steer(text: string): Promise<void> {
    this.assertState(["running", "aborting"], "Pi session controller is not running");
    await this.session.steer(text);
  }

  async followUp(text: string): Promise<void> {
    this.assertState(["running", "aborting"], "Pi session controller is not running");
    await this.session.followUp(text);
  }

  async abort(): Promise<void> {
    if (this.lifecycle.kind === "aborting") {
      return;
    }
    if (this.lifecycle.kind !== "running") {
      throw new Error("Pi session controller has no active turn to abort");
    }
    const turnPromise = this.lifecycle.turnPromise;
    this.abortedDuringTurn = true;
    this.lifecycle = { kind: "aborting", turnPromise };
    await this.session.abort();
  }

  async waitForIdle(): Promise<void> {
    this.assertNotDisposed();
    await this.session.agent.waitForIdle();
  }

  getProviderStatus(): ProviderCapacitySnapshot | undefined {
    return this.providerCapacityService !== undefined && this.schedulingKey !== undefined
      ? this.providerCapacityService.getStatus(this.schedulingKey)
      : undefined;
  }

  async dispose(): Promise<void> {
    if (this.lifecycle.kind === "disposed") {
      return;
    }
    this.lifecycle = { kind: "disposed" };
    this.unsubscribe();
    this.session.dispose();
  }

  private assertNotDisposed(): void {
    if (this.lifecycle.kind === "disposed") {
      throw new Error("Pi session controller is disposed");
    }
  }

  private assertState(expected: PiSessionLifecycleStateKind | PiSessionLifecycleStateKind[], message: string): void {
    const expectedStates = Array.isArray(expected) ? expected : [expected];
    if (expectedStates.includes(this.lifecycle.kind)) {
      return;
    }
    throw new Error(message);
  }
}
