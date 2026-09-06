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
import type { AuthUser } from '../auth/auth-user.type';
import { InvoiceStatus, WalletTransactionType } from '../common/enums';
import type { Buyer } from '../generated/prisma/client';
import type { ListInvoicesQueryDto } from './dto/list-invoices.query.dto';
import type { PayInvoiceDto } from './dto/pay-invoice.dto';
import type { ReviewConfirmationDto } from './dto/review-confirmation.dto';
import type { UpdateBuyerSettingsDto } from './dto/update-buyer-settings.dto';

/**
 * Buyer area — the debtor-facing dashboard (/buyer/*) plus the PUBLIC
 * magic-link confirm flow (/confirm/*).
 */
@Injectable()
export class BuyerService {
  private readonly logger = new Logger(BuyerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // --- authenticated buyer endpoints ---

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

    // No partial-payment tracking on Invoice, so only a full payment is
    // accepted — see docs/RAIQUID_CONTEXT.md.
    if (Number(dto.amount) !== Number(invoice.amount)) {
      throw new BadRequestException(
        `Payment amount must exactly equal the invoice amount (${invoice.amount.toString()})`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const holdings = await tx.holding.findMany({
        where: { invoiceId: invoice.id },
      });

      // Principal only. Each holder gets back exactly what they put in
      // (holding.amount) — no return/yield, because there's no rate field
      // on Invoice to compute one from (see docs/RAIQUID_CONTEXT.md).
      for (const h of holdings) {
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
          data: { repaidAmount: h.amount },
        });
      }

      return tx.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.repaid },
      });
    });
  }

  // --- public magic-link confirm flow (no Clerk session) ---

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
      include: { business: { include: { user: true } } },
    });
    if (!invoice) {
      throw new NotFoundException('Confirmation link is invalid');
    }
    if (invoice.confirmedAt) {
      throw new ConflictException('This invoice has already been reviewed');
    }

    // Business.contactEmail is optional; fall back to the owner's account email.
    const businessEmail =
      invoice.business.contactEmail ?? invoice.business.user.email;

    if (dto.accept) {
      const updated = await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.tokenized, confirmedAt: new Date() },
      });
      // Status change is the durable outcome; a failed notification email
      // shouldn't undo it or fail the request.
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
      return updated;
    }

    // accept=false: no status change — InvoiceStatus has no declined/disputed
    // value, and inventing one backend-only would diverge the shared contract
    // (see docs/RAIQUID_CONTEXT.md). The notification IS the whole outcome
    // here, so a send failure propagates rather than being swallowed.
    await this.email.sendBuyerReviewOutcome(businessEmail, {
      invoiceNumber: invoice.invoiceNumber,
      accepted: false,
      note: dto.note,
    });
    return invoice;
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
