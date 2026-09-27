-- Calendar & Scheduling V1: inspection duration/readiness fields, date-only
-- transaction deadlines, service default durations, blocked time on
-- Appointment, per-user calendar preferences, and range-query indexes.


-- CreateEnum
CREATE TYPE "AppointmentKind" AS ENUM ('APPOINTMENT', 'BLOCK');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "kind" "AppointmentKind" NOT NULL DEFAULT 'APPOINTMENT',
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "inspections" ADD COLUMN     "accessNotes" TEXT,
ADD COLUMN     "agreementSignedAt" TIMESTAMP(3),
ADD COLUMN     "durationMinutes" INTEGER NOT NULL DEFAULT 180;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "defaultDurationMinutes" INTEGER;

-- AlterTable
-- closingDate becomes date-only. No application code wrote it before this
-- migration; any existing value keeps its stored calendar day (date inputs
-- in this app are anchored at local noon, so the UTC date is the same day).
ALTER TABLE "transactions" ADD COLUMN     "inspectionDeadline" DATE,
ALTER COLUMN "closingDate" SET DATA TYPE DATE USING "closingDate"::date;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "calendarPreferences" JSONB;

-- CreateIndex
CREATE INDEX "appointments_userId_startAt_idx" ON "appointments"("userId", "startAt");

-- CreateIndex
CREATE INDEX "inspection_reports_inspectionId_idx" ON "inspection_reports"("inspectionId");

-- CreateIndex
CREATE INDEX "inspections_inspectorId_scheduledAt_idx" ON "inspections"("inspectorId", "scheduledAt");

-- CreateIndex
CREATE INDEX "invoices_dueAt_idx" ON "invoices"("dueAt");

-- CreateIndex
CREATE INDEX "transactions_closingDate_idx" ON "transactions"("closingDate");

-- CreateIndex
CREATE INDEX "transactions_inspectionDeadline_idx" ON "transactions"("inspectionDeadline");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

