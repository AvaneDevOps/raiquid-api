import { z } from 'zod';

export const envSchema = z
  .object({
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
    // 32-byte hex, with or without a 0x prefix — Brickken issues the key with no
    // prefix, and the SDK's fromPrivateKey accepts either form. Passed through to
    // fromPrivateKey verbatim in both brickken.provider.ts factories.
    BRICKKEN_PRIVATE_KEY: z
      .string()
      .regex(
        /^(0x)?[0-9a-fA-F]{64}$/,
        'must be a 32-byte hex string (64 hex chars), optionally 0x-prefixed',
      ),
    BRICKKEN_TOKENIZER_EMAIL: z.string().email(),
    // Brickken rejects an STO investment whose investor email matches the token's
    // tokenizer email, so the platform's on-chain investor identity is a second,
    // distinct address book entry.
    BRICKKEN_INVESTOR_EMAIL: z.string().email(),
    BRICKKEN_ACCEPTED_COIN: z.string().min(1),
    BRICKKEN_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
    // Ethereum Sepolia (11155111). Switched off Base Sepolia (84532): its
    // faucets were unreliable, Ethereum Sepolia is Brickken's own documented
    // example network, and the platform wallet already holds Sepolia ETH.
    BRICKKEN_CHAIN_ID: z.string().min(1).default('11155111'),
  })
  .refine(
    (env) => env.BRICKKEN_INVESTOR_EMAIL !== env.BRICKKEN_TOKENIZER_EMAIL,
    {
      path: ['BRICKKEN_INVESTOR_EMAIL'],
      message:
        'must differ from BRICKKEN_TOKENIZER_EMAIL (Brickken forbids self-investment)',
    },
  );

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
