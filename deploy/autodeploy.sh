#!/usr/bin/env bash
# Continuous deployment for crm.n3rdlabs.dev. genesisadmin's crontab runs this every minute as
# ~/inspection-crm/bin/autodeploy (a copy of this file; see README, "Production"). When master has
# a commit that is not live yet and that commit's CI run passed, it exports the commit to a fresh
# release directory and runs that release's deploy/deploy.sh. The repo is public, so nothing here
# needs a credential on either side.
#
#   autodeploy          what cron runs
#   autodeploy --force  ship master's tip now: skips the CI check and retries a held commit
set -euo pipefail

base="$HOME/inspection-crm"
repo=Freecreeper/inspection-crm
log="$base/deploy.log"
force=false
[ "${1:-}" = --force ] && force=true

# One run at a time: a tick that finds a deploy in progress just leaves.
exec 9>"$base/deploy.lock"
flock -n 9 || exit 0
if [ -t 1 ]; then exec > >(tee -a "$log") 2>&1; else exec >>"$log" 2>&1; fi

git -C "$base/source" fetch --prune --quiet origin
sha="$(git -C "$base/source" rev-parse --verify 'origin/master^{commit}')"
live="$(cat "$base/current/REVISION" 2>/dev/null || true)"
if [ "$sha" = "$live" ]; then
  $force && echo "$sha is already live."
  exit 0
fi

# A commit whose CI failed, or whose deploy failed, is held so it is not rebuilt every minute.
hold() {
  echo "$(date -u +%FT%TZ) holding $sha: $1 ($live stays live; next push or --force retries)"
  echo "$sha" > "$base/held"
}

if ! $force; then
  [ "$(cat "$base/held" 2>/dev/null || true)" = "$sha" ] && exit 0
  ci="$(curl -fsS --max-time 20 "https://api.github.com/repos/$repo/actions/runs?head_sha=$sha&event=push&per_page=50" \
    | python3 -c '
import json, sys
runs = [r for r in json.load(sys.stdin)["workflow_runs"] if r["path"] == ".github/workflows/ci.yml"]
print((runs[0]["conclusion"] or runs[0]["status"]) if runs else "missing")')" || exit 0
  case "$ci" in
    success) ;;
    queued|in_progress|waiting|requested|pending|missing) exit 0 ;;
    *) hold "CI $ci"; exit 0 ;;
  esac
fi

echo "==> $(date -u +%FT%TZ) deploying $sha (live: ${live:-nothing})"
release="$base/releases/$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:7}"
mkdir -p "$release"
git -C "$base/source" archive "$sha" | tar -x -C "$release"
echo "$sha" > "$release/REVISION"

if ! bash "$release/deploy/deploy.sh"; then
  rm -rf "$release"
  hold "deploy failed"
  exit 1
fi
ln -sfn "$release" "$base/current"
rm -f "$base/held"

# Keep the five newest releases (the live one is always the newest).
ls -1dt "$base"/releases/*/ | tail -n +6 | xargs -r rm -rf
