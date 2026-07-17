/**
 * Measures the execution time of a synchronous or asynchronous function.
 * @param fn The function to execute.
 * @returns An object containing the duration in milliseconds and the result of the function.
 */
export async function measureLatency<T>(fn: () => Promise<T> | T): Promise<{ durationMs: number; result: T }> {
  const start = process.hrtime.bigint();
  const result = await fn();
  const end = process.hrtime.bigint();
  const durationMs = Number(end - start) / 1_000_000; // convert nanoseconds to milliseconds
  return { durationMs, result };
}

/**
 * Measures the execution time of a synchronous function.
 * @param fn The function to execute.
 * @returns An object containing the duration in milliseconds and the result of the function.
 */
export function measureLatencySync<T>(fn: () => T): { durationMs: number; result: T } {
  const start = process.hrtime.bigint();
  const result = fn();
  const end = process.hrtime.bigint();
  const durationMs = Number(end - start) / 1_000_000;
  return { durationMs, result };
}
