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
#   Bypasses. Every one of these weakens a check, all of them are read from deploy/local.env before any gate
#   runs, and a flag left uncommented in that file is therefore permanent until someone notices. So each one
#   announces itself on every run where it is in effect.
#   NO_PHONE_WALLET      publish the airdrop page with no phone-wallet connector at all.
#   ALLOW_DIRTY_PUBLISH  publish from a working tree with uncommitted changes, so the published bytes
#                        correspond to no commit anyone can check out.
#
# Attaching a hostname to a worker is a one-off, separate from publishing:
#   PUT https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/domains
#   {"environment":"production","hostname":"<host>","service":"<worker name>","zone_id":"<zone>"}
# It fails with code 100117 if a DNS record for that hostname already exists; delete the record first.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$ROOT/deploy/local.env" ] && . "$ROOT/deploy/local.env"

# Announced before anything is published. These are read from local.env too, where one left uncommented would
# otherwise stay in force for ever without appearing anywhere in the output.
for f in NO_PHONE_WALLET ALLOW_DIRTY_PUBLISH ALLOW_CONNECTOR_GAP; do
  eval "v=\${$f:-}"
  [ -n "$v" ] && echo "BYPASS IN EFFECT: $f=$v  (this run skips a check it would otherwise make)" >&2
done

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
# Any inline script, however the tag is written. Matching the literal "<script>" meant
# `<script type="module">`, `<script >` and `<script\n>` were invisible here, so a second inline script
# passed this count and was never hashed. Tags with a src= are external and not inline, so they are excluded.
blocks = [b for a, b in re.findall(r"<script([^>]*)>(.*?)</script>", html, re.S)
          if "src=" not in a.lower() and b.strip()]
assert len(blocks) == 1, "expected exactly one inline script, found %d" % len(blocks)
print("sha256-" + base64.b64encode(hashlib.sha256(blocks[0].encode()).digest()).decode())
PY
)"
python3 deploy/csp-gate.py "$SRC" "$CSP_HASH"

# The page is inlined into the worker as a string constant, so the worker serves it from the edge with no
# origin request at all. Everything the page needs beyond that is fetched by the browser.
# The connector is signing-page code. It is fetched from a URL at request time rather than embedded, because
# it is 2 MB, so the worker is given the digest of the file in this repository and refuses to serve anything
# else. Drift, replacement or misconfiguration upstream then breaks the page rather than changing it.
WC_SHA256=""
# Every check on the connector -- the reviewed digest, the origin publication, the digest-keyed prefetch --
# used to hang off WC_BUNDLE_URL being set, and that variable was documented as optional. Leaving it out
# therefore skipped the lot and shipped a page whose phone-wallet button cannot work, without ever reaching
# the deliberate ALLOW_CONNECTOR_GAP exception. Not configuring the connector is now a decision that has to be
# made out loud.
if [ "$TARGET" = "airdrop" ] && [ -z "${WC_BUNDLE_URL:-}" ] && [ "${NO_PHONE_WALLET:-}" != "1" ]; then
  echo "WC_BUNDLE_URL is not set, so /wc.js would be a 404 and the phone-wallet button would not work." >&2
  echo "Set it, or set NO_PHONE_WALLET=1 to publish deliberately without phone wallets." >&2
  exit 1
fi
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

# The Worker template itself lives in deploy/render-worker.py, so this script and test/worker.test.mjs build
# the exact same worker.js from the exact same code rather than two copies that can drift apart.
python3 deploy/render-worker.py "$SRC" "$WORK/worker.js" "$TARGET" "${WC_BUNDLE_URL:-}" "$WC_SHA256" "$CSP_HASH"

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
# Gate 11: bind the Blockscout PRO API key as a Worker secret when deploy/local.env names a file holding it.
# Without it the Worker behaves exactly as before. The key is read here and sent only in this upload.
META='{"main_module":"worker.js","compatibility_date":"2026-09-01"}'
if [ -n "${BLOCKSCOUT_KEY_FILE:-}" ] && [ -f "$BLOCKSCOUT_KEY_FILE" ]; then
  BK="$(tr -d '[:space:]' < "$BLOCKSCOUT_KEY_FILE")"
  META="$(python3 -c "import json,sys;print(json.dumps({'main_module':'worker.js','compatibility_date':'2026-09-01','bindings':[{'type':'secret_text','name':'BLOCKSCOUT_KEY','text':sys.argv[1]}]}))" "$BK")"
  echo "explorer: mainnet reads will go through Blockscout's PRO API (key bound as a Worker secret)"
fi

curl -s -m 90 -X PUT -H "Authorization: Bearer $CF_API_TOKEN" \
  -F "metadata=$META;type=application/json" \
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
if [ -z "$VERIFY" ]; then
  echo "No URL to verify against (URL_${TARGET^^} unset): the published bytes were not compared with this repository." >&2
fi
[ -n "$VERIFY" ] && { verify_body "$VERIFY" "$SRC" "page:" || FAILED=1; }
# Only when a connector was actually configured. This used to ask whether web/wc.js exists, so a deliberate
# NO_PHONE_WALLET=1 publish -- a supported path this script tells you about itself -- exited 1 with
# "connector: DOES NOT match" about something it was never asked to publish. A script that cries failure on
# its own supported path trains whoever runs it to stop reading the exit code, and then it cannot report a
# real failure either.
if [ "$TARGET" = "airdrop" ] && [ -n "$VERIFY" ] && [ -n "${WC_BUNDLE_URL:-}" ] && [ -f "$ROOT/web/wc.js" ]; then
  verify_body "${VERIFY%/}/wc.js" "$ROOT/web/wc.js" "connector:" || FAILED=1
elif [ "$TARGET" = "airdrop" ] && [ "${NO_PHONE_WALLET:-}" = "1" ]; then
  echo "connector: not published and not checked, because NO_PHONE_WALLET=1 was set."
fi
exit $FAILED
