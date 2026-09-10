import { Global, Module } from '@nestjs/common';
import {
  BrickkenClientProvider,
  BrickkenSignerAddressProvider,
} from './brickken.provider';
import { BrickkenService } from './brickken.service';

@Global()
@Module({
  providers: [
    BrickkenClientProvider,
    BrickkenSignerAddressProvider,
    BrickkenService,
  ],
  exports: [BrickkenService],
})
export class BrickkenModule {}
