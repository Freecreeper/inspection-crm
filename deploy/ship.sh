#!/usr/bin/env bash
# Deploys master to crm.n3rdlabs.dev from a laptop (`npm run ship`). Runs lint, typecheck and the
# tests on exactly the commit that will ship, then has the netcup box pull and build it over SSH
# (~/inspection-crm/bin/autodeploy --force; see README, "Production"). Needs the `crm-server` SSH
# alias (or CRM_SSH_HOST) for genesisadmin@152.53.89.254.
set -euo pipefail

host="${CRM_SSH_HOST:-crm-server}"
cd "$(dirname "$0")/.."

git fetch --quiet origin master
sha="$(git rev-parse --verify 'origin/master^{commit}')"
if [ "$(git rev-parse HEAD)" != "$sha" ] || [ -n "$(git status --porcelain)" ]; then
  echo "Check out a clean master at origin/master (${sha:0:7}) first: what is checked is what ships." >&2
  exit 1
fi

echo "==> Checking ${sha:0:7}"
npm run --silent lint
npm run --silent typecheck
npm run --silent test

echo "==> Deploying ${sha:0:7} on $host"
# autodeploy logs to the box's deploy.log rather than stdout; print what this run added.
# shellcheck disable=SC2016 # expanded on the server
ssh "$host" 'log=~/inspection-crm/deploy.log; start=$(stat -c %s "$log" 2>/dev/null || echo 0)
  status=0; ~/inspection-crm/bin/autodeploy --force || status=$?
  tail -c +$((start + 1)) "$log"; exit $status'

live="$(ssh "$host" 'cat ~/inspection-crm/current/REVISION')"
if [ "$live" != "$sha" ]; then
  echo "Live is ${live:0:7}, not ${sha:0:7} (another deploy may hold the lock); see ~/inspection-crm/deploy.log." >&2
  exit 1
fi
code="$(curl -s -o /dev/null -w '%{http_code}' https://crm.n3rdlabs.dev/login)"
echo "==> ${sha:0:7} is live (login page: HTTP $code)"
[ "$code" = 200 ]
