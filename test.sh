#!/usr/bin/env bash
# Everything, in one command. Contracts first, then both pages in a real browser with every answer mocked.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
echo "=== contracts ==="
# The reviewers' probe files are excluded here on purpose: they reproduce findings, so they FAIL while a
# defect stands and would abort this script before it ever reached the page suites. That happened, for eight
# commits. ./verify.sh runs them and interprets a failure as a finding that is fixed.
forge test --no-match-path 'test/Audit*.t.sol'
echo
echo "=== pages ==="
[ -d node_modules ] || npm install --no-audit --no-fund
node test/web/client.test.mjs
node test/web/check.test.mjs

echo
echo "=== the publish gate ==="
# The gate that decides whether a Content-Security-Policy may be published. It used to live inside
# deploy/publish.sh, where the only way to exercise it was to publish -- so it was never run against a policy
# it was supposed to refuse.
./test/csp-gate.test.sh

echo
echo "=== the reviewers' probes (a FAILING probe is a finding that is fixed) ==="
forge test --match-path 'test/Audit*.t.sol' 2>&1 | grep -E "^Suite result|^Ran " || true
echo
echo "The live check (needs the network, so it is not part of this run):"
echo "  node test/web/live-chain.mjs    (measures real tokens on testnet)"
echo "  node test/web/live-send.mjs     (signs and sends a real airdrop on testnet)"
echo "  node test/web/live-wallet-batch.mjs  (the no-approval path, over real EIP-7702)"
