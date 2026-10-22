#!/usr/bin/env bash
# One-command deploy of the Qatom storefront to try.agentkepler.tech.
# Run from anywhere on a Mac or Linux machine with Node 20+:
#   bash storefront/scripts/deploy.sh
# Safe to re-run: it skips steps that are already done.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/4 Installing tools"
npm install --silent

echo "== 2/4 Cloudflare sign-in (the account that holds agentkepler.tech)"
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login
npx wrangler whoami | grep -iE "email|account" || true

echo "== 3/4 Deploying the Worker"
npx wrangler deploy

echo "== 4/4 Signing the storefront in to Qatom"
if npx wrangler secret list 2>/dev/null | grep -q QATOM_REFRESH_TOKEN; then
  echo "already signed in (to redo it: node scripts/get-token.mjs --apply)"
else
  echo "Your browser will open. Sign in as the storefront's account (e.g. kepleragentteam@todaq.net)."
  node scripts/get-token.mjs --apply
fi

echo
echo "== Checking https://try.agentkepler.tech/health"
sleep 5
curl -sS https://try.agentkepler.tech/health || true
echo
echo "Done. Expect {\"ok\":true,\"items\":…}. If it says the storefront isn't connected yet, wait a minute and try again."
