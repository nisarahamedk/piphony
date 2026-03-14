import { describe, expect, test } from "vitest";
import { PiSessionAbortedError, PiSessionController } from "../src/pi/session-controller.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFakeSession() {
  const idleGate = createDeferred<void>();
  let lastAssistantText: string | undefined;
  let pendingMessageCount = 0;
  let disposed = false;
  let promptCalls = 0;
  let abortCalls = 0;
  let steerCalls = 0;
  let followUpCalls = 0;
  const subscribers = new Set<(event: any) => void>();

  const session = {
    sessionId: "session-test-1",
    sessionFile: "/tmp/pi-session.jsonl",
    isStreaming: false,
    get pendingMessageCount() {
      return pendingMessageCount;
    },
    messages: [] as any[],
    thinkingLevel: "off",
    subscribe(listener: (event: any) => void) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    async prompt(_text: string) {
      promptCalls += 1;
      pendingMessageCount += 1;
    },
    agent: {
      waitForIdle: async () => {
        await idleGate.promise;
        pendingMessageCount = 0;
      },
    },
    getLastAssistantText() {
      return lastAssistantText;
    },
    getSteeringMessages() {
      return steerCalls === 0 ? [] : ["steer"];
    },
    getFollowUpMessages() {
      return followUpCalls === 0 ? [] : ["follow-up"];
    },
    async steer(_text: string) {
      steerCalls += 1;
    },
    async followUp(_text: string) {
      followUpCalls += 1;
    },
    async abort() {
      abortCalls += 1;
    },
    dispose() {
      disposed = true;
    },
    emitAssistantText(text: string) {
      lastAssistantText = text;
      this.messages.push({ role: "assistant", stopReason: "stop" });
      for (const subscriber of subscribers) {
        subscriber({ type: "message_update" });
      }
    },
    emitAssistantError(message: string) {
      this.messages.push({ role: "assistant", stopReason: "error", errorMessage: message });
    },
    stats() {
      return { disposed, promptCalls, abortCalls, steerCalls, followUpCalls };
    },
    idleGate,
  };

  return session;
}

describe("PiSessionController", () => {
  test("enforces lifecycle transitions and rejects duplicate turns", async () => {
    const session = createFakeSession();
    const controller = PiSessionController.fromCreatedSession({ session });

    const runPromise = controller.runPrompt("hello");
    expect(controller.snapshot().state).toBe("running");
    await expect(controller.runPrompt("again")).rejects.toThrow("Pi session controller is not ready for a new turn");

    await controller.steer("steer it");
    await controller.followUp("follow it up");
    expect(session.stats().steerCalls).toBe(1);
    expect(session.stats().followUpCalls).toBe(1);

    session.emitAssistantText("done");
    session.idleGate.resolve();
    await expect(runPromise).resolves.toEqual({ output: "done" });
    expect(controller.snapshot().state).toBe("ready");
  });

  test("moves into aborting state and surfaces PiSessionAbortedError", async () => {
    const session = createFakeSession();
    const controller = PiSessionController.fromCreatedSession({ session });

    const runPromise = controller.runPrompt("hello");
    await controller.abort();
    expect(controller.snapshot().state).toBe("aborting");
    expect(session.stats().abortCalls).toBe(1);

    session.emitAssistantText("partial");
    session.idleGate.resolve();
    await expect(runPromise).rejects.toBeInstanceOf(PiSessionAbortedError);
    expect(controller.snapshot().state).toBe("ready");
  });

  test("rejects operations after disposal", async () => {
    const session = createFakeSession();
    const controller = PiSessionController.fromCreatedSession({ session, usedModel: "provider/model" });
    const unsubscribe = controller.subscribe(() => undefined);
    unsubscribe();

    await controller.dispose();
    expect(session.stats().disposed).toBe(true);
    expect(controller.snapshot().state).toBe("disposed");
    expect(controller.snapshot().usedModel).toBe("provider/model");

    await expect(controller.runPrompt("hello")).rejects.toThrow("Pi session controller is not ready for a new turn");
    await expect(controller.waitForIdle()).rejects.toThrow("Pi session controller is disposed");
    expect(() => controller.subscribe(() => undefined)).toThrow("Pi session controller is disposed");
  });

  test("surfaces terminal assistant errors as rich failures", async () => {
    const session = createFakeSession();
    const controller = PiSessionController.fromCreatedSession({ session });

    const runPromise = controller.runPrompt("hello");
    session.emitAssistantError("model exploded");
    session.idleGate.resolve();
    await expect(runPromise).rejects.toThrow("model exploded");
  });
});
