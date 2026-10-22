#!/usr/bin/env node
// One-time sign-in for the storefront Worker.
// Registers an OAuth client with Qatom (pay.m.todaq.net), opens your browser to sign in
// as the account the storefront should act as (e.g. kepleragentteam@todaq.net), and
// prints the client id + refresh token to store as Worker secrets.
//
//   node scripts/get-token.mjs           prints the two secret commands
//   node scripts/get-token.mjs --apply   stores them on the deployed Worker (used by deploy.sh)
//
// The storefront only ever calls catalog_search and guest_checkout. Guest checkout is
// paid by the buyer on Qatom's checkout page, so this account's wallet is never spent.
// Use an account whose agent wallet is empty anyway, so even a leaked token can't spend.
// No dependencies; Node 18+.

import http from "node:http";
import crypto from "node:crypto";
import { exec, spawnSync } from "node:child_process";

const AS = "https://pay.m.todaq.net";
const RESOURCE = "https://mcp.m.todaq.net";
const PORT = Number(process.env.PORT || 8765);
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPE = "openid profile email twin offline_access";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function main() {
  const meta = await (await fetch(`${AS}/.well-known/oauth-authorization-server`)).json();

  // 1. Register a public client (PKCE, no secret)
  const regRes = await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Qatom storefront (try.agentkepler.tech)",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    }),
  });
  const reg = await regRes.json();
  if (!regRes.ok || !reg.client_id) throw new Error(`client registration failed: ${regRes.status} ${JSON.stringify(reg)}`);

  // 2. Authorization request with PKCE
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const authUrl = new URL(meta.authorization_endpoint);
  Object.entries({
    response_type: "code",
    client_id: reg.client_id,
    redirect_uri: REDIRECT,
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
    prompt: "consent", // required by most OIDC servers to issue a refresh token for offline_access
  }).forEach(([k, v]) => authUrl.searchParams.set(k, v));

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
      const err = u.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/plain" });
      if (err) { res.end(`Sign-in failed: ${err}. You can close this tab.`); server.close(); reject(new Error(err + " " + (u.searchParams.get("error_description") || ""))); return; }
      if (u.searchParams.get("state") !== state) { res.end("State mismatch."); server.close(); reject(new Error("state mismatch")); return; }
      res.end("Signed in. You can close this tab and return to the terminal.");
      server.close();
      resolve(u.searchParams.get("code"));
    });
    server.listen(PORT, "127.0.0.1", () => {
      console.log("\nOpening your browser to sign in to Qatom. If it doesn't open, visit:\n\n" + authUrl + "\n");
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? 'start ""' : "xdg-open";
      exec(`${opener} "${authUrl}"`);
    });
    setTimeout(() => { server.close(); reject(new Error("timed out after 5 minutes")); }, 300_000);
  });

  // 3. Exchange the code
  const tokRes = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: reg.client_id,
      code_verifier: verifier,
      resource: RESOURCE,
    }),
  });
  const tok = await tokRes.json();
  if (!tokRes.ok || !tok.access_token) throw new Error(`token exchange failed: ${tokRes.status} ${JSON.stringify(tok)}`);

  // 4. Prove it works: list one catalog item over MCP
  const ok = await checkMcp(tok.access_token).catch((e) => `check failed: ${e.message}`);

  console.log("\n✓ Signed in. MCP check:", ok);
  if (!tok.refresh_token) {
    console.log("\n! No refresh token was issued, so the Worker can only use this access token until it expires " +
      `(${tok.expires_in}s). Ask Matthew to allow offline_access/refresh tokens for this client, or set\n  QATOM_MCP_TOKEN=${tok.access_token}`);
  }
  if (process.argv.includes("--apply")) {
    // Store the secrets on the deployed Worker directly (values go over stdin, never on screen).
    putSecret("QATOM_CLIENT_ID", reg.client_id);
    if (tok.refresh_token) putSecret("QATOM_REFRESH_TOKEN", tok.refresh_token);
    else putSecret("QATOM_MCP_TOKEN", tok.access_token);
    console.log(`\n✓ Secrets stored on the Worker. To revoke the sign-in later: ${meta.revocation_endpoint}\n`);
    return;
  }
  console.log(`\nStore these as Worker secrets (run in the storefront folder):\n
  printf '%s' '${reg.client_id}' | npx wrangler secret put QATOM_CLIENT_ID
  printf '%s' '${tok.refresh_token || ""}' | npx wrangler secret put QATOM_REFRESH_TOKEN
\nKeep the refresh token private. To revoke it later: ${meta.revocation_endpoint}\n`);
}

function putSecret(name, value) {
  const r = spawnSync("npx", ["wrangler", "secret", "put", name], { input: value, stdio: ["pipe", "inherit", "inherit"], shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`could not store ${name} (wrangler exit ${r.status})`);
}

async function checkMcp(token) {
  const h = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` };
  const init = await fetch(`${RESOURCE}/mcp`, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "storefront-setup", version: "1" } } }) });
  if (!init.ok) return `initialize ${init.status}`;
  const sid = init.headers.get("mcp-session-id");
  await init.text();
  if (sid) h["mcp-session-id"] = sid;
  await fetch(`${RESOURCE}/mcp`, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  const r = await fetch(`${RESOURCE}/mcp`, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "catalog_search", arguments: { limit: 1 } } }) });
  const body = await r.text();
  const m = body.match(/\\?"total\\?":\s*(\d+)/);
  return r.ok ? `catalog reachable${m ? ` (${m[1]} items)` : ""}` : `tools/call ${r.status}`;
}

main().catch((e) => { console.error("\n✗", e.message); process.exit(1); });
