import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BrickkenService } from '../brickken/brickken.service';
import { BrickkenIntegrationError } from '../brickken/brickken.errors';
import type { AuthUser } from '../auth/auth-user.type';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import {
  InvoiceStatus,
  KycDocumentType,
  NotificationTone,
  WalletTransactionType,
  WhitelistStatus,
} from '../common/enums';
import { walletBalance } from '../common/wallet-balance';
import type { Invoice, Investor } from '../generated/prisma/client';
import type { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import type { DepositDto } from './dto/deposit.dto';
import type { FundInvoiceDto } from './dto/fund-invoice.dto';
import type { SubmitWhitelistingDto } from './dto/submit-whitelisting.dto';
import type { UpdateInvestorSettingsDto } from './dto/update-investor-settings.dto';

const OPEN_FOR_INVESTMENT: InvoiceStatus[] = [
  InvoiceStatus.tokenized,
  InvoiceStatus.funding,
];

@Injectable()
export class InvestorService {
  private readonly logger = new Logger(InvestorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly brickken: BrickkenService,
  ) {}

  async listMarketplace(user: AuthUser, query: PaginationQueryDto) {
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
      include: { business: true },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (!OPEN_FOR_INVESTMENT.includes(invoice.status)) {
      throw new ConflictException(
        `Invoice is not open for investment (status "${invoice.status}")`,
      );
    }

    // Falls back to the full face value when fundingTargetAmount is null —
    // true for every invoice confirmed before the yield mechanism existed —
    // so those rows keep funding exactly as they did before.
    const fundingTarget = invoice.fundingTargetAmount ?? invoice.amount;
    const remaining = fundingTarget.sub(invoice.fundedAmount);
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

    const finalInvoice = await this.prisma.$transaction(async (tx) => {
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
      const fullyFunded = incremented.fundedAmount.gte(
        incremented.fundingTargetAmount ?? incremented.amount,
      );

      const finalInvoice = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: fullyFunded ? InvoiceStatus.funded : InvoiceStatus.funding,
          ...(fullyFunded ? { fundedAt: new Date() } : {}),
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
        await this.notifications.notify(
          {
            userId: invoice.business.userId,
            tone: NotificationTone.positive,
            title: `Invoice ${invoice.invoiceNumber} fully funded`,
            body: `Invoice ${invoice.invoiceNumber} is fully funded. A net payout of ${invoice.currency} ${netPayout.toString()} has been credited to your wallet.`,
            href: `/business/invoices/${invoice.id}`,
          },
          tx,
        );
      }

      return finalInvoice;
    });

    await this.recordOnChainInvestment(invoice, investor.id, dto.amount);
    return finalInvoice;
  }

  /**
   * Mirrors a completed funding to the STO as the platform wallet's `newInvest`.
   * Runs after the funding transaction has committed: the investor's capital is
   * real in our ledger regardless of chain state, so a Brickken failure here is
   * recorded on the Holding (queryable, reconcilable) and never rolls anything
   * back. See docs/RAIQUID_CONTEXT.md for why the flag lives on Holding.
   */
  private async recordOnChainInvestment(
    invoice: Invoice,
    investorId: string,
    amount: number,
  ): Promise<void> {
    const where = {
      investorId_invoiceId: { investorId, invoiceId: invoice.id },
    };

    if (!invoice.brickkenTokenSymbol) {
      const message =
        'invoice has no Brickken token symbol — tokenization never completed on-chain';
      await this.prisma.holding.update({
        where,
        data: { brickkenInvestmentError: message },
      });
      this.logger.error(
        `Holding ${investorId}/${invoice.id} funded but newInvest was skipped: ${message}`,
      );
      return;
    }

    try {
      await this.brickken.invest({
        invoiceId: invoice.id,
        tokenSymbol: invoice.brickkenTokenSymbol,
        amount: String(amount),
      });
      await this.prisma.holding.update({
        where,
        data: { brickkenInvestmentError: null },
      });
    } catch (err) {
      const message =
        err instanceof BrickkenIntegrationError
          ? `[${err.kind}] ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      await this.prisma.holding.update({
        where,
        data: { brickkenInvestmentError: message.slice(0, 500) },
      });
      this.logger.error(
        `Holding ${investorId}/${invoice.id} funded but newInvest did not complete: ${message}`,
      );
    }
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

  async createWhitelistingUploadUrl(
    user: AuthUser,
    dto: CreateUploadUrlDto,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    const investor = await this.getInvestorForUser(user);
    const objectKey = `kyc/${investor.id}/${dto.documentType}/${randomUUID()}`;
    const uploadUrl = await this.storage.createUploadUrl(
      objectKey,
      dto.contentType,
    );
    return { uploadUrl, objectKey };
  }

  async submitWhitelisting(user: AuthUser, dto: SubmitWhitelistingDto) {
    const investor = await this.getInvestorForUser(user);
    const prefix = `kyc/${investor.id}/`;

    const docs: { documentType: KycDocumentType; objectKey: string }[] = [];
    if (dto.identityDocumentKey) {
      docs.push({
        documentType: KycDocumentType.identity,
        objectKey: dto.identityDocumentKey,
      });
    }
    if (dto.proofOfAddressKey) {
      docs.push({
        documentType: KycDocumentType.proof_of_address,
        objectKey: dto.proofOfAddressKey,
      });
    }
    if (docs.some((d) => !d.objectKey.startsWith(prefix))) {
      throw new BadRequestException(
        'Document key does not belong to this investor',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.investor.update({
        where: { id: investor.id },
        data: {
          countryOfResidence: dto.countryOfResidence,
          displayName: dto.legalName,
          whitelistStatus: WhitelistStatus.in_review,
        },
      });
      if (docs.length > 0) {
        await tx.kycDocument.createMany({
          data: docs.map((d) => ({ ...d, investorId: investor.id })),
        });
      }
      return updated;
    });
  }

  async getWallet(user: AuthUser) {
    const investor = await this.getInvestorForUser(user);
    return this.walletView(investor.id);
  }

  async deposit(user: AuthUser, dto: DepositDto) {
    const investor = await this.getInvestorForUser(user);
    await this.prisma.walletTransaction.create({
      data: {
        type: WalletTransactionType.deposit,
        amount: dto.amount,
        investorId: investor.id,
      },
    });
    return this.walletView(investor.id);
  }

  private async walletView(investorId: string) {
    const transactions = await this.prisma.walletTransaction.findMany({
      where: { investorId },
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
