import { describe, expect, test } from "vitest";
import { createProviderCapacityExtension } from "../src/pi/provider-capacity-extension.js";
import { ProviderCapacityService } from "../src/pi/provider-middleware.js";

type HandlerMap = Record<string, Array<(event?: any, ctx?: any) => unknown>>;

function createFakePi() {
  const handlers: HandlerMap = {};
  return {
    handlers,
    on(event: string, handler: (event?: any, ctx?: any) => unknown) {
      handlers[event] = handlers[event] ?? [];
      handlers[event]!.push(handler);
    },
  };
}

async function runHandlers(map: HandlerMap, event: string, payload?: any): Promise<void> {
  for (const handler of map[event] ?? []) {
    await handler(payload, {});
  }
}

describe("createProviderCapacityExtension", () => {
  test("acquires on provider request and releases on assistant message end", async () => {
    const service = new ProviderCapacityService({
      resolvePolicy: () => ({
        concurrency: 1,
        trafficCooldownBaseMs: 20,
        trafficCooldownMaxMs: 20,
        usageLimitCooldownMs: 120,
      }),
    });
    const key = { provider: "minimax", credentialFingerprint: "abc" };

    const first = createFakePi();
    createProviderCapacityExtension({ service, key, requestClass: "background" })(first as any);
    await runHandlers(first.handlers, "before_provider_request");
    expect(service.getStatus(key)?.runningCount).toBe(1);

    const second = createFakePi();
    createProviderCapacityExtension({ service, key, requestClass: "background" })(second as any);
    let secondGranted = false;
    const secondAcquire = runHandlers(second.handlers, "before_provider_request").then(() => {
      secondGranted = true;
    });

    await Promise.resolve();
    expect(secondGranted).toBe(false);

    await runHandlers(first.handlers, "message_end", { message: { role: "assistant", stopReason: "stop" } });
    await secondAcquire;
    expect(secondGranted).toBe(true);
    expect(service.getStatus(key)?.runningCount).toBe(1);

    await runHandlers(second.handlers, "message_end", { message: { role: "assistant", stopReason: "stop" } });
    expect(service.getStatus(key)?.runningCount).toBe(0);
  });

  test("records usage-limit cooldown from assistant errors", async () => {
    const service = new ProviderCapacityService({
      resolvePolicy: () => ({
        concurrency: 1,
        trafficCooldownBaseMs: 20,
        trafficCooldownMaxMs: 20,
        usageLimitCooldownMs: 120,
      }),
    });
    const key = { provider: "minimax", credentialFingerprint: "abc" };
    const fakePi = createFakePi();

    createProviderCapacityExtension({ service, key, requestClass: "interactive" })(fakePi as any);
    await runHandlers(fakePi.handlers, "before_provider_request");
    await runHandlers(fakePi.handlers, "message_end", {
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: '429 {"type":"error","error":{"type":"rate_limit_error","message":"usage limit exceeded (2056)"}}',
      },
    });

    expect(service.getStatus(key)?.lastErrorCode).toBe("2056");
    expect((service.getStatus(key)?.cooldownUntil ?? 0) > Date.now()).toBe(true);
  });
});
