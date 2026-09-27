-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED', 'CANCELLED', 'SUPPRESSED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EmailSendMode" AS ENUM ('AUTOMATIC', 'REVIEW', 'MANUAL');

-- CreateEnum
CREATE TYPE "EmailCategory" AS ENUM ('TRANSACTIONAL', 'RELATIONSHIP', 'MARKETING');

-- CreateEnum
CREATE TYPE "EmailRecipientType" AS ENUM ('CUSTOMER', 'REALTOR', 'OTHER');

-- CreateEnum
CREATE TYPE "SuppressionScope" AS ENUM ('ALL', 'NON_TRANSACTIONAL', 'MARKETING');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "automations" ADD COLUMN     "description" TEXT,
ADD COLUMN     "key" TEXT,
ADD COLUMN     "sendMode" "EmailSendMode" NOT NULL DEFAULT 'AUTOMATIC';

-- AlterTable
ALTER TABLE "communications" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "inspectionId" TEXT;

-- AlterTable
ALTER TABLE "inspections" ADD COLUMN     "scheduleVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "realtors" ADD COLUMN     "birthdayDay" INTEGER,
ADD COLUMN     "birthdayMonth" INTEGER,
ADD COLUMN     "careerStartDate" DATE,
ADD COLUMN     "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketingOptInAt" TIMESTAMP(3),
ADD COLUMN     "marketingOptInSource" TEXT,
ADD COLUMN     "marketingUnsubscribedAt" TIMESTAMP(3),
ADD COLUMN     "relationshipEmailsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "relationshipStartDate" DATE;

-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "EmailCategory" NOT NULL,
    "recipientType" "EmailRecipientType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "automationEligible" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL,
    "mode" "EmailSendMode" NOT NULL,
    "category" "EmailCategory" NOT NULL,
    "statusReason" TEXT,
    "recipientType" "EmailRecipientType" NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "templateId" TEXT,
    "automationId" TEXT,
    "campaignId" TEXT,
    "customerId" TEXT,
    "realtorId" TEXT,
    "transactionId" TEXT,
    "inspectionId" TEXT,
    "invoiceId" TEXT,
    "reportDeliveryId" TEXT,
    "idempotencyKey" TEXT,
    "guard" JSONB,
    "scheduledFor" TIMESTAMP(3),
    "queuedAt" TIMESTAMP(3),
    "sendingAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "provider" TEXT,
    "providerMessageId" TEXT,
    "messageStream" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "communicationId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_events" (
    "id" TEXT NOT NULL,
    "emailMessageId" TEXT,
    "provider" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "EmailCategory" NOT NULL,
    "templateId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "scope" "SuppressionScope" NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "companyName" TEXT NOT NULL DEFAULT 'Our inspection company',
    "fromName" TEXT NOT NULL DEFAULT 'Inspection Team',
    "fromEmail" TEXT,
    "replyTo" TEXT,
    "signature" TEXT NOT NULL DEFAULT '',
    "companyPhone" TEXT,
    "companyWebsite" TEXT,
    "mailingAddress" TEXT,
    "inspectionPrepInstructions" TEXT,
    "marketingRequiresOptIn" BOOLEAN NOT NULL DEFAULT true,
    "campaignSendsPerMinute" INTEGER NOT NULL DEFAULT 60,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_key_key" ON "email_templates"("key");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_idempotencyKey_key" ON "email_messages"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_providerMessageId_key" ON "email_messages"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_communicationId_key" ON "email_messages"("communicationId");

-- CreateIndex
CREATE INDEX "email_messages_status_nextAttemptAt_idx" ON "email_messages"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "email_messages_status_scheduledFor_idx" ON "email_messages"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "email_messages_realtorId_idx" ON "email_messages"("realtorId");

-- CreateIndex
CREATE INDEX "email_messages_customerId_idx" ON "email_messages"("customerId");

-- CreateIndex
CREATE INDEX "email_messages_transactionId_idx" ON "email_messages"("transactionId");

-- CreateIndex
CREATE INDEX "email_messages_inspectionId_idx" ON "email_messages"("inspectionId");

-- CreateIndex
CREATE INDEX "email_messages_invoiceId_idx" ON "email_messages"("invoiceId");

-- CreateIndex
CREATE INDEX "email_messages_campaignId_idx" ON "email_messages"("campaignId");

-- CreateIndex
CREATE INDEX "email_messages_automationId_idx" ON "email_messages"("automationId");

-- CreateIndex
CREATE INDEX "email_messages_createdAt_idx" ON "email_messages"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_events_eventKey_key" ON "email_events"("eventKey");

-- CreateIndex
CREATE INDEX "email_events_emailMessageId_idx" ON "email_events"("emailMessageId");

-- CreateIndex
CREATE INDEX "email_campaigns_status_scheduledAt_idx" ON "email_campaigns"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_suppressions_email_scope_key" ON "email_suppressions"("email", "scope");

-- CreateIndex
CREATE INDEX "automation_events_firedAt_idx" ON "automation_events"("firedAt");

-- CreateIndex
CREATE UNIQUE INDEX "automations_key_key" ON "automations"("key");

-- CreateIndex
CREATE INDEX "communications_customerId_idx" ON "communications"("customerId");

-- CreateIndex
CREATE INDEX "communications_inspectionId_idx" ON "communications"("inspectionId");

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "email_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "email_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_realtorId_fkey" FOREIGN KEY ("realtorId") REFERENCES "realtors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_reportDeliveryId_fkey" FOREIGN KEY ("reportDeliveryId") REFERENCES "report_deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_communicationId_fkey" FOREIGN KEY ("communicationId") REFERENCES "communications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "email_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "email_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

