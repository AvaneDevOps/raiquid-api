import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { BuyerService } from './buyer.service';
import { ReviewConfirmationDto } from './dto/review-confirmation.dto';

@ApiTags('confirm (public)')
@Controller('confirm')
export class ConfirmController {
  constructor(private readonly buyer: BuyerService) {}

  @Get(':invoiceId')
  @Public()
  @ApiOperation({ summary: 'Load an invoice for buyer review via magic link' })
  getConfirmation(@Param('invoiceId') invoiceId: string) {
    return this.buyer.getConfirmation(invoiceId);
  }

  @Post(':invoiceId/review')
  @Public()
  @ApiOperation({ summary: 'Accept or dispute an invoice via magic link' })
  submitReview(
    @Param('invoiceId') invoiceId: string,
    @Body() dto: ReviewConfirmationDto,
  ) {
    return this.buyer.submitConfirmationReview(invoiceId, dto);
  }
}
