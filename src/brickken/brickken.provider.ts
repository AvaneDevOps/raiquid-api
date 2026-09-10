import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Brickken } from 'brickken-sdk';
import { fromPrivateKey } from 'brickken-sdk/adapters/private-key';
import type { Env } from '../config/env.validation';
import { BRICKKEN_CLIENT, BRICKKEN_SIGNER_ADDRESS } from './brickken.tokens';

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

export const BrickkenSignerAddressProvider: Provider = {
  provide: BRICKKEN_SIGNER_ADDRESS,
  inject: [ConfigService],
  // fromPrivateKey accepts the key with or without a 0x prefix and derives the
  // same address either way; .address() returns it 0x-prefixed and checksummed.
  useFactory: (config: ConfigService<Env, true>): Promise<`0x${string}`> =>
    fromPrivateKey(
      config.get('BRICKKEN_PRIVATE_KEY', { infer: true }),
    ).address(),
};
