-- CreateEnum
CREATE TYPE "PreferredContactMethod" AS ENUM ('PHONE', 'TEXT', 'EMAIL');

-- AlterTable
ALTER TABLE "communications" ADD COLUMN     "realtorId" TEXT;

-- AlterTable
ALTER TABLE "realtors" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "preferredContactMethod" "PreferredContactMethod",
ADD COLUMN     "preferredName" TEXT;

-- AlterTable
ALTER TABLE "referral_sources" ADD COLUMN     "realtorId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "realtorId" TEXT;

-- CreateIndex
CREATE INDEX "communications_realtorId_idx" ON "communications"("realtorId");

-- CreateIndex
CREATE INDEX "realtors_lastName_firstName_idx" ON "realtors"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "realtors_brokerageId_idx" ON "realtors"("brokerageId");

-- CreateIndex
CREATE INDEX "realtors_email_idx" ON "realtors"("email");

-- CreateIndex
CREATE INDEX "realtors_phone_idx" ON "realtors"("phone");

-- CreateIndex
CREATE INDEX "referral_sources_realtorId_idx" ON "referral_sources"("realtorId");

-- CreateIndex
CREATE INDEX "tasks_realtorId_completedAt_idx" ON "tasks"("realtorId", "completedAt");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_realtorId_fkey" FOREIGN KEY ("realtorId") REFERENCES "realtors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_sources" ADD CONSTRAINT "referral_sources_realtorId_fkey" FOREIGN KEY ("realtorId") REFERENCES "realtors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_realtorId_fkey" FOREIGN KEY ("realtorId") REFERENCES "realtors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
