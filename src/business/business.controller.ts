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
import { BusinessService } from './business.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ListInvoicesQueryDto } from './dto/list-invoices.query.dto';
import { UpdateBusinessSettingsDto } from './dto/update-business-settings.dto';

@ApiTags('business')
@ApiBearerAuth()
@Controller('business')
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  @Get('invoices')
  @ApiOperation({ summary: "List the current business's invoices" })
  listInvoices(
    @CurrentUser() user: AuthUser,
    @Query() query: ListInvoicesQueryDto,
  ) {
    return this.business.listInvoices(user, query);
  }

  @Post('invoices')
  @ApiOperation({ summary: 'Submit a new invoice for financing' })
  createInvoice(@CurrentUser() user: AuthUser, @Body() dto: CreateInvoiceDto) {
    return this.business.createInvoice(user, dto);
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'Get one invoice by id' })
  getInvoice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.business.getInvoice(user, id);
  }

  @Get('wallet')
  @ApiOperation({ summary: 'Get wallet balance and transaction history' })
  getWallet(@CurrentUser() user: AuthUser) {
    return this.business.getWallet(user);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get business profile settings' })
  getSettings(@CurrentUser() user: AuthUser) {
    return this.business.getSettings(user);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update business profile settings' })
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateBusinessSettingsDto,
  ) {
    return this.business.updateSettings(user, dto);
  }
}
