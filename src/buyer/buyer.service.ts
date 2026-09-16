import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BrickkenService } from '../brickken/brickken.service';
import { BrickkenIntegrationError } from '../brickken/brickken.errors';
import { brickkenTokenSymbol } from '../brickken/token-symbol';
import { computeInvoiceYield } from '../business/invoice-yield';
import type { AuthUser } from '../auth/auth-user.type';
import {
  InvoiceStatus,
  NotificationTone,
  WalletTransactionType,
} from '../common/enums';
import type { Buyer, Invoice } from '../generated/prisma/client';
import type { ListInvoicesQueryDto } from './dto/list-invoices.query.dto';
import type { PayInvoiceDto } from './dto/pay-invoice.dto';
import type { ReviewConfirmationDto } from './dto/review-confirmation.dto';
import type { UpdateBuyerSettingsDto } from './dto/update-buyer-settings.dto';

const STO_START_DELAY_MS = 20 * 60 * 1000;
const STO_WINDOW_MS = 72 * 60 * 60 * 1000;

function describeBrickkenError(err: unknown): string {
  if (err instanceof BrickkenIntegrationError) {
    return `[${err.kind}] ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class BuyerService {
  private readonly logger = new Logger(BuyerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly brickken: BrickkenService,
  ) {}

  async listInvoices(user: AuthUser, query: ListInvoicesQueryDto) {
    const buyer = await this.getBuyerForUser(user);
    const where = {
      buyerId: buyer.id,
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: { business: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  async getPaymentSchedule(user: AuthUser) {
    const buyer = await this.getBuyerForUser(user);
    return this.prisma.invoice.findMany({
      where: {
        buyerId: buyer.id,
        status: { in: [InvoiceStatus.funded, InvoiceStatus.overdue] },
      },
      include: { business: true },
      orderBy: { dueDate: 'asc' },
    });
  }

  async getSettings(user: AuthUser) {
    return this.getBuyerForUser(user);
  }

  async updateSettings(user: AuthUser, dto: UpdateBuyerSettingsDto) {
    const buyer = await this.getBuyerForUser(user);
    return this.prisma.buyer.update({
      where: { id: buyer.id },
      data: { ...dto },
    });
  }

  async payInvoice(user: AuthUser, invoiceId: string, dto: PayInvoiceDto) {
    const buyer = await this.getBuyerForUser(user);
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, buyerId: buyer.id },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (
      invoice.status !== InvoiceStatus.funded &&
      invoice.status !== InvoiceStatus.overdue
    ) {
      throw new ConflictException(
        `Invoice cannot be paid in status "${invoice.status}" (must be funded or overdue)`,
      );
    }

    if (Number(dto.amount) !== Number(invoice.amount)) {
      throw new BadRequestException(
        `Payment amount must exactly equal the invoice amount (${invoice.amount.toString()})`,
      );
    }

    // Surplus = the gap between what the buyer pays (full face value, always)
    // and what was actually raised (fundedAmount, capped at fundingTarget).
    // 75% of it goes to investors, proportional to each holding's share of
    // the raise; the remaining 25% is the platform's cut of the surplus —
    // deliberately not credited anywhere yet (no WalletTransaction, no
    // ledger), see docs/RAIQUID_CONTEXT.md. For an invoice funded before the
    // yield mechanism existed, fundedAmount already equals amount, so surplus
    // is naturally zero and this is principal-only, same as always.
    const surplus = invoice.amount.sub(invoice.fundedAmount);
    const investorSurplusShare = surplus.mul(0.75);

    return this.prisma.$transaction(async (tx) => {
      const holdings = await tx.holding.findMany({
        where: { invoiceId: invoice.id },
        include: { investor: true },
      });

      for (const h of holdings) {
        const repaidAmount = h.amount.add(
          h.amount.div(invoice.fundedAmount).mul(investorSurplusShare),
        );

        await tx.walletTransaction.create({
          data: {
            type: WalletTransactionType.repayment,
            amount: h.amount,
            description: dto.paymentReference,
            investorId: h.investorId,
            invoiceId: invoice.id,
          },
        });
        await tx.holding.update({
          where: { id: h.id },
          data: { repaidAmount },
        });
        await this.notifications.notify(
          {
            userId: h.investor.userId,
            tone: NotificationTone.positive,
            title: `Invoice ${invoice.invoiceNumber} repaid`,
            body: `Your ${invoice.currency} ${h.amount.toString()} stake in invoice ${invoice.invoiceNumber} has been repaid.`,
            href: `/investor/portfolio/${h.id}`,
          },
          tx,
        );
      }

      return tx.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.repaid, repaidAt: new Date() },
      });
    });
  }

  async getConfirmation(confirmToken: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { confirmToken },
      include: { buyer: true, business: true },
    });
    if (!invoice) {
      throw new NotFoundException('Confirmation link is invalid');
    }
    return invoice;
  }

  async submitConfirmationReview(
    confirmToken: string,
    dto: ReviewConfirmationDto,
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { confirmToken },
      include: { business: { include: { user: true } }, buyer: true },
    });
    if (!invoice) {
      throw new NotFoundException('Confirmation link is invalid');
    }
    if (invoice.confirmedAt) {
      throw new ConflictException('This invoice has already been reviewed');
    }

    const businessEmail =
      invoice.business.contactEmail ?? invoice.business.user.email;

    const noteSuffix = dto.note ? ` Buyer's note: ${dto.note}` : '';

    if (dto.accept) {
      const confirmedAt = new Date();
      const { fundingTargetAmount, investorYieldPct } = computeInvoiceYield(
        invoice.amount,
        invoice.dueDate,
        confirmedAt,
        invoice.buyer.provenanceTier,
      );

      const updated = await this.prisma.$transaction(async (tx) => {
        const inv = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: InvoiceStatus.tokenized,
            confirmedAt,
            fundingTargetAmount,
            investorYieldPct,
          },
        });
        await this.notifications.notify(
          {
            userId: invoice.business.userId,
            tone: NotificationTone.positive,
            title: `Invoice ${invoice.invoiceNumber} accepted`,
            body: `The buyer accepted invoice ${invoice.invoiceNumber}; it is now tokenized and open for funding.${noteSuffix}`,
            href: `/business/invoices/${invoice.id}`,
          },
          tx,
        );
        return inv;
      });
      try {
        await this.email.sendBuyerReviewOutcome(businessEmail, {
          invoiceNumber: invoice.invoiceNumber,
          accepted: true,
          note: dto.note,
        });
      } catch (err) {
        this.logger.error(
          `Invoice ${invoice.id} tokenized but business notification failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      await this.tokenizeAndLaunchOffering(updated);
      return this.prisma.invoice.findUniqueOrThrow({
        where: { id: updated.id },
      });
    }

    await this.notifications.notify({
      userId: invoice.business.userId,
      tone: NotificationTone.warning,
      title: `Invoice ${invoice.invoiceNumber} disputed`,
      body: `The buyer disputed invoice ${invoice.invoiceNumber}.${noteSuffix}`,
      href: `/business/invoices/${invoice.id}`,
    });
    await this.email.sendBuyerReviewOutcome(businessEmail, {
      invoiceNumber: invoice.invoiceNumber,
      accepted: false,
      note: dto.note,
    });
    return invoice;
  }

  private async tokenizeAndLaunchOffering(invoice: Invoice): Promise<void> {
    const tokenSymbol = brickkenTokenSymbol(invoice.id);
    const startDate = new Date(Date.now() + STO_START_DELAY_MS);
    const endDate = new Date(startDate.getTime() + STO_WINDOW_MS);
    const raiseAmount = invoice.amount.toString();

    try {
      await this.brickken.tokenizeInvoice({
        invoiceId: invoice.id,
        tokenSymbol,
        name: `Invoice ${invoice.invoiceNumber}`,
        supplyCap: raiseAmount,
      });
      const { stoId } = await this.brickken.launchOffering({
        invoiceId: invoice.id,
        tokenSymbol,
        offeringName: `Invoice ${invoice.invoiceNumber} financing`,
        tokenAmount: raiseAmount,
        raiseAmount,
        startDate,
        endDate,
      });
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          brickkenTokenSymbol: tokenSymbol,
          brickkenStoId: stoId,
          brickkenStoEndsAt: endDate,
          brickkenTokenizationError: null,
        },
      });
    } catch (err) {
      const message = describeBrickkenError(err);
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { brickkenTokenizationError: message.slice(0, 500) },
      });
      this.logger.error(
        `Invoice ${invoice.id} accepted but Brickken tokenization did not complete: ${message}`,
      );
      return;
    }

    // tokenization + STO succeeded and the STO fields are persisted. The platform
    // wallet still has to be whitelisted for this token before any newInvest can
    // land. A failure here is recorded on brickkenTokenizationError with a
    // `[whitelist]` prefix; brickkenStoId stays set, so this state is distinct
    // from a tokenize/launch failure (see docs/RAIQUID_CONTEXT.md).
    try {
      await this.brickken.whitelistPlatformWallet({
        invoiceId: invoice.id,
        tokenSymbol,
      });
    } catch (err) {
      const message = `[whitelist] ${describeBrickkenError(err)}`;
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { brickkenTokenizationError: message.slice(0, 500) },
      });
      this.logger.error(
        `Invoice ${invoice.id} tokenized and STO launched but platform-wallet whitelisting did not complete: ${message}`,
      );
    }
  }

  private async getBuyerForUser(user: AuthUser): Promise<Buyer> {
    if (!user.dbUserId) {
      throw new ForbiddenException('User is not provisioned yet');
    }
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId: user.dbUserId },
    });
    if (!buyer) {
      throw new NotFoundException('Buyer profile not found');
    }
    return buyer;
  }
}
