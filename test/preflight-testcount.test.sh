#!/usr/bin/env bash
# Round 21 F-10: three documents stated numeric browser-test counts the commands beside them do not produce.
# preflight.sh check 6 is meant to refuse any future prose line in docs/*.md or README.md that states one, so
# the drift cannot happen a third time. This proves the check actually catches a reintroduced count, on a
# scratch copy of the repository's docs/ and README.md, and that it still passes the real, current tree.
#
#   ./test/preflight-testcount.test.sh
#
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

pass=0; failed=0
check() { if [ "$1" -eq 0 ]; then pass=$((pass + 1)); printf '  ok    %s\n' "$2"; else failed=$((failed + 1)); printf '  FAIL  %s\n' "$2"; fi; }

start_ln="$(grep -nF '# 6. Round 21 F-10' preflight.sh | head -1 | cut -d: -f1)"
# The block's own closing marker is the heredoc terminator, "PY" alone on its line, the first one after start_ln.
end_ln="$(awk -v s="$start_ln" 'NR>s && $0=="PY"{print NR; exit}' preflight.sh)"
if [ -z "${start_ln:-}" ] || [ -z "${end_ln:-}" ]; then
  echo "  FAIL  could not extract the F-10 check block from preflight.sh; its markers may have moved"
  echo "0 passed, 1 failed"
  exit 1
fi
BLOCK="$(sed -n "${start_ln},${end_ln}p" preflight.sh)"

RH_TMP="$(mktemp -d)"; trap 'rm -rf "$RH_TMP"' EXIT

# A scratch tree with exactly the shape the reviewer found: a live document restating a count next to the
# command that would disprove it, and a dated audit report quoting the same shape as evidence -- which must
# NOT trip the check, the same way check 3 and check 4 leave audit-*.md alone.
mkdir -p "$RH_TMP/bad/docs"
cat > "$RH_TMP/bad/README.md" <<'EOF'
    npm install && npm test    # 477 browser tests, every answer mocked, no network
EOF
cat > "$RH_TMP/bad/docs/status.md" <<'EOF'
node test/web/client.test.mjs          # 362 airdrop page tests
EOF
cat > "$RH_TMP/bad/docs/audit-2026-01-01-first-external.md" <<'EOF'
| claim | where | what I measured |
| "362 airdrop page tests" | `docs/status.md` | 380 |
EOF

# The current, real repository: every one of these prose lines has already been fixed by this round.
mkdir -p "$RH_TMP/good"
ln -s "$PWD/README.md" "$RH_TMP/good/README.md"
ln -s "$PWD/docs" "$RH_TMP/good/docs"

run_block() { ( cd "$1" && bad=0; eval "$BLOCK"; exit "$bad" ) >"$2" 2>&1; }

OUT_BAD="$RH_TMP/out-bad.txt"
run_block "$RH_TMP/bad" "$OUT_BAD"
code_bad=$?
check $([ "$code_bad" -ne 0 ] && echo 0 || echo 1) "the check refuses a live document restating a numeric browser-test count (exit was $code_bad)"
if grep -q 'FAIL.*README.md' "$OUT_BAD"; then r=0; else r=1; fi
check "$r" "and names README.md by line number"
if grep -q 'FAIL.*docs/status.md' "$OUT_BAD"; then r=0; else r=1; fi
check "$r" "and names docs/status.md by line number"
if grep -q 'audit-2026-01-01-first-external' "$OUT_BAD"; then r=1; else r=0; fi
check "$r" "and does not flag the dated audit report quoting the same shape as evidence"

OUT_GOOD="$RH_TMP/out-good.txt"
run_block "$RH_TMP/good" "$OUT_GOOD"
code_good=$?
check $([ "$code_good" -eq 0 ] && echo 0 || echo 1) "control: the real, current docs/ and README.md pass cleanly (exit was $code_good)"

echo
echo "$pass passed, $failed failed"
[ "$failed" -eq 0 ]
exit $?
