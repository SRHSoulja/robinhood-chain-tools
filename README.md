# rh-airdrop: bulk NFT and token airdrops on Robinhood Chain

`BulkSend` sends ERC-721, ERC-1155, or ERC-20 to many wallets in one transaction.

It holds nothing. Every transfer is `transferFrom(msg.sender, ...)`, so the contract can only move what
the caller approved, inside the transaction the caller signed. No owner, no upgrade path, no fees, no pause.

## Modes

- strict (`lenient=false`): one bad recipient reverts the whole batch, nothing moves.
- lenient (`lenient=true`): a recipient that cannot receive (a contract with no receiver hook, an id you
  no longer own, a paused token) is skipped and logged with a `Skipped` event; the rest is delivered.
  The call returns `(sent, skipped)`.
- safe (721 only): use `safeTransferFrom`, so contract recipients must implement `onERC721Received`.

## Networks

| | chain id | RPC | explorer |
|---|---|---|---|
| testnet | 46630 | https://rpc.testnet.chain.robinhood.com | https://explorer.testnet.chain.robinhood.com |
| mainnet | 4663 | https://rpc.mainnet.chain.robinhood.com | https://robinhoodchain.blockscout.com |

Gas token is ETH. Testnet faucet: https://faucet.testnet.chain.robinhood.com/ (browser only, blocks automation).

## Build and test

    forge build
    forge test -vv

Gas: about 37k per recipient for ERC-721 in a batch of 200.

## Deploy

    export RH_RPC=https://rpc.testnet.chain.robinhood.com
    forge script script/Deploy.s.sol:DeployBulkSend --rpc-url $RH_RPC --private-key $PK --broadcast
    forge verify-contract <address> src/BulkSend.sol:BulkSend --chain-id 46630 --rpc-url $RH_RPC \
      --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/

Testnet first, always. Rehearse on a local fork with no funds:

    anvil --fork-url $RH_RPC --port 8555
    cast rpc --rpc-url http://127.0.0.1:8555 anvil_setBalance <deployer> 0x8AC7230489E80000

## Keys

The deployer key is a throwaway with no value. It lives outside the repo in a 600-permission file
and is never committed. Nothing in this repo contains a secret.
