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
};

describe('validateEnv', () => {
  it('parses and coerces a complete environment', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('test');
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
