import { Injectable, NotImplementedException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.type';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { ListInvoicesQueryDto } from './dto/list-invoices.query.dto';
import type { UpdateBusinessSettingsDto } from './dto/update-business-settings.dto';

/**
 * Business area — the supplier-facing dashboard (/business/*).
 *
 * All method bodies are stubs per the project-structure scope. Each notes the
 * frontend screen it backs and what real logic belongs here.
 */
@Injectable()
export class BusinessService {
  /** GET /business/invoices — frontend: /business/invoices list. */
  listInvoices(
    _user: AuthUser,
    _query: ListInvoicesQueryDto,
  ): Promise<unknown> {
    // TODO: implement. Return the current business's invoices (paginated,
    // optional status filter) with buyer + funding summary.
    throw new NotImplementedException();
  }

  /** POST /business/invoices — frontend: /business/invoices "Submit invoice". */
  createInvoice(_user: AuthUser, _dto: CreateInvoiceDto): Promise<unknown> {
    // TODO: implement. Upsert the Buyer, create the Invoice in `submitted`,
    // generate a confirmToken, email the buyer the magic link, return the row.
    throw new NotImplementedException();
  }

  /** GET /business/invoices/:id — frontend: /business/invoices/[id] detail. */
  getInvoice(_user: AuthUser, _id: string): Promise<unknown> {
    // TODO: implement. Return one invoice owned by the current business,
    // including holdings, on-chain events and repayment schedule.
    throw new NotImplementedException();
  }

  /** GET /business/wallet — frontend: /business/wallet. */
  getWallet(_user: AuthUser): Promise<unknown> {
    // TODO: implement. Aggregate WalletTransaction rows for this business into
    // a balance + transaction history.
    throw new NotImplementedException();
  }

  /** GET /business/settings — frontend: /business/settings. */
  getSettings(_user: AuthUser): Promise<unknown> {
    // TODO: implement. Return the Business profile for the current user.
    throw new NotImplementedException();
  }

  /** PATCH /business/settings — frontend: /business/settings. */
  updateSettings(
    _user: AuthUser,
    _dto: UpdateBusinessSettingsDto,
  ): Promise<unknown> {
    // TODO: implement. Partial-update the Business profile.
    throw new NotImplementedException();
  }
}
