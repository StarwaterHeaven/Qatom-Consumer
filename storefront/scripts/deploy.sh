#!/usr/bin/env bash
# One-command deploy of the Qatom storefront to try.agentkepler.tech.
# Run from anywhere on a Mac or Linux machine with Node 20+:
#   bash storefront/scripts/deploy.sh
# Safe to re-run: it skips steps that are already done.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/5 Installing tools"
npm install --silent

echo "== 2/5 Cloudflare sign-in (the account that holds agentkepler.tech)"
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login
npx wrangler whoami | grep -iE "email|account" || true

echo "== 3/5 Token store (KV)"
if grep -q REPLACE_WITH_KV_ID wrangler.toml; then
  out=$(npx wrangler kv namespace create TOKENS 2>&1 || true)
  id=$(printf '%s' "$out" | grep -oE '[0-9a-f]{32}' | head -1)
  if [ -z "$id" ]; then
    id=$(npx wrangler kv namespace list 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const n=JSON.parse(d).find(x=>/TOKENS$/.test(x.title));if(n)console.log(n.id)})')
  fi
  [ -n "$id" ] || { echo "Could not create or find the TOKENS KV namespace:"; echo "$out"; exit 1; }
  node -e 'const f="wrangler.toml",fs=require("fs");fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("REPLACE_WITH_KV_ID",process.argv[1]))' "$id"
  echo "KV namespace $id"
else
  echo "already set"
fi

echo "== 4/5 Deploying the Worker"
npx wrangler deploy

echo "== 5/5 Signing the storefront in to Qatom"
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
