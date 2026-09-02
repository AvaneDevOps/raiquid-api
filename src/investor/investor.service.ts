import { Injectable, NotImplementedException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.type';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { FundInvoiceDto } from './dto/fund-invoice.dto';
import type { SubmitWhitelistingDto } from './dto/submit-whitelisting.dto';
import type { UpdateInvestorSettingsDto } from './dto/update-investor-settings.dto';

/**
 * Investor area — the funder-facing dashboard (/investor/*).
 *
 * All method bodies are stubs per the project-structure scope.
 */
@Injectable()
export class InvestorService {
  /** GET /investor/marketplace — frontend: /investor/marketplace. */
  listMarketplace(
    _user: AuthUser,
    _query: PaginationQueryDto,
  ): Promise<unknown> {
    // TODO: implement. Invoices in `funding` status open for investment.
    throw new NotImplementedException();
  }

  /** GET /investor/marketplace/:id — frontend: /investor/marketplace/[id]. */
  getMarketplaceListing(_user: AuthUser, _id: string): Promise<unknown> {
    // TODO: implement. One listing with buyer provenance, economics, progress.
    throw new NotImplementedException();
  }

  /** POST /investor/marketplace/:id/fund — frontend: /investor/marketplace/[id]. */
  fundInvoice(
    _user: AuthUser,
    _invoiceId: string,
    _dto: FundInvoiceDto,
  ): Promise<unknown> {
    // TODO: implement. Check whitelist + wallet balance, create Holding,
    // debit wallet, bump Invoice.fundedAmount, trigger on-chain transfer.
    throw new NotImplementedException();
  }

  /** GET /investor/portfolio — frontend: /investor/portfolio. */
  getPortfolio(_user: AuthUser): Promise<unknown> {
    // TODO: implement. This investor's holdings with valuation + returns.
    throw new NotImplementedException();
  }

  /** GET /investor/portfolio/:id — frontend: /investor/portfolio/[id]. */
  getPortfolioHolding(_user: AuthUser, _id: string): Promise<unknown> {
    // TODO: implement. One holding with the underlying invoice + repayment state.
    throw new NotImplementedException();
  }

  /** GET /investor/whitelisting — frontend: /investor/whitelisting. */
  getWhitelisting(_user: AuthUser): Promise<unknown> {
    // TODO: implement. Current WhitelistStatus + submitted details.
    throw new NotImplementedException();
  }

  /** POST /investor/whitelisting — frontend: /investor/whitelisting. */
  submitWhitelisting(
    _user: AuthUser,
    _dto: SubmitWhitelistingDto,
  ): Promise<unknown> {
    // TODO: implement. Persist details, move status to `identity_submitted` ->
    // `in_review`, notify admins.
    throw new NotImplementedException();
  }

  /** GET /investor/wallet — frontend: /investor/wallet. */
  getWallet(_user: AuthUser): Promise<unknown> {
    // TODO: implement. Balance + WalletTransaction history for this investor.
    throw new NotImplementedException();
  }

  /** GET /investor/settings — frontend: /investor/settings. */
  getSettings(_user: AuthUser): Promise<unknown> {
    // TODO: implement.
    throw new NotImplementedException();
  }

  /** PATCH /investor/settings — frontend: /investor/settings. */
  updateSettings(
    _user: AuthUser,
    _dto: UpdateInvestorSettingsDto,
  ): Promise<unknown> {
    // TODO: implement.
    throw new NotImplementedException();
  }
}
