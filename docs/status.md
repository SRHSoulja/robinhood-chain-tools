# What is tested, what is not, and what is still open

Last updated 9 September 2026, against `e379490`.

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
forge test                             #  82 contract tests
node test/web/client.test.mjs          # 257 airdrop page tests
node test/web/check.test.mjs           # 116 Check page tests
```

All green as of the commit above, run with four other agents on the same machine.

Three further scripts need the network and are deliberately outside `npm test`, because a test that depends on
a chain being up is not a test you want gating a commit:

```
node test/web/live-chain.mjs           # the real page, real testnet, four real token types
node test/web/live-send.mjs            # signs and sends a real airdrop, then asks the chain who owns what
node test/web/live-wallet-batch.mjs    # the no-approval path over a real EIP-7702 delegation
```

They sign with a testnet-only key that holds no mainnet balance and refuse to run unless the chain id is
46630.

## What that actually proves

| | proven by | |
| --- | --- | --- |
| the contract cannot move what was not approved | `forge test`, and no owner or upgrade path exists to change it | ✅ |
| a batch of ERC-721 really lands | `live-send.mjs`, on chain, three fresh addresses | ✅ |
| the no-approval path really works with no approval | `live-wallet-batch.mjs`, on chain, BulkSend approved for nothing before or after | ✅ |
| the gas probe gets a sane answer from a real chain | `live-chain.mjs`, four token types | ✅ |
| deployed bytecode matches what this repository builds | byte-identical, 16,330 chars, checked in round eleven | ✅ |
| the deployed pages match these files | `deploy/publish.sh` verifies the hash after publishing | ✅ |
| ERC-1155 and ERC-20 batches really land | **only against mocks** | ❌ |
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

### Should be fixed — 5 closed, 14 open

| | | |
| --- | --- | --- |
| S-4 | a hostile RPC could raise the batch cap above the un-measured fallback | closed |
| S-5 | the gas measurement was not re-taken when the list or the account changed | closed |
| S-15 | `value` not checked as a hex quantity, an ETH figure stated from it | closed |
| S-16 | the unlimited-approval warning missed `increaseAllowance` and `permit` | closed |
| S-17 | a refused input left the previous answer on screen | closed |
| S-1 | the NFT picker silently collapses a documented multi-id line | **open** |
| S-2 | a stale wallet-batch record makes Send throw before the run lock is taken | **open** |
| S-3 | "Review held rows" can never confirm an ERC-20 or ERC-1155 row | **open** |
| S-6 | `onlyOnce` releases the button while the first request is still live | **open** |
| S-7 | attacker-controlled revert text presented as the page's own words | **open** |
| S-8 | a 404 from the explorer passthrough is replaced by our own page, unhardened | **open** |
| S-9 | the explorer passthrough serves third-party HTML from this origin with no CSP | **open** |
| S-10 | the publish CSP gate counts hashes and checks nothing else | **open** |
| S-11 | `/cdn-cgi/*` is answered before the Worker, so a claim in SECURITY.md is false | **open** |
| S-12 | the contract counts a 721/1155 delivery without reading the call's return data | **open** |
| S-13 | `ZERO_REASON` is the selector of an error this contract does not declare | **open** |
| S-14 | smaller things, grouped (13 items) | **open** |
| S-18 | `owner() == 0` stated as fact, its qualifier rendering in the other branch | **open** |
| S-19 | smaller Check-page items (5 items) | **open** |

### Inherent limits — 8, acknowledged not fixed

Things that cannot be engineered away in a browser, listed in the report's own section. Pretending otherwise
would be its own defect, so they are recorded rather than closed.

## Reproduction state, measured

Re-running every probe against the current commit:

| | still reproduces |
| --- | --- |
| Check page probes | 3 of 21 |
| Airdrop page probes | 14 of 23 |
| Contract probes | 20 of 20 |

The contract line is not a pass. S-12 and S-13 have not been touched, so those assertions still hold.

## History

Blocking findings by round: 15, 11, 5, 9, 9, 4, 6, 3, 4, 3, 5. Eleven rounds, each by a fresh model given the
code and no other context. Three times a fix from one round became the next round's finding, which is the
reason the newest code is always reviewed first.
