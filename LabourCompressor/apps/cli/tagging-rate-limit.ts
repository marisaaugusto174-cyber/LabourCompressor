export async function withRateLimitRetry<T>(input: {
  readonly operation: () => Promise<T>;
  readonly maxRetries?: number | undefined;
  readonly delayMs?: number | undefined;
}): Promise<T> {
  const maxRetries = input.maxRetries ?? 2;
  const delayMs = input.delayMs ?? 1200;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await input.operation();
    } catch (error) {
      if (attempt >= maxRetries || !isRateLimitError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }

  throw new Error('Unreachable rate limit retry state.');
}

export function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate limit|resource_exhausted|too many requests|rps|tps|rpm|tpm/iu.test(message);
}
