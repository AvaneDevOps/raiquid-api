-- Rewrite OnChainAction to the real Brickken Dapp API method names. The prior
-- values (mint/whitelist/transfer/burn) were a guess; nothing ever wrote to
-- OnChainEvent, so the enum swap has no rows to migrate. If a row does exist
-- with an old value the USING cast below fails loudly, which is correct.

-- AlterEnum
BEGIN;
CREATE TYPE "OnChainAction_new" AS ENUM ('newTokenization', 'whitelist', 'mintToken', 'newSto', 'newInvest', 'closeOffer', 'claimTokens', 'dividendDistribution');
ALTER TABLE "OnChainEvent" ALTER COLUMN "action" TYPE "OnChainAction_new" USING ("action"::text::"OnChainAction_new");
ALTER TYPE "OnChainAction" RENAME TO "OnChainAction_old";
ALTER TYPE "OnChainAction_new" RENAME TO "OnChainAction";
DROP TYPE "OnChainAction_old";
COMMIT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "brickkenStoEndsAt" TIMESTAMP(3),
ADD COLUMN     "brickkenStoId" TEXT,
ADD COLUMN     "brickkenTokenSymbol" TEXT,
ADD COLUMN     "brickkenTokenizationError" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_brickkenTokenSymbol_key" ON "Invoice"("brickkenTokenSymbol");
