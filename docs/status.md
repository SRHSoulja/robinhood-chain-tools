# What is tested, what is not, and what is still open

Last updated 10 September 2026, against BulkSend **v12** and round twelve.

This file exists so that the state of the project is readable from the repository rather than from anyone's
summary of it. Everything here is a count or a verdict that can be reproduced by running the command beside
it. Where something has not been tested, it says so; where a finding is open, it says so.

## The gate

**Testnet only. Mainnet is switched off in the page itself**, not by intent: the mainnet BulkSend address is
an unsubstituted `{{BULKSEND_MAINNET}}` placeholder, so `bulkReady()` is false and the send refuses there.

Two things have to be true before that changes, and both are currently false:

| | state |
| --- | --- |
| a review round with no release blockers | **not met** — round twelve found one, now fixed, along with every one of its 18 should-fix items. The round that finds none has not happened |
| explicit permission from the maintainer, given after that round | **not given** |

Neither alone is enough. The deployer holds about 0.002 mainnet ETH that someone else sent, which is enough
for three deployments, which is exactly why the rule is written down: available is not permitted. Its mainnet
nonce is 0.

## What runs

```
./test.sh                              # everything below except the live scripts
forge test                             #  93 contract tests, plus 27 reviewer probes of which 7 must FAIL
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

All four were last run green against BulkSend **v12** on 10 September 2026: 4, 10, 12 and 18 checks, 44 in
total. Between them, every one of the three standards has been delivered on chain through the current
contract and the balances read back afterwards -- three NFTs to three fresh addresses, three recipients each
holding 2 of an ERC-1155 edition, and three each holding exactly 1.5 of an ERC-20, to the wei.

This matters more than usual for v12, because v12 changed the guard that decides whether a contract is an NFT
at all. Had that discrimination been backwards, every legitimate airdrop would now refuse, and no mocked suite
could have told me: a mock answers `ownerOf` however the test says to.

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
| deployed bytecode matches what this repository builds | v12, byte-identical, 8,968 bytes, and verified on the explorer (not partially, compiler 0.8.36) | ✅ |
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

Round twelve, 10 September 2026, against `59e979f`. The full report is
[`audit-2026-09-10-twelfth-external.md`](audit-2026-09-10-twelfth-external.md), published unedited. One
blocking finding, eighteen should-fix, six inherent limits.

Reproduction is by the reviewer's own probes, which are in the repository and can be re-run:

```
node test/web/audit-probe.mjs          # the airdrop page
node test/web/audit-probe-check.mjs    # the Check page
node test/web/audit-probe-check2.mjs   # the Check page, second set
node test/web/audit-probe-12.mjs       # round twelve
forge test --match-path 'test/Audit*.t.sol'
```

A finding is marked closed only when the probe that demonstrated it stops reproducing.

### Blocks release — closed

| | | |
| --- | --- | --- |
| B-1 | a transaction naming another chain is read against this one | closed |

B-1 is the same defect as round eleven's B-4, surviving on the reader nobody re-checked: the fix went onto the
single-call path and the batch renderer kept reading `env.chainId`, a field only a `wallet_sendCalls` envelope
has. Both readers now report their declared network under one name and the renderer reads that name.

### Should be fixed — 17 closed, 1 declined with its reason, 0 open

| | | |
| --- | --- | --- |
| S-1 | `tests` CI red for 8 commits; browser suites and bytecode check skipped | closed |
| S-2 | the live Check page was not this repository's | closed |
| S-3 | deployed runtime ≠ what this source builds | closed — **v12** deployed and verified |
| S-4 | `airdrop20` on an ERC-721 spends amounts as token ids | closed in v12 |
| S-5 | `_mustBeNft` refuses a bare-`require` ERC-721; probes `ids[0]` only | closed in v12 |
| S-6 | one `false` answer reverts the whole lenient ERC-20 batch | **declined**, reason below |
| S-7 | "Use these" silently deletes unreadable list lines | closed |
| S-8 | a quoted CSV works with a header row and fails without one | closed |
| S-9 | "would not switch" reported for a wallet that never answered | closed |
| S-10 | `readTransaction` validates neither `to` nor `from` | closed |
| S-11 | `arrivalsFromReceipt` reads the live account | closed |
| S-12 | `readBatchReceipt` reads the live form during reconciliation | closed |
| S-13 | the quoted cost carries none of the 1.35 margin; docs still say 1.15 | closed |
| S-14 | Send does not check the `signing` guard | closed |
| S-15 | the publish gate checks `script-src` and no other directive | closed |
| S-16 | origin-wide `cdnjs` grant; ethers from a third-party CDN | closed |
| S-17 | `integrity.yml` hashes bodies, so a header regression on `/` passes | closed |
| S-18 | six small items, grouped | closed |

Every one of the other seventeen is closed, and each was closed against the probe or the test that
demonstrated it rather than against an argument that it should now be fine. Four of them needed a test written
first, because the fix could not otherwise be told from a belief: S-12 and S-14 were reasoned from source with
no probe, S-9's existing test asserted the wrong sentence, and S-13's probe read the measurement rather than
the figure the page works from.

**S-6, declined.** The reviewer's reasoning is sound: ERC-20 defines `false` as "I did not transfer", so a
conforming token answering it has moved nothing, and one blocklisted recipient should not cost a 400-row
lenient batch. It is declined because this repository's own fixture disproves the premise — `PaysThenLies20`
moves the balance and *then* answers `false`, and from inside the call nothing separates it from a refusal
short of reading every balance before and after. Reporting a payment that happened as a skip is how a re-run
pays someone twice. The choice, its cost, and what would have to change to revisit it are written up in
[`for-reviewers.md`](for-reviewers.md) decision 3, and both halves are pinned by tests, so a later round that
wants to change it has to say what new information separates the two shapes.

Three of the four most serious findings in this round were process failures from the same night the code was
written: a fix applied to one path and not its twin, CI red for eight commits because deliberately-failing
probe files were added and the watcher never run, and a page committed but never deployed. None of them were
subtle. All three now have an automatic guard, in `preflight.sh` and `verify.sh`.

### Inherent limits — 6, acknowledged not fixed

Things that cannot be engineered away in a browser, listed in the report's own section. Pretending otherwise
would be its own defect, so they are recorded rather than closed.

### Round eleven, 9 September 2026 — all closed

Kept for the record. The full report is
[`audit-2026-09-09-eleventh-external.md`](audit-2026-09-09-eleventh-external.md).

Five blockers: a wallet's word released already-paid recipients for re-payment; de-prefixed calldata answered
as "a plain transfer of ETH", in green; a transaction whose body could not be read described as a plain
transfer; `chainId` read by nobody; an unsettled token standard written up as ERC-20. All five closed, and all
nineteen should-fix items closed with them.

## Reproduction state, measured

Re-running every probe against the current commit:

| | still reproduces |
| --- | --- |
| Check page probes, set one | 0 of 21 |
| Check page probes, set two | 1 of 6 |
| Airdrop page probes | 8 of 23 |
| Contract probes, round eleven | 15 of 20 |
| Contract probes, round twelve | 5 of 7 |
| Round twelve browser probes | 0 of 10 |

`./verify.sh` runs all of the above in one command and compares those counts against
[`test/findings-baseline.json`](../test/findings-baseline.json), so a later fix that quietly reopens an
earlier finding fails rather than passing. `./preflight.sh` runs the cheap consistency checks on every commit.

The one left in the Check set is the page correctly stating that no function name in the published source
matched, which is true and is not a defect: the finding was the *combination* with an unqualified "nobody owns
it", and that half is fixed.

The contract lines read backwards on purpose. These probes reproduce findings, so the assertions that now
FAIL are the fixed ones -- five from round eleven, two from round twelve. The rest are the reviewers' checks on
behaviour that was already correct.

`verify.sh` compares each probe file separately and **fails on a probe file the baseline has never heard of**.
That is not hypothetical tidiness: round twelve's probe file sat in the repository unwatched, because the
comparison named `AuditProbe.t.sol` specifically rather than every `test/Audit*.t.sol`.

## History

Blocking findings by round: 15, 11, 5, 9, 9, 4, 6, 3, 4, 3, 5, 1. Twelve rounds, each by a fresh model given
the code and no other context. Five times a fix from one round became the next round's finding, which is the
reason the newest code is always reviewed first.

The contract had been unchanged and clean for seven rounds. Round eleven ended that, and round twelve found
three more things in it, so BulkSend is now **v12**. That makes the contract once again the newest code in the
repository, and v12 in particular has been reviewed by exactly one pass -- mine. It should go through a round
before it goes anywhere near mainnet, and that round should see v12.

Round twelve's own shape is the argument for that rule. Its single blocker and two of its three most serious
should-fix items were written the night before it ran: a fix applied to one reader and not its twin, a CI job
left red for eight commits, and a page committed but never deployed. None were subtle, and none would have
been caught by thinking harder -- only by a check that runs. All three now have one.
