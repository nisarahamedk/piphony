export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

export function errorDetails(error: unknown): { message: string; stack?: string } {
  const message = errorMessage(error);
  const stack = errorStack(error);
  return stack === undefined ? { message } : { message, stack };
}
