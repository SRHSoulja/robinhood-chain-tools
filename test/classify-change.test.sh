#!/usr/bin/env bash
# The classifier's own fixtures. Every one of them is a change someone could plausibly make, applied to a
# throwaway copy of this repository, and the assertion is the verdict test/classify-change.sh gives plus the
# reason it gives for it. A guard nobody tests is a guard that quietly stops guarding, and this one is the
# only thing standing between a presentation-lane publish and a change that moves money.
#
#   ./test/classify-change.test.sh
#
# The scratch repository is built with rsync and its own git identity, so nothing here touches the working
# tree, the maintainer's git config or the maintainer's signing key. deploy/local.env and deploy/local-*.sh
# are excluded from the copy on purpose: they hold credentials and have no business in a temporary directory.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pass=0
fail=0
ok()  { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf '  FAIL %s  <- %s\n' "$1" "$2"; }

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
REPO="$SCRATCH/repo"

echo "building a scratch repository in $REPO"
rsync -a \
  --exclude '.git' --exclude 'node_modules' --exclude 'out' --exclude 'cache' --exclude 'broadcast' \
  --exclude 'deploy/local.env' --exclude 'deploy/local-*.sh' \
  "$ROOT/" "$REPO/" || { echo "rsync failed"; exit 1; }

# The fixtures anchor on exact strings in the pages, so the material they are applied to has to be a known
# state rather than whatever is half-edited in the working tree right now. Otherwise the first fixture -- a
# typo in the intro paragraph -- stops applying the moment someone actually fixes that typo, which is the one
# change this lane exists for. Tracked files are therefore reset to their committed content; the lane's own
# scripts are then copied back from the working tree, because those are the thing under test and testing the
# committed copy of a classifier you just edited proves nothing about the edit.
git -C "$ROOT" archive HEAD | tar -x -C "$REPO" || { echo "could not lay down HEAD's tracked files"; exit 1; }
for f in test/classify-change.sh test/classify-change.test.sh test/presentation.sh test/web/presentation.test.mjs; do
  [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "$REPO/$f"
done

cd "$REPO" || exit 1
git init -q .
git config user.name "presentation-lane fixtures"
git config user.email "fixtures@localhost"
git config commit.gpgsign false
git add -A >/dev/null 2>&1
git commit -qm "fixture base" >/dev/null 2>&1 || { echo "could not commit the fixture base"; exit 1; }
BASE="$(git rev-parse HEAD)"
echo "fixture base is $BASE"
echo

# ---- helpers the fixtures are written in -----------------------------------------------------------------

# Replaces one exact occurrence, and refuses if the text is not there exactly once. A fixture that silently
# does nothing would assert nothing, and would pass.
py_sub() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path, encoding='utf-8').read()
n = s.count(old)
assert n == 1, 'expected exactly one occurrence of %r in %s, found %d' % (old[:60], path, n)
open(path, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
}

# A real PNG of the size asked for, built here rather than fetched, so the fixtures need nothing installed.
make_png() {
  python3 - "$1" "$2" "$3" <<'PY'
import struct, sys, zlib
path, w, h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
raw = b''.join(b'\x00' + bytes([(y * 3) % 256]) * (w * 3) for y in range(h))
def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(raw, 6))
       + chunk(b'IEND', b''))
open(path, 'wb').write(png)
PY
}

# ---- the fixtures ----------------------------------------------------------------------------------------
# Each one is a function that mutates the scratch tree. The runner resets the tree before every fixture.

fx_intro_typo()      { py_sub web/index.html 'is a good habit' 'is a good habbit'; }
fx_support_spacing() { py_sub web/index.html '<details id="support" class="card" style="padding:8px 14px;font-size:12.5px">' \
                              '<details id="support" class="card" style="padding: 8px 14px; font-size: 12.5px">'; }
fx_new_og_image()    { make_png web/og-airdrop.png 1200 630; }
fx_comment_text()    { py_sub web/index.html '// mainnet is switched off until it is deployed and tested there' \
                              '// both networks are live; this only refuses a chain the page has no deployment on'; }
fx_docs_edit()       { printf '\nThe presentation lane is described below.\n' >> docs/harness.md; }
fx_new_meta()        { py_sub web/index.html '<meta name="twitter:image" content="https://rhairdrop.gmgnrepeat.com/og.png">' \
                              '<meta name="twitter:image" content="https://rhairdrop.gmgnrepeat.com/og.png">'$'\n''<meta property="og:locale" content="en_GB">'; }

fx_live_chains()     { py_sub web/index.html 'new Set([46630, 4663])' 'new Set([46630])'; }
fx_bulk_address()    { py_sub web/index.html "0x904412cfe982f33385f486aaff8c8a4a6f4b5fbf' }" "0x904412cfe982f33385f486aaff8c8a4a6f4b5fbe' }"; }
fx_swap_options()    { py_sub web/index.html \
                        '<option value="4663">Robinhood Chain mainnet (4663)</option><option value="46630">Robinhood Chain testnet (46630)</option>' \
                        '<option value="46630">Robinhood Chain testnet (46630)</option><option value="4663">Robinhood Chain mainnet (4663)</option>'; }
fx_send_path()       { py_sub web/index.html "'  sent, waiting …'" "'  sent, waiting for the receipt …'"; }
fx_solidity_ws()     { printf '\n' >> src/BulkSend.sol; }
fx_workflow_ws()     { printf '\n' >> .github/workflows/integrity.yml; }
fx_client_test()     { printf '\n// a note added by a fixture\n' >> test/web/client.test.mjs; }
fx_deployments()     { py_sub deployments.mainnet.json '"BulkSend"' '"BulkSend" '; }
fx_id_removed()      { py_sub web/index.html 'id="msgList"' 'data-was="msgList"'; }
fx_onclick_added()   { py_sub web/index.html '<summary style="cursor:pointer;color:var(--mut)">' \
                              '<summary onclick="void 0" style="cursor:pointer;color:var(--mut)">'; }
fx_csp_directive()   { py_sub web/index.html "form-action 'none'" "form-action 'self'"; }
fx_comment_to_code() {
  python3 - <<'PY'
old = '    // 11 September 2026; chainlist marks neither as tracking). pickRpc() decides which is in use.'
new = '    const __probe = 1;'
new = new + ' ' * (len(old) - len(new))
s = open('web/index.html', encoding='utf-8').read()
assert s.count(old) == 1 and len(new) == len(old)
open('web/index.html', 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
}
fx_quoted_line()     { py_sub web/index.html "      } else if (c === '\"') inQ = true;" \
                              "      } else if (c === '\"') inQ = true;   // a quoted character opens the field"; }
fx_new_src_file()    { printf '// scratch\n' > src/Scratch.sol; }
fx_check_js()        { printf '\n// a note added by a fixture\n' >> web/check.js; }
fx_package_json()    { py_sub package.json '"quick":' '"quick" :'; }
fx_integrity()       { py_sub web/index.html 'integrity="sha384-6Zl0Pc8zjSz8KvmNeXRvUQgY4ryFb+BwDvKCmLYcBME0joAaru491tQgi9B7zsMM"' \
                              'integrity="sha384-6Zl0Pc8zjSz8KvmNeXRvUQgY4ryFb+BwDvKCmLYcBME0joAaru491tQgi9B7zsMA"'; }
fx_small_png()       { make_png web/og-airdrop.png 100 100; }

# ---- the runner ------------------------------------------------------------------------------------------
# want = the verdict the last line must be. needle = text the reason lines must contain, so a fixture cannot
# pass on the right verdict for the wrong reason. A PRESENTATION_ONLY fixture asserts no reason at all.
fixture() {
  local name="$1" want="$2" needle="$3" mutate="$4" out verdict reasons rc
  git -C "$REPO" reset -q --hard
  git -C "$REPO" clean -qfd
  if ! "$mutate"; then bad "$name" "the fixture's own mutation failed"; return; fi
  out="$(./test/classify-change.sh "$BASE" 2>&1)"
  rc=$?
  verdict="$(printf '%s\n' "$out" | tail -1)"
  reasons="$(printf '%s\n' "$out" | grep '^escalate:' || true)"
  if [ "$verdict" != "$want" ]; then
    bad "$name" "said $verdict (exit $rc), expected $want; reasons: $(printf '%s' "$reasons" | tr '\n' '|' | cut -c1-200)"
    return
  fi
  case "$want" in
    FULL_VERIFY_REQUIRED)
      [ "$rc" -eq 2 ] || { bad "$name" "verdict $verdict but exit $rc, expected 2"; return; }
      if ! printf '%s' "$reasons" | grep -qF -- "$needle"; then
        bad "$name" "no reason mentions '$needle'; reasons were: $(printf '%s' "$reasons" | tr '\n' '|' | cut -c1-300)"
        return
      fi
      # The reason is printed, not just matched: a fixture that passes for the wrong reason is a fixture
      # whose reason nobody ever read.
      ok "$name  ($verdict)"
      printf '       %s\n' "$(printf '%s' "$reasons" | grep -F -- "$needle" | head -1)"
      return ;;
    PRESENTATION_ONLY|NO_CHANGE)
      [ "$rc" -eq 0 ] || { bad "$name" "verdict $verdict but exit $rc, expected 0"; return; }
      if [ -n "$reasons" ]; then
        bad "$name" "PRESENTATION_ONLY was printed with reasons listed: $(printf '%s' "$reasons" | tr '\n' '|')"
        return
      fi ;;
  esac
  ok "$name  ($verdict)"
}

echo "== changes that cannot reach a transaction =="
fixture "a typo fix in the intro paragraph text"                PRESENTATION_ONLY "" fx_intro_typo
fixture "a spacing change in a style attribute inside #support" PRESENTATION_ONLY "" fx_support_spacing
fixture "a different valid 1200x630 og-airdrop.png"             PRESENTATION_ONLY "" fx_new_og_image
fixture "the wording of a trailing // comment in the script"    PRESENTATION_ONLY "" fx_comment_text
fixture "an edit to docs/harness.md"                            PRESENTATION_ONLY "" fx_docs_edit
fixture "a new <meta property=\"og:locale\"> tag"               PRESENTATION_ONLY "" fx_new_meta

echo
echo "== changes that must go through ./verify.sh =="
fixture "LIVE_CHAINS edited"                     FULL_VERIFY_REQUIRED "web/index.html inline script differs outside comments" fx_live_chains
fixture "a bulk: '0x…' address edited"           FULL_VERIFY_REQUIRED "web/index.html inline script differs outside comments" fx_bulk_address
fixture "the two options of #net swapped"        FULL_VERIFY_REQUIRED 'web/index.html the <select id="net"> element changed'  fx_swap_options
fixture "a code line in the send path edited"    FULL_VERIFY_REQUIRED "web/index.html inline script differs outside comments" fx_send_path
fixture "a whitespace-only change in src/BulkSend.sol" FULL_VERIFY_REQUIRED "escalate: src/BulkSend.sol changed"              fx_solidity_ws
fixture "a whitespace change in a CI workflow"   FULL_VERIFY_REQUIRED "escalate: .github/workflows/integrity.yml changed"     fx_workflow_ws
fixture "test/web/client.test.mjs edited"        FULL_VERIFY_REQUIRED "escalate: test/web/client.test.mjs changed"            fx_client_test
fixture "deployments.mainnet.json edited"        FULL_VERIFY_REQUIRED "escalate: deployments.mainnet.json changed"            fx_deployments
fixture "an element id removed from the page"    FULL_VERIFY_REQUIRED "web/index.html element id 'msgList' removed"           fx_id_removed
fixture "an onclick attribute added"             FULL_VERIFY_REQUIRED "web/index.html contains an inline event-handler attribute" fx_onclick_added
fixture "a CSP directive changed"                FULL_VERIFY_REQUIRED "web/index.html Content-Security-Policy changed outside its single script hash" fx_csp_directive
fixture "a // comment line replaced by code of the same length" FULL_VERIFY_REQUIRED "web/index.html inline script differs outside comments" fx_comment_to_code
fixture "a comment added to a line whose code carries a quote"  FULL_VERIFY_REQUIRED "web/index.html inline script differs outside comments" fx_quoted_line
fixture "a new untracked file under src/"        FULL_VERIFY_REQUIRED "escalate: src/Scratch.sol changed"                     fx_new_src_file
fixture "web/check.js edited"                    FULL_VERIFY_REQUIRED "escalate: web/check.js changed"                        fx_check_js
fixture "package.json edited"                    FULL_VERIFY_REQUIRED "escalate: package.json changed"                        fx_package_json
fixture "the ethers <script src> integrity attribute changed"   FULL_VERIFY_REQUIRED "web/index.html <script src> tag"        fx_integrity
fixture "og-airdrop.png replaced with a 100x100 PNG"            FULL_VERIFY_REQUIRED "web/og-airdrop.png is 100x100"          fx_small_png

git -C "$REPO" reset -q --hard
git -C "$REPO" clean -qfd

printf '\n%d passed, %d failed\n' "$pass" "$fail"
exit $((fail ? 1 : 0))
