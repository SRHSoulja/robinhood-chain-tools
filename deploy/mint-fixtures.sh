#!/usr/bin/env bash
# Mint fresh testnet fixtures to a wallet for the real-wallet run (docs/real-wallet-run.md). Testnet only:
# refuses any chain but 46630. Uses the testnet-plain key (a testnet-only account with no mainnet balance),
# the same way the live scripts do. Ids come from a decade no live script uses (they use 7e12, 8e12, 9e12).
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
TO="${1:?usage: deploy/mint-fixtures.sh 0xWalletAddress}"
[[ "$TO" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "not an address: $TO"; exit 1; }
RPC=https://rpc.testnet.chain.robinhood.com
[ "$(cast chain-id --rpc-url $RPC)" = "46630" ] || { echo "not testnet; refusing"; exit 1; }
cd "$(dirname "${BASH_SOURCE[0]}")/.."
OZ721="$(python3 -c "import json;print(json.load(open('deployments.testnet.json'))['OZ721'])")"
OZ1155="$(python3 -c "import json;print(json.load(open('deployments.testnet.json'))['OZ1155'])")"
OZ20="$(python3 -c "import json;print(json.load(open('deployments.testnet.json'))['OZ20'])")"
PK="$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.config/rh-airdrop/testnet-plain.json')))['private_key'])")"
BASE=$(( 6000000000000 + $(date +%s%3N) ))
send() { cast send --rpc-url $RPC --private-key "$PK" "$@" >/dev/null; }
echo "minting to $TO"
send $OZ721 "mintMany(address,uint256,uint256)" "$TO" "$BASE" 6
echo "  ERC-721  $OZ721  ids $BASE .. $((BASE + 5))"
send $OZ1155 "mint(address,uint256,uint256)" "$TO" "$BASE" 10
echo "  ERC-1155 $OZ1155  id $BASE, 10 units"
send $OZ20 "mint(address,uint256)" "$TO" 30000000000000000000
echo "  ERC-20   $OZ20  30 tokens"
unset PK
echo "check: https://explorer.testnet.chain.robinhood.com/address/$TO"
