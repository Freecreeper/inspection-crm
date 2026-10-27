#!/usr/bin/env bash
# Builds and starts one release on the netcup box. deploy/autodeploy.sh calls this from a fresh export
# of the commit being shipped. The image is built and migrations run before the running containers
# are touched, so a broken build or migration leaves the current version serving.
set -euo pipefail

release_dir="$(cd "$(dirname "$0")/.." && pwd)"
base="${CRM_BASE:-$HOME/inspection-crm}"
export CRM_ENV_FILE="$base/shared/.env"
compose=(docker compose --project-name inspection-crm --env-file "$CRM_ENV_FILE" -f "$release_dir/deploy/compose.yml")

echo "==> Building $(cat "$release_dir/REVISION" 2>/dev/null || echo "$release_dir")"
"${compose[@]}" build app

echo "==> Starting the database"
"${compose[@]}" up -d --wait db

echo "==> Applying migrations"
"${compose[@]}" run --rm --no-deps app npx prisma migrate deploy

# Create-only upserts: new report-catalog entries and email templates arrive, edits are kept.
echo "==> Seeding reference data"
"${compose[@]}" run --rm --no-deps app npx prisma db seed

echo "==> Starting the app and email worker"
"${compose[@]}" up -d --wait app worker

# Only this project's superseded images: other projects share this Docker host.
docker image prune -f --filter label=com.docker.compose.project=inspection-crm >/dev/null
echo "==> Live at https://crm.n3rdlabs.dev"
