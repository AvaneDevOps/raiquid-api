import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Brickken } from 'brickken-sdk';
import { fromPrivateKey } from 'brickken-sdk/adapters/private-key';
import type { Env } from '../config/env.validation';
import { BRICKKEN_CLIENT } from './brickken.tokens';

export const BrickkenClientProvider: Provider = {
  provide: BRICKKEN_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): Brickken =>
    new Brickken({
      env: config.get('BRICKKEN_ENV', { infer: true }),
      apiKey: config.get('BRICKKEN_API_KEY', { infer: true }),
      signer: fromPrivateKey(
        config.get('BRICKKEN_PRIVATE_KEY', { infer: true }),
      ),
    }),
};
