import { z } from 'zod';

/**
 * Environment contract for the API.
 *
 * This mirrors the pattern used by the frontend's `src/lib/env.ts`: a single
 * zod schema is the source of truth, parsed once at boot. If anything is
 * missing or malformed the process exits instead of starting in a half-broken
 * state. Keep `.env.example` in sync with this schema.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Database
  DATABASE_URL: z.string().url(),

  // Auth (Clerk)
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: z.string().min(1),

  // File storage (Cloudflare R2, S3-compatible)
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),

  // Transactional email (Resend)
  RESEND_API_KEY: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Passed to `ConfigModule.forRoot({ validate })`. Nest calls this with
 * `process.env`; we return the parsed + coerced object so `ConfigService`
 * hands back typed, validated values.
 */
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
