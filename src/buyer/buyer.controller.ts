import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.type';
import { BuyerService } from './buyer.service';
import { ListInvoicesQueryDto } from './dto/list-invoices.query.dto';
import { PayInvoiceDto } from './dto/pay-invoice.dto';
import { UpdateBuyerSettingsDto } from './dto/update-buyer-settings.dto';

/**
 * Debtor-facing routes. Base path `/buyer` matches the frontend's /buyer/*
 * group 1:1. All routes require a Clerk session.
 */
@ApiTags('buyer')
@ApiBearerAuth()
@Controller('buyer')
export class BuyerController {
  constructor(private readonly buyer: BuyerService) {}

  @Get('invoices')
  @ApiOperation({ summary: 'List invoices this buyer owes' })
  listInvoices(
    @CurrentUser() user: AuthUser,
    @Query() query: ListInvoicesQueryDto,
  ) {
    return this.buyer.listInvoices(user, query);
  }

  @Get('payment-schedule')
  @ApiOperation({ summary: 'Get upcoming and overdue repayments' })
  getPaymentSchedule(@CurrentUser() user: AuthUser) {
    return this.buyer.getPaymentSchedule(user);
  }

  @Post('invoices/:id/pay')
  @ApiOperation({ summary: 'Record a repayment against an invoice' })
  payInvoice(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PayInvoiceDto,
  ) {
    return this.buyer.payInvoice(user, id, dto);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get buyer profile settings' })
  getSettings(@CurrentUser() user: AuthUser) {
    return this.buyer.getSettings(user);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update buyer profile settings' })
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateBuyerSettingsDto,
  ) {
    return this.buyer.updateSettings(user, dto);
  }
}
