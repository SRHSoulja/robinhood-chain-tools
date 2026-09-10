# What is tested, what is not, and what is still open

Last updated 10 September 2026, against `cebe40c`.

This file exists so that the state of the project is readable from the repository rather than from anyone's
summary of it. Everything here is a count or a verdict that can be reproduced by running the command beside
it. Where something has not been tested, it says so; where a finding is open, it says so.

## The gate

**Testnet only. Mainnet is switched off in the page itself**, not by intent: the mainnet BulkSend address is
an unsubstituted `{{BULKSEND_MAINNET}}` placeholder, so `bulkReady()` is false and the send refuses there.

Two things have to be true before that changes, and both are currently false:

| | state |
| --- | --- |
| a review round with no release blockers | **not met** — round eleven found five, all now fixed, but the round that finds none has not happened |
| explicit permission from the maintainer, given after that round | **not given** |

Neither alone is enough. The deployer holds about 0.002 mainnet ETH that someone else sent, which is enough
for three deployments, which is exactly why the rule is written down: available is not permitted. Its mainnet
nonce is 0.

## What runs

```
./test.sh                              # everything below except the live scripts
forge test                             #  86 contract tests, plus 20 reviewer probes of which 5 must FAIL
node test/web/client.test.mjs          # 270 airdrop page tests
node test/web/check.test.mjs           # 116 Check page tests
```

The reviewer's probe files reproduce findings, so a probe that **fails** is a finding that is fixed. They are
kept rather than deleted, because they are the only thing that can tell a fix from a belief.

All green as of the commit above, run with four other agents on the same machine.

Three further scripts need the network and are deliberately outside `npm test`, because a test that depends on
a chain being up is not a test you want gating a commit:

```
node test/web/live-chain.mjs           # the real page, real testnet, four real token types
node test/web/live-send.mjs            # signs and sends a real airdrop, then asks the chain who owns what
node test/web/live-wallet-batch.mjs    # the no-approval path over a real EIP-7702 delegation
node test/web/live-send-all.mjs        # real ERC-1155 and ERC-20 airdrops, balances checked afterwards
```

All four were last run green against BulkSend v11 on 10 September 2026: 4, 10, 12 and 18 checks. Between
them, every one of the three standards has been delivered on chain through the current contract and the
balances read back afterwards.

live-send-all.mjs signs with a deliberately **undelegated** key. That is not incidental: an EIP-7702 upgraded
wallet has code, so a conforming ERC-1155 refuses to mint to it unless its delegate implements
`onERC1155Received`. The first run of that script failed on exactly this. It is a real constraint on upgraded
wallets, and the page already handles it: `upgradedWalletsThatCannotReceive` probes each recipient's delegate
and holds back the ones that would fail rather than reverting the batch.

They sign with a testnet-only key that holds no mainnet balance and refuse to run unless the chain id is
46630.

## What that actually proves

| | proven by | |
| --- | --- | --- |
| the contract cannot move what was not approved | `forge test`, and no owner or upgrade path exists to change it | ✅ |
| a batch of ERC-721 really lands | `live-send.mjs`, on chain, three fresh addresses | ✅ |
| the no-approval path really works with no approval | `live-wallet-batch.mjs`, on chain, BulkSend approved for nothing before or after | ✅ |
| the gas probe gets a sane answer from a real chain | `live-chain.mjs`, four token types | ✅ |
| deployed bytecode matches what this repository builds | v11, byte-identical, 18,276 chars, and verified on the explorer (not partially, compiler 0.8.36) | ✅ |
| the deployed pages match these files | `deploy/publish.sh` verifies the hash after publishing | ✅ |
| ERC-1155 batches really land | `live-send-all.mjs`, on chain: 3 recipients each holding 2 of an edition | ✅ |
| ERC-20 batches really land | `live-send-all.mjs`, on chain: 3 recipients each holding exactly 1.5, to the wei | ✅ |
| any of it against a real wallet extension | **never** — every wallet in every test is written by this repository | ❌ |
| behaviour on mainnet | **never, by design** | ❌ |

## Where the numbers come from

Gas figures in [`gas-and-batches.md`](gas-and-batches.md) are measured, not estimated, and the method is in
that file. The ERC-721 survey covers 58 collections live on mainnet; the ERC-20 survey covers 29 and the
ERC-1155 survey covers 6, which is every one that was findable and measurable. Six is not enough to describe
a distribution, only its top, and the file says so.

## Open findings

Round eleven, 9 September 2026, against `33c29e0`. The full report is
[`audit-2026-09-09-eleventh-external.md`](audit-2026-09-09-eleventh-external.md), published unedited.

Reproduction is by the reviewer's own probes, which are in the repository and can be re-run:

```
node test/web/audit-probe.mjs          # the airdrop page
node test/web/audit-probe-check.mjs    # the Check page
node test/web/audit-probe-check2.mjs   # the Check page, second set
forge test --match-path test/AuditProbe.t.sol
```

A finding is marked closed only when the probe that demonstrated it stops reproducing.

### Blocks release — all closed

| | | |
| --- | --- | --- |
| B-1 | a wallet's word released already-paid recipients for re-payment | closed |
| B-2 | de-prefixed calldata answered as "a plain transfer of ETH", in green | closed |
| B-3 | a transaction whose body could not be read described as a plain transfer | closed |
| B-4 | `chainId` read by nobody, so another chain's contract described as this one's | closed |
| B-5 | unsettled token standard written up as ERC-20 | closed |

### Should be fixed — 18 closed, 1 open

| | | |
| --- | --- | --- |
| S-4 | a hostile RPC could raise the batch cap above the un-measured fallback | closed |
| S-5 | the gas measurement was not re-taken when the list or the account changed | closed |
| S-15 | `value` not checked as a hex quantity, an ETH figure stated from it | closed |
| S-16 | the unlimited-approval warning missed `increaseAllowance` and `permit` | closed |
| S-17 | a refused input left the previous answer on screen | closed |
| S-1 | the NFT picker silently collapses a documented multi-id line | closed |
| S-2 | a stale wallet-batch record makes Send throw before the run lock is taken | closed |
| S-3 | "Review held rows" can never confirm an ERC-20 or ERC-1155 row | closed |
| S-6 | `onlyOnce` releases the button while the first request is still live | closed |
| S-7 | attacker-controlled revert text presented as the page's own words | closed |
| S-8 | a 404 from the explorer passthrough is replaced by our own page, unhardened | closed |
| S-9 | the explorer passthrough serves third-party HTML from this origin with no CSP | closed |
| S-10 | the publish CSP gate counts hashes and checks nothing else | **open** |
| S-11 | `/cdn-cgi/*` is answered before the Worker, so a claim in SECURITY.md is false | closed |
| S-12 | the contract counts a 721/1155 delivery without reading the call's return data | closed |
| S-13 | `ZERO_REASON` is the selector of an error this contract does not declare | closed |
| S-14 | smaller things, grouped (13 items) | closed |
| S-18 | `owner() == 0` stated as fact, its qualifier rendering in the other branch | closed |
| S-19 | smaller Check-page items (7 items) | closed |

### Inherent limits — 8, acknowledged not fixed

Things that cannot be engineered away in a browser, listed in the report's own section. Pretending otherwise
would be its own defect, so they are recorded rather than closed.

## Reproduction state, measured

Re-running every probe against the current commit:

| | still reproduces |
| --- | --- |
| Check page probes, set one | 0 of 21 |
| Check page probes, set two | 1 of 6 |
| Airdrop page probes | 8 of 23 |
| Contract probes | 15 of 20 |

`./verify.sh` runs all of the above in one command and compares those counts against
[`test/findings-baseline.json`](../test/findings-baseline.json), so a later fix that quietly reopens an
earlier finding fails rather than passing. `./preflight.sh` runs the cheap consistency checks on every commit.

The one left in the Check set is the page correctly stating that no function name in the published source
matched, which is true and is not a defect: the finding was the *combination* with an unqualified "nobody owns
it", and that half is fixed.

The contract line reads backwards on purpose. These probes reproduce findings, so 5 of the 20 assertions now
FAIL, and those five are the fixed ones. The 15 that still pass are the reviewer's checks on behaviour that was
already correct.

## History

Blocking findings by round: 15, 11, 5, 9, 9, 4, 6, 3, 4, 3, 5. Eleven rounds, each by a fresh model given the
code and no other context. Three times a fix from one round became the next round's finding, which is the
reason the newest code is always reviewed first.

The contract had been unchanged and clean for seven rounds. Round eleven ended that: S-12 and S-13 are real,
and chasing S-12 turned up a further case the review had not asked about, so BulkSend is now v11. That means
the contract is once again the newest code in the repository, reviewed by exactly one pass — mine. It should
go through a round before it goes anywhere near mainnet, and that round should see v11.
