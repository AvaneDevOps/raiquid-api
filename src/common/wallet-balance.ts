import { WalletTransactionType } from './enums';
import type { WalletTransaction } from '../generated/prisma/client';

// Money in vs money out. `deposit` / `repayment` credit a wallet;
// `withdrawal` / `invested` debit it. Shared between the business and investor
// wallet views so the two can't drift.
const CREDIT_TYPES = new Set<WalletTransactionType>([
  WalletTransactionType.deposit,
  WalletTransactionType.repayment,
]);

/** Signed sum of a wallet's transactions. */
export function walletBalance(
  transactions: Pick<WalletTransaction, 'type' | 'amount'>[],
): number {
  return transactions.reduce((sum, t) => {
    const amount = Number(t.amount);
    return CREDIT_TYPES.has(t.type) ? sum + amount : sum - amount;
  }, 0);
}
