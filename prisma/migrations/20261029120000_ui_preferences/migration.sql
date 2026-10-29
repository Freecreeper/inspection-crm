-- Per-user interface settings (theme today). Nullable: NULL means defaults.
ALTER TABLE "users" ADD COLUMN "uiPreferences" JSONB;
