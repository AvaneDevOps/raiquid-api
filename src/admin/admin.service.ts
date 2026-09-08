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

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const PIPELINE_EXCLUDED: InvoiceStatus[] = [
  InvoiceStatus.submitted,
  InvoiceStatus.awaiting_acceptance,
  InvoiceStatus.repaid,
];

const RESERVE_COLLECTED: InvoiceStatus[] = [
  InvoiceStatus.funded,
  InvoiceStatus.repaid,
];

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
        this.prisma.invoice.aggregate({ _sum: { fundedAmount: true } }),
        this.prisma.invoice.count({
          where: { status: { notIn: PIPELINE_EXCLUDED } },
        }),
        this.prisma.invoice.findMany({
          where: { status: InvoiceStatus.repaid, repaidAt: { not: null } },
          select: { dueDate: true, repaidAt: true },
        }),
        this.prisma.investor.count({
          where: { whitelistStatus: WhitelistStatus.whitelisted },
        }),
      ]);

    const totalValueFinanced = Number(financed._sum.fundedAmount ?? 0);

    const onTimeRepaymentRate =
      repaid.length === 0
        ? null
        : repaid.filter(
            (i) =>
              i.repaidAt !== null && utcDay(i.repaidAt) <= utcDay(i.dueDate),
          ).length / repaid.length;

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
          'Repaid invoices with repaidAt <= dueDate (day granularity) over all repaid invoices. null until something is repaid.',
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
