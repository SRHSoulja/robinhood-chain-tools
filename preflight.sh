#!/usr/bin/env bash
# The cheap half. Everything here runs in well under a second and needs no browser, no chain and no network.
#
#   ./preflight.sh
#
# These are not the interesting bugs. They are the ones that have actually cost time on this project, and
# every one of them is invisible until something much further away breaks in a way that points somewhere
# else. A stale CSP hash does not say "stale CSP hash", it says "a checkbox in an unrelated test timed out".
# So they get checked before anything expensive runs, and before a commit, rather than being remembered.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
bad=0
note() { printf '  %-6s %s\n' "$1" "$2"; }
fail() { note FAIL "$1"; bad=1; }

# 1. The page's own CSP names the hash of the script it carries. Edit the script, forget web/sync.sh, and the
#    browser refuses to execute any of it: no error, no exception, every later test timing out somewhere else.
python3 - <<'PY' || bad=1
import base64, hashlib, re, io, sys
ok = True
for path in ('web/index.html', 'web/check.html'):
    s = io.open(path, encoding='utf-8').read()
    blocks = [b for a, b in re.findall(r'<script([^>]*)>(.*?)</script>', s, re.S)
              if 'src=' not in a.lower() and b.strip()]
    if len(blocks) != 1:
        print('  FAIL   %s has %d inline scripts, expected 1' % (path, len(blocks))); ok = False; continue
    want = 'sha256-' + base64.b64encode(hashlib.sha256(blocks[0].encode()).digest()).decode()
    m = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)"', s)
    if not m or ("'" + want + "'") not in m.group(1):
        print('  FAIL   %s: its CSP does not name the script it carries. Run web/sync.sh.' % path); ok = False
    else:
        print('  ok     %s carries a CSP that matches its script' % path)
sys.exit(0 if ok else 1)
PY

# 2. check.html carries a copy of check.js. A stale copy hashes correctly against itself, so check 1 passes
#    while the page runs last week's code.
python3 - <<'PY' || bad=1
import io, re, sys
h = io.open('web/check.html', encoding='utf-8').read()
js = io.open('web/check.js', encoding='utf-8').read()
b = [x for a, x in re.findall(r'<script([^>]*)>(.*?)</script>', h, re.S) if 'src=' not in a.lower() and x.strip()][0]
if b != '\n' + js:
    print('  FAIL   check.html does not carry the current check.js. Run web/sync.sh.'); sys.exit(1)
print('  ok     check.html carries the current check.js')
PY

# 3. The contract the page sends to, and the contract the manifest and the tests name, must be one contract.
python3 - <<'PY' || bad=1
import io, json, re, sys
man = json.load(open('deployments.testnet.json'))['BulkSend'].lower()
page = re.search(r"bulk: '(0x[0-9a-fA-F]{40})'", io.open('web/index.html', encoding='utf-8').read())
tests = io.open('test/web/client.test.mjs', encoding='utf-8').read()
ok = True
if not page or page.group(1).lower() != man:
    print('  FAIL   the page sends to %s, the manifest says %s' % (page.group(1) if page else '?', man)); ok = False
if man not in tests.lower():
    print('  FAIL   client.test.mjs does not mention %s, so it is asserting against a different contract' % man); ok = False
if ok: print('  ok     page, manifest and tests name the same BulkSend')

# And the published documents, which drifted three deploys behind before anything noticed. The dated audit
# reports are excluded on purpose: each was written against a particular deployment, and rewriting them would
# be falsifying the record. Everything else that names a BulkSend must name the one that is live.
tombstones = {v.lower() for k, v in json.load(open('deployments.testnet.json')).items()
              if k.startswith('BulkSend_')}
for f in ('README.md', 'docs/for-reviewers.md', 'docs/status.md', 'SECURITY.md'):
    try: body = io.open(f, encoding='utf-8').read()
    except FileNotFoundError: continue
    for hit in sorted({h.lower() for h in re.findall(r'0x[0-9a-fA-F]{40}', body)} & tombstones):
        print('  FAIL   %s names %s, a superseded BulkSend. The live one is %s.' % (f, hit, man)); ok = False
if ok: print('  ok     no published document names a superseded BulkSend')
sys.exit(0 if ok else 1)
PY

# 4. Nothing personal, and no key material, in anything tracked.
HOMEPAT='/home/''arson'   # split so this file does not match its own search
if git grep -qIl "$HOMEPAT" -- . ':!preflight.sh' 2>/dev/null; then
  fail "a tracked file contains an absolute home path"
  git grep -Il "$HOMEPAT" -- . ':!preflight.sh' | sed 's/^/         /'
else
  note ok "no absolute home paths in tracked files"
fi
if git grep -nIE '"private_key"[[:space:]]*:[[:space:]]*"0x' -- . 2>/dev/null | grep -q .; then
  fail "a tracked file looks like it contains a private key"
else
  note ok "no key material in tracked files"
fi

# 5. A live script with a hardcoded token id passes once and then cries wolf for ever. That happened.
if grep -qE 'const IDS = \[[0-9]+, *[0-9]+' test/web/live-send.mjs 2>/dev/null; then
  fail "live-send.mjs has hardcoded token ids again; it must mint its own so it can run twice"
else
  note ok "the live scripts mint their own token ids"
fi

echo
if [ "$bad" -eq 0 ]; then echo "Preflight clean."; else echo "Preflight found something. Fix it before running anything slower."; fi
exit "$bad"
