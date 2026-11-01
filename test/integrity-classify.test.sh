#!/usr/bin/env bash
# The integrity workflow's explorer step must classify each endpoint on its own: credits spent is a warning
# for that endpoint, a dark or wrong answer still fails, whatever the other endpoints did (review of a501254, P2).
#   ./test/integrity-classify.test.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
python3 - "$W/step.sh" <<'PY'
import sys, yaml
d = yaml.safe_load(open('.github/workflows/integrity.yml'))
for st in d['jobs']['live-matches-source']['steps']:
    if st.get('name', '').startswith('the mainnet explorer answers'):
        r = st['run'].replace('for host in rhcheck.gmgnrepeat.com rhairdrop.gmgnrepeat.com; do', 'for host in h1; do')
        old = 'j() { curl -sS --max-time 25 "https://$host/x/4663$1"; }'
        assert old in r
        r = r.replace(old, 'j() { case "$1" in */holders) echo "$HOLD";; *324f*) echo "$UNV";; *) echo "$VER";; esac; }')
        open(sys.argv[1], 'w').write(r); break
else:
    raise SystemExit('step not found')
PY
X='{"error":"upstream","status":402,"reason":"credits_exhausted"}'
DARK='{"error":"upstream","status":403}'
HG='{"items":[{"address":{"hash":"0xab"}}]}'; UG='{"is_verified":false}'; VG='{"is_verified":true,"name":"UniversalRouter","abi":[1]}'
fail=0
t() { local want="$1" name="$2"; shift 2; local got=0
  HOLD="$1" UNV="$2" VER="$3" bash "$W/step.sh" >/dev/null 2>&1 || got=$?
  if { [ "$want" = 0 ] && [ "$got" = 0 ]; } || { [ "$want" = 1 ] && [ "$got" != 0 ]; }; then echo "  ok   $name"; else echo "  FAIL $name (exit $got)"; fail=1; fi; }
t 0 "all real answers pass" "$HG" "$UG" "$VG"
t 0 "holders cached, both contract lookups out of credits: warnings, not red" "$HG" "$X" "$X"
t 0 "everything out of credits: warnings, not red" "$X" "$X" "$X"
t 0 "a pre-budget Worker's bare 402 counts as credits" '{"error":"upstream","status":402}' "$UG" "$VG"
t 1 "holders out of credits but the unverified lookup is DARK still fails" "$X" "$DARK" "$VG"
t 1 "holders out of credits but the verified lookup reads wrong still fails" "$X" "$UG" "$UG"
t 1 "holders dark (403) fails" "$DARK" "$UG" "$VG"
t 1 "non-JSON fails" "<html>" "$UG" "$VG"
exit $fail
