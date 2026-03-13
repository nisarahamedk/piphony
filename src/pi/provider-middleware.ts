export interface ProviderSchedulingKey {
  provider: string;
  credentialFingerprint: string;
}

export type ProviderRequestClass = "interactive" | "background";
export type ProviderCapacityErrorCode = "2056" | "2062";

export interface ProviderCapacityPolicy {
  concurrency: number;
  trafficCooldownBaseMs: number;
  trafficCooldownMaxMs: number;
  usageLimitCooldownMs: number;
}

export interface ProviderCapacitySnapshot {
  provider: string;
  credentialFingerprint: string;
  concurrency: number;
  runningCount: number;
  queuedCount: number;
  cooldownUntil?: number;
  lastError?: string;
  lastErrorCode?: ProviderCapacityErrorCode;
  updatedAt: number;
}

export interface AcquireProviderCapacityInput {
  key: ProviderSchedulingKey;
  requestClass: ProviderRequestClass;
  maxWaitMs?: number;
}

export interface SettleProviderAttemptInput {
  key: ProviderSchedulingKey;
  errorMessage?: string;
}

export interface ProviderCapacityLease {
  release(): Promise<void>;
}

export interface ProviderCapacityServiceOptions {
  resolvePolicy?: (provider: string) => ProviderCapacityPolicy;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

interface LaneWaiter {
  requestClass: ProviderRequestClass;
  maxWaitAt: number | undefined;
  resolve: (lease: ProviderCapacityLease) => void;
  reject: (reason?: unknown) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | undefined;
}

interface LaneState {
  key: ProviderSchedulingKey;
  policy: ProviderCapacityPolicy;
  runningCount: number;
  queue: LaneWaiter[];
  cooldownUntil: number | undefined;
  lastError: string | undefined;
  lastErrorCode: ProviderCapacityErrorCode | undefined;
  updatedAt: number;
  transientFailureCount: number;
  drainTimer: ReturnType<typeof setTimeout> | undefined;
}

const DEFAULT_MINIMAX_POLICY: ProviderCapacityPolicy = {
  concurrency: 1,
  trafficCooldownBaseMs: 10_000,
  trafficCooldownMaxMs: 60_000,
  usageLimitCooldownMs: 15 * 60_000,
};

const DEFAULT_PROVIDER_POLICY: ProviderCapacityPolicy = {
  concurrency: 2,
  trafficCooldownBaseMs: 2_000,
  trafficCooldownMaxMs: 15_000,
  usageLimitCooldownMs: 60_000,
};

export class ProviderCapacityExceededError extends Error {
  constructor(
    readonly provider: string,
    readonly requestClass: ProviderRequestClass,
    readonly retryAt: number | undefined,
    readonly code: ProviderCapacityErrorCode | undefined,
  ) {
    super(buildCapacityExceededMessage(provider, requestClass, retryAt, code));
    this.name = "ProviderCapacityExceededError";
  }
}

export class ProviderCapacityService {
  private readonly lanes = new Map<string, LaneState>();
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
  private readonly resolvePolicy: (provider: string) => ProviderCapacityPolicy;

  constructor(options: ProviderCapacityServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    this.resolvePolicy = options.resolvePolicy ?? resolveDefaultProviderPolicy;
  }

  async acquire(input: AcquireProviderCapacityInput): Promise<ProviderCapacityLease> {
    const lane = this.getLane(input.key);
    const now = this.now();
    const maxWaitAt = input.maxWaitMs === undefined ? undefined : now + input.maxWaitMs;

    if (lane.cooldownUntil !== undefined && maxWaitAt !== undefined && lane.cooldownUntil > maxWaitAt) {
      throw new ProviderCapacityExceededError(lane.key.provider, input.requestClass, lane.cooldownUntil, lane.lastErrorCode);
    }

    return new Promise<ProviderCapacityLease>((resolve, reject) => {
      const waiter: LaneWaiter = {
        requestClass: input.requestClass,
        maxWaitAt,
        resolve,
        reject,
        timeoutHandle: undefined,
      };
      if (maxWaitAt !== undefined) {
        const delayMs = Math.max(0, maxWaitAt - this.now());
        waiter.timeoutHandle = this.setTimer(() => {
          this.removeWaiter(lane, waiter);
          reject(new ProviderCapacityExceededError(lane.key.provider, waiter.requestClass, lane.cooldownUntil, lane.lastErrorCode));
          this.notifyLaneUpdated(lane);
        }, delayMs);
      }
      lane.queue.push(waiter);
      this.notifyLaneUpdated(lane);
      this.drainLane(lane);
    });
  }

  async release(input: { key: ProviderSchedulingKey }): Promise<void> {
    const lane = this.getLane(input.key);
    if (lane.runningCount > 0) {
      lane.runningCount -= 1;
    }
    lane.updatedAt = this.now();
    this.notifyLaneUpdated(lane);
    this.drainLane(lane);
  }

  settleAttempt(input: SettleProviderAttemptInput): void {
    const lane = this.getLane(input.key);
    lane.updatedAt = this.now();
    if (input.errorMessage === undefined || input.errorMessage.trim() === "") {
      lane.lastError = undefined;
      lane.lastErrorCode = undefined;
      lane.cooldownUntil = undefined;
      lane.transientFailureCount = 0;
      this.clearDrainTimer(lane);
      this.notifyLaneUpdated(lane);
      return;
    }

    lane.lastError = input.errorMessage;
    const code = classifyProviderErrorCode(input.key.provider, input.errorMessage);
    lane.lastErrorCode = code;
    if (code === "2056") {
      lane.cooldownUntil = this.now() + lane.policy.usageLimitCooldownMs;
      lane.transientFailureCount = 0;
      this.scheduleDrainAtCooldown(lane);
      this.notifyLaneUpdated(lane);
      return;
    }
    if (code === "2062") {
      lane.transientFailureCount += 1;
      const delayMs = Math.min(
        lane.policy.trafficCooldownBaseMs * 2 ** Math.max(0, lane.transientFailureCount - 1),
        lane.policy.trafficCooldownMaxMs,
      );
      lane.cooldownUntil = this.now() + delayMs;
      this.scheduleDrainAtCooldown(lane);
      this.notifyLaneUpdated(lane);
      return;
    }

    lane.cooldownUntil = undefined;
    lane.transientFailureCount = 0;
    this.clearDrainTimer(lane);
    this.notifyLaneUpdated(lane);
  }

  getStatus(key: ProviderSchedulingKey): ProviderCapacitySnapshot | undefined {
    const lane = this.lanes.get(buildLaneKey(key));
    if (lane === undefined) {
      return undefined;
    }
    return this.snapshotLane(lane);
  }

  private getLane(key: ProviderSchedulingKey): LaneState {
    const laneKey = buildLaneKey(key);
    const existing = this.lanes.get(laneKey);
    if (existing !== undefined) {
      return existing;
    }
    const created: LaneState = {
      key,
      policy: this.resolvePolicy(key.provider),
      runningCount: 0,
      queue: [],
      cooldownUntil: undefined,
      lastError: undefined,
      lastErrorCode: undefined,
      updatedAt: this.now(),
      transientFailureCount: 0,
      drainTimer: undefined,
    };
    this.lanes.set(laneKey, created);
    return created;
  }

  private drainLane(lane: LaneState): void {
    this.clearDrainTimer(lane);
    while (lane.runningCount < lane.policy.concurrency && lane.queue.length > 0) {
      const now = this.now();
      if (lane.cooldownUntil !== undefined && lane.cooldownUntil > now) {
        this.scheduleDrainAtCooldown(lane);
        return;
      }
      const waiter = lane.queue.shift()!;
      if (waiter.maxWaitAt !== undefined && waiter.maxWaitAt <= now) {
        this.clearWaiterTimeout(waiter);
        waiter.reject(new ProviderCapacityExceededError(lane.key.provider, waiter.requestClass, lane.cooldownUntil, lane.lastErrorCode));
        continue;
      }
      lane.runningCount += 1;
      lane.updatedAt = now;
      this.clearWaiterTimeout(waiter);
      waiter.resolve({
        release: async () => {
          await this.release({ key: lane.key });
        },
      });
    }
    this.notifyLaneUpdated(lane);
  }

  private scheduleDrainAtCooldown(lane: LaneState): void {
    this.clearDrainTimer(lane);
    if (lane.cooldownUntil === undefined) {
      return;
    }
    const delayMs = Math.max(0, lane.cooldownUntil - this.now());
    lane.drainTimer = this.setTimer(() => {
      lane.drainTimer = undefined;
      this.drainLane(lane);
    }, delayMs);
  }

  private clearDrainTimer(lane: LaneState): void {
    if (lane.drainTimer === undefined) {
      return;
    }
    this.clearTimer(lane.drainTimer);
    lane.drainTimer = undefined;
  }

  private removeWaiter(lane: LaneState, waiter: LaneWaiter): void {
    const index = lane.queue.indexOf(waiter);
    if (index !== -1) {
      lane.queue.splice(index, 1);
    }
    this.clearWaiterTimeout(waiter);
  }

  private clearWaiterTimeout(waiter: LaneWaiter): void {
    if (waiter.timeoutHandle === undefined) {
      return;
    }
    this.clearTimer(waiter.timeoutHandle);
    waiter.timeoutHandle = undefined;
  }

  private notifyLaneUpdated(lane: LaneState): void {
    lane.updatedAt = this.now();
  }

  private snapshotLane(lane: LaneState): ProviderCapacitySnapshot {
    return {
      provider: lane.key.provider,
      credentialFingerprint: lane.key.credentialFingerprint,
      concurrency: lane.policy.concurrency,
      runningCount: lane.runningCount,
      queuedCount: lane.queue.length,
      ...(lane.cooldownUntil === undefined ? {} : { cooldownUntil: lane.cooldownUntil }),
      ...(lane.lastError === undefined ? {} : { lastError: lane.lastError }),
      ...(lane.lastErrorCode === undefined ? {} : { lastErrorCode: lane.lastErrorCode }),
      updatedAt: lane.updatedAt,
    };
  }
}

export function resolveDefaultProviderPolicy(provider: string): ProviderCapacityPolicy {
  return normalizeProvider(provider) === "minimax" ? DEFAULT_MINIMAX_POLICY : DEFAULT_PROVIDER_POLICY;
}

export function classifyProviderErrorCode(provider: string, errorMessage: string): ProviderCapacityErrorCode | undefined {
  if (normalizeProvider(provider) !== "minimax") {
    return undefined;
  }
  if (errorMessage.includes("(2056)")) {
    return "2056";
  }
  if (errorMessage.includes("(2062)")) {
    return "2062";
  }
  return undefined;
}

function buildCapacityExceededMessage(
  provider: string,
  requestClass: ProviderRequestClass,
  retryAt: number | undefined,
  code: ProviderCapacityErrorCode | undefined,
): string {
  const providerName = provider.trim() === "" ? "provider" : provider;
  const retryLabel = retryAt === undefined ? "later" : new Date(retryAt).toLocaleTimeString();
  if (code === "2056") {
    return `${providerName} usage limit is active for ${requestClass} requests. Retry after approximately ${retryLabel}.`;
  }
  return `${providerName} capacity is currently saturated for ${requestClass} requests. Retry after approximately ${retryLabel}.`;
}

function buildLaneKey(key: ProviderSchedulingKey): string {
  return `${normalizeProvider(key.provider)}:${key.credentialFingerprint}`;
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}
