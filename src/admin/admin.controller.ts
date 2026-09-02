import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../common/enums';
import { AdminService } from './admin.service';
import { LedgerQueryDto } from './dto/ledger-query.dto';

/**
 * Platform-operator routes. Base path `/admin` matches the frontend's /admin/*
 * group 1:1. `@Roles(admin)` on the controller locks every route to the admin
 * role (enforced by RolesGuard, after the global ClerkAuthGuard).
 */
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
}
