-- Indexes on foreign keys Postgres doesn't index automatically (audit:
-- the Realtor directory sequentially scanned inspections and transactions
-- for every realtor). Additive only.

-- CreateIndex
CREATE INDEX "leads_referralSourceId_idx" ON "leads"("referralSourceId");

-- CreateIndex
CREATE INDEX "appointments_inspectionId_idx" ON "appointments"("inspectionId");

-- CreateIndex
CREATE INDEX "appointments_transactionId_idx" ON "appointments"("transactionId");

-- CreateIndex
CREATE INDEX "tasks_transactionId_idx" ON "tasks"("transactionId");

-- CreateIndex
CREATE INDEX "realtor_brokerage_history_brokerageId_idx" ON "realtor_brokerage_history"("brokerageId");

-- CreateIndex
CREATE INDEX "transactions_referralSourceId_idx" ON "transactions"("referralSourceId");

-- CreateIndex
CREATE INDEX "transactions_propertyId_idx" ON "transactions"("propertyId");

-- CreateIndex
CREATE INDEX "transaction_realtors_brokerageId_idx" ON "transaction_realtors"("brokerageId");

-- CreateIndex
CREATE INDEX "inspections_transactionId_idx" ON "inspections"("transactionId");

-- CreateIndex
CREATE INDEX "inspections_propertyId_idx" ON "inspections"("propertyId");

-- CreateIndex
CREATE INDEX "inspection_services_serviceId_idx" ON "inspection_services"("serviceId");

-- CreateIndex
CREATE INDEX "media_reportId_idx" ON "media"("reportId");

-- CreateIndex
CREATE INDEX "report_deliveries_versionId_idx" ON "report_deliveries"("versionId");

-- CreateIndex
CREATE INDEX "email_messages_reportDeliveryId_idx" ON "email_messages"("reportDeliveryId");

-- CreateIndex
CREATE INDEX "email_messages_templateId_idx" ON "email_messages"("templateId");

