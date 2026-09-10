import { validateEnv } from './env.validation';

const base = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  CLERK_SECRET_KEY: 'sk_test_x',
  CLERK_PUBLISHABLE_KEY: 'pk_test_x',
  CLERK_WEBHOOK_SECRET: 'whsec_x',
  FRONTEND_URL: 'http://localhost:3000',
  R2_ACCOUNT_ID: 'acc',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'bucket',
  RESEND_API_KEY: 're_x',
  BRICKKEN_API_KEY: 'bk_x',
  BRICKKEN_PRIVATE_KEY:
    '0x0000000000000000000000000000000000000000000000000000000000000001',
  BRICKKEN_TOKENIZER_EMAIL: 'tokenizer@raiquid.test',
  BRICKKEN_INVESTOR_EMAIL: 'investor@raiquid.test',
  BRICKKEN_ACCEPTED_COIN: '0x0000000000000000000000000000000000000000',
};

describe('validateEnv', () => {
  it('parses and coerces a complete environment', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('test');
  });

  it('defaults BRICKKEN_ENV to sandbox and BRICKKEN_CHAIN_ID to Base Sepolia', () => {
    const env = validateEnv(base);
    expect(env.BRICKKEN_ENV).toBe('sandbox');
    expect(env.BRICKKEN_CHAIN_ID).toBe('84532');
  });

  it('rejects a BRICKKEN_PRIVATE_KEY that is not a 32-byte hex string', () => {
    expect(() =>
      validateEnv({ ...base, BRICKKEN_PRIVATE_KEY: 'not-a-key' }),
    ).toThrow(/BRICKKEN_PRIVATE_KEY/);
  });

  it('accepts a BRICKKEN_PRIVATE_KEY with no 0x prefix (Brickken issues it this way)', () => {
    const noPrefix = 'abcdef01'.repeat(8);
    expect(noPrefix).toHaveLength(64);
    expect(noPrefix).toMatch(/^[0-9a-f]{64}$/);
    const env = validateEnv({ ...base, BRICKKEN_PRIVATE_KEY: noPrefix });
    expect(env.BRICKKEN_PRIVATE_KEY).toBe(noPrefix);
  });

  it('rejects a BRICKKEN_INVESTOR_EMAIL equal to BRICKKEN_TOKENIZER_EMAIL', () => {
    expect(() =>
      validateEnv({
        ...base,
        BRICKKEN_INVESTOR_EMAIL: base.BRICKKEN_TOKENIZER_EMAIL,
      }),
    ).toThrow(/BRICKKEN_INVESTOR_EMAIL/);
  });

  it('throws when a required variable is missing', () => {
    const { CLERK_SECRET_KEY: _omitted, ...incomplete } = base;
    expect(() => validateEnv(incomplete)).toThrow(/CLERK_SECRET_KEY/);
  });

  it('rejects a malformed DATABASE_URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: 'not-a-url' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
