import { Injectable, NotImplementedException } from '@nestjs/common';
import type { LedgerQueryDto } from './dto/ledger-query.dto';

/**
 * Admin area — the platform-operator dashboard (/admin/*).
 *
 * All method bodies are stubs per the project-structure scope. Every route is
 * admin-only (see AdminController).
 */
@Injectable()
export class AdminService {
  /** GET /admin/overview — frontend: /admin/overview. */
  getOverview(): Promise<unknown> {
    // TODO: implement. Platform KPIs: volume, active invoices, funded totals,
    // user counts by role.
    throw new NotImplementedException();
  }

  /** GET /admin/reserve — frontend: /admin/reserve. */
  getReserve(): Promise<unknown> {
    // TODO: implement. Reserve-fund balance from reserveContributionPct across
    // invoices, inflows/outflows, coverage ratio.
    throw new NotImplementedException();
  }

  /** GET /admin/provenance — frontend: /admin/provenance. */
  getProvenance(): Promise<unknown> {
    // TODO: implement. Buyer breakdown by ProvenanceTier with acceptance /
    // on-time rates and financed counts.
    throw new NotImplementedException();
  }

  /** GET /admin/ledger — frontend: /admin/ledger. */
  getLedger(_query: LedgerQueryDto): Promise<unknown> {
    // TODO: implement. Paginated read of the OnChainEvent mirror table
    // (mint / whitelist / transfer / burn), filtered by action/status.
    throw new NotImplementedException();
  }
}
