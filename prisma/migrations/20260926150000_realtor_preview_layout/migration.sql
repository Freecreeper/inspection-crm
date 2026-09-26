-- Active/Inactive realtor status is removed from the product. Verified before
-- writing this: no realtor had ever been set inactive (every row was the
-- default true) and no status change had been logged, so nothing is lost.
ALTER TABLE "realtors" DROP COLUMN "active";

-- Per-user choice of Realtor preview drawer sections (NULL = defaults).
ALTER TABLE "users" ADD COLUMN "realtorPreviewSections" JSONB;
