# rh-airdrop: bulk NFT and token airdrops on Robinhood Chain

`BulkSend` sends ERC-721, ERC-1155, or ERC-20 to many wallets in one transaction.

It holds nothing. Every transfer is `transferFrom(msg.sender, ...)`, so the contract can only move what
the caller approved, inside the transaction the caller signed. No owner, no upgrade path, no fees, no pause.

## Modes

- strict (`lenient=false`): one bad recipient reverts the whole batch, nothing moves. The token's own error
  bubbles up, and each transfer gets the whole transaction's gas, so a recipient with a heavy receive hook works.
- lenient (`lenient=true`): a recipient that cannot receive (a contract with no receiver hook, an id you
  no longer own, a paused token) is skipped and logged with a `Skipped` event; the rest is delivered.
  The call returns `(sent, skipped)`. Each transfer gets at most a gas stipend and at most 128 bytes of its
  revert data is kept, so no single recipient can starve the batch or inflate its cost. The stipend is
  `DEFAULT_GAS` (400,000) through `airdrop721` / `airdrop1155` / `airdrop20`, or a number you choose between
  `MIN_GAS` (100,000) and `MAX_GAS` (5,000,000) through `airdrop721WithGas` / `airdrop1155WithGas` /
  `airdrop20WithGas`. There is no constant that separates an honest receiver from a hostile one, so the
  default is a measured guess and the parameter is there for callers who know their recipients better.
  A stipend is refused in strict mode, which forwards everything: accepting it and ignoring it would
  describe a transaction that does not exist.
- safe (721 only): use `safeTransferFrom`, so contract recipients must implement `onERC721Received`.

A wallet skipped in lenient mode with an empty reason has either failed or run past the stipend; the two look
identical from outside. Raise the stipend, or send that one on its own in strict mode, where the whole
transaction's gas is available to it.

If a batch cannot afford to give every recipient its full stipend, the contract reverts `OutOfGasForBatch`
rather than silently skipping the last wallets and blaming them. That also keeps `eth_estimateGas` honest,
since "skip everyone" is no longer a cheaper way to succeed.

The zero address is refused as a recipient in both modes: burning a token is not something a bulk sender
should do by accident.

## Before you send

The page runs a free test run first: it simulates every batch against live chain state with `eth_call`,
so you learn exactly how many would be delivered before anything is signed. Some collections use a creator
transfer validator and only allow transfers through operators the creator approved; those cannot be moved by
any bulk sender, and the test run says so instead of wasting a transaction.

## The other half: Check

`web/check.html` is a separate read-only page, live at
[rhcheck.gmgnrepeat.com](https://rhcheck.gmgnrepeat.com/), built from the second request in the same
community thread: human-readable transaction previews and better contract verification. Paste a transaction
hash, a contract address, or the calldata a wallet is about to sign, and it says in a sentence what that does,
what would move, whether it would fail and why, and what powers the contract holds over the people who own it.

It signs nothing and writes nothing. Previews come from `eth_simulateV1`, which Robinhood Chain supports on
both networks and which returns the logs a call *would* emit, so the preview is what actually moves rather
than what the function is named. Where a contract has published no source, the powers are read from the
function selectors in its own bytecode, which is a floor rather than a ceiling, and the page says so.

The mainnet explorer answers browsers and challenges everything else, so the page's own Cloudflare Worker
carries a small read-only passthrough at `/x/<chain id>/<api path>`. When the explorer will not answer at all,
the page says the source status is unknown; it never reports "no source published" for a question it could
not ask.

    ./deploy-check.sh          # worker + origin copy, both verified
    cd /mnt/c/GMGNRepeat/baby-bananza-grand-prix && node test/web/check.test.mjs

## Networks

| | chain id | RPC | explorer |
|---|---|---|---|
| testnet | 46630 | https://rpc.testnet.chain.robinhood.com | https://explorer.testnet.chain.robinhood.com |
| mainnet | 4663 | https://rpc.mainnet.chain.robinhood.com | https://robinhoodchain.blockscout.com |

Gas token is ETH. Testnet faucet: https://faucet.testnet.chain.robinhood.com/ (browser only, blocks automation).

## Build and test

    forge build
    forge test -vv

Gas, measured on the live testnet rather than estimated: about 35k per recipient for a plain ERC-721
transfer, 38k with a receive hook, 32k for ERC-1155, 28k for ERC-20. BulkSend's own share of that is 2.0k to
2.9k, roughly 6 to 9%; the rest is the token's own transfer, which no batch sender can avoid.

**Delivery order matters more than any of that.** Collections built on ERC721A store ownership lazily, so
moving a token scans backwards through unwritten slots and charges the sender for it. The page therefore
delivers in ascending token id order, which makes each scan trivial. Measured on the live chain with the same
20 ids: descending 65,358 gas per recipient, ascending 54,615. On a freshly minted 200-token collection the
gap is wider still, and in lenient mode a descending list can push honest recipients past the per-transfer
allowance so they are skipped. Everyone still receives exactly the id listed for them; only the order changes.

## Deploy

    export RH_RPC=https://rpc.testnet.chain.robinhood.com
    forge script script/Deploy.s.sol:DeployBulkSend --rpc-url $RH_RPC --private-key $PK --broadcast
    forge verify-contract <address> src/BulkSend.sol:BulkSend --chain-id 46630 --rpc-url $RH_RPC \
      --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/

Testnet first, always. Rehearse on a local fork with no funds:

    anvil --fork-url $RH_RPC --port 8555
    cast rpc --rpc-url http://127.0.0.1:8555 anvil_setBalance <deployer> 0x8AC7230489E80000

## Reviews

Six internal reviews and one external audit run by a different model with no knowledge of how this was
built. The external audit returned 8 High, 4 Medium and 3 Low; all fifteen are fixed, and the tests name the
finding each one guards. Findings and what changed are recorded in the project's wiki page in the brain.
Nothing here has been reviewed by a human audit team.

Deployed on testnet 46630 at `0xC6AE3189eDAE544Ed60ADf5Ec057E338ce224F74`, source verified, runtime bytecode
byte-for-byte equal to a local build. Mainnet is deliberately not deployed.

## Keys

The deployer key is a throwaway with no value. It lives outside the repo in a 600-permission file
and is never committed. Nothing in this repo contains a secret.
