-- PR #1 architecture review corrections (items 1, 2, 5, 6).
--
-- This is a destructive migration against transactions.customerId,
-- transaction_participants, and invoices.inspectionId. That is acceptable
-- here: this schema has never shipped, there is no production data, and the
-- only rows that can exist locally come from `prisma db seed`, which creates
-- none of the tables touched below. Do not model this migration as a
-- template for a later destructive change against real data.

-- ============================================================================
-- Item 1: Customer <-> Transaction becomes many-to-many via TransactionCustomer
-- ============================================================================

-- CreateEnum
CREATE TYPE "TransactionCustomerRole" AS ENUM ('PRIMARY_BUYER', 'SECONDARY_BUYER', 'SELLER', 'OTHER');

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_customerId_fkey";

-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "customerId";

-- CreateTable
CREATE TABLE "transaction_customers" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "role" "TransactionCustomerRole" NOT NULL DEFAULT 'OTHER',
    "primaryContact" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transaction_customers_transactionId_customerId_key" ON "transaction_customers"("transactionId", "customerId");

-- CreateIndex
CREATE INDEX "transaction_customers_transactionId_idx" ON "transaction_customers"("transactionId");

-- CreateIndex
CREATE INDEX "transaction_customers_customerId_idx" ON "transaction_customers"("customerId");

-- AddForeignKey
ALTER TABLE "transaction_customers" ADD CONSTRAINT "transaction_customers_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_customers" ADD CONSTRAINT "transaction_customers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Item 2: TransactionParticipant -> TransactionRealtor (Realtor-specific)
-- ============================================================================

-- CreateEnum
CREATE TYPE "RealtorParticipantRole" AS ENUM ('BUYER_AGENT', 'LISTING_AGENT', 'TRANSACTION_COORDINATOR', 'OTHER');

-- DropForeignKey
ALTER TABLE "transaction_participants" DROP CONSTRAINT "transaction_participants_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "transaction_participants" DROP CONSTRAINT "transaction_participants_realtorId_fkey";

-- DropTable
DROP TABLE "transaction_participants";

-- DropEnum
DROP TYPE "ParticipantRole";

-- CreateTable (includes the brokerage snapshot from item 5)
CREATE TABLE "transaction_realtors" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "realtorId" TEXT NOT NULL,
    "role" "RealtorParticipantRole" NOT NULL,
    "brokerageId" TEXT,
    "brokerageName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_realtors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transaction_realtors_transactionId_idx" ON "transaction_realtors"("transactionId");

-- CreateIndex
CREATE INDEX "transaction_realtors_realtorId_idx" ON "transaction_realtors"("realtorId");

-- AddForeignKey
ALTER TABLE "transaction_realtors" ADD CONSTRAINT "transaction_realtors_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_realtors" ADD CONSTRAINT "transaction_realtors_realtorId_fkey" FOREIGN KEY ("realtorId") REFERENCES "realtors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_realtors" ADD CONSTRAINT "transaction_realtors_brokerageId_fkey" FOREIGN KEY ("brokerageId") REFERENCES "brokerages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Item 6: Invoice anchors to Transaction; Inspection<->Invoice becomes 1:many
-- ============================================================================

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_inspectionId_fkey";

-- DropIndex
DROP INDEX "invoices_inspectionId_key";

-- AlterTable
ALTER TABLE "invoices"
  ADD COLUMN "transactionId" TEXT NOT NULL,
  ALTER COLUMN "inspectionId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "invoices_transactionId_idx" ON "invoices"("transactionId");

-- CreateIndex
CREATE INDEX "invoices_inspectionId_idx" ON "invoices"("inspectionId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
