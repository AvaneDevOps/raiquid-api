import {
  ApiError,
  AuthError,
  CreditsExhaustedError,
  RateLimitError,
  UnauthorizedTokenSymbolError,
  ValidationError,
} from 'brickken-sdk';

export type BrickkenErrorKind =
  | 'validation'
  | 'auth'
  | 'unauthorized_token_symbol'
  | 'credits_exhausted'
  | 'rate_limited'
  | 'api'
  | 'unknown';

export class BrickkenIntegrationError extends Error {
  /** The Brickken call that failed, set by BrickkenService once known. */
  action?: string;

  constructor(
    readonly kind: BrickkenErrorKind,
    message: string,
    readonly retryAfterSeconds?: number,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'BrickkenIntegrationError';
  }
}

export function mapBrickkenError(err: unknown): BrickkenIntegrationError {
  if (err instanceof BrickkenIntegrationError) {
    return err;
  }
  if (err instanceof ValidationError) {
    return new BrickkenIntegrationError('validation', err.message);
  }
  if (err instanceof AuthError) {
    return new BrickkenIntegrationError('auth', err.message);
  }
  if (err instanceof UnauthorizedTokenSymbolError) {
    return new BrickkenIntegrationError(
      'unauthorized_token_symbol',
      err.message,
    );
  }
  if (err instanceof CreditsExhaustedError) {
    return new BrickkenIntegrationError(
      'credits_exhausted',
      `${err.message} (method: ${err.method})`,
    );
  }
  if (err instanceof RateLimitError) {
    return new BrickkenIntegrationError(
      'rate_limited',
      err.message,
      err.retryAfterSeconds,
    );
  }
  if (err instanceof ApiError) {
    return new BrickkenIntegrationError(
      'api',
      err.message,
      undefined,
      err.status,
    );
  }
  return new BrickkenIntegrationError(
    'unknown',
    err instanceof Error ? err.message : String(err),
  );
}
