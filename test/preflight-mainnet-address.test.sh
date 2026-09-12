#!/usr/bin/env bash
# The same deployer at the same nonce lands at the same address on every chain, so the live mainnet BulkSend can
# share its address with a superseded testnet deployment. preflight.sh's superseded-address rule must not refuse
# a document for naming an address that deployments.mainnet.json records as the active BulkSend, and must still
# refuse the same address when no such record exists. Proven on a scratch copy of the tree; the real tree passes.
#
#   ./test/preflight-mainnet-address.test.sh
#
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
pass=0; failed=0
check() { if [ "$1" -eq 0 ]; then pass=$((pass + 1)); printf '  ok    %s\n' "$2"; else failed=$((failed + 1)); printf '  FAIL  %s\n' "$2"; fi; }
RH_TMP="$(mktemp -d)"; trap 'rm -rf "$RH_TMP"' EXIT
rsync -a --exclude .git --exclude node_modules --exclude out --exclude cache --exclude broadcast ./ "$RH_TMP/tree/"
OLD="$(python3 -c "import json;print(json.load(open('deployments.testnet.json'))['BulkSend_v1_unoptimized'])")"
cd "$RH_TMP/tree"
# a document naming the old testnet address, with no mainnet record: refused. The scratch copy starts without
# the record whether or not the real tree has one, so this case means the same thing before and after the deploy.
rm -f deployments.mainnet.json
printf '\nMainnet BulkSend is at %s.\n' "$OLD" >> docs/status.md
out="$(./preflight.sh 2>&1)"; rc=$?
check "$([ $rc -ne 0 ] && echo "$out" | grep -q 'names .*a superseded BulkSend' && echo 0 || echo 1)" "without deployments.mainnet.json, a document naming the old testnet address is still refused"
# the same address recorded as the ACTIVE mainnet BulkSend: not a tombstone any more
printf '{\n "BulkSend": "%s"\n}\n' "$OLD" > deployments.mainnet.json
out="$(./preflight.sh 2>&1)"; rc=$?
check "$([ $rc -eq 0 ] && echo "$out" | grep -q 'no published document names a superseded BulkSend' && echo 0 || echo 1)" "with the address recorded as the active mainnet BulkSend, the same document passes"
# and a DIFFERENT superseded testnet address is still refused even with the mainnet record present
OLD2="$(python3 -c "import json;print(json.load(open('deployments.testnet.json'))['BulkSend_v12_prior'])")"
printf '\nOnce it was %s.\n' "$OLD2" >> docs/status.md
out="$(./preflight.sh 2>&1)"; rc=$?
check "$([ $rc -ne 0 ] && echo "$out" | grep -q "names $OLD2, a superseded BulkSend" && echo 0 || echo 1)" "a different superseded testnet address is still refused with the mainnet record present"
cd - >/dev/null
out="$(./preflight.sh 2>&1)"; rc=$?
check "$([ $rc -eq 0 ] && echo 0 || echo 1)" "control: the real tree passes preflight"
echo "$pass passed, $failed failed"
[ "$failed" -eq 0 ]
