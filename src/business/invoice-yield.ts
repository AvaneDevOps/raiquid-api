import { Prisma } from '../generated/prisma/client';
import { ProvenanceTier } from '../common/enums';

// Investor-side monthly discount rate by the buyer's provenance tier —
// a different concept from PROVENANCE_FEE_SCHEDULE's business-side fees.
// Confirmed rates (2026-09-16), not placeholders.
export const TIER_MONTHLY_DISCOUNT_RATE: Record<ProvenanceTier, number> = {
  [ProvenanceTier.anchored]: 3.0,
  [ProvenanceTier.carried]: 3.5,
  [ProvenanceTier.quarried]: 4.0,
};

// Of the total discount, the share that becomes investor yield. The
// remaining 25% is the platform's share of the surplus — deliberately not
// tracked anywhere yet (no WalletTransaction, no ledger row); see
// docs/RAIQUID_CONTEXT.md.
const INVESTOR_SURPLUS_SHARE = 0.75;

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DAYS_PER_MONTH = 30;

export interface InvoiceYield {
  fundingTargetAmount: Prisma.Decimal;
  investorYieldPct: Prisma.Decimal;
}

/**
 * Computed once, at buyer confirmation — duration only makes sense once the
 * investment window actually opens. `confirmedAt` and `dueDate` are whole
 * dates; duration rounds up to a full month, minimum 1.
 */
export function computeInvoiceYield(
  amount: Prisma.Decimal,
  dueDate: Date,
  confirmedAt: Date,
  provenanceTier: ProvenanceTier,
): InvoiceYield {
  const days = (dueDate.getTime() - confirmedAt.getTime()) / MS_PER_DAY;
  const durationInMonths = Math.max(1, Math.ceil(days / DAYS_PER_MONTH));

  const tierMonthlyRate = TIER_MONTHLY_DISCOUNT_RATE[provenanceTier];
  const totalDiscountPct = tierMonthlyRate * durationInMonths;
  const totalDiscountAmount = amount.mul(totalDiscountPct).div(100);
  const fundingTargetAmount = amount.sub(totalDiscountAmount);
  const investorYieldPct = totalDiscountAmount
    .mul(INVESTOR_SURPLUS_SHARE)
    .div(fundingTargetAmount)
    .mul(100);

  return { fundingTargetAmount, investorYieldPct };
}
