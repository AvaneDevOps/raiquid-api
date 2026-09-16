-- Discount-based investor yield mechanism, plus fundedAt for "time to cash".
-- All three columns are nullable and additive; every existing Invoice row
-- gets NULL for all three. fundInvoice's funding-cap fallback
-- (fundingTargetAmount ?? amount) means a NULL fundingTargetAmount keeps a
-- pre-existing row behaving exactly as it did before this migration.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "fundedAt" TIMESTAMP(3),
ADD COLUMN     "fundingTargetAmount" DECIMAL(18,2),
ADD COLUMN     "investorYieldPct" DECIMAL(5,2);
