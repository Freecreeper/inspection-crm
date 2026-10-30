-- Online signing of the pre-inspection agreement: the agreement wording (one
-- settings row) and one row per signature request. Additive only.
-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('PENDING', 'SIGNED', 'REVOKED');

-- CreateTable
CREATE TABLE "agreement_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "title" TEXT NOT NULL DEFAULT 'Pre-Inspection Agreement',
    "body" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreement_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_agreements" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "customerId" TEXT,
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "signedAt" TIMESTAMP(3),
    "signedName" TEXT,
    "signedIp" TEXT,
    "signedUserAgent" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inspection_agreements_inspectionId_status_idx" ON "inspection_agreements"("inspectionId", "status");

-- CreateIndex
CREATE INDEX "inspection_agreements_customerId_idx" ON "inspection_agreements"("customerId");

-- AddForeignKey
ALTER TABLE "inspection_agreements" ADD CONSTRAINT "inspection_agreements_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_agreements" ADD CONSTRAINT "inspection_agreements_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

