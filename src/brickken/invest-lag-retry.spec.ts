import { BrickkenIntegrationError } from './brickken.errors';
import {
  INVEST_RETRY_DELAYS_MS,
  isInvestIndexingLagError,
  retryOnInvestIndexingLag,
} from './invest-lag-retry';

describe('isInvestIndexingLagError', () => {
  it('matches an api, 400, "... not found" shape', () => {
    const err = new BrickkenIntegrationError(
      'api',
      'STO not found for the provided token scope',
      undefined,
      400,
    );
    expect(isInvestIndexingLagError(err)).toBe(true);
  });

  it('matches case-insensitively', () => {
    const err = new BrickkenIntegrationError(
      'api',
      'Token NOT FOUND',
      undefined,
      400,
    );
    expect(isInvestIndexingLagError(err)).toBe(true);
  });

  it('does not match a non-400 api error', () => {
    const err = new BrickkenIntegrationError(
      'api',
      'not found',
      undefined,
      404,
    );
    expect(isInvestIndexingLagError(err)).toBe(false);
  });

  it('does not match an api error with an unrelated message (e.g. insufficient funds)', () => {
    const err = new BrickkenIntegrationError(
      'api',
      'insufficient funds',
      undefined,
      400,
    );
    expect(isInvestIndexingLagError(err)).toBe(false);
  });

  it('does not match unauthorized_token_symbol even with a 400 — the likely shape of a real whitelist failure', () => {
    const err = new BrickkenIntegrationError(
      'unauthorized_token_symbol',
      'token not found in whitelist',
      undefined,
      400,
    );
    expect(isInvestIndexingLagError(err)).toBe(false);
  });

  it('does not match auth, validation, credits_exhausted, or rate_limited', () => {
    expect(
      isInvestIndexingLagError(
        new BrickkenIntegrationError('auth', 'not found', undefined, 400),
      ),
    ).toBe(false);
    expect(
      isInvestIndexingLagError(
        new BrickkenIntegrationError('validation', 'nope'),
      ),
    ).toBe(false);
    expect(
      isInvestIndexingLagError(
        new BrickkenIntegrationError('credits_exhausted', 'no credits left'),
      ),
    ).toBe(false);
    expect(
      isInvestIndexingLagError(
        new BrickkenIntegrationError('rate_limited', 'slow down'),
      ),
    ).toBe(false);
  });

  it('does not match a plain Error or a non-Error value', () => {
    expect(isInvestIndexingLagError(new Error('not found'))).toBe(false);
    expect(isInvestIndexingLagError('not found')).toBe(false);
    expect(isInvestIndexingLagError(null)).toBe(false);
  });
});

describe('retryOnInvestIndexingLag', () => {
  const lagError = () =>
    new BrickkenIntegrationError(
      'api',
      'STO not found for the provided token scope',
      undefined,
      400,
    );

  it('returns the result on the first try without sleeping', async () => {
    const attempt = jest.fn().mockResolvedValue('ok');
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    const result = await retryOnInvestIndexingLag(
      attempt,
      INVEST_RETRY_DELAYS_MS,
      sleepFn,
    );

    expect(result).toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('retries only on the lag error, escalating through the given delays, then succeeds', async () => {
    const attempt = jest
      .fn()
      .mockRejectedValueOnce(lagError())
      .mockRejectedValueOnce(lagError())
      .mockResolvedValueOnce('ok');
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    const result = await retryOnInvestIndexingLag(
      attempt,
      [10_000, 20_000, 30_000],
      sleepFn,
    );

    expect(result).toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenNthCalledWith(1, 10_000);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 20_000);
  });

  it('rethrows once the delay list is exhausted, having tried delaysMs.length + 1 times', async () => {
    const attempt = jest.fn().mockRejectedValue(lagError());
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await expect(
      retryOnInvestIndexingLag(attempt, [10_000, 20_000], sleepFn),
    ).rejects.toThrow('STO not found for the provided token scope');

    expect(attempt).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it('rethrows immediately on a non-lag error, without sleeping or retrying', async () => {
    const attempt = jest
      .fn()
      .mockRejectedValue(
        new BrickkenIntegrationError(
          'unauthorized_token_symbol',
          'not whitelisted',
        ),
      );
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await expect(
      retryOnInvestIndexingLag(attempt, INVEST_RETRY_DELAYS_MS, sleepFn),
    ).rejects.toThrow('not whitelisted');

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });
});
