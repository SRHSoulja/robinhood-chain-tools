# What to look at, and how to run it

## The thing that matters

`src/BulkSend.sol`, about 300 lines. It is deployed at
[`0x91949D7328387A3613b29E56f6979Ae893ccd23C`](https://explorer.testnet.chain.robinhood.com/address/0x91949D7328387A3613b29E56f6979Ae893ccd23C)
on Robinhood Chain testnet, verified, and its runtime bytecode is byte-for-byte equal to what this repository
builds. Check that yourself:

    forge build
    cast code 0x91949D7328387A3613b29E56f6979Ae893ccd23C --rpc-url https://rpc.testnet.chain.robinhood.com
    # compare with out/BulkSend.sol/BulkSend.json -> deployedBytecode.object

The two pages under `web/` are what people actually use, and the live copies are byte-identical to the files
here:

    curl -s https://rhairdrop.gmgnrepeat.com/ | cmp - web/index.html
    curl -s https://rhcheck.gmgnrepeat.com/   | cmp - web/check.html

## Running everything

    forge test                    # 82 contract tests
    npm install && npm test       # 140 browser tests, all answers mocked, no network
    ./test.sh                     # both of the above

The browser tests answer every RPC, explorer and price request from the test file itself, so a failure is the
page's fault and nothing else. Many test names begin with an audit finding id; that test is what stops the
finding coming back.

## What is in scope

- `src/BulkSend.sol` — the contract. No owner, no upgrade path, no fees, no pause, no stored state. Every
  transfer is `transferFrom(msg.sender, …)`.
- `web/index.html` — the airdrop page. Builds and sends batches. This is where the double-payment and
  silent-underpayment risks live, and where the previous audit found most of its High findings.
- `web/check.html` — a read-only page. Signs nothing, sends nothing, writes nothing.
- `deploy/publish.sh` — builds a Cloudflare Worker with the page inlined and uploads it.

## What is deliberately not in scope

- `lib/` — vendored dependencies (OpenZeppelin, ERC721A, forge-std), used only by the tests and by the
  rehearsal tokens. They are committed rather than fetched as submodules so that the source which produced
  the deployed bytecode is present in the repository, with no version to resolve and nothing to drift.
- `src/research/` — two EIP-7702 proof contracts. Not deployed, not referenced by anything, not part of the
  tool. See the README in that directory.
- `script/Rehearsal.s.sol` and `test/RealTokens.sol` — throwaway testnet tokens and hostile fixtures.

## Design decisions worth arguing with

These are choices, not accidents, and a reviewer disagreeing with one is useful.

1. **Ownerless and with no rescue function.** Assets sent to the contract by mistake are gone. The contract
   refuses itself as a recipient in all three methods, and the page refuses it before parsing finishes, which
   is a cheaper fix than a privileged role.
2. **The zero address is refused, never burned.** Strict mode reverts, lenient mode skips and logs.
3. **Ambiguous ERC-20 results revert the whole batch, in both modes.** Reporting a possible payment as a skip
   is worse than failing.
4. **The stipend is bounded, not free.** A caller can choose 100,000 to 5,000,000 gas per transfer, and
   nothing outside that. Unlimited per-transfer gas is strict mode by another name.
5. **`localStorage` is a convenience, never a guarantee.** It is scoped to chain, account, token and standard,
   keyed on parsed values with an occurrence number, backed by a cross-tab lock, and it reconciles unconfirmed
   transactions against the chain before it trusts itself. It still cannot help another browser or device, and
   the page says so.
6. **Delivery is in ascending token id order.** It is much cheaper on lazily-minted collections, and it means a
   partial run favours the wallets holding lower ids. The confirmation says that in those words.

## Previous review

- Six internal review passes.
- Five external audits, each by a different model with no prior context, all published unedited:
  [the first](audit-2026-09-06-external.md) (8 High, 4 Medium, 3 Low),
  [the second](audit-2026-09-06-second-external.md) (6 High, 5 Medium, 1 Low),
  [the third](audit-2026-09-06-third-external.md) (4 High, 1 Medium) and
  [the fourth](audit-2026-09-06-fourth-external.md) (6 High, 2 Medium, 1 Low) and
  [the fifth](audit-2026-09-06-fifth-external.md) (5 High, 2 Medium, 2 Low). All fixed.
- No human audit firm has looked at this.
