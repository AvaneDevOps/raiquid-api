import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  InvoiceStatus,
  ProvenanceTier,
  WhitelistStatus,
} from '../common/enums';
import { Prisma } from '../generated/prisma/client';
import type { LedgerQueryDto } from './dto/ledger-query.dto';

/** Truncate a Date to its UTC calendar day (ms since epoch). */
function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// "Active in the financing pipeline" = tokenized onward but not yet done.
const PIPELINE_EXCLUDED: InvoiceStatus[] = [
  InvoiceStatus.submitted,
  InvoiceStatus.awaiting_acceptance,
  InvoiceStatus.repaid,
];

// The reserve contribution is only actually collected once an invoice funds.
const RESERVE_COLLECTED: InvoiceStatus[] = [
  InvoiceStatus.funded,
  InvoiceStatus.repaid,
];

/**
 * Admin area — the platform-operator dashboard (/admin/*). Read-only reporting:
 * no money moves here, so the metrics below are deliberately-chosen
 * approximations, each labelled with its definition. This service NEVER writes
 * to `OnChainEvent` (see the schema file header).
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    const [financed, activeInvoices, repaid, activeInvestors] =
      await this.prisma.$transaction([
        // Total value financed := sum of fundedAmount across ALL invoices.
        // This is capital actually deployed (every ₦ has a matching `invested`
        // WalletTransaction), and it moves continuously with partial funding
        // rather than only stepping when an invoice fully funds.
        this.prisma.invoice.aggregate({ _sum: { fundedAmount: true } }),
        // Active invoices := anything past buyer acceptance and not yet repaid.
        this.prisma.invoice.count({
          where: { status: { notIn: PIPELINE_EXCLUDED } },
        }),
        // On-time rate inputs — see below for why updatedAt.
        this.prisma.invoice.findMany({
          where: { status: InvoiceStatus.repaid },
          select: { dueDate: true, updatedAt: true },
        }),
        // Active investors := those cleared to actually fund (whitelisted).
        this.prisma.investor.count({
          where: { whitelistStatus: WhitelistStatus.whitelisted },
        }),
      ]);

    const totalValueFinanced = Number(financed._sum.fundedAmount ?? 0);

    // APPROXIMATION: there is no `repaidAt` column (deferred — see
    // docs/RAIQUID_CONTEXT.md), so `updatedAt` stands in for "when it was
    // marked repaid". updatedAt moves on any field change, so this can
    // over- or under-count. Compared at day granularity. null when nothing
    // has been repaid yet.
    const onTimeRepaymentRate =
      repaid.length === 0
        ? null
        : repaid.filter((i) => utcDay(i.updatedAt) <= utcDay(i.dueDate))
            .length / repaid.length;

    return {
      totalValueFinanced,
      activeInvoices,
      onTimeRepaymentRate,
      activeInvestors,
      definitions: {
        totalValueFinanced:
          'Sum of Invoice.fundedAmount across all invoices (capital deployed, includes partial in-progress fundings).',
        activeInvoices:
          'Invoices whose status is not submitted / awaiting_acceptance / repaid.',
        onTimeRepaymentRate:
          'APPROXIMATION — repaid invoices with updatedAt <= dueDate (day granularity) over all repaid invoices. No repaidAt field exists; updatedAt is a proxy. null until something is repaid.',
        activeInvestors:
          'Investor rows with whitelistStatus = whitelisted (cleared to fund).',
      },
    };
  }

  async getReserve() {
    const [reserveInvoices, financed] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where: { status: { in: RESERVE_COLLECTED } },
        select: { amount: true, reserveContributionPct: true },
      }),
      this.prisma.invoice.aggregate({ _sum: { fundedAmount: true } }),
    ]);

    const reserveBalance = reserveInvoices.reduce(
      (acc, inv) =>
        acc.add(inv.amount.mul(inv.reserveContributionPct).div(100)),
      new Prisma.Decimal(0),
    );
    const totalValueFinanced = Number(financed._sum.fundedAmount ?? 0);
    const coverageRatio =
      totalValueFinanced > 0
        ? reserveBalance.toNumber() / totalValueFinanced
        : null;

    return {
      reserveBalance: reserveBalance.toNumber(),
      totalValueFinanced,
      coverageRatio,
      claims: [] as never[],
      note: 'reserveBalance = sum of amount * reserveContributionPct / 100 for funded/repaid invoices (where the contribution is actually collected). coverageRatio uses the same "value financed" definition as /admin/overview. No ReservePool or claims model exists — claims is always empty, matching the frontend "No claims yet" state.',
    };
  }

  async getProvenance() {
    const buyers = await this.prisma.buyer.findMany({
      select: {
        id: true,
        legalName: true,
        provenanceTier: true,
        acceptanceRate: true,
        onTimePaymentRate: true,
        invoicesFinancedCount: true,
      },
      orderBy: { legalName: 'asc' },
    });

    const byTier: Record<ProvenanceTier, number> = {
      [ProvenanceTier.quarried]: 0,
      [ProvenanceTier.carried]: 0,
      [ProvenanceTier.anchored]: 0,
    };
    for (const b of buyers) {
      byTier[b.provenanceTier] += 1;
    }

    return {
      buyers,
      byTier,
      note: 'acceptanceRate / onTimePaymentRate / invoicesFinancedCount are read straight from the Buyer rows. They are 0 for every buyer today because computing them was deferred (see docs/RAIQUID_CONTEXT.md) — this endpoint reads them fine.',
    };
  }

  async getLedger(query: LedgerQueryDto) {
    const where = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.onChainEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.onChainEvent.count({ where }),
    ]);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }
}
