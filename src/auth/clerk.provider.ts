import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient, type ClerkClient } from '@clerk/backend';
import type { Env } from '../config/env.validation';

export const CLERK_CLIENT = 'CLERK_CLIENT';

export const ClerkClientProvider: Provider = {
  provide: CLERK_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): ClerkClient =>
    createClerkClient({
      secretKey: config.get('CLERK_SECRET_KEY', { infer: true }),
      publishableKey: config.get('CLERK_PUBLISHABLE_KEY', { infer: true }),
    }),
};
