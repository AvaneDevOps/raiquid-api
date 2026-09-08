import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from './env.validation';

export function configureCors(
  app: INestApplication,
  config: ConfigService<Env, true>,
): void {
  app.enableCors({
    origin: config.get('FRONTEND_URL', { infer: true }),
    credentials: true,
  });
}
