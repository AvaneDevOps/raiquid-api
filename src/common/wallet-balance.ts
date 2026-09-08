import { WalletTransactionType } from './enums';
import type { WalletTransaction } from '../generated/prisma/client';

const CREDIT_TYPES = new Set<WalletTransactionType>([
  WalletTransactionType.deposit,
  WalletTransactionType.repayment,
]);

export function walletBalance(
  transactions: Pick<WalletTransaction, 'type' | 'amount'>[],
): number {
  return transactions.reduce((sum, t) => {
    const amount = Number(t.amount);
    return CREDIT_TYPES.has(t.type) ? sum + amount : sum - amount;
  }, 0);
}
