-- Investor funding now drives an on-chain `newInvest` per Holding, and an admin
-- can finalize a closed STO (closeOffer -> claimTokens -> dividendDistribution).
-- Two nullable columns record, respectively, a per-Holding newInvest failure and
-- the moment the on-chain offering was finalized. Both are additive; no backfill.

-- AlterTable
ALTER TABLE "Holding" ADD COLUMN     "brickkenInvestmentError" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "brickkenFinalizedAt" TIMESTAMP(3);
