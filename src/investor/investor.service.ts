import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth-user.type';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import {
  InvoiceStatus,
  WalletTransactionType,
  WhitelistStatus,
} from '../common/enums';
import { walletBalance } from '../common/wallet-balance';
import type { Investor } from '../generated/prisma/client';
import type { FundInvoiceDto } from './dto/fund-invoice.dto';
import type { SubmitWhitelistingDto } from './dto/submit-whitelisting.dto';
import type { UpdateInvestorSettingsDto } from './dto/update-investor-settings.dto';

// Statuses that mean "open for investment".
const OPEN_FOR_INVESTMENT: InvoiceStatus[] = [
  InvoiceStatus.tokenized,
  InvoiceStatus.funding,
];

/** Investor area — the funder-facing dashboard (/investor/*). */
@Injectable()
export class InvestorService {
  constructor(private readonly prisma: PrismaService) {}

  async listMarketplace(user: AuthUser, query: PaginationQueryDto) {
    // Browsing only needs an investor account, not a whitelisted one —
    // the frontend keeps the marketplace open, only funding is gated.
    await this.getInvestorForUser(user);
    const where = { status: { in: OPEN_FOR_INVESTMENT } };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: { buyer: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  async getMarketplaceListing(user: AuthUser, id: string) {
    await this.getInvestorForUser(user);
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, status: { in: OPEN_FOR_INVESTMENT } },
      include: { buyer: true, business: true },
    });
    if (!invoice) {
      throw new NotFoundException('Listing not found');
    }
    return invoice;
  }

  async fundInvoice(user: AuthUser, invoiceId: string, dto: FundInvoiceDto) {
    const investor = await this.getInvestorForUser(user);
    if (investor.whitelistStatus !== WhitelistStatus.whitelisted) {
      throw new ForbiddenException(
        'Funding requires a whitelisted investor account',
      );
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (!OPEN_FOR_INVESTMENT.includes(invoice.status)) {
      throw new ConflictException(
        `Invoice is not open for investment (status "${invoice.status}")`,
      );
    }

    const remaining = invoice.amount.sub(invoice.fundedAmount);
    if (remaining.lt(dto.amount)) {
      throw new BadRequestException(
        `Amount exceeds the invoice's remaining unfunded balance (${remaining.toString()})`,
      );
    }

    const balance = walletBalance(
      await this.prisma.walletTransaction.findMany({
        where: { investorId: investor.id },
        select: { type: true, amount: true },
      }),
    );
    if (balance < dto.amount) {
      throw new BadRequestException(
        `Insufficient wallet balance (${balance}) for this investment`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // One Holding per (investor, invoice) — accumulate on repeat funding.
      // tokenUnits mirrors the invested amount as a placeholder; real
      // on-chain unit accounting needs the separate minting service
      // (see docs/RAIQUID_CONTEXT.md).
      await tx.holding.upsert({
        where: {
          investorId_invoiceId: {
            investorId: investor.id,
            invoiceId: invoice.id,
          },
        },
        create: {
          investorId: investor.id,
          invoiceId: invoice.id,
          amount: dto.amount,
          tokenUnits: dto.amount,
        },
        update: {
          amount: { increment: dto.amount },
          tokenUnits: { increment: dto.amount },
        },
      });

      await tx.walletTransaction.create({
        data: {
          type: WalletTransactionType.invested,
          amount: dto.amount,
          investorId: investor.id,
          invoiceId: invoice.id,
        },
      });

      const incremented = await tx.invoice.update({
        where: { id: invoice.id },
        data: { fundedAmount: { increment: dto.amount } },
      });
      const fullyFunded = incremented.fundedAmount.gte(incremented.amount);

      const finalInvoice = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: fullyFunded ? InvoiceStatus.funded : InvoiceStatus.funding,
        },
        include: { buyer: true },
      });

      if (fullyFunded) {
        const totalFeePct = invoice.platformFeePct.add(
          invoice.reserveContributionPct,
        );
        const feeAmount = invoice.amount.mul(totalFeePct).div(100);
        const netPayout = invoice.amount.sub(feeAmount);
        await tx.walletTransaction.create({
          data: {
            type: WalletTransactionType.deposit,
            amount: netPayout,
            businessId: invoice.businessId,
            invoiceId: invoice.id,
          },
        });
      }

      return finalInvoice;
    });
  }

  async getPortfolio(user: AuthUser, query: PaginationQueryDto) {
    const investor = await this.getInvestorForUser(user);
    const where = { investorId: investor.id };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.holding.findMany({
        where,
        include: { invoice: true },
        orderBy: { acquiredAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.holding.count({ where }),
    ]);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  async getPortfolioHolding(user: AuthUser, id: string) {
    const investor = await this.getInvestorForUser(user);
    const holding = await this.prisma.holding.findFirst({
      where: { id, investorId: investor.id },
      include: { invoice: true },
    });
    if (!holding) {
      throw new NotFoundException('Holding not found');
    }
    return holding;
  }

  async getWhitelisting(user: AuthUser) {
    const investor = await this.getInvestorForUser(user);
    return {
      whitelistStatus: investor.whitelistStatus,
      countryOfResidence: investor.countryOfResidence,
      displayName: investor.displayName,
    };
  }

  async submitWhitelisting(user: AuthUser, dto: SubmitWhitelistingDto) {
    const investor = await this.getInvestorForUser(user);
    // No admin notification: there's no admin contact list or notification
    // target defined anywhere yet. KYC document upload isn't modelled either
    // (see docs/RAIQUID_CONTEXT.md) — only country + legal name are captured.
    return this.prisma.investor.update({
      where: { id: investor.id },
      data: {
        countryOfResidence: dto.countryOfResidence,
        displayName: dto.legalName,
        whitelistStatus: WhitelistStatus.in_review,
      },
    });
  }

  async getWallet(user: AuthUser) {
    const investor = await this.getInvestorForUser(user);
    const transactions = await this.prisma.walletTransaction.findMany({
      where: { investorId: investor.id },
      orderBy: { createdAt: 'desc' },
    });
    return {
      balance: walletBalance(transactions),
      currency: 'NGN',
      transactions,
    };
  }

  async getSettings(user: AuthUser) {
    return this.getInvestorForUser(user);
  }

  async updateSettings(user: AuthUser, dto: UpdateInvestorSettingsDto) {
    const investor = await this.getInvestorForUser(user);
    return this.prisma.investor.update({
      where: { id: investor.id },
      data: { ...dto },
    });
  }

  private async getInvestorForUser(user: AuthUser): Promise<Investor> {
    if (!user.dbUserId) {
      throw new ForbiddenException('User is not provisioned yet');
    }
    const investor = await this.prisma.investor.findUnique({
      where: { userId: user.dbUserId },
    });
    if (!investor) {
      throw new NotFoundException('Investor profile not found');
    }
    return investor;
  }
}
