#!/usr/bin/env bash
# The presentation lane: the gate for a change that cannot affect a transaction.
#
#   ./test/presentation.sh [BASE]        BASE defaults to HEAD
#
# It is NOT a replacement for ./verify.sh, and it cannot be used as one. It runs only after
# test/classify-change.sh has proved, byte by byte against BASE, that every change in the tree is one of the
# narrow kinds that cannot reach a transaction: page text, styles, share metadata, icons, share cards,
# documentation, and comments inside the page's script. Anything else, and anything the classifier cannot
# prove, stops here with "run ./verify.sh".
#
# What it runs, in order, stopping at the first failure:
#
#   1  test/classify-change.sh    the change is presentation only
#   2  web/sync.sh                the pages are already in the state the publisher would put them in
#   3  preflight.sh               the cheap invariants, CSP hash and spliced copy included
#   4  test/csp-gate.test.sh      the publish gate still refuses every weakening of the policy
#   5  test/worker.test.mjs       the worker the publisher builds still behaves
#   6  assets                     the four PNGs are real and the right size, each page's share card is its
#                                 own, and the worker the publisher would build carries those exact bytes
#   7  test/web/presentation.test.mjs   both pages load clean, with every control and every share tag
#   8  test/classify-change.test.sh     the classifier's own fixtures, so the guard is proved every run
#
# See docs/harness.md, "The presentation lane".
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
BASE="${1:-HEAD}"
START=$SECONDS

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

summaries=()
note() { summaries+=("$1"); }

die() {
  local step="$1" detail="$2"
  echo
  [ -n "$detail" ] && printf '%s\n' "$detail"
  echo
  printf '%s\n' "${summaries[@]+"${summaries[@]}"}"
  echo
  echo "PRESENTATION LANE FAILED at $step"
  echo "elapsed: ${SECONDS}s"
  exit 1
}

# Runs a command, streams its failures, and returns the "N passed, M failed" line it ended with.
summary_of() {
  grep -E '^[0-9]+ passed, [0-9]+ failed' "$1" | tail -1
}

# ---- 1: the change is presentation only -------------------------------------------------------------------
echo "== 1  classify the change against $BASE =="
if ! ./test/classify-change.sh "$BASE" >"$WORK/classify.out" 2>&1; then
  grep '^escalate:' "$WORK/classify.out" || true
  echo
  echo "FULL_VERIFY_REQUIRED: run ./verify.sh"
  echo "elapsed: ${SECONDS}s"
  exit 1
fi
VERDICT="$(tail -1 "$WORK/classify.out")"
case "$VERDICT" in
  PRESENTATION_ONLY|NO_CHANGE) : ;;
  *) grep '^escalate:' "$WORK/classify.out" || true
     echo
     echo "FULL_VERIFY_REQUIRED: run ./verify.sh"
     echo "elapsed: ${SECONDS}s"
     exit 1 ;;
esac
tail -1 "$WORK/classify.out" | sed 's/^/  /'
note "1  classify:    $VERDICT against $BASE"

# ---- 2: the pages are already synced ----------------------------------------------------------------------
# web/sync.sh splices check.js into check.html and writes each page's own CSP hash. If running it changes a
# page, the tree being tested is not the tree that would be published.
echo
echo "== 2  the pages are in the state the publisher would put them in =="
before_index="$(sha256sum web/index.html | cut -d' ' -f1)"
before_check="$(sha256sum web/check.html | cut -d' ' -f1)"
if ! ./web/sync.sh >"$WORK/sync.out" 2>&1; then
  cat "$WORK/sync.out"
  die "2 sync" "web/sync.sh itself failed"
fi
sed 's/^/  /' "$WORK/sync.out"
after_index="$(sha256sum web/index.html | cut -d' ' -f1)"
after_check="$(sha256sum web/check.html | cut -d' ' -f1)"
changed=""
[ "$before_index" = "$after_index" ] || changed="web/index.html"
[ "$before_check" = "$after_check" ] || changed="${changed:+$changed and }web/check.html"
[ -z "$changed" ] || die "2 sync" "web/sync.sh changed $changed: run ./web/sync.sh, then re-run"
note "2  sync:        both pages were already current"

# ---- 3: preflight -----------------------------------------------------------------------------------------
echo
echo "== 3  preflight =="
if ! ./preflight.sh >"$WORK/preflight.out" 2>&1; then
  sed 's/^/  /' "$WORK/preflight.out"
  die "3 preflight" ""
fi
sed 's/^/  /' "$WORK/preflight.out"
note "3  preflight:   $(grep -c '^  ok' "$WORK/preflight.out") checks, $(tail -1 "$WORK/preflight.out")"

# ---- 4: the CSP publish gate --------------------------------------------------------------------------------
echo
echo "== 4  the publish gate still refuses every weakening of the policy =="
./test/csp-gate.test.sh >"$WORK/csp.out" 2>&1
csp_rc=$?
grep -E '^  FAIL' "$WORK/csp.out" || true
csp_line="$(summary_of "$WORK/csp.out")"
echo "  ${csp_line:-DID NOT FINISH}"
[ "$csp_rc" -eq 0 ] || die "4 csp-gate" "see the failures above"
note "4  csp-gate:    ${csp_line:-DID NOT FINISH}"

# ---- 5: the worker ------------------------------------------------------------------------------------------
echo
echo "== 5  the worker the publisher builds =="
node test/worker.test.mjs >"$WORK/worker.out" 2>&1
worker_rc=$?
grep -E '^  FAIL' "$WORK/worker.out" || true
worker_line="$(summary_of "$WORK/worker.out")"
echo "  ${worker_line:-DID NOT FINISH}"
[ "$worker_rc" -eq 0 ] || die "5 worker" "see the failures above"
note "5  worker:      ${worker_line:-DID NOT FINISH}"

# ---- 6: the images, and the worker that would carry them -----------------------------------------------------
echo
echo "== 6  the share cards, the home-screen icons, and the bytes the worker would serve =="
python3 - <<'PY' || die "6 assets" "an image or a share tag is wrong"
import re, struct, sys

bad = False
def note(ok, msg):
    global bad
    print('  %-5s %s' % ('ok' if ok else 'FAIL', msg))
    if not ok:
        bad = True

for path, want in (('web/og-airdrop.png', (1200, 630)), ('web/og-check.png', (1200, 630)),
                   ('web/apple-touch-icon.png', (180, 180)), ('web/apple-touch-icon-check.png', (180, 180))):
    try:
        data = open(path, 'rb').read()
    except FileNotFoundError:
        note(False, '%s is missing' % path); continue
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        note(False, '%s does not start with a PNG signature' % path); continue
    if len(data) < 24 or data[12:16] != b'IHDR':
        note(False, '%s has no IHDR chunk' % path); continue
    got = struct.unpack('>II', data[16:24])
    note(got == want, '%s is a PNG, %dx%d' % (path, got[0], got[1]) + ('' if got == want else ', expected %dx%d' % want))

# A share card served from the other page's origin is a broken preview that only shows up once someone posts
# the link, so each page's og:image and twitter:image have to be its own origin's /og.png.
for path in ('web/index.html', 'web/check.html'):
    s = open(path, encoding='utf-8').read()
    prop = lambda p: (re.search(r'<meta property="%s" content="([^"]*)"' % p, s) or [None, None])[1]
    name = lambda n: (re.search(r'<meta name="%s" content="([^"]*)"' % n, s) or [None, None])[1]
    url = prop('og:url')
    if not url:
        note(False, '%s names no og:url, so there is no origin to check its share card against' % path); continue
    origin = url.rstrip('/')
    want = origin + '/og.png'
    note(prop('og:image') == want, '%s og:image is %s' % (path, prop('og:image')))
    note(name('twitter:image') == want, '%s twitter:image is %s' % (path, name('twitter:image')))

sys.exit(1 if bad else 0)
PY

# Built exactly the way deploy/publish.sh builds it: the same hash computation, the same gate, the same
# render-worker.py call with the same arguments in the same order. The connector arguments are empty because
# nothing is being published here; everything else is what a publish would produce.
for target in airdrop check; do
  case "$target" in
    airdrop) SRC=web/index.html; OG=web/og-airdrop.png; TOUCH=web/apple-touch-icon.png ;;
    check)   SRC=web/check.html; OG=web/og-check.png;   TOUCH=web/apple-touch-icon-check.png ;;
  esac
  CSP_HASH="$(python3 - "$SRC" <<'PY'
import base64, hashlib, re, sys
html = open(sys.argv[1], encoding="utf-8").read()
blocks = [b for a, b in re.findall(r"<script([^>]*)>(.*?)</script>", html, re.S)
          if "src=" not in a.lower() and b.strip()]
assert len(blocks) == 1, "expected exactly one inline script, found %d" % len(blocks)
print("sha256-" + base64.b64encode(hashlib.sha256(blocks[0].encode()).digest()).decode())
PY
)" || die "6 assets" "could not compute $SRC's script hash"
  python3 deploy/csp-gate.py "$SRC" "$CSP_HASH" >"$WORK/cspgate-$target.out" 2>&1 \
    || die "6 assets" "$(cat "$WORK/cspgate-$target.out")"
  sed 's/^ *//;s/^/  /' "$WORK/cspgate-$target.out"
  python3 deploy/render-worker.py "$SRC" "$WORK/worker-$target.js" "$target" "" "" "$CSP_HASH" "$OG" "$TOUCH" \
    || die "6 assets" "deploy/render-worker.py refused to build the $target worker"
  node --check "$WORK/worker-$target.js" 2>/dev/null || die "6 assets" "the generated $target worker does not parse"
  python3 - "$WORK/worker-$target.js" "$OG" "$TOUCH" "$target" <<'PY' || die "6 assets" "the worker would serve different bytes than the files on disk"
import base64, json, re, sys
worker, og_path, touch_path, target = sys.argv[1:5]
src = open(worker, encoding='utf-8').read()
ok = True
for const, path in (('OG_PNG', og_path), ('TOUCH_PNG', touch_path)):
    m = re.search(r'^const %s = (.*);$' % const, src, re.M)
    if not m:
        print('  FAIL  the %s worker has no %s constant' % (target, const)); ok = False; continue
    value = json.loads(m.group(1))
    if value is None:
        print('  FAIL  the %s worker carries no %s' % (target, const)); ok = False; continue
    if base64.b64decode(value) != open(path, 'rb').read():
        print('  FAIL  the %s worker would serve a %s that is not %s' % (target, const, path)); ok = False; continue
    print('  ok    the %s worker carries %s byte for byte' % (target, path))
sys.exit(0 if ok else 1)
PY
done
note "6  assets:      four PNGs, both share cards, and both workers carry the files on disk"

# ---- 7: the pages, in a browser -------------------------------------------------------------------------------
echo
echo "== 7  both pages, loaded in a browser with every request answered =="
node test/web/presentation.test.mjs >"$WORK/pres.out" 2>&1
pres_rc=$?
grep -E '^  FAIL' "$WORK/pres.out" || true
pres_line="$(summary_of "$WORK/pres.out")"
echo "  ${pres_line:-DID NOT FINISH}"
[ "$pres_rc" -eq 0 ] || die "7 presentation suite" "see the failures above"
note "7  pages:       ${pres_line:-DID NOT FINISH}"

# ---- 8: the classifier's own fixtures -------------------------------------------------------------------------
# The lane is only as good as the guard in front of it, so the guard is re-proved on every run rather than on
# the day it was written.
echo
echo "== 8  the classifier's own fixtures =="
./test/classify-change.test.sh >"$WORK/fixtures.out" 2>&1
fx_rc=$?
grep -E '^  FAIL' "$WORK/fixtures.out" || true
fx_line="$(summary_of "$WORK/fixtures.out")"
echo "  ${fx_line:-DID NOT FINISH}"
[ "$fx_rc" -eq 0 ] || die "8 classifier fixtures" "see the failures above"
note "8  guard:       ${fx_line:-DID NOT FINISH}"

echo
printf '%s\n' "${summaries[@]}"
echo
echo "elapsed: $((SECONDS - START))s"
echo "PRESENTATION LANE PASSED; ./verify.sh was NOT run; publish with ./deploy/publish.sh <airdrop|check>"
