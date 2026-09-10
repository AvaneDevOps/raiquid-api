/**
 * Test double for `brickken-sdk`. The real package's only runtime dependency,
 * `micro-eth-signer`, is ESM-only and Jest on Node < 24.9 cannot `require()` it,
 * so both jest configs map `brickken-sdk` and its private-key adapter here.
 * Every spec replaces BrickkenService or the BRICKKEN_CLIENT provider with its
 * own jest.fn()s; this file only needs to load and expose the error classes so
 * BrickkenService's `instanceof` mapping works.
 */

class BrickkenError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends BrickkenError {
  constructor(message: string) {
    super('validation', message);
  }
}

export class AuthError extends BrickkenError {
  constructor(message: string) {
    super('auth', message);
  }
}

export class UnauthorizedTokenSymbolError extends BrickkenError {
  constructor(
    readonly tokenSymbol?: string,
    message = 'unauthorized token symbol',
  ) {
    super('unauthorized_token_symbol', message);
  }
}

export class CreditsExhaustedError extends BrickkenError {
  constructor(readonly method: string) {
    super('credits_exhausted', `credits exhausted for ${method}`);
  }
}

export class RateLimitError extends BrickkenError {
  constructor(readonly retryAfterSeconds: number) {
    super('rate_limited', `rate limited, retry after ${retryAfterSeconds}s`);
  }
}

export class ApiError extends BrickkenError {
  readonly status?: number;
  constructor(message: string, options?: { status?: number }) {
    super('api', message);
    this.status = options?.status;
  }
}

const notStubbed = () =>
  Promise.reject(new Error('brickken-sdk mock: not stubbed for this test'));

export class Brickken {
  readonly tokenization = {
    create: notStubbed,
    distributeDividend: notStubbed,
  };
  readonly sto = {
    create: notStubbed,
    invest: notStubbed,
    close: notStubbed,
    claim: notStubbed,
  };
  get baseUrl(): string {
    return 'https://api.sandbox.brickken.test';
  }
}
