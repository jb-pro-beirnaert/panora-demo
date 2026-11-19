/**
 * Resilience of the calls to the insurer extranet (V9): each MCP tool call is retried with an
 * increasing delay on transport errors (timeouts, 429, 5xx). A retry that succeeds is invisible to
 * the broker; it is counted and logged (and visible in the trace as a slower tool span).
 */
export const resilienceStats = { toolCalls: 0, retries: 0, failures: 0 };

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `call`, retrying on any thrown error, with exponential backoff and jitter. */
export async function withRetry<T>(
  label: string,
  call: () => Promise<T>,
  { attempts, baseDelayMs, sleep = defaultSleep }: RetryOptions,
): Promise<T> {
  resilienceStats.toolCalls += 1;
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= attempts) {
        resilienceStats.failures += 1;
        throw error;
      }
      resilienceStats.retries += 1;
      const delay = baseDelayMs * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
      console.warn(
        `${label} failed (attempt ${attempt}/${attempts}), retrying in ${Math.round(delay)} ms: ${String(error)}`,
      );
      await sleep(delay);
    }
  }
}

/** True when an MCP tool result is a transport-level failure worth retrying. */
export function isTransientToolError(result: unknown): boolean {
  const text = JSON.stringify(result ?? '');
  return /\b(429|502|503|504)\b|temporarily unavailable|Rate limit exceeded|ECONNRESET|ECONNREFUSED|timed? ?out/i.test(
    text,
  );
}
