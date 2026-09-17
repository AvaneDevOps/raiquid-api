import { BrickkenIntegrationError } from './brickken.errors';

/**
 * Wait times between invest() retries — shorter than the STO-launch retry
 * (10s/20s/30s = 60s total, vs newSto's 15s/30s/45s = 90s) because newInvest
 * happens well after the STO already confirmed, not right after a fresh
 * mint, so any indexing lag should clear faster. Adjust if real sandbox
 * evidence says otherwise.
 */
export const INVEST_RETRY_DELAYS_MS = [10_000, 20_000, 30_000];

/**
 * True only for the same *shape* of transient "backend hasn't caught up yet"
 * error confirmed live for newSto: a Brickken ApiError, 400, message
 * containing "not found". Unlike newSto's, no live newInvest failure of this
 * exact shape has been confirmed yet — this is the same class of issue
 * (Brickken indexing a very recent prior write) applied by analogy.
 * Narrow or correct this once a real newInvest lag message is observed.
 *
 * Everything else is treated as a real rejection and is NOT retried:
 * validation, auth, credits_exhausted, rate_limited,
 * unauthorized_token_symbol (the likely shape of an actual whitelist
 * failure — see docs/RAIQUID_CONTEXT.md), or an api error with an unrelated
 * message (e.g. insufficient funds).
 */
export function isInvestIndexingLagError(err: unknown): boolean {
  return (
    err instanceof BrickkenIntegrationError &&
    err.kind === 'api' &&
    err.httpStatus === 400 &&
    /not found/i.test(err.message)
  );
}

/**
 * Retries `attempt` only on the transient indexing-lag shape above, waiting
 * `delaysMs[i]` before the (i+2)th try. Any other error, or exhausting
 * `delaysMs`, rethrows immediately so the real failure surfaces.
 */
export async function retryOnInvestIndexingLag<T>(
  attempt: () => Promise<T>,
  delaysMs: number[] = INVEST_RETRY_DELAYS_MS,
  sleepFn: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (i >= delaysMs.length || !isInvestIndexingLagError(err)) {
        throw err;
      }
      await sleepFn(delaysMs[i]);
    }
  }
}
