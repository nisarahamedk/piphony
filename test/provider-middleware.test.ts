import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, test } from "vitest";
import {
  ProviderCapacityExceededError,
  ProviderCapacityService,
  type ProviderCapacityPolicy,
} from "../src/pi/provider-middleware.js";

const minimaxKey = { provider: "minimax", credentialFingerprint: "abc" };
const otherKey = { provider: "anthropic", credentialFingerprint: "abc" };

function createService(policy: Partial<ProviderCapacityPolicy> = {}): ProviderCapacityService {
  return new ProviderCapacityService({
    resolvePolicy: (provider) => ({
      concurrency: provider === "minimax" ? 1 : 2,
      trafficCooldownBaseMs: 20,
      trafficCooldownMaxMs: 20,
      usageLimitCooldownMs: 120,
      ...policy,
    }),
  });
}

describe("ProviderCapacityService", () => {
  test("serializes MiniMax requests per provider credential", async () => {
    const service = createService();
    const lease1 = await service.acquire({ key: minimaxKey, requestClass: "background" });

    let grantedSecond = false;
    const secondPromise = service.acquire({ key: minimaxKey, requestClass: "background" }).then((lease) => {
      grantedSecond = true;
      return lease;
    });

    await sleep(20);
    expect(grantedSecond).toBe(false);

    await lease1.release();
    const lease2 = await secondPromise;
    expect(grantedSecond).toBe(true);
    await lease2.release();
  });

  test("allows separate MiniMax credentials to run independently", async () => {
    const service = createService();
    const otherCredential = { provider: "minimax", credentialFingerprint: "def" };

    const [lease1, lease2] = await Promise.all([
      service.acquire({ key: minimaxKey, requestClass: "background" }),
      service.acquire({ key: otherCredential, requestClass: "background" }),
    ]);

    expect(service.getStatus(minimaxKey)?.runningCount).toBe(1);
    expect(service.getStatus(otherCredential)?.runningCount).toBe(1);

    await Promise.all([lease1.release(), lease2.release()]);
  });

  test("uses bounded concurrency for non-MiniMax providers", async () => {
    const service = createService();
    const lease1 = await service.acquire({ key: otherKey, requestClass: "background" });
    const lease2 = await service.acquire({ key: otherKey, requestClass: "background" });

    let grantedThird = false;
    const thirdPromise = service.acquire({ key: otherKey, requestClass: "background" }).then((lease) => {
      grantedThird = true;
      return lease;
    });

    await sleep(20);
    expect(grantedThird).toBe(false);

    await lease1.release();
    const lease3 = await thirdPromise;
    expect(grantedThird).toBe(true);

    await Promise.all([lease2.release(), lease3.release()]);
  });

  test("enforces usage-limit cooldown and exposes retry timing", async () => {
    const service = createService();
    service.settleAttempt({
      key: minimaxKey,
      errorMessage: '429 {"type":"error","error":{"type":"rate_limit_error","message":"usage limit exceeded (2056)"}}',
    });

    await expect(service.acquire({ key: minimaxKey, requestClass: "interactive", maxWaitMs: 10 }))
      .rejects.toBeInstanceOf(ProviderCapacityExceededError);

    const snapshot = service.getStatus(minimaxKey);
    expect(snapshot?.lastErrorCode).toBe("2056");
    expect(typeof snapshot?.cooldownUntil).toBe("number");
    expect((snapshot?.cooldownUntil ?? 0) > Date.now()).toBe(true);
  });

  test("releases waiting work after transient traffic cooldown", async () => {
    const service = createService();
    const lease1 = await service.acquire({ key: minimaxKey, requestClass: "background" });
    service.settleAttempt({
      key: minimaxKey,
      errorMessage: '429 {"type":"error","error":{"type":"rate_limit_error","message":"Traffic is currently high (2062)"}}',
    });

    const startedAt = Date.now();
    const secondPromise = service.acquire({ key: minimaxKey, requestClass: "background" });
    await lease1.release();
    const lease2 = await secondPromise;
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);
    await lease2.release();
  });
});
