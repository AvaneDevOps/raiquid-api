import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import type { AuthUser } from '../auth/auth-user.type';
import { WalletTransactionType } from '../common/enums';
import { isUniqueConstraintError } from '../common/prisma-errors';
import type { Business } from '../generated/prisma/client';
import { PROVENANCE_FEE_SCHEDULE } from './provenance-fee-schedule';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { ListInvoicesQueryDto } from './dto/list-invoices.query.dto';
import type { UpdateBusinessSettingsDto } from './dto/update-business-settings.dto';

// Business-wallet sign convention: money in = credit, money out = debit.
// `invested`/`repayment` mainly apply to investor wallets, but the type is
// shared, so this stays defined for both rather than special-cased per owner.
const CREDIT_TYPES = new Set<WalletTransactionType>([
  WalletTransactionType.deposit,
  WalletTransactionType.repayment,
]);

/** Business area — the supplier-facing dashboard (/business/*). */
@Injectable()
export class BusinessService {
  private readonly logger = new Logger(BusinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async listInvoices(user: AuthUser, query: ListInvoicesQueryDto) {
    const business = await this.getBusinessForUser(user);
    const where = {
      businessId: business.id,
      ...(query.status ? { status: query.status } : {}),
    };

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

  async createInvoice(user: AuthUser, dto: CreateInvoiceDto) {
    const business = await this.getBusinessForUser(user);

    // Buyers aren't authenticated accounts by default, so they're matched by
    // contact email; normalized to lower case so casing differences don't
    // fragment one buyer (and its provenance tier) across rows. There's a
    // small race window between find and create, acceptable at this scale.
    const buyerEmail = dto.buyerContactEmail.toLowerCase();
    const buyer =
      (await this.prisma.buyer.findFirst({
        where: { contactEmail: buyerEmail },
      })) ??
      (await this.prisma.buyer.create({
        data: {
          legalName: dto.buyerLegalName,
          contactEmail: buyerEmail,
          contactPhone: dto.buyerContactPhone,
        },
      }));

    const confirmToken = randomBytes(32).toString('hex');
    // Fees are never client input — CreateInvoiceDto has no fee fields at
    // all, they're resolved from the buyer's provenance tier.
    const fees = PROVENANCE_FEE_SCHEDULE[buyer.provenanceTier];

    const invoice = await this.prisma.invoice
      .create({
        data: {
          invoiceNumber: dto.invoiceNumber,
          businessId: business.id,
          buyerId: buyer.id,
          description: dto.description,
          amount: dto.amount,
          currency: dto.currency ?? 'NGN',
          dueDate: new Date(dto.dueDate),
          platformFeePct: fees.platformFeePct,
          reserveContributionPct: fees.reserveContributionPct,
          confirmToken,
        },
        include: { buyer: true },
      })
      .catch((err: unknown) => {
        if (isUniqueConstraintError(err)) {
          throw new ConflictException(
            `Invoice number "${dto.invoiceNumber}" already exists for this business`,
          );
        }
        throw err;
      });

    // The invoice is already durably created at this point; a failed email
    // shouldn't fail the request and leave the client thinking nothing
    // happened (or retrying into a duplicate-invoiceNumber 409).
    const confirmUrl = `${this.config.get('FRONTEND_URL', { infer: true })}/confirm/${confirmToken}`;
    try {
      await this.email.sendBuyerConfirmationLink(
        buyer.contactEmail,
        confirmUrl,
      );
    } catch (err) {
      this.logger.error(
        `Invoice ${invoice.id} created but confirmation email failed to send to ${buyer.contactEmail}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return invoice;
  }

  async getInvoice(user: AuthUser, id: string) {
    const business = await this.getBusinessForUser(user);
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, businessId: business.id },
      include: { buyer: true, holdings: true, onChainEvents: true },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  async getWallet(user: AuthUser) {
    const business = await this.getBusinessForUser(user);
    const transactions = await this.prisma.walletTransaction.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' },
    });

    const balance = transactions.reduce((sum, t) => {
      const amount = Number(t.amount);
      return CREDIT_TYPES.has(t.type) ? sum + amount : sum - amount;
    }, 0);

    return { balance, currency: 'NGN', transactions };
  }

  async getSettings(user: AuthUser) {
    return this.getBusinessForUser(user);
  }

  async updateSettings(user: AuthUser, dto: UpdateBusinessSettingsDto) {
    const business = await this.getBusinessForUser(user);
    return this.prisma.business.update({
      where: { id: business.id },
      data: { ...dto },
    });
  }

  private async getBusinessForUser(user: AuthUser): Promise<Business> {
    if (!user.dbUserId) {
      throw new ForbiddenException('User is not provisioned yet');
    }
    const business = await this.prisma.business.findUnique({
      where: { userId: user.dbUserId },
    });
    if (!business) {
      throw new NotFoundException('Business profile not found');
    }
    return business;
  }
}
