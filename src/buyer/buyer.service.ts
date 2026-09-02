import { Injectable, NotImplementedException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.type';
import type { PayInvoiceDto } from './dto/pay-invoice.dto';
import type { ReviewConfirmationDto } from './dto/review-confirmation.dto';
import type { UpdateBuyerSettingsDto } from './dto/update-buyer-settings.dto';

/**
 * Buyer area — the debtor-facing dashboard (/buyer/*) plus the PUBLIC
 * magic-link confirm flow (/confirm/*).
 *
 * All method bodies are stubs per the project-structure scope.
 */
@Injectable()
export class BuyerService {
  /** GET /buyer/invoices — frontend: /buyer/invoices. */
  listInvoices(_user: AuthUser): Promise<unknown> {
    // TODO: implement. Invoices where this buyer is the debtor.
    throw new NotImplementedException();
  }

  /** GET /buyer/payment-schedule — frontend: /buyer/payment-schedule. */
  getPaymentSchedule(_user: AuthUser): Promise<unknown> {
    // TODO: implement. Upcoming/overdue repayments across this buyer's invoices.
    throw new NotImplementedException();
  }

  /** POST /buyer/invoices/:id/pay — frontend: /buyer/payment-schedule "Pay". */
  payInvoice(
    _user: AuthUser,
    _invoiceId: string,
    _dto: PayInvoiceDto,
  ): Promise<unknown> {
    // TODO: implement. Record a repayment WalletTransaction, advance the
    // invoice toward `repaid`, fan out repayment to holders.
    throw new NotImplementedException();
  }

  /** GET /buyer/settings — frontend: /buyer/settings. */
  getSettings(_user: AuthUser): Promise<unknown> {
    // TODO: implement.
    throw new NotImplementedException();
  }

  /** PATCH /buyer/settings — frontend: /buyer/settings. */
  updateSettings(
    _user: AuthUser,
    _dto: UpdateBuyerSettingsDto,
  ): Promise<unknown> {
    // TODO: implement.
    throw new NotImplementedException();
  }

  // --- PUBLIC magic-link confirm flow (no Clerk session) ---

  /** GET /confirm/:invoiceId — frontend: standalone /confirm/[invoiceId]. */
  getConfirmation(_confirmToken: string): Promise<unknown> {
    // TODO: implement. Resolve the Invoice by confirmToken, return a
    // read-only summary for the buyer to review. 404 if token unknown.
    throw new NotImplementedException();
  }

  /** POST /confirm/:invoiceId/review — frontend: standalone /confirm/[invoiceId]. */
  submitConfirmationReview(
    _confirmToken: string,
    _dto: ReviewConfirmationDto,
  ): Promise<unknown> {
    // TODO: implement. Accept -> move invoice to `tokenized` and notify the
    // business + trigger minting; dispute -> flag and notify the business.
    throw new NotImplementedException();
  }
}
