import { BrickkenIntegrationError } from './brickken.errors';
import {
  isStoIndexingLagError,
  retryOnStoIndexingLag,
  STO_LAUNCH_RETRY_DELAYS_MS,
} from './sto-lag-retry';

describe('isStoIndexingLagError', () => {
  it('matches the exact documented shape: api, 400, "Company ... not found"', () => {
    const err = new BrickkenIntegrationError(
      'api',
      'Company not found for the provided email and token scope',
      undefined,
      400,
    );
    expect(isStoIndexingLagError(err)).toBe(true);
  });

  it('matches case-insensitively and against the shorter tokenizer-info wording', () => {
    const err = new BrickkenIntegrationError(
      'api',
      'company NOT found',
      undefined,
      400,
    );
    expect(isStoIndexingLagError(err)).toBe(true);
  });

  it('does not match a non-400 api error', () => {
    const err = new BrickkenIntegrationError(
      'api',
      'Company not found for the provided email and token scope',
      undefined,
      404,
    );
    expect(isStoIndexingLagError(err)).toBe(false);
  });

  it('does not match an api error with an unrelated message', () => {
    const err = new BrickkenIntegrationError(
      'api',
      'insufficient funds',
      undefined,
      400,
    );
    expect(isStoIndexingLagError(err)).toBe(false);
  });

  it('does not match auth, validation, or rate-limit errors even with a 400', () => {
    expect(
      isStoIndexingLagError(
        new BrickkenIntegrationError(
          'auth',
          'Company not found',
          undefined,
          400,
        ),
      ),
    ).toBe(false);
    expect(
      isStoIndexingLagError(new BrickkenIntegrationError('validation', 'nope')),
    ).toBe(false);
    expect(
      isStoIndexingLagError(
        new BrickkenIntegrationError('rate_limited', 'slow down'),
      ),
    ).toBe(false);
  });

  it('does not match a plain Error or a non-Error value', () => {
    expect(isStoIndexingLagError(new Error('Company not found'))).toBe(false);
    expect(isStoIndexingLagError('Company not found')).toBe(false);
    expect(isStoIndexingLagError(null)).toBe(false);
  });
});

describe('retryOnStoIndexingLag', () => {
  const lagError = () =>
    new BrickkenIntegrationError(
      'api',
      'Company not found for the provided email and token scope',
      undefined,
      400,
    );

  it('returns the result on the first try without sleeping', async () => {
    const attempt = jest.fn().mockResolvedValue('ok');
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    const result = await retryOnStoIndexingLag(
      attempt,
      STO_LAUNCH_RETRY_DELAYS_MS,
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

    const result = await retryOnStoIndexingLag(
      attempt,
      [15_000, 30_000, 45_000],
      sleepFn,
    );

    expect(result).toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenNthCalledWith(1, 15_000);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 30_000);
  });

  it('rethrows once the delay list is exhausted, having tried delaysMs.length + 1 times', async () => {
    const attempt = jest.fn().mockRejectedValue(lagError());
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await expect(
      retryOnStoIndexingLag(attempt, [15_000, 30_000], sleepFn),
    ).rejects.toThrow(
      'Company not found for the provided email and token scope',
    );

    expect(attempt).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it('rethrows immediately on a non-lag error, without sleeping or retrying', async () => {
    const attempt = jest
      .fn()
      .mockRejectedValue(new BrickkenIntegrationError('auth', 'bad key'));
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await expect(
      retryOnStoIndexingLag(attempt, STO_LAUNCH_RETRY_DELAYS_MS, sleepFn),
    ).rejects.toThrow('bad key');

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });
});
