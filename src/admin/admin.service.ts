import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  InvoiceStatus,
  NotificationTone,
  ProvenanceTier,
  WhitelistStatus,
} from '../common/enums';
import { Prisma } from '../generated/prisma/client';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { LedgerQueryDto } from './dto/ledger-query.dto';
import type { WhitelistDecisionDto } from './dto/whitelist-decision.dto';

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
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
  ) {}

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

  /**
   * The whitelisting review queue — investors who have submitted for review but
   * are not yet cleared to fund. Each row carries the account email and the KYC
   * document pointers the operator needs to make a decision.
   */
  async listWhitelistingQueue(query: PaginationQueryDto) {
    const where = {
      whitelistStatus: { not: WhitelistStatus.whitelisted },
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.investor.findMany({
        where,
        include: {
          user: { select: { email: true, firstName: true, lastName: true } },
          kycDocuments: true,
        },
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.investor.count({ where }),
    ]);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  /**
   * Approve or reject an investor's whitelisting. Approve → whitelisted.
   * Reject → back to identity_submitted: `WhitelistStatus` has no `rejected`
   * value (it mirrors the frontend enum, a cross-repo contract), so a rejection
   * is indistinguishable from "never reviewed" apart from the notification the
   * investor receives (see docs/RAIQUID_CONTEXT.md).
   */
  async decideWhitelisting(investorId: string, dto: WhitelistDecisionDto) {
    const investor = await this.prisma.investor.findUnique({
      where: { id: investorId },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!investor) {
      throw new NotFoundException('Investor not found');
    }
    if (
      dto.approve &&
      investor.whitelistStatus === WhitelistStatus.whitelisted
    ) {
      throw new ConflictException('Investor is already whitelisted');
    }

    const nextStatus = dto.approve
      ? WhitelistStatus.whitelisted
      : WhitelistStatus.identity_submitted;
    const noteSuffix = dto.note ? ` Reviewer note: ${dto.note}` : '';

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.investor.update({
        where: { id: investor.id },
        data: { whitelistStatus: nextStatus },
      });
      await this.notifications.notify(
        {
          userId: investor.user.id,
          tone: dto.approve
            ? NotificationTone.positive
            : NotificationTone.warning,
          title: dto.approve
            ? 'Your investor account is whitelisted'
            : 'Whitelisting needs another look',
          body: dto.approve
            ? `You're cleared to fund invoices on the marketplace.${noteSuffix}`
            : `Your whitelisting submission was not approved. Please review your details and resubmit.${noteSuffix}`,
          href: dto.approve
            ? '/investor/marketplace'
            : '/investor/whitelisting',
        },
        tx,
      );
      return row;
    });

    // Email is a courtesy on top of the in-app notification; a send failure
    // must not roll back the decision.
    try {
      await this.email.sendWhitelistDecision(investor.user.email, dto.approve);
    } catch (err) {
      this.logger.error(
        `Whitelisting decision for investor ${investor.id} saved but the email failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return updated;
  }
}
