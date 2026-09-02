import { Module } from '@nestjs/common';
import { BuyerController } from './buyer.controller';
import { ConfirmController } from './confirm.controller';
import { BuyerService } from './buyer.service';

@Module({
  controllers: [BuyerController, ConfirmController],
  providers: [BuyerService],
})
export class BuyerModule {}
