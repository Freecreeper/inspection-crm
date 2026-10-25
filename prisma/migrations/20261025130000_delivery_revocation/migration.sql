-- Report delivery links can be revoked (audit finding: links couldn't be
-- withdrawn). Additive only.

-- AlterTable
ALTER TABLE "report_deliveries" ADD COLUMN "revokedAt" TIMESTAMP(3);
