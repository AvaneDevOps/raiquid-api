/**
 * Re-export of the schema enums from the generated Prisma client, so the rest
 * of the app imports domain enums from one stable path instead of reaching
 * into `src/generated/`. These are runtime objects (usable with
 * class-validator's `@IsEnum`) as well as types.
 */
export {
  UserRole,
  ProvenanceTier,
  InvoiceStatus,
  WhitelistStatus,
  WalletTransactionType,
  OnChainAction,
  OnChainStatus,
  NotificationTone,
  KycDocumentType,
} from '../generated/prisma/enums';
