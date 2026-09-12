#!/usr/bin/env bash
# Round 21 F-7: verify.sh's own summary block could print "Everything passes, and nothing that was closed has
# reopened." on a run that had already failed, because the loop that pins the eleven suite-file fingerprints
# set fail=1 INSIDE the `if [ "$fail" -eq 0 ]; then` branch, and that branch printed its success sentence
# unconditionally afterward. The exit status was always correct (CI still failed); the sentence a human reads
# at the end was not.
#
# This does not run ./verify.sh (that is the full commit gate). It extracts the exact summary block from the
# real verify.sh -- the same lines the reviewer's own reproduction named -- and runs that block standalone
# against a deliberately empty suite_files baseline, so every one of the eleven pinned fingerprints disagrees.
# That is the real shape of the defect: some ordinary check inside the "if fail==0" branch fails on its own,
# and the summary printed after it has to agree with that failure, not with whatever fail was before the loop.
#
#   ./test/verify-summary.test.sh
#
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

pass=0; failed=0
check() { if [ "$1" -eq 0 ]; then pass=$((pass + 1)); printf '  ok    %s\n' "$2"; else failed=$((failed + 1)); printf '  FAIL  %s\n' "$2"; fi; }

# Extracted by marker, from the real verify.sh, not retyped: if the file changes shape, this test sees the
# change the next time it runs, the same discipline test/readers.test.mjs uses for the page's own readers.
start_ln="$(grep -nF '# --- summary: whether this run may be trusted' verify.sh | head -1 | cut -d: -f1)"
end_ln="$(grep -nF 'exit "$fail"' verify.sh | tail -1 | cut -d: -f1)"
if [ -z "${start_ln:-}" ] || [ -z "${end_ln:-}" ] || [ "$end_ln" -lt "$start_ln" ]; then
  echo "  FAIL  could not extract the summary block from verify.sh; its markers may have moved"
  echo "0 passed, 1 failed"
  exit 1
fi
BLOCK="$(sed -n "${start_ln},${end_ln}p" verify.sh)"

RH_TMP="$(mktemp -d)"; trap 'rm -rf "$RH_TMP"' EXIT
# A baseline that names none of the eleven pinned suite files, so every one of them disagrees with the real
# repository's current fingerprints inside the block's own `for pair in ...` loop -- exactly the shape a
# maintainer hits by weakening one of the eleven and never touching the baseline.
BASELINE="$RH_TMP/baseline.json"
printf '{"suite_files":{}}' > "$BASELINE"

OUT="$RH_TMP/out.txt"
( fail=0
  say() { printf '%s\n' "$*"; }
  eval "$BLOCK"
) >"$OUT" 2>&1
code=$?

check $([ "$code" -ne 0 ] && echo 0 || echo 1) "exit status is non-zero when a pinned suite-file fingerprint disagrees with the baseline (was $code)"
if grep -q "Everything passes" "$OUT"; then r=1; else r=0; fi
check "$r" "the summary line never claims everything passes on a run that just failed a fingerprint check"
if grep -q "Something is wrong above" "$OUT"; then r=0; else r=1; fi
check "$r" "the summary line instead says something is wrong, matching the non-zero exit"
if grep -q "FAIL.*suite file fingerprint changed" "$OUT"; then r=0; else r=1; fi
check "$r" "the fingerprint mismatch itself is still reported by name, same as before this fix"

# Control: an unmodified baseline (the repository's real one) against the repository's real files must still
# pass cleanly and still say so -- this fix must not turn a clean run into a false failure.
OUT2="$RH_TMP/out2.txt"
( BASELINE="$PWD/test/findings-baseline.json"
  fail=0
  say() { printf '%s\n' "$*"; }
  eval "$BLOCK"
) >"$OUT2" 2>&1
code2=$?
check $([ "$code2" -eq 0 ] && echo 0 || echo 1) "control: the real baseline against the real suite files still exits 0 (was $code2)"
if grep -q "Everything passes" "$OUT2"; then r=0; else r=1; fi
check "$r" "control: the real baseline still prints the true clean-pass sentence"

echo
echo "$pass passed, $failed failed"
[ "$failed" -eq 0 ]
exit $?
