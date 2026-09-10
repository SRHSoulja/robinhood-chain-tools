#!/usr/bin/env bash
# Everything, and then the question the suites cannot answer on their own.
#
#   ./verify.sh
#
# Two failure modes matter here and only one of them is a failing test.
#
# The first is an ordinary regression: a fix breaks something that used to work. The suites catch that, and
# they have: a card added while fixing one finding swallowed the message of another, and a test written three
# rounds earlier caught it.
#
# The second has nothing watching it. A later fix can quietly REOPEN an earlier finding, and every suite will
# still be green, because a suite tests what the code should do and a finding is a thing the code should no
# longer do. The reviewers' probe files are the only record of the second kind, and they are written
# backwards on purpose: a probe REPRODUCES a defect, so a probe that fails is a defect that is fixed.
#
# So this counts how many findings still reproduce and compares that to what was true when the work was done.
# If the number goes up, something that was closed has come open again, and it says which set.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export PATH="$HOME/.foundry/bin:$PATH"
[ -d node_modules ] || npm install --no-audit --no-fund >/dev/null 2>&1

BASELINE=test/findings-baseline.json
fail=0
say() { printf '%s\n' "$*"; }

say "=== the suites: does everything still work ==="
forge test >/tmp/rh-forge.txt 2>&1
forge_line="$(grep -E '^Ran .* test suites' /tmp/rh-forge.txt | tail -1)"
# The reviewers' probe suite is expected to fail; every other contract suite is not.
forge_bad="$(grep -cE '^\[FAIL' /tmp/rh-forge.txt || true)"
forge_bad_outside_probes="$(grep -E '^\[FAIL' /tmp/rh-forge.txt | grep -vc 'test_probe_' || true)"
say "  contracts: ${forge_line:-no result}"
if [ "${forge_bad_outside_probes:-0}" -gt 0 ]; then
  say "  FAIL  $forge_bad_outside_probes contract test(s) failing outside the probe suite:"
  grep -E '^\[FAIL' /tmp/rh-forge.txt | grep -v 'test_probe_' | sed 's/^/        /'
  fail=1
fi

for suite in client check; do
  node "test/web/$suite.test.mjs" >"/tmp/rh-$suite.txt" 2>&1
  line="$(grep -E '^[0-9]+ passed, [0-9]+ failed' "/tmp/rh-$suite.txt" | tail -1)"
  say "  $suite page: ${line:-DID NOT FINISH}"
  case "$line" in
    *' 0 failed') ;;
    '') say "  FAIL  the $suite suite did not finish; see /tmp/rh-$suite.txt"; fail=1 ;;
    *)  say "  FAIL  the $suite suite has failures:"; grep -E '^  FAIL' "/tmp/rh-$suite.txt" | sed 's/^/      /'; fail=1 ;;
  esac
done

say ""
say "=== the publish gate: can a weaker policy get out ==="
if ./test/csp-gate.test.sh >/tmp/rh-csp.txt 2>&1; then
  say "  $(grep -E '^[0-9]+ passed' /tmp/rh-csp.txt | tail -1), every weakening refused"
else
  say "  FAIL  the CSP gate let something through; see /tmp/rh-csp.txt"
  grep -E '^  FAIL' /tmp/rh-csp.txt | sed 's/^/      /'
  fail=1
fi

say ""
say "=== the probes: is everything that was fixed still fixed ==="
count_probe() { node "$1" 2>/dev/null | grep -oE '^[0-9]+ demonstrated' | grep -oE '^[0-9]+' | tail -1; }
now_airdrop="$(count_probe test/web/audit-probe.mjs)"
now_check1="$(count_probe test/web/audit-probe-check.mjs)"
now_check2="$(count_probe test/web/audit-probe-check2.mjs)"
rm -f /tmp/rh-probe-sol.txt
probe_files=""
for f in test/Audit*.t.sol; do
  [ -e "$f" ] || continue
  n="$(basename "$f" .t.sol)"
  forge test --match-path "$f" >>"/tmp/rh-probe-sol.txt" 2>&1
  c="$(forge test --match-path "$f" 2>/dev/null | grep -oE '[0-9]+ passed' | grep -oE '^[0-9]+' | tail -1)"
  eval "now_probe_$n=\${c:-0}"
  probe_files="$probe_files $n"
done
now_sol="${now_probe_AuditProbe:-0}"

if [ ! -f "$BASELINE" ]; then
  say "  no baseline yet; writing one from this run. Check these numbers before trusting them."
  printf '{\n "airdrop": %s,\n "check1": %s,\n "check2": %s,\n "contract_still_passing": %s\n}\n' \
    "${now_airdrop:-0}" "${now_check1:-0}" "${now_check2:-0}" "${now_sol:-0}" > "$BASELINE"
fi

read -r was_airdrop was_check1 was_check2 was_sol <<EOF
$(python3 -c "import json;d=json.load(open('$BASELINE'));print(d['airdrop'],d['check1'],d['check2'],d['contract_still_passing'])")
EOF

check_set() {
  local name="$1" now="$2" was="$3" dir="$4"
  if [ "$dir" = "down" ]; then
    if [ "${now:-999}" -gt "${was:-0}" ]; then
      say "  FAIL  $name: $now findings reproduce, was $was. Something closed has come open again."
      fail=1
    elif [ "${now:-999}" -lt "${was:-0}" ]; then
      say "  ok    $name: $now reproduce, was $was. Fewer than the baseline; update it."
    else
      say "  ok    $name: $now still reproduce, unchanged"
    fi
  else
    if [ "${now:-0}" -gt "${was:-0}" ]; then
      say "  FAIL  $name: $now probe assertions pass, was $was. A fixed finding is reproducing again."
      fail=1
    else
      say "  ok    $name: $now probe assertions pass, was $was"
    fi
  fi
}
check_set "airdrop page" "$now_airdrop" "$was_airdrop" down
check_set "check page, set one" "$now_check1" "$was_check1" down
check_set "check page, set two" "$now_check2" "$was_check2" down
for n in $probe_files; do
  eval "now=\$now_probe_$n"
  was="$(python3 -c "import json,sys;d=json.load(open('$BASELINE')).get('contract_probes',{});print(d.get('$n','none'))")"
  if [ "$was" = "none" ]; then
    say "  FAIL  contract probes $n: $now pass, and the baseline has never heard of this file."
    say "        Add \"$n\" to contract_probes in $BASELINE, with the count this run should hold at."
    fail=1
  else
    check_set "contract probes $n" "$now" "$was" up
  fi
done

say ""
if [ "$fail" -eq 0 ]; then
  say "Everything passes, and nothing that was closed has reopened."
  say ""
  say "Not covered by any of the above, and not claimed to be:"
  say "  - the live scripts (they need the network): live-chain, live-send, live-wallet-batch"
  say "  - anything against a real wallet extension"
else
  say "Something is wrong above. Nothing should be committed on this tree."
fi
exit "$fail"
