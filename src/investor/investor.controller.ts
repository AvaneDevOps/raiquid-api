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
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { InvestorService } from './investor.service';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { DepositDto } from './dto/deposit.dto';
import { FundInvoiceDto } from './dto/fund-invoice.dto';
import { SubmitWhitelistingDto } from './dto/submit-whitelisting.dto';
import { UpdateInvestorSettingsDto } from './dto/update-investor-settings.dto';

@ApiTags('investor')
@ApiBearerAuth()
@Controller('investor')
export class InvestorController {
  constructor(private readonly investor: InvestorService) {}

  @Get('marketplace')
  @ApiOperation({ summary: 'List invoices open for investment' })
  listMarketplace(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.investor.listMarketplace(user, query);
  }

  @Get('marketplace/:id')
  @ApiOperation({ summary: 'Get one marketplace listing' })
  getMarketplaceListing(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.investor.getMarketplaceListing(user, id);
  }

  @Post('marketplace/:id/fund')
  @ApiOperation({ summary: 'Commit capital to a listed invoice' })
  fundInvoice(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: FundInvoiceDto,
  ) {
    return this.investor.fundInvoice(user, id, dto);
  }

  @Get('portfolio')
  @ApiOperation({ summary: "List this investor's holdings" })
  getPortfolio(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.investor.getPortfolio(user, query);
  }

  @Get('portfolio/:id')
  @ApiOperation({ summary: 'Get one holding' })
  getPortfolioHolding(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.investor.getPortfolioHolding(user, id);
  }

  @Get('whitelisting')
  @ApiOperation({ summary: 'Get whitelisting status' })
  getWhitelisting(@CurrentUser() user: AuthUser) {
    return this.investor.getWhitelisting(user);
  }

  @Post('whitelisting/upload-url')
  @ApiOperation({
    summary: 'Get a presigned R2 URL to upload one KYC document',
  })
  createWhitelistingUploadUrl(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUploadUrlDto,
  ) {
    return this.investor.createWhitelistingUploadUrl(user, dto);
  }

  @Post('whitelisting')
  @ApiOperation({ summary: 'Submit identity details for whitelisting review' })
  submitWhitelisting(
    @CurrentUser() user: AuthUser,
    @Body() dto: SubmitWhitelistingDto,
  ) {
    return this.investor.submitWhitelisting(user, dto);
  }

  @Get('wallet')
  @ApiOperation({ summary: 'Get wallet balance and transaction history' })
  getWallet(@CurrentUser() user: AuthUser) {
    return this.investor.getWallet(user);
  }

  @Post('wallet/deposit')
  @ApiOperation({ summary: 'Add simulated sandbox funds to the wallet' })
  deposit(@CurrentUser() user: AuthUser, @Body() dto: DepositDto) {
    return this.investor.deposit(user, dto);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get investor profile settings' })
  getSettings(@CurrentUser() user: AuthUser) {
    return this.investor.getSettings(user);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update investor profile settings' })
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateInvestorSettingsDto,
  ) {
    return this.investor.updateSettings(user, dto);
  }
}
