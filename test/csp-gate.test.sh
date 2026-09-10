#!/usr/bin/env bash
# Every way the published CSP could be weakened, and the gate refusing each one.
#
#   ./test/csp-gate.test.sh
#
# This exists because the gate it tests used to be a heredoc inside deploy/publish.sh, reachable only by
# publishing. That is the shape of a check nobody ever runs: the only way to find out whether it works is to
# do the thing it is supposed to prevent. Round twelve's S-15 was that the gate read script-src and no other
# directive, so a host added to connect-src, or `object-src 'none'` dropped, published without a word.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
pass=0; fail=0
ok()   { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }

hash_of() {
  python3 - "$1" <<'PY'
import base64, hashlib, re, sys
html = open(sys.argv[1], encoding="utf-8").read()
blocks = [b for a, b in re.findall(r'<script([^>]*)>(.*?)</script>', html, re.S)
          if "src=" not in a.lower() and b.strip()]
assert len(blocks) == 1, "expected exactly one inline script, found %d" % len(blocks)
print("sha256-" + base64.b64encode(hashlib.sha256(blocks[0].encode()).digest()).decode())
PY
}

# A doctored page must be REFUSED. The name says what was done to it.
refuses() {
  local name="$1" find="$2" repl="$3" src="$4"
  cp "$src" "$tmp/p.html"
  python3 - "$tmp/p.html" "$find" "$repl" <<'PY' || { bad "$name (could not doctor the page: anchor missing)"; return; }
import io, sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(p, encoding="utf-8").read()
if s.count(a) < 1: raise SystemExit(1)
io.open(p, "w", encoding="utf-8").write(s.replace(a, b, 1))
PY
  local out; out="$(python3 deploy/csp-gate.py "$tmp/p.html" "$(hash_of "$tmp/p.html")" 2>&1)"
  if [ $? -eq 0 ]; then bad "$name -- the gate ALLOWED it"; else ok "$name -- refused: $(printf '%s' "$out" | head -1 | cut -c1-72)"; fi
}

for page in web/index.html web/check.html; do
  printf '\n== %s ==\n' "$page"
  out="$(python3 deploy/csp-gate.py "$page" "$(hash_of "$page")" 2>&1)"
  if [ $? -eq 0 ]; then ok "the page as committed is accepted"; else bad "the page as committed was REFUSED: $out"; fi

  refuses "a host added to connect-src"        "connect-src 'self'" "connect-src 'self' https://evil.example.com" "$page"
  refuses "object-src 'none' dropped"          "object-src 'none'; " ""                                           "$page"
  refuses "base-uri 'none' dropped"            "base-uri 'none'; "  ""                                            "$page"
  refuses "form-action widened to 'self'"      "form-action 'none'" "form-action 'self'"                          "$page"
  refuses "default-src widened"                "default-src 'none'" "default-src 'self'"                          "$page"
  refuses "script-src given 'unsafe-inline'"   "script-src 'self'"  "script-src 'unsafe-inline' 'self'"           "$page"
  refuses "script-src given 'strict-dynamic'"  "script-src 'self'"  "script-src 'strict-dynamic' 'self'"          "$page"
  refuses "a script host outside the allowlist" "script-src 'self'" "script-src 'self' https://evil.example.com"  "$page"
  refuses "an unknown directive appears"       "base-uri 'none'"    "child-src https://evil.example.com; base-uri 'none'" "$page"
done

# img-src only exists on the airdrop page with blob:, so it is tested where it lives.
printf '\n== img-src ==\n'
refuses "img-src widened to *" "img-src 'self' data: blob:" "img-src *" web/index.html

printf '\n%d passed, %d failed\n' "$pass" "$fail"
exit $((fail ? 1 : 0))
