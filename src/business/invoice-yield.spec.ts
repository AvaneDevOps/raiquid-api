import { Prisma } from '../generated/prisma/client';
import { ProvenanceTier } from '../common/enums';
import { computeInvoiceYield } from './invoice-yield';

describe('computeInvoiceYield', () => {
  it('computes the full formula for a 45-day window (rounds up to 2 months), carried tier', () => {
    const confirmedAt = new Date('2026-01-01T00:00:00Z');
    const dueDate = new Date('2026-02-15T00:00:00Z'); // 45 days later
    const out = computeInvoiceYield(
      new Prisma.Decimal(100_000),
      dueDate,
      confirmedAt,
      ProvenanceTier.carried,
    );

    // durationInMonths = ceil(45/30) = 2; totalDiscountPct = 3.5 * 2 = 7.0
    // totalDiscountAmount = 100000 * 7 / 100 = 7000
    // fundingTargetAmount = 100000 - 7000 = 93000
    // investorYieldPct = (7000 * 0.75) / 93000 * 100 = 5.645161290322580645...
    expect(out.fundingTargetAmount.toString()).toBe('93000');
    expect(out.investorYieldPct.toNumber()).toBeCloseTo(5.645161290322581, 10);
  });

  it('rounds a sub-30-day window up to 1 month, not down to 0', () => {
    const confirmedAt = new Date('2026-01-01T00:00:00Z');
    const dueDate = new Date('2026-01-11T00:00:00Z'); // 10 days later
    const out = computeInvoiceYield(
      new Prisma.Decimal(100_000),
      dueDate,
      confirmedAt,
      ProvenanceTier.anchored,
    );

    // durationInMonths = ceil(10/30) = 1; totalDiscountPct = 3.0 * 1 = 3.0
    expect(out.fundingTargetAmount.toString()).toBe('97000');
  });

  it('floors duration at 1 month even when dueDate is not after confirmedAt', () => {
    const confirmedAt = new Date('2026-01-01T00:00:00Z');
    const dueDate = new Date('2026-01-01T00:00:00Z'); // 0 days
    const out = computeInvoiceYield(
      new Prisma.Decimal(100_000),
      dueDate,
      confirmedAt,
      ProvenanceTier.quarried,
    );

    // durationInMonths = max(1, ceil(0/30)) = 1; totalDiscountPct = 4.0 * 1 = 4.0
    expect(out.fundingTargetAmount.toString()).toBe('96000');
  });

  it('uses the confirmed per-tier monthly rates: anchored 3.0, carried 3.5, quarried 4.0', () => {
    const confirmedAt = new Date('2026-01-01T00:00:00Z');
    const dueDate = new Date('2026-01-30T00:00:00Z'); // 29 days -> 1 month
    const amount = new Prisma.Decimal(10_000);

    const anchored = computeInvoiceYield(
      amount,
      dueDate,
      confirmedAt,
      ProvenanceTier.anchored,
    );
    const carried = computeInvoiceYield(
      amount,
      dueDate,
      confirmedAt,
      ProvenanceTier.carried,
    );
    const quarried = computeInvoiceYield(
      amount,
      dueDate,
      confirmedAt,
      ProvenanceTier.quarried,
    );

    expect(anchored.fundingTargetAmount.toString()).toBe('9700'); // 10000 - 3%
    expect(carried.fundingTargetAmount.toString()).toBe('9650'); // 10000 - 3.5%
    expect(quarried.fundingTargetAmount.toString()).toBe('9600'); // 10000 - 4%
  });
});
