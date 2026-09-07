# rh-airdrop

Two tools for [Robinhood Chain](https://robinhoodchain.com), built from two requests made by people in that
community. Both are free, both are open source, and neither takes a fee.

| | what it does | live | source |
|---|---|---|---|
| **BulkSend** | send an NFT or a token to hundreds of wallets in a few transactions | [rhairdrop.gmgnrepeat.com](https://rhairdrop.gmgnrepeat.com/) | `src/BulkSend.sol`, `web/index.html` |
| **Check** | read a transaction or a contract in plain English before you sign it | [rhcheck.gmgnrepeat.com](https://rhcheck.gmgnrepeat.com/) | `web/check.html` |

> **Testnet only.** `BulkSend` is deployed and verified on Robinhood Chain testnet (46630) and nowhere else.
> Mainnet is switched off in the page, in code, not just by intent. Check is read-only and works on both
> networks because it never signs anything.

---

## BulkSend

One contract, three functions. It holds nothing: every transfer is `transferFrom(msg.sender, …)`, so it can
only move what you approved, inside the transaction you signed. **No owner, no upgrade path, no fees, no
pause.** If you want it to stop, stop calling it.

Deployed at [`0x91949D7328387A3613b29E56f6979Ae893ccd23C`](https://explorer.testnet.chain.robinhood.com/address/0x91949D7328387A3613b29E56f6979Ae893ccd23C),
verified, runtime bytecode byte-for-byte equal to what this repository builds.

### Modes

- **All or nothing** (`lenient = false`): one bad recipient reverts the whole batch and nothing moves. The
  token's own error bubbles up, and each transfer gets the whole transaction's gas, so a recipient with an
  expensive receive hook still works. Only meaningful inside one transaction, so the page refuses to split a
  list across several in this mode.
- **Keep going** (`lenient = true`): a recipient that cannot receive is skipped, logged with a `Skipped` event
  carrying the revert reason, and the rest is delivered. The call returns `(sent, skipped)`.
- **Safe** (721 only): `safeTransferFrom`, so a contract recipient has to say it can hold NFTs. On by default.

### The gas stipend, and why it is a parameter

In "keep going" mode each transfer gets a limited amount of gas. Without a cap, EIP-150 hands a callee 63/64
of what is left, so one recipient whose hook burns everything starves the rest of the batch, which is exactly
what that mode promises not to do.

There is no number that separates an honest receiver from a hostile one. `DEFAULT_GAS` is 400,000, which is
comfortably above every honest recipient measured (OpenZeppelin ERC-721/1155, ERC721A crossing an
uninitialised ownership slot, smart-contract wallets). If your recipients are more expensive than that, the
`…WithGas` entry points take your own number between `MIN_GAS` (100,000) and `MAX_GAS` (5,000,000). A stipend
passed with all-or-nothing mode is refused rather than silently ignored, because that mode forwards everything
and accepting the number would describe a transaction that does not exist.

A wallet skipped with an empty reason has either failed or run past the stipend, and the two are
indistinguishable from outside. The page says exactly that instead of guessing.

### Cost

Measured on the live testnet, not estimated: about **35k gas per recipient** for a plain ERC-721 transfer, 38k
with a receive hook, 32k for ERC-1155, 28k for ERC-20. BulkSend's own share is 2.0k to 2.9k of that, roughly 6
to 9%; the rest is the token's own transfer, which no batch sender can avoid.

**Delivery order matters more than any of that.** Collections built on ERC721A store ownership lazily, so
moving a token scans backwards through unwritten slots and charges the sender for it. The page delivers in
ascending token id order, which makes each scan trivial. Measured on chain with the same 20 ids: descending
65,358 gas per recipient, ascending 54,615. On a freshly minted 200-token collection the gap is wider, and in
lenient mode a descending list can push honest recipients past the stipend so they are skipped. Everyone still
receives exactly the id listed for them; only the order changes.

### What it cannot promise

Every delivery this counts means the token's transfer function was called and did not fail. That is not the
same as somebody being paid. A contract that accepts the call, returns success and moves nothing looks
identical from the outside, and no on-chain check can tell the difference; a fee-on-transfer token delivers
less than the amount asked for while correctly returning `true`. The counter is a report of what was
attempted. The chain is the record of what happened, and the page links every batch to it.

What the contract does refuse is anything it can actually detect: an address with no code, a delegated wallet
posing as a token, itself as a recipient, the zero address, a zero amount, and an ERC-20 answer it cannot read
as either success or failure.

### Upgraded wallets, and what they can still receive

A wallet that has delegated under EIP-7702 has code. It is still that person's wallet, but a **safe** ERC-721
transfer calls `onERC721Received` on whatever it delegated to, and plenty of delegates do not implement it.
ERC-1155 has no unsafe transfer at all, so such a wallet cannot receive an edition from anybody.

Measured on Robinhood Chain against a delegated account:

| | delegated wallet with no receive hook |
|---|---|
| ERC-721 `transferFrom` | accepted |
| ERC-721 `safeTransferFrom` | refused, `ERC721InvalidReceiver` |
| ERC-1155 `safeTransferFrom` | refused, `ERC1155InvalidReceiver` |

This matters because EIP-7702 is live on Robinhood Chain mainnet and wallets do delegate, so these recipients
appear in ordinary holder lists looking exactly like ordinary wallets. The test run names them before anything
is signed, asks their delegate directly rather than guessing, and says the useful thing: for an NFT, untick the
safe-transfer box and a plain transfer reaches them; for an edition, nothing can be done from the sender's
side.

### Before you send

The page simulates every batch against live chain state with `eth_call` first, so you learn how many would be
delivered before anything is signed. Some collections use a creator transfer validator and only allow
transfers through operators the creator approved; no bulk sender can move those, and the test run says so
rather than wasting a transaction. If your wallet can run several calls as itself (EIP-5792), the page uses
that instead: no approval to grant, nothing to revoke, and validator-gated collections work.

### Sending twice is the thing to be afraid of

The page keeps a record, in your browser and for your account only, of what it has already delivered, keyed on
parsed values with an occurrence number so two identical lines are two payments rather than one. A batch that
was signed but never confirmed is written down **before** the wait and read back from the chain next time, so
closing the tab mid-airdrop does not mean paying everyone again; those recipients are held back until the
transaction can be read. There is a cross-tab lock. None of that can help another browser, another device, or
a cleared cache, and the page says so. What was actually sent is on the chain, and that is the record to
trust.

---

## Check

Paste a transaction hash, a contract address, the calldata your wallet is about to sign, or the whole JSON
blob a wallet shows under "raw data". It answers in a sentence.

- **A sent transaction:** what it did, what moved (decoded from the receipt's logs, with token names), the gas
  actually paid, and for a failure the contract's own reason in words, with its arguments.
- **A contract:** verified or not, proxy or not, token facts, current owner, whether transfers are paused, a
  creator transfer validator if one is set, and **what whoever controls it can do to the people holding it**:
  mint, burn yours, pause, blacklist, retax, replace the code. Read from the published ABI where there is one,
  and from the function selectors in the bytecode where there is not.
- **An unsent call:** what it means, plus a real `eth_simulateV1` run that reports the logs it *would* emit, so
  the preview is what actually moves rather than what the function is named. With the warnings that matter:
  unlimited approvals, `setApprovalForAll`, ownership changes, calls to an address with no code, and calls
  that would fail right now.

Three things it does that a block explorer does not: it previews a transaction that has not been sent, it
reads contracts that never published their source, and it shows which function names suggest the people behind
a contract can act on your holdings.

It is careful about the limits of all three. An explorer that will not answer is not a contract without a
source, so verification status is three-valued and "could not check" is reported as itself. A function name is
not a behaviour, so a name matching is worth showing and **nothing matching proves nothing at all** — the page
says so rather than printing an all-clear. And a transfer event is a contract announcing something, not proof
it happened, so the movement section is labelled for what it holds and silence is never reported as "nothing
moved".

---

## Build, test, deploy

    forge build
    forge test                 # 82 contract tests
    npm install && npm test    # 140 browser tests, every answer mocked, no network
    ./test.sh                  # all of it

The browser tests drive the real pages in headless Chromium and answer every RPC, explorer and price request
from the test file, so a failure is the page's fault and nothing else.

Deploying publishes each page as a Cloudflare Worker with the HTML inlined, so the live page is byte-identical
to the file in this repository:

    cp deploy/local.env.example deploy/local.env    # then fill it in; it is gitignored
    ./deploy/publish.sh airdrop
    ./deploy/publish.sh check

Contracts, testnet only:

    export RH_RPC=https://rpc.testnet.chain.robinhood.com
    forge script script/Deploy.s.sol:DeployBulkSend --rpc-url $RH_RPC --private-key $PK --broadcast
    forge verify-contract <address> src/BulkSend.sol:BulkSend --chain-id 46630 --rpc-url $RH_RPC \
      --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/

Rehearse against a fork with no funds first:

    anvil --fork-url $RH_RPC --port 8555
    cast rpc --rpc-url http://127.0.0.1:8555 anvil_setBalance <deployer> 0x8AC7230489E80000

## Networks

| | chain id | RPC | explorer |
|---|---|---|---|
| testnet | 46630 | https://rpc.testnet.chain.robinhood.com | https://explorer.testnet.chain.robinhood.com |
| mainnet | 4663 | https://rpc.mainnet.chain.robinhood.com | https://robinhoodchain.blockscout.com |

Gas token is ETH. Testnet faucet: https://faucet.testnet.chain.robinhood.com/ (browser only, blocks
automation). `eth_simulateV1` is available on both networks and returns the logs a call would emit, which is
what makes Check's previews real; `debug_traceCall` and `eth_createAccessList` are not exposed.

## Reviews

Six internal review passes and five external audits, each by a different model given the code and no other
context: 8/4/3, then 6/5/1, then 4/1/0, then 6/2/1, then 5/2/2 (High/Medium/Low). Every finding is fixed, and
all five are published unedited in [`docs/`](docs/) — including the first audit's
finding that a bug I had dismissed in a code comment as deliberate was in fact a double-payment path, and the
second's finding that the Check page was printing safety conclusions on the strength of function names.

No human audit firm has reviewed this. If you are reviewing it, start with
[`docs/for-reviewers.md`](docs/for-reviewers.md).

## Secrets

There are none in this repository, and there never have been: the history has been scanned for the deployer
key and for API tokens. Deploy configuration lives in `deploy/local.env`, which is gitignored; the deployer
key lives outside the repository in a 600-permission file. The WalletConnect project id in `web/index.html` is
public by design, as it is in every WalletConnect-enabled page.

## Licence

MIT, including the vendored dependencies under `lib/` (MIT and Apache-2.0, each with its own licence file).
