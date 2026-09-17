import { BrickkenIntegrationError } from './brickken.errors';

/**
 * Wait times between launchOffering retries, escalating toward ~90s total —
 * matches the documented indexing-lag fix (a 90-second wait was enough for
 * an identical newSto request to succeed) in docs/RAIQUID_CONTEXT.md.
 */
export const STO_LAUNCH_RETRY_DELAYS_MS = [15_000, 30_000, 45_000];

/**
 * True only for the exact documented newSto indexing-lag shape: a Brickken
 * ApiError, 400, "Company not found ...". Brickken's backend hasn't caught
 * up to a just-mined newTokenization tx yet — this is not our code being
 * wrong. Anything else (auth, validation, rate limiting, an unrelated api
 * error) is not retried.
 */
export function isStoIndexingLagError(err: unknown): boolean {
  return (
    err instanceof BrickkenIntegrationError &&
    err.kind === 'api' &&
    err.httpStatus === 400 &&
    /company.*not found/i.test(err.message)
  );
}

/**
 * Retries `attempt` only on the documented indexing-lag error shape, waiting
 * `delaysMs[i]` before the (i+2)th try. Any other error, or exhausting
 * `delaysMs`, rethrows immediately.
 */
export async function retryOnStoIndexingLag<T>(
  attempt: () => Promise<T>,
  delaysMs: number[] = STO_LAUNCH_RETRY_DELAYS_MS,
  sleepFn: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (i >= delaysMs.length || !isStoIndexingLagError(err)) {
        throw err;
      }
      await sleepFn(delaysMs[i]);
    }
  }
}
