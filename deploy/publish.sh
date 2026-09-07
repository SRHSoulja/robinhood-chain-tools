#!/usr/bin/env bash
# Publish one of the two pages to a Cloudflare Worker, and optionally to an origin host as well.
#
#   ./deploy/publish.sh airdrop
#   ./deploy/publish.sh check
#
# Configuration comes from the environment, or from deploy/local.env if that file exists (it is gitignored;
# copy deploy/local.env.example to start one). Nothing here contains a credential.
#
#   CF_ACCOUNT_ID        required. Cloudflare account the worker belongs to.
#   CF_API_TOKEN         required, unless CF_API_TOKEN_FILE points at a file holding it.
#   CF_API_TOKEN_FILE    a file containing the token, so it never sits in a shell history or an env dump.
#   WORKER_AIRDROP       worker script name for the airdrop page   (default: rh-airdrop)
#   WORKER_CHECK         worker script name for the check page     (default: rh-check)
#   URL_AIRDROP          the URL to verify after publishing, if the worker has a custom domain
#   URL_CHECK            likewise for the check page
#   ORIGIN_PUBLISH_CMD   optional. Run for an origin copy as: $ORIGIN_PUBLISH_CMD <built file> <target name>
#   ORIGIN_PUBLISH_WC_CMD  optional. Same, for web/wc.js: $ORIGIN_PUBLISH_WC_CMD <web/wc.js> <target name>.
#                        Without it the connector has to reach WC_BUNDLE_URL some other way before publishing.
#   WC_BUNDLE_URL        optional. Where the worker fetches the WalletConnect bundle for /wc.js.
#   ALLOW_CONNECTOR_GAP  set to 1 only for a first-ever deploy, where no origin copy can exist yet.
#
# Attaching a hostname to a worker is a one-off, separate from publishing:
#   PUT https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/domains
#   {"environment":"production","hostname":"<host>","service":"<worker name>","zone_id":"<zone>"}
# It fails with code 100117 if a DNS record for that hostname already exists; delete the record first.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$ROOT/deploy/local.env" ] && . "$ROOT/deploy/local.env"

TARGET="${1:-}"
case "$TARGET" in
  airdrop) SRC="$ROOT/web/index.html"; WORKER="${WORKER_AIRDROP:-rh-airdrop}"; VERIFY="${URL_AIRDROP:-}"; ORIGIN_NAME="${ORIGIN_NAME_AIRDROP:-rhairdrop}" ;;
  check)   SRC="$ROOT/web/check.html"; WORKER="${WORKER_CHECK:-rh-check}";    VERIFY="${URL_CHECK:-}";   ORIGIN_NAME="${ORIGIN_NAME_CHECK:-rhcheck}" ;;
  *) echo "usage: $0 airdrop|check" >&2; exit 2 ;;
esac

: "${CF_ACCOUNT_ID:?set CF_ACCOUNT_ID (see the header of this script)}"
if [ -z "${CF_API_TOKEN:-}" ]; then
  : "${CF_API_TOKEN_FILE:?set CF_API_TOKEN or CF_API_TOKEN_FILE}"
  CF_API_TOKEN="$(tr -d '\n' < "$CF_API_TOKEN_FILE")"
fi

# What is published has to be what was reviewed. Publishing from a dirty tree ships bytes that exist only on
# this machine, and the live-versus-repository check then passes against a file nobody else can see.
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  DIRTY="$(git -C "$ROOT" status --porcelain -- web deploy src 2>/dev/null | head -5)"
  if [ -n "$DIRTY" ] && [ "${ALLOW_DIRTY_PUBLISH:-}" != "1" ]; then
    echo "Refusing to publish: these are not committed." >&2
    echo "$DIRTY" >&2
    echo "Commit them, or set ALLOW_DIRTY_PUBLISH=1 if you know why you are shipping something unreviewed." >&2
    exit 1
  fi
  echo "publishing $(git -C "$ROOT" rev-parse --short HEAD)${DIRTY:+ (with uncommitted changes, by request)}"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The page carries one inline script. Naming it by hash is what lets the policy drop 'unsafe-inline', so a
# script injected into the response cannot run even if it reaches the browser. The hash is recomputed here and
# the file is corrected if it has drifted, because a stale hash would silently break the page.
CSP_HASH="$(python3 - "$SRC" <<'PY'
import base64, hashlib, re, sys
html = open(sys.argv[1], encoding="utf-8").read()
# The hash covers everything between the tags, the leading newline included. Dropping it produces a
# hash that looks right and blocks the page.
blocks = re.findall(r"<script>(.*?)</script>", html, re.S)
blocks = [b for b in blocks if b.strip()]
assert len(blocks) == 1, "expected exactly one inline script, found %d" % len(blocks)
print("sha256-" + base64.b64encode(hashlib.sha256(blocks[0].encode()).digest()).decode())
PY
)"
python3 - "$SRC" "$CSP_HASH" <<'PY'
import re, sys
path, want = sys.argv[1], sys.argv[2]
html = open(path, encoding="utf-8").read()
m = re.search(r'(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(">)', html)
assert m, "no CSP meta tag"
policy = m.group(2)
# This checks; it does not repair. A publisher that edits the file it is about to ship is a publisher that
# ships bytes no commit contains, which is exactly what the dirty-tree guard above exists to prevent.
# Presence is not the invariant. A policy naming this hash *and* an older one still authorizes the older
# inline script, so what is required is that the hash set in script-src is exactly this one.
src = re.search(r"script-src ([^;]*)", policy)
if not src:
    raise SystemExit("the page's CSP has no script-src")
hashes = sorted(t for t in src.group(1).split() if t.startswith("'sha256-"))
if hashes != ["'%s'" % want]:
    raise SystemExit(
        "the page's CSP must name exactly one script hash, its own.\n  script-src hashes: %s\n  this page's script: '%s'\nRun web/sync.sh and commit the result."
        % (", ".join(hashes) or "(none)", want))
# Only the hash is managed here. Rewriting the whole directive would silently drop any other source the
# policy deliberately allows, which it did once.
PY

# The page is inlined into the worker as a string constant, so the worker serves it from the edge with no
# origin request at all. Everything the page needs beyond that is fetched by the browser.
# The connector is signing-page code. It is fetched from a URL at request time rather than embedded, because
# it is 2 MB, so the worker is given the digest of the file in this repository and refuses to serve anything
# else. Drift, replacement or misconfiguration upstream then breaks the page rather than changing it.
WC_SHA256=""
if [ "$TARGET" = "airdrop" ] && [ -n "${WC_BUNDLE_URL:-}" ]; then
  [ -f "$ROOT/web/wc.js" ] || { echo "WC_BUNDLE_URL is set but web/wc.js is missing: refusing to publish a connector nobody can check" >&2; exit 1; }
  WC_SHA256="$(sha256sum "$ROOT/web/wc.js" | cut -d' ' -f1)"
  # The digest reviewers were given, not merely whatever file is sitting here at publish time. A missing or
  # empty expected digest used to skip the comparison, which pins whatever happens to be on disk: the check
  # that exists to catch an unreviewed bundle would be silently absent exactly when it was needed.
  EXPECTED="$(cat "$ROOT/web/wc-build/EXPECTED-SHA256" 2>/dev/null | tr -d '[:space:]')"
  if ! printf '%s' "$EXPECTED" | grep -Eq '^[0-9a-f]{64}$'; then
    echo "web/wc-build/EXPECTED-SHA256 is missing, empty, or not a sha256 digest." >&2
    echo "  read: '${EXPECTED}'" >&2
    echo "Refusing to publish: there is nothing to check the connector against." >&2
    exit 1
  fi
  if [ "$EXPECTED" != "$WC_SHA256" ]; then
    echo "web/wc.js does not match web/wc-build/EXPECTED-SHA256" >&2
    echo "  file     $WC_SHA256" >&2
    echo "  expected $EXPECTED" >&2
    echo "Refusing to publish: update the expected digest deliberately if the bundle really changed." >&2
    exit 1
  fi
  echo "connector pinned to sha256 $WC_SHA256"
fi

python3 - "$SRC" "$WORK/worker.js" "$TARGET" "${WC_BUNDLE_URL:-}" "$WC_SHA256" "$CSP_HASH" <<'PY'
import json, sys
src, out, target, wc_bundle, wc_sha, csp_hash = sys.argv[1:7]
import re as _re
_m = _re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)">', open(src, encoding="utf-8").read())
assert _m, "no CSP meta tag to derive the header from"
# The same policy the page carries, sent as a header as well, where a browser cannot be tricked out of it by
# anything that arrives before the meta tag is parsed. Plus the framing and form rules.
csp_header = _m.group(1) + "; frame-ancestors 'none'"
html = open(src, encoding="utf-8").read()

wc_route = """
  // The WalletConnect bundle is served from this same origin, so importing it needs no CORS and the page
  // never takes signing code from a third party.
  if (url.pathname === '/wc.js') {
    if (!WC_BUNDLE) return new Response('connector not configured', { status: 404, headers: secure() });
    // The digest is in the URL, so the edge cache is keyed on the exact bundle. Without it a changed bundle
    // is fetched from a day-old cache, fails its own digest check, and the connector goes dark until the
    // cache expires: the check is right and the input to it is stale.
    const upstream = await fetch(WC_BUNDLE + (WC_BUNDLE.includes('?') ? '&' : '?') + 'v=' + (WC_SHA256 || ''), { cf: { cacheEverything: true, cacheTtl: 86400 } });
    if (!upstream.ok) return new Response('connector unavailable', { status: 502, headers: secure() });
    // Read it, hash it, and serve it only if it is the file this deployment was built against. Without this
    // the page's own signing code could change after review without anything here changing.
    const bytes = await upstream.arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (WC_SHA256 && digest !== WC_SHA256) return new Response('connector digest mismatch', { status: 502, headers: secure() });
    return new Response(bytes, { headers: Object.assign(secure(), { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400' }) });
  }
""" if target == "airdrop" else ""

x_route = """
  // The mainnet explorer sends no Access-Control-Allow-Origin, so a browser cannot read it from this page.
  // A worker can: it is a server. Read-only, one host per chain id, and nothing but the API path is passed on.
  const x = url.pathname.match(/^\\/x\\/(4663|46630)(\\/[A-Za-z0-9_\\-\\/.]{1,200})$/);
  if (x) {
    const base = EXPLORERS[x[1]];
    if (!base || x[2].includes('..')) return new Response('bad path', { status: 400, headers: secure() });
    // The mainnet explorer answers browsers and challenges everything else, so ask the way a browser does.
    // One reader's lookup at a time, cached at the edge for a minute so it stays that way.
    const upstream = await fetch(base + '/api/v2' + x[2] + url.search, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' },
      cf: { cacheEverything: true, cacheTtl: 60 },
    });
    return new Response(upstream.body, { status: upstream.status, headers: Object.assign(secure(), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' }) });
  }
""" if target == "check" else ""

open(out, "w", encoding="utf-8").write(
"""// Serves the %s page from Cloudflare's edge. Generated by deploy/publish.sh; do not edit by hand.
const HTML = %s;
const WC_BUNDLE = %s;
const WC_SHA256 = %s;
const CSP = %s;
const EXPLORERS = { '4663': 'https://robinhoodchain.blockscout.com', '46630': 'https://explorer.testnet.chain.robinhood.com' };
// Sent on every response. A wallet-connected page delivered once over plain HTTP can be replaced in transit
// before any of its own protections exist, so the first request is redirected and the browser is told never
// to try HTTP again. No preload: that is a decision about every subdomain, not just this one.
const HSTS = 'max-age=31536000; includeSubDomains';
// Every response this worker constructs goes through here, the failures included. A visitor whose first
// contact with the host is a 400 or a 502 is exactly the visitor who has not been pinned to HTTPS yet, and
// leaving those bare made "on every response" untrue in the one case where it mattered most.
const secure = () => ({
  'strict-transport-security': HSTS,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
});
export default { async fetch(request) {
  const url = new URL(request.url);
  const visitor = request.headers.get('cf-visitor') || '';
  if (url.protocol === 'http:' || visitor.includes('"scheme":"http"')) {
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }
%s%s  // Anything else goes to the page rather than to a 404. Cloudflare replaces the headers on an error
  // response from a worker, so a 404 here arrives without HSTS or the rest of the hardening: a visitor whose
  // first ever contact with this host is a mistyped path would not be pinned to HTTPS. A redirect keeps them.
  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    return new Response(null, { status: 302, headers: Object.assign(secure(), { location: '/' }) });
  }
  return new Response(HTML, { headers: Object.assign(secure(), { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'content-security-policy': CSP }) });
} };
""" % (target, json.dumps(html), json.dumps(wc_bundle or None), json.dumps(wc_sha or None), json.dumps(csp_header), wc_route, x_route))
PY

node --check "$WORK/worker.js" 2>/dev/null || { echo "the generated worker does not parse" >&2; exit 1; }

# The origin copies go first, connector included, and the connector is then checked at the exact URL the
# worker will ask for. The worker refuses any bundle whose digest is not the one it was built against, so
# activating it while the origin still serves the previous bundle turns /wc.js into a 502 and takes phone
# wallets offline for as long as the gap lasts. Ordering the steps was not enough on its own: nothing was
# passing the connector to the hook, and nothing was confirming it had arrived.
if [ -n "${ORIGIN_PUBLISH_CMD:-}" ]; then
  $ORIGIN_PUBLISH_CMD "$SRC" "$ORIGIN_NAME"
fi
if [ "$TARGET" = "airdrop" ] && [ -n "${WC_BUNDLE_URL:-}" ]; then
  if [ -n "${ORIGIN_PUBLISH_WC_CMD:-}" ]; then
    $ORIGIN_PUBLISH_WC_CMD "$ROOT/web/wc.js" "$ORIGIN_NAME"
  fi
  case "$WC_BUNDLE_URL" in *\?*) WC_PROBE="$WC_BUNDLE_URL&v=$WC_SHA256" ;; *) WC_PROBE="$WC_BUNDLE_URL?v=$WC_SHA256" ;; esac
  WC_LIVE=""
  for _ in 1 2 3 4 5 6; do
    WC_LIVE="$(curl -s -m 60 "$WC_PROBE" | sha256sum | cut -d' ' -f1 || true)"
    [ "$WC_LIVE" = "$WC_SHA256" ] && break
    sleep 5
  done
  if [ "$WC_LIVE" = "$WC_SHA256" ]; then
    echo "connector reachable at $WC_PROBE  ($WC_SHA256)"
  elif [ "${ALLOW_CONNECTOR_GAP:-}" = "1" ]; then
    echo "connector NOT yet reachable at $WC_PROBE; publishing anyway by request." >&2
    echo "  /wc.js will 502 until the origin serves $WC_SHA256." >&2
  else
    echo "Refusing to publish: the worker would be built against a connector the origin does not serve." >&2
    echo "  wanted $WC_SHA256" >&2
    echo "  served ${WC_LIVE:-(nothing)}  from $WC_PROBE" >&2
    echo "Publish web/wc.js to the origin first (see ORIGIN_PUBLISH_WC_CMD), or set ALLOW_CONNECTOR_GAP=1 for a first deploy." >&2
    exit 1
  fi
fi

curl -s -m 90 -X PUT -H "Authorization: Bearer $CF_API_TOKEN" \
  -F 'metadata={"main_module":"worker.js","compatibility_date":"2026-09-01"};type=application/json' \
  -F "worker.js=@$WORK/worker.js;type=application/javascript+module" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/$WORKER" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);ok=d.get('success');print('worker',('published' if ok else 'FAILED'),[(e.get('code'),e.get('message')) for e in d.get('errors',[])][:2]);sys.exit(0 if ok else 1)"

# A 200 proves something answered, not that it answered with the file that was just reviewed. Compare the
# bytes: a custom domain still pointing at an older worker returns 200 all day.
verify_body () {
  local url="$1" want="$2" label="$3" got=""
  local want_sum; want_sum="$(sha256sum "$want" | cut -d' ' -f1)"
  for _ in 1 2 3 4 5 6; do
    got="$(curl -s -m 25 "$url" | sha256sum | cut -d' ' -f1 || true)"
    [ "$got" = "$want_sum" ] && break
    sleep 5
  done
  if [ "$got" = "$want_sum" ]; then
    echo "$label $url matches $want  ($want_sum)"
  else
    echo "$label $url DOES NOT match $want" >&2
    echo "  served $got" >&2
    echo "  local  $want_sum" >&2
    return 1
  fi
}

FAILED=0
[ -n "$VERIFY" ] && { verify_body "$VERIFY" "$SRC" "page:" || FAILED=1; }
if [ "$TARGET" = "airdrop" ] && [ -n "$VERIFY" ] && [ -f "$ROOT/web/wc.js" ]; then
  verify_body "${VERIFY%/}/wc.js" "$ROOT/web/wc.js" "connector:" || FAILED=1
fi
exit $FAILED
