import { Global, Module } from '@nestjs/common';
import { BrickkenClientProvider } from './brickken.provider';
import { BrickkenService } from './brickken.service';

@Global()
@Module({
  providers: [BrickkenClientProvider, BrickkenService],
  exports: [BrickkenService],
})
export class BrickkenModule {}
