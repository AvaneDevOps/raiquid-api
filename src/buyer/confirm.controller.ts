import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { BuyerService } from './buyer.service';
import { ReviewConfirmationDto } from './dto/review-confirmation.dto';

/**
 * PUBLIC magic-link confirm flow. Base path `/confirm` matches the frontend's
 * standalone /confirm/[invoiceId] route. Every route here is `@Public()` — it
 * must work with no Clerk session, reached straight from an emailed link. The
 * `:invoiceId` segment is the opaque confirm token, not a raw database id.
 */
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
