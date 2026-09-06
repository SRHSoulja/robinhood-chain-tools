#!/usr/bin/env bash
# Publish the BulkSend page to rhairdrop.gmgnrepeat.com (Cloudflare Worker) and gmgnrepeat.com/rhairdrop/ (origin copy).
# The Porkbun origin 301s unknown subdomains to the apex, so the subdomain is served from the edge, not the host.
set -euo pipefail
BRAIN=/home/arson/gmgn-brain
SRC=/home/arson/rh-airdrop/web/index.html
STAGE=$BRAIN/private/runtime/gmgnrepeat-website/rhairdrop/index.html
T=$(cat ~/.config/bbgp/cf-token | tr -d '\n'); ACC=8ffb31f1fc753495184e15e75f2f3a79
WORK=$(mktemp -d)

python3 - "$SRC" "$STAGE" <<'PY'
import sys
src, stage = sys.argv[1], sys.argv[2]
s = open(src, encoding="utf-8").read()
banner = """<main>
  <div class="card" style="border-color:var(--warn)">
    <h2 style="color:var(--warn)">Testnet only, for now</h2>
    <p style="margin:0 0 8px;font-size:13.5px">This works on Robinhood Chain <b>testnet</b> only, so you can try the whole thing with test tokens. Mainnet is switched off until the contract is deployed and tested there. Built from a request in the Robinhood Chain community.</p>
    <p style="margin:0;font-size:13.5px">Two ways out, picked for you. If your wallet can send several transfers in one transaction, it sends them <b>as itself</b>: no approval to grant, nothing left to revoke, and it works on collections that only allow transfers their creator approved. Otherwise it uses <b>BulkSend</b>, a contract that holds nothing, takes no fee, and can only move what you approve in the transaction you sign; its source is verified on the explorer.</p>
  </div>
"""
assert s.count("<main>\n") == 1
open(stage, "w", encoding="utf-8").write(s.replace("<main>\n", banner, 1))
print("staged", stage)
PY

python3 - "$STAGE" "$WORK/worker.js" <<'PY'
import json, sys
html = open(sys.argv[1], encoding="utf-8").read()
open(sys.argv[2], "w", encoding="utf-8").write("""// rhairdrop.gmgnrepeat.com - serves the BulkSend page from Cloudflare's edge.
const HTML = %s;
export default { async fetch(request) {
  const url = new URL(request.url);
  // The WalletConnect bundle is served from this same origin, so importing it needs no CORS and the page
  // never takes signing code from a third party.
  if (url.pathname === '/wc.js') {
    const upstream = await fetch('https://gmgnrepeat.com/rhairdrop/wc.js', { cf: { cacheEverything: true, cacheTtl: 86400 } });
    if (!upstream.ok) return new Response('connector unavailable', { status: 502 });
    return new Response(upstream.body, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' } });
  }
  if (url.pathname !== '/' && url.pathname !== '/index.html') return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'content-security-policy': \"frame-ancestors 'none'\" } });
} };
""" % json.dumps(html))
PY

curl -s -m 90 -X PUT -H "Authorization: Bearer $T" \
  -F 'metadata={"main_module":"worker.js","compatibility_date":"2026-09-01"};type=application/json' \
  -F "worker.js=@$WORK/worker.js;type=application/javascript+module" \
  "https://api.cloudflare.com/client/v4/accounts/$ACC/workers/scripts/gmgn-airdrop" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('worker:',d.get('success'), [(e.get('code'),e.get('message')) for e in d.get('errors',[])][:2])"

"$BRAIN/scripts/bin/gmgnrepeat-deploy" rhairdrop/index.html | tail -2
rm -rf "$WORK"
sleep 8
curl -s -o /dev/null -w "rhairdrop.gmgnrepeat.com -> %{http_code}\n" -m 25 https://rhairdrop.gmgnrepeat.com/
curl -s -o /dev/null -w "gmgnrepeat.com/rhairdrop/ -> %{http_code}\n" -m 25 https://gmgnrepeat.com/rhairdrop/
