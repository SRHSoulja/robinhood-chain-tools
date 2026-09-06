#!/usr/bin/env bash
# Publish the Check page to rhcheck.gmgnrepeat.com (Cloudflare Worker) and gmgnrepeat.com/rhcheck/ (origin copy).
# Same shape as deploy-web.sh: the Porkbun origin 301s unknown subdomains, so the subdomain is served from the edge.
set -euo pipefail
BRAIN=/home/arson/gmgn-brain
SRC=/home/arson/rh-airdrop/web/check.html
STAGE=$BRAIN/private/runtime/gmgnrepeat-website/rhcheck/index.html
T=$(cat ~/.config/bbgp/cf-token | tr -d '\n'); ACC=8ffb31f1fc753495184e15e75f2f3a79
WORK=$(mktemp -d)
mkdir -p "$(dirname "$STAGE")"
cp "$SRC" "$STAGE"

python3 - "$STAGE" "$WORK/worker.js" <<'PY'
import json, sys
html = open(sys.argv[1], encoding="utf-8").read()
open(sys.argv[2], "w", encoding="utf-8").write("""// rhcheck.gmgnrepeat.com - serves the Check page from Cloudflare's edge.
const HTML = %s;
const EXPLORERS = { '4663': 'https://robinhoodchain.blockscout.com', '46630': 'https://explorer.testnet.chain.robinhood.com' };
export default { async fetch(request) {
  const url = new URL(request.url);
  // The mainnet explorer sends no Access-Control-Allow-Origin, so a browser cannot read it from this page.
  // A worker can: it is a server. Read-only, one host per chain id, and nothing but the API path is passed on.
  const x = url.pathname.match(/^\\/x\\/(4663|46630)(\\/[A-Za-z0-9_\\-\\/.]{1,200})$/);
  if (x) {
    const base = EXPLORERS[x[1]];
    if (!base || x[2].includes('..')) return new Response('bad path', { status: 400 });
    // The mainnet explorer answers browsers and challenges everything else, so ask the way a browser does.
    // One user's lookup at a time, cached at the edge for a minute so it stays that way.
    const upstream = await fetch(base + '/api/v2' + x[2] + url.search, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' },
      cf: { cacheEverything: true, cacheTtl: 60 },
    });
    return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff' } });
  }
  if (url.pathname !== '/' && url.pathname !== '/index.html') return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'content-security-policy': \"frame-ancestors 'none'\" } });
} };
""" % json.dumps(html))
PY

curl -s -m 90 -X PUT -H "Authorization: Bearer $T" \
  -F 'metadata={"main_module":"worker.js","compatibility_date":"2026-09-01"};type=application/json' \
  -F "worker.js=@$WORK/worker.js;type=application/javascript+module" \
  "https://api.cloudflare.com/client/v4/accounts/$ACC/workers/scripts/gmgn-rhcheck" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('worker:',d.get('success'), [(e.get('code'),e.get('message')) for e in d.get('errors',[])][:2])"

"$BRAIN/scripts/bin/gmgnrepeat-deploy" rhcheck/index.html | tail -2
rm -rf "$WORK"
sleep 8
curl -s -o /dev/null -w "rhcheck.gmgnrepeat.com -> %{http_code}\n" -m 25 https://rhcheck.gmgnrepeat.com/
curl -s -o /dev/null -w "gmgnrepeat.com/rhcheck/ -> %{http_code}\n" -m 25 https://gmgnrepeat.com/rhcheck/
