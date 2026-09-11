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
BASELINE=test/findings-baseline.json
fail=0
say() { printf '%s\n' "$*"; }

# Check the evidence inventory before installing dependencies or starting the long browser suites. A deleted
# probe is not an expensive test failure; it is a missing part of the ledger, and should fail in seconds.
if [ ! -f "$BASELINE" ]; then
  say "FAIL  $BASELINE is missing. A missing history is not a new clean baseline."
  exit 1
fi
current_web=(); for f in test/web/audit-probe*.mjs; do [ -e "$f" ] && current_web+=("$(basename "$f" .mjs)"); done
current_contract=(); for f in test/Audit*.t.sol; do [ -e "$f" ] && current_contract+=("$(basename "$f" .t.sol)"); done
if ! python3 - "$BASELINE" "${current_web[@]}" -- "${current_contract[@]}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    baseline = json.load(f)
mark = sys.argv.index("--")
current = {"web_probes": set(sys.argv[2:mark]), "contract_probes": set(sys.argv[mark + 1:])}
bad = False
for section, label in (("web_probes", "browser probe"), ("contract_probes", "contract probe")):
    expected = set(baseline.get(section, {}))
    missing, extra = sorted(expected - current[section]), sorted(current[section] - expected)
    if missing or extra:
        parts = (["missing: " + ", ".join(missing)] if missing else []) + (["unlisted: " + ", ".join(extra)] if extra else [])
        print("FAIL  " + label + " manifest differs from the baseline (" + "; ".join(parts) + ").")
        bad = True
if bad: raise SystemExit(1)
print("ok    evidence-file manifest exactly matches the baseline")
PY
then
  exit 1
fi

[ -d node_modules ] || npm install --no-audit --no-fund >/dev/null 2>&1

say "=== the suites: does everything still work ==="
forge test --no-match-path 'test/fork/*.t.sol' >/tmp/rh-forge.txt 2>&1
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

suite_files=""
for suite in client check; do
  node "test/web/$suite.test.mjs" >"/tmp/rh-$suite.txt" 2>&1
  line="$(grep -E '^[0-9]+ passed, [0-9]+ failed' "/tmp/rh-$suite.txt" | tail -1)"
  # The suite must pass, and its reviewed source must still be the suite whose pass is being cited. Pinning the
  # whole file makes deleting or rewriting an assertion a baseline change rather than a quieter green run.
  assertion_sha="$(sha256sum "test/web/$suite.test.mjs" | cut -d' ' -f1)"
  eval "now_suite_${suite}_sha=\$assertion_sha"
  suite_files="$suite_files $suite"
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
web_probe_files=""
for f in test/web/audit-probe*.mjs; do
  [ -e "$f" ] || continue
  n="$(basename "$f" .mjs)"
  tmp="/tmp/rh-${n}.txt"
  node "$f" >"$tmp" 2>&1
  c="$(grep -oE '^[0-9]+ demonstrated' "$tmp" | grep -oE '^[0-9]+' | tail -1)"
  # Hash status plus assertion name, not the diagnostic after `<-`: diagnostics legitimately contain wall-clock
  # times and other run data. Two runs with identical evidence must have identical fingerprints.
  assertion_sha="$(grep -E '^  (ok|FAIL|REPRODUCES|fixed|DEMONSTRATED|not shown)[[:space:]]' "$tmp" \
    | sed -E 's/[[:space:]]+<-.*/ /; s/[[:space:]]+/ /g; s/[[:space:]]+$//' \
    | sha256sum | cut -d' ' -f1)"
  eval "now_web_${n//-/_}=\${c:-999}"
  eval "now_web_${n//-/_}_sha=\$assertion_sha"
  web_probe_files="$web_probe_files $n"
done
rm -f /tmp/rh-probe-sol.txt
probe_files=""
for f in test/Audit*.t.sol; do
  [ -e "$f" ] || continue
  n="$(basename "$f" .t.sol)"
  tmp="/tmp/rh-probe-${n}.txt"
  forge test --match-path "$f" >"$tmp" 2>&1 || true
  cat "$tmp" >>"/tmp/rh-probe-sol.txt"
  c="$(grep -oE '[0-9]+ passed' "$tmp" | grep -oE '^[0-9]+' | tail -1)"
  assertion_sha="$(sed -n -E 's/^\[PASS\] ([^ (]+).*/PASS \1/p; s/^\[FAIL[^]]*\] ([^ (]+).*/FAIL \1/p' "$tmp" \
    | sort | sha256sum | cut -d' ' -f1)"
  eval "now_probe_$n=\${c:-0}"
  eval "now_probe_${n}_sha=\$assertion_sha"
  probe_files="$probe_files $n"
done

check_set() {
  local name="$1" now="$2" was="$3" unit="$4"
  if [ "${now:-missing}" != "${was:-baseline-missing}" ]; then
    say "  FAIL  $name: $now $unit, baseline is $was. Any change requires a reviewed baseline update."
    fail=1
  else
    say "  ok    $name: $now $unit, exactly the baseline"
  fi
}

check_fingerprint() {
  local label="$1" now="$2" section="$3" key="$4" was
  was="$(python3 -c "import json;d=json.load(open('$BASELINE')).get('$section',{});print(d.get('$key','none'))")"
  if [ "$was" = "none" ]; then
    say "  FAIL  $label has no fingerprint in the baseline."
    fail=1
  elif [ "$now" != "$was" ]; then
    say "  FAIL  $label fingerprint changed. Update the baseline only after reviewing the exact change."
    fail=1
  else
    say "  ok    $label fingerprint exactly matches the baseline"
  fi
}

for n in $web_probe_files; do
  eval "now=\$now_web_${n//-/_}"
  was="$(python3 -c "import json;d=json.load(open('$BASELINE')).get('web_probes',{});print(d.get('$n','none'))")"
  if [ "$was" = "none" ]; then
    say "  FAIL  browser probes $n: $now reproduce, and the baseline has never heard of this file."
    say "        Add \"$n\" to web_probes in $BASELINE, with the count this run should hold at."
    fail=1
  else
    check_set "browser probes $n" "$now" "$was" "findings reproduce"
    eval "sha=\$now_web_${n//-/_}_sha"
    check_fingerprint "browser probes $n" "$sha" web_probe_assertions "$n"
  fi
done
for n in $probe_files; do
  eval "now=\$now_probe_$n"
  was="$(python3 -c "import json,sys;d=json.load(open('$BASELINE')).get('contract_probes',{});print(d.get('$n','none'))")"
  if [ "$was" = "none" ]; then
    say "  FAIL  contract probes $n: $now pass, and the baseline has never heard of this file."
    say "        Add \"$n\" to contract_probes in $BASELINE, with the count this run should hold at."
    fail=1
  else
    check_set "contract probes $n" "$now" "$was" "probe assertions pass"
    eval "sha=\$now_probe_${n}_sha"
    check_fingerprint "contract probes $n" "$sha" contract_probe_assertions "$n"
  fi
done
for suite in $suite_files; do
  eval "sha=\$now_suite_${suite}_sha"
  check_fingerprint "$suite page suite file" "$sha" suite_files "$suite"
done

say ""
if [ "$fail" -eq 0 ]; then
  say "Everything passes, and nothing that was closed has reopened."
  say ""
  say "Not covered by any of the above, and not claimed to be:"
  say "  - the live scripts (they need the network): live-chain, live-send, live-wallet-batch"
  say "  - test/fork/, which asks the paste guards about REAL mainnet contracts on a read-only local fork:"
  say "      forge test --match-path 'test/fork/MainnetGuards.t.sol'"
  say "  - anything against a real wallet extension. The maintainer has driven the page from a phone with"
  say "    MetaMask once, by hand, against a pre-v10 contract. Nothing automatic covers it."
else
  say "Something is wrong above. Nothing should be committed on this tree."
fi
exit "$fail"
