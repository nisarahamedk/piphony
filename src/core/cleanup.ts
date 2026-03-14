import { errorDetails } from "./errors.js";

export interface CleanupFailure {
  operation: string;
  target?: string;
  message: string;
  stack?: string;
}

export async function attemptCleanup(
  operation: string,
  cleanup: () => Promise<void>,
  onFailure?: (failure: CleanupFailure) => Promise<void> | void,
  target?: string,
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    const failure = {
      operation,
      ...(target === undefined ? {} : { target }),
      ...errorDetails(error),
    } satisfies CleanupFailure;
    if (onFailure !== undefined) {
      await onFailure(failure);
      return;
    }
    console.error("cleanup_failed", failure);
  }
}
