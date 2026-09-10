#!/usr/bin/env bash
# Everything, in one command. Contracts first, then both pages in a real browser with every answer mocked.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
echo "=== contracts ==="
forge test
echo
echo "=== pages ==="
[ -d node_modules ] || npm install --no-audit --no-fund
node test/web/client.test.mjs
node test/web/check.test.mjs
echo
echo "The live check (needs the network, so it is not part of this run):"
echo "  node test/web/live-chain.mjs    (measures real tokens on testnet)"
echo "  node test/web/live-send.mjs     (signs and sends a real airdrop on testnet)"
