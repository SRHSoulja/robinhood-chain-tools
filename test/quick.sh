#!/usr/bin/env bash
# The fast inner loop for a change still being made. NOT a commit gate: it never touches the findings
# baseline and it is allowed to run only a slice. ./verify.sh is the only thing that decides whether a commit
# may land; this is what you run while you are still finding out whether the fix works. See docs/harness.md.
#
#   ./test/quick.sh                       # node layers: readers, worker, csp-gate, forge (ordinary files)
#   ./test/quick.sh assign snapshot       # plus the browser cases in those areas
#   ./test/quick.sh --probes 17 18        # plus the named probe files
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.foundry/bin:$PATH"
[ -d node_modules ] || npm install --no-audit --no-fund >/dev/null 2>&1

pass=0
fail=0
say() { printf '%s\n' "$*"; }
add() { pass=$((pass + $1)); fail=$((fail + $2)); }

# Reads the "N passed, M failed" line a node suite or csp-gate.test.sh ends with, and folds it into the
# running total. The same line client.test.mjs and check.test.mjs print, filtered or not.
add_from_summary() {
  local line n m
  line="$(grep -E '^[0-9]+ passed, [0-9]+ failed' "$1" | tail -1)"
  if [ -z "$line" ]; then fail=$((fail + 1)); say "  FAIL  no summary line found; see $1"; return; fi
  n="$(printf '%s' "$line" | grep -oE '^[0-9]+')"
  m="$(printf '%s' "$line" | grep -oE '[0-9]+ failed' | grep -oE '^[0-9]+')"
  add "${n:-0}" "${m:-1}"
}

say "=== readers: web/index.html's pure functions, extracted and run in node ==="
tmp="$(mktemp)"
node test/readers.test.mjs >"$tmp" 2>&1
grep -E '^  FAIL|^[0-9]+ passed' "$tmp" || true
add_from_summary "$tmp"

say ""
say "=== worker: gate 11's mainnet explorer translation ==="
tmp="$(mktemp)"
node test/worker.test.mjs >"$tmp" 2>&1
grep -E '^  FAIL|^[0-9]+ passed' "$tmp" || true
add_from_summary "$tmp"

say ""
say "=== csp-gate: the publish gate refuses every weakening ==="
tmp="$(mktemp)"
./test/csp-gate.test.sh >"$tmp" 2>&1
grep -E '^  FAIL|^[0-9]+ passed' "$tmp" || true
add_from_summary "$tmp"

say ""
say "=== forge: every ordinary contract test file ==="
tmp="$(mktemp)"
forge test --no-match-path 'test/{Audit*.t.sol,fork/*.t.sol}' >"$tmp" 2>&1
grep -E '^\[FAIL|^Suite result: ok|^Ran [0-9]+ test suites' "$tmp" || true
forge_line="$(grep -E '^Ran [0-9]+ test suites' "$tmp" | tail -1)"
if [ -z "$forge_line" ]; then
  fail=$((fail + 1)); say "  FAIL  forge did not finish; see $tmp"
else
  fp="$(printf '%s' "$forge_line" | grep -oE '[0-9]+ tests passed' | grep -oE '^[0-9]+')"
  ff="$(printf '%s' "$forge_line" | grep -oE ', [0-9]+ failed' | grep -oE '[0-9]+')"
  add "${fp:-0}" "${ff:-0}"
fi

# ---- optional extras: an area slice of the browser suites, or named probe files -----------------------
areas=()
probes=()
mode="areas"
for arg in "$@"; do
  case "$arg" in
    --probes) mode="probes" ;;
    *) if [ "$mode" = "probes" ]; then probes+=("$arg"); else areas+=("$arg"); fi ;;
  esac
done

if [ "${#areas[@]}" -gt 0 ]; then
  only_re="$(IFS='|'; echo "${areas[*]}")"
  say ""
  say "=== browser cases in area(s): ${areas[*]} (ONLY=\"$only_re\") ==="
  for suite in client check; do
    tmp="$(mktemp)"
    ONLY="$only_re" node "test/web/$suite.test.mjs" >"$tmp" 2>&1
    line="$(grep -E '^[0-9]+ passed, [0-9]+ failed' "$tmp" | tail -1)"
    ran_count="$(printf '%s' "$line" | grep -oE '\([0-9]+ of' | grep -oE '[0-9]+')"
    if [ "${ran_count:-1}" = "0" ]; then
      say "  $suite: no case in this file matches ${areas[*]}"
      continue
    fi
    grep -E '^  FAIL' "$tmp" || true
    say "  $suite: ${line:-DID NOT FINISH}"
    add_from_summary "$tmp"
  done
fi

if [ "${#probes[@]}" -gt 0 ]; then
  say ""
  say "=== named probes: ${probes[*]} (reproductions, not pass/fail -- see docs/harness.md) ==="
  for n in "${probes[@]}"; do
    found=0
    f="test/web/audit-probe-$n.mjs"
    if [ -f "$f" ]; then
      found=1
      tmp="$(mktemp)"
      node "$f" >"$tmp" 2>&1
      say "  $f: $(grep -oE '^[0-9]+ demonstrated.*' "$tmp" | tail -1)"
    fi
    sf="test/Audit$n.t.sol"
    if [ -f "$sf" ]; then
      found=1
      tmp="$(mktemp)"
      forge test --match-path "$sf" >"$tmp" 2>&1
      say "  $sf: $(grep -E '^Suite result' "$tmp" | tail -1)"
    fi
    [ "$found" -eq 1 ] || say "  no probe named $n (looked for $f and $sf)"
  done
fi

say ""
say "quick: $pass passed, $fail failed; NOT a commit gate, run ./verify.sh"
exit $((fail ? 1 : 0))
