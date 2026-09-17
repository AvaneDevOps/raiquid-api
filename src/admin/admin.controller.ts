import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../common/enums';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AdminService } from './admin.service';
import { LedgerQueryDto } from './dto/ledger-query.dto';
import { WhitelistDecisionDto } from './dto/whitelist-decision.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(UserRole.admin)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Platform KPI overview' })
  getOverview() {
    return this.admin.getOverview();
  }

  @Get('reserve')
  @ApiOperation({ summary: 'Reserve-fund status' })
  getReserve() {
    return this.admin.getReserve();
  }

  @Get('provenance')
  @ApiOperation({ summary: 'Buyer provenance-tier breakdown' })
  getProvenance() {
    return this.admin.getProvenance();
  }

  @Get('ledger')
  @ApiOperation({ summary: 'On-chain event ledger (mirror table)' })
  getLedger(@Query() query: LedgerQueryDto) {
    return this.admin.getLedger(query);
  }

  @Post('invoices/:id/finalize-onchain')
  @ApiOperation({
    summary:
      'Close the STO and settle it on-chain: closeOffer, then claimTokens, then dividendDistribution',
  })
  finalizeInvoiceOnChain(@Param('id') id: string) {
    return this.admin.finalizeInvoiceOnChain(id);
  }

  @Post('invoices/:id/retry-sto-launch')
  @ApiOperation({
    summary:
      'Manually re-attempt launchOffering (newSto) for an invoice whose tokenization succeeded but STO launch did not',
  })
  retryStoLaunch(@Param('id') id: string) {
    return this.admin.retryStoLaunch(id);
  }

  @Post('holdings/:id/retry-invest')
  @ApiOperation({
    summary:
      "Manually re-attempt newInvest for one Holding whose on-chain investment did not complete (scoped per-holding, not per-invoice — one invoice can have many investors' Holdings)",
  })
  retryInvest(@Param('id') id: string) {
    return this.admin.retryInvest(id);
  }

  @Get('whitelisting')
  @ApiOperation({ summary: 'Investor whitelisting review queue' })
  listWhitelistingQueue(@Query() query: PaginationQueryDto) {
    return this.admin.listWhitelistingQueue(query);
  }

  @Post('whitelisting/:investorId/decision')
  @ApiOperation({ summary: 'Approve or reject an investor whitelisting' })
  decideWhitelisting(
    @Param('investorId') investorId: string,
    @Body() dto: WhitelistDecisionDto,
  ) {
    return this.admin.decideWhitelisting(investorId, dto);
  }
}
