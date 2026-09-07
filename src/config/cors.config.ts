import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from './env.validation';

/**
 * Restrict CORS to the browser SPA at `FRONTEND_URL`. Called from `main.ts` at
 * boot and from the CORS e2e spec, so the rule is defined once.
 *
 * Server-to-server callers (the Clerk webhook, uptime probes, this API's own
 * health checks) send no `Origin` header and are unaffected by CORS.
 */
export function configureCors(
  app: INestApplication,
  config: ConfigService<Env, true>,
): void {
  app.enableCors({
    origin: config.get('FRONTEND_URL', { infer: true }),
    credentials: true,
  });
}
