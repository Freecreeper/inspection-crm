-- Dashboard V1: per-user Dashboard preferences (one validated JSON document
-- on the user, like calendarPreferences) and two indexes for Dashboard
-- counts. Additive only.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "dashboardPreferences" JSONB;

-- CreateIndex
CREATE INDEX "leads_createdAt_idx" ON "leads"("createdAt");

-- CreateIndex
CREATE INDEX "report_deliveries_status_idx" ON "report_deliveries"("status");
