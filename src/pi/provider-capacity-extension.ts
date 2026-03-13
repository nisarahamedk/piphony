import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type {
  ProviderCapacityService,
  ProviderRequestClass,
  ProviderSchedulingKey,
} from "./provider-middleware.js";

export interface ProviderCapacityExtensionOptions {
  service: ProviderCapacityService;
  key: ProviderSchedulingKey;
  requestClass: ProviderRequestClass;
  maxWaitMs?: number;
}

export function createProviderCapacityExtension(options: ProviderCapacityExtensionOptions): ExtensionFactory {
  return (pi) => {
    let activeLease: { release(): Promise<void> } | undefined;

    const releaseActiveLease = async () => {
      if (activeLease === undefined) {
        return;
      }
      const lease = activeLease;
      activeLease = undefined;
      await lease.release();
    };

    pi.on("before_provider_request", async () => {
      if (activeLease !== undefined) {
        return undefined;
      }
      activeLease = await options.service.acquire({
        key: options.key,
        requestClass: options.requestClass,
        ...(options.maxWaitMs === undefined ? {} : { maxWaitMs: options.maxWaitMs }),
      });
      return undefined;
    });

    pi.on("message_end", async (event) => {
      const message = (event as any).message;
      if (message?.role !== "assistant") {
        return;
      }
      options.service.settleAttempt({
        key: options.key,
        ...(message.stopReason === "error" || message.stopReason === "aborted"
          ? { errorMessage: typeof message.errorMessage === "string" ? message.errorMessage : `Assistant ${message.stopReason}` }
          : {}),
      });
      await releaseActiveLease();
    });

    pi.on("agent_end", async () => {
      await releaseActiveLease();
    });

    pi.on("session_shutdown", async () => {
      await releaseActiveLease();
    });
  };
}
