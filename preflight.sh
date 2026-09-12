#!/usr/bin/env bash
# The cheap half. Everything here runs in seconds and needs no browser, no chain and no network.
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
# The reviewers' browser probes hardcode the address too, and they were not in this check: at the v13 deploy
# the list of files to update was written as five when nine named the address. Every probe that names a
# BulkSend must name the live one, or it is measuring a contract that is no longer there.
import glob
# The same deployer at the same nonce lands at the same address on every chain, so the live MAINNET BulkSend can
# share its address with a superseded testnet one. An address recorded as the active `BulkSend` in
# deployments.mainnet.json is live, not a tombstone, and is not refused for the coincidence. Nothing else changes:
# on testnet the live one is still `man`, and every superseded testnet address is still refused.
try:
    live_mainnet = {v.lower() for k, v in json.load(open('deployments.mainnet.json')).items() if k == 'BulkSend'}
except FileNotFoundError:
    live_mainnet = set()
for f in sorted(glob.glob('test/web/audit-probe*.mjs')):
    body = io.open(f, encoding='utf-8').read().lower()
    for hit in sorted(set(re.findall(r'0x[0-9a-f]{40}', body))):
        if hit != man and hit not in live_mainnet and hit in {v.lower() for k, v in json.load(open('deployments.testnet.json')).items() if k.startswith('BulkSend')}:
            print('  FAIL   %s names %s, a superseded BulkSend. The live one is %s.' % (f, hit, man)); ok = False
if ok: print('  ok     page, manifest, tests and probes name the same BulkSend')

# And the published documents, which drifted three deploys behind before anything noticed. The dated audit
# reports are excluded on purpose: each was written against a particular deployment, and rewriting them would
# be falsifying the record. Everything else that names a BulkSend must name the one that is live.
tombstones = {v.lower() for k, v in json.load(open('deployments.testnet.json')).items()
              if k.startswith('BulkSend_')} - live_mainnet
for f in ('README.md', 'docs/for-reviewers.md', 'docs/status.md', 'SECURITY.md'):
    try: body = io.open(f, encoding='utf-8').read()
    except FileNotFoundError: continue
    for hit in sorted({h.lower() for h in re.findall(r'0x[0-9a-fA-F]{40}', body)} & tombstones):
        print('  FAIL   %s names %s, a superseded BulkSend. The live one is %s.' % (f, hit, man)); ok = False
if ok: print('  ok     no published document names a superseded BulkSend')
sys.exit(0 if ok else 1)
PY

# 3b. Every error the contract can revert with must reach the user as a sentence.
#     Six of fifteen were declared in the page's decoder, so nine -- including every guard added in v11 and
#     v12 -- arrived as "reverted with 0x16102772". Two of those nine already had sentences written for them
#     and were unreachable because the interface never named them. Being stopped correctly and told nothing
#     you can act on is its own defect, and it is the kind that returns the moment a new error is added.
#
#     Always ask Foundry for an ABI from the current source. `out/` is ignored, so reading it directly made
#     this check skip itself on a fresh CI clone; when it did exist locally it could also be stale. `inspect`
#     validates the cache or rebuilds before answering, and its output is independent of either case.
audit_abi_file="$(mktemp)"
audit_forge="$(command -v forge 2>/dev/null || true)"
if [ -z "$audit_forge" ] && [ -x "${HOME:-}/.foundry/bin/forge" ]; then
  audit_forge="${HOME}/.foundry/bin/forge"
fi
if [ -n "$audit_forge" ] && "$audit_forge" inspect src/BulkSend.sol:BulkSend abi --json >"$audit_abi_file"; then
python3 - "$audit_abi_file" <<'PY' || bad=1
import io, json, re, sys
abi = json.load(open(sys.argv[1]))
errs = [e['name'] for e in abi if e['type'] == 'error']
bad = False
# Both pages read this contract's errors, and round thirteen's fix taught only one of them (S-7 on the twin
# reader). The airdrop page declares signatures and words them in a map; Check carries [signature, words]
# pairs. Either way: every error, declared, with a sentence.
page = io.open('web/index.html', encoding='utf-8').read()
declared = set(re.findall(r"'error (\w+)\(", page))
worded = set(re.findall(r"^\s*(\w+): '", page, re.M))
for e in [e for e in errs if e not in declared]:
    print('  FAIL   the contract can revert %s() and the airdrop page does not declare it, so it reaches the user as hex' % e); bad = True
for e in [e for e in errs if e in declared and e not in worded]:
    print('  FAIL   %s() is declared in the airdrop page but has no sentence, so the user is shown its name and nothing to do' % e); bad = True
check = io.open('web/check.js', encoding='utf-8').read()
pairs = dict(re.findall(r"\['error (\w+)\([^']*\)',\s*'([^']*)'\]", check))
for e in [e for e in errs if e not in pairs]:
    print('  FAIL   the contract can revert %s() and the Check page cannot name it, so it is shown as a bare selector' % e); bad = True
for e in [e for e in errs if e in pairs and not pairs[e].strip()]:
    print('  FAIL   %s() has an empty sentence in the Check page' % e); bad = True
if bad: sys.exit(1)
print('  ok     all %d contract errors reach the user as a sentence, on both pages' % len(errs))
PY
else
  fail "could not build the current BulkSend ABI, so contract-error coverage was not checked"
fi
rm -f "$audit_abi_file"

# 4. Nothing personal, and no key material, in anything tracked. Dated audit reports are immutable external
# records and can name the auditor's local workspace; do not rewrite those paths merely to make this check
# green. They remain covered by the key-material check below.
HOMEPAT='/home/''arson'   # split so this file does not match its own search
if git grep -qIl "$HOMEPAT" -- . ':!preflight.sh' ':(exclude,glob)docs/audit-*.md' 2>/dev/null; then
  fail "a tracked file contains an absolute home path"
  git grep -Il "$HOMEPAT" -- . ':!preflight.sh' ':(exclude,glob)docs/audit-*.md' | sed 's/^/         /'
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

# 6. Round 21 F-10: a numeric browser-test count in prose goes stale the moment a check is added or removed,
#    silently, because nothing reruns the suite to check the sentence against it. The suites already print
#    their own counts when they run, and ./verify.sh's output is the record of what passed -- a document
#    should say that, not retype a number. Dated audit reports are excluded on the same grounds check 3 and
#    check 4 above exclude them: each is a past reviewer's own measurement of a past commit, quoted as
#    evidence in their own report, not a present claim this repository is making about itself today.
python3 - <<'PY' || bad=1
import glob, io, re, sys
pat = re.compile(r'[0-9]+\s+(airdrop[- ]page|Check[- ]page|browser)\s+tests', re.I)
targets = ['README.md'] + sorted(f for f in glob.glob('docs/*.md') if not re.match(r'docs/audit-\d', f))
ok = True
for f in targets:
    try:
        body = io.open(f, encoding='utf-8').read()
    except FileNotFoundError:
        continue
    for i, line in enumerate(body.splitlines(), 1):
        if pat.search(line):
            print('  FAIL   %s:%d states a numeric browser-test count in prose: %s' % (f, i, line.strip()[:120]))
            ok = False
if ok:
    print('  ok     no document states a numeric browser-test count the commands beside it could make stale')
sys.exit(0 if ok else 1)
PY

echo
if [ "$bad" -eq 0 ]; then echo "Preflight clean."; else echo "Preflight found something. Fix it before running anything slower."; fi
exit "$bad"
