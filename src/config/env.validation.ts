import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),

  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().min(1),

  FRONTEND_URL: z.string().url(),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),

  RESEND_API_KEY: z.string().min(1),

  BRICKKEN_API_KEY: z.string().min(1),
  BRICKKEN_PRIVATE_KEY: z
    .string()
    .regex(
      /^0x[0-9a-fA-F]{64}$/,
      'must be a 0x-prefixed 32-byte hex string (the platform signing wallet)',
    ),
  BRICKKEN_TOKENIZER_EMAIL: z.string().email(),
  BRICKKEN_ACCEPTED_COIN: z.string().min(1),
  BRICKKEN_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  BRICKKEN_CHAIN_ID: z.string().min(1).default('84532'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  return parsed.data;
}
