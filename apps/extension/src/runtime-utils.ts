import { attemptCleanup } from "@piphony/core/cleanup";
import { errorMessage } from "@piphony/core/errors";

export function reportExtensionError(event: string, error: unknown, details?: Record<string, unknown>): void {
  console.error(event, {
    ...(details ?? {}),
    message: errorMessage(error),
  });
}

export async function attemptExtensionCleanup(
  operation: string,
  cleanup: () => Promise<void>,
  details?: Record<string, unknown>,
): Promise<void> {
  await attemptCleanup(operation, cleanup, (failure) => {
    console.error("extension_cleanup_failed", {
      ...failure,
      ...(details ?? {}),
    });
  });
}
