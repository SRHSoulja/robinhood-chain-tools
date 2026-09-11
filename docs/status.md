# What is tested, what is not, and what is still open

Last updated 10 September 2026, against BulkSend **v13** and round thirteen.

This file exists so that the state of the project is readable from the repository rather than from anyone's
summary of it. Everything here is a count or a verdict that can be reproduced by running the command beside
it. Where something has not been tested, it says so; where a finding is open, it says so.

## The gate

**Testnet only. Mainnet is switched off in the page itself**, not by intent: the mainnet BulkSend address is
an unsubstituted `{{BULKSEND_MAINNET}}` placeholder, so `bulkReady()` is false and the send refuses there.

Two things have to be true before that changes, and both are currently false:

| | state |
| --- | --- |
| a review round with no release blockers | **not met** — round thirteen found two, both fixed, along with every one of its seven should-fix items. The round that finds none has not happened |
| explicit permission from the maintainer, given after that round | **not given** |

Neither alone is enough. The deployer holds about 0.002 mainnet ETH that someone else sent, which is enough
for three deployments, which is exactly why the rule is written down: available is not permitted. Its mainnet
nonce is 0.

## What runs

```
./test.sh                              # everything below except the live scripts
forge test                             # 110 contract tests, plus 29 reviewer probes of which 9 must FAIL
node test/web/client.test.mjs          # 319 airdrop page tests
node test/web/check.test.mjs           # 122 Check page tests
./test/csp-gate.test.sh                #  21 checks that a weaker published CSP is refused
forge test --match-path 'test/fork/MainnetGuards.t.sol'   # the paste guards against 20 real mainnet
                                       #   collections and 20 real tokens, on a read-only fork
```

The 110 include `test/Invariants.t.sol`: a handler drives all three paths with random lists, 2,304 calls per
run, and after every one the contract must still satisfy *sent + skipped == rows*, *sent means it moved*, and
*BulkSend holds nothing*. Branch coverage of `src/BulkSend.sol` is 100% (58 of 58); it was 82% before v13's
tests were written, and the missing arms were all on the ERC-1155 and ERC-20 paths.

`./verify.sh` runs all of that, plus every probe file, and compares the probe counts against
[`test/findings-baseline.json`](../test/findings-baseline.json). It **fails on a probe file the baseline has
never heard of**, because twice now a probe file has been added and watched by nothing.

The reviewer's probe files reproduce findings, so a probe that **fails** is a finding that is fixed. They are
kept rather than deleted, because they are the only thing that can tell a fix from a belief.

All green as of the commit above, run with four other agents on the same machine.

Four further scripts need the network and are deliberately outside `npm test`, because a test that depends on
a chain being up is not a test you want gating a commit:

```
node test/web/live-chain.mjs           # the real page, real testnet, four real token types
node test/web/live-send.mjs            # signs and sends a real airdrop, then asks the chain who owns what
node test/web/live-wallet-batch.mjs    # the no-approval path over a real EIP-7702 delegation
node test/web/live-send-all.mjs        # real ERC-1155 and ERC-20 airdrops, balances checked afterwards
```

All four were last run green against BulkSend **v12** on 10 September 2026: 4, 10, 12 and 18 checks, 44 in
total. **All four ran green against v13 the same day**, right after it was deployed: 4, 10, 18 and 12 checks. And
every transaction they sent was then read back from the **block explorer**, which decodes against the verified
ABI independently of this repository's own receipt parsing: `airdrop721` with `Airdrop721` and three
`Transfer`s, `airdrop1155` with `Airdrop1155` and three `TransferSingle`s, `airdrop20` with `Airdrop20` and
three `Transfer`s, all to `0xf2eD…9232`, and the no-approval path as one `execute` from the delegated account
carrying three `Transfer`s with BulkSend nowhere in it. Between them, every one of the three standards has been delivered on chain through the current
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
| deployed bytecode matches what this repository builds | v13, byte-identical, 9,752 bytes, fully verified on the explorer (compiler 0.8.36, cancun, 10,000 runs) | ✅ |
| the paste guards agree with real mainnet contracts | `test/fork/MainnetGuards.t.sol` on a read-only fork: 20 real collections refused by the ERC-20 guard and accepted by the NFT guard, 20 real tokens accepted; v12's guard let 20 of 20 through | ✅ |
| the contract's properties hold over random sequences, all three standards | `test/Invariants.t.sol`, 2,304 calls, 0 reverts | ✅ |
| the deployed pages match these files | `deploy/publish.sh` verifies the hash after publishing | ✅ |
| ERC-1155 batches really land | `live-send-all.mjs`, on chain: 3 recipients each holding 2 of an edition | ✅ |
| ERC-20 batches really land | `live-send-all.mjs`, on chain: 3 recipients each holding exactly 1.5, to the wei | ✅ |
| any of it against a real wallet extension, automatically | **no** — every wallet in every test here is written by this repository | ❌ |
| any of it against a real wallet extension, by hand | **yes, once** — the maintainer drove the page from a phone with MetaMask and it worked. That was against an earlier BulkSend, before v10, so it is evidence about the page and not about the contract now deployed. Not repeated since, deliberately: more of it is worth doing when the software is otherwise finished, not while it is still changing under the tester | ⚠️ |
| behaviour on mainnet | **never, by design** | ❌ |

## Reading the testnet deployer's activity

The deployer and the test wallets are **shared with unrelated work**: the maintainer also mints and moves NFTs
on this testnet for a game being tested. So on chain 46630, expect balances, nonces and gas to move for
reasons that have nothing to do with this project, and expect tokens in these collections that this repository
did not create.

Nothing here may touch them, and nothing here can:

- every live script **mints the tokens it sends**, in its own decade of the id space
  (`live-send.mjs` from 7,000,000,000,000 and `live-wallet-batch.mjs` from 8,000,000,000,000, each plus the
  millisecond it started). Minting an id that already exists reverts, so a collision fails the run rather than
  moving a token the run did not create. `preflight.sh` refuses a live script with hardcoded ids.
- nothing in this repository enumerates what a wallet already holds and sends it. The NFT picker reads
  holdings, but only in the browser suites, against a wallet this repository writes.

The practical consequence for anyone reading a balance here: **a change in testnet gas or nonce is not a signal
about this project.** Mainnet is the one to watch, and it is at nonce 0.

## Where the numbers come from

Gas figures in [`gas-and-batches.md`](gas-and-batches.md) are measured, not estimated, and the method is in
that file. The ERC-721 survey covers 58 collections live on mainnet; the ERC-20 survey covers 29 and the
ERC-1155 survey covers 6, which is every one that was findable and measurable. Six is not enough to describe
a distribution, only its top, and the file says so.

## Open findings

Round thirteen, 10 September 2026, against `f4f5ca6`. The full report is
[`audit-2026-09-10-thirteenth-external.md`](audit-2026-09-10-thirteenth-external.md), published unedited.
Two blocking findings, seven should-fix, one inherent limit.

Reproduction is by the reviewer's own probes, which are in the repository and can be re-run:

```
node test/web/audit-probe.mjs          # the airdrop page, round eleven
node test/web/audit-probe-check.mjs    # the Check page
node test/web/audit-probe-check2.mjs   # the Check page, second set
node test/web/audit-probe-12.mjs       # round twelve
node test/web/audit-probe-13.mjs       # round thirteen
forge test --match-path 'test/Audit*.t.sol'
```

A finding is marked closed only when the probe that demonstrated it stops reproducing.

### Blocks release — 2, both closed

| | | |
| --- | --- | --- |
| B-1 | `_mustNotBeNft` probed one id where its twin probed three; NFTs spent as ERC-20 amounts | closed in **v13**, and proven on chain: the same paste is refused with `IsAnNft` ([`0x5b46a00557…`](https://explorer.testnet.chain.robinhood.com/tx/0x5b46a00557302eb7ec212a655e10e0d77707ba1b2d115076a2559fb656aae851)) |
| B-2 | nothing written down until the wallet answers; a batch lost with the tab is paid twice | closed |

B-1 was proven on chain against v12, not only in a test: one transaction recorded two ERC-721 `Transfer`
events and an `Airdrop20(sent 2, skipped 1)`. v13 makes the guard the same shape as its twin and then goes
one further: it also asks `isApprovedForAll(address,address)`, which every ERC-721 and ERC-1155 must have and
no ERC-20 has, so the answer no longer depends on which ids the sender typed. The same paste against v13 is
refused with `IsAnNft` on chain against v13, read back from the explorer: the revert decoded, no log emitted,
both ids still with the sender. That is the check that closes it.

B-2 is closed by writing the pending record *before* the wallet is asked and dropping it only on a definite
rejection. Its probe had to be repaired first: it answered a two-value function with one value, so the page
never signed and the probe measured nothing.

### Should be fixed — 7, all closed

| | | |
| --- | --- | --- |
| S-1 | every headed CSV refused by "Use these" and "Assign" | closed, plus a third instance in `applyWeight` the round did not find |
| S-2 | `deliveriesOn` took the column map and never read it | closed |
| S-3 | CI ran none of `verify.sh`, the CSP gate or `preflight.sh` | closed; proven by reopening a finding on a branch and watching CI go red |
| S-4 | a low estimate understated the quoted cost about 3x while labelled "at most" | closed: "about" for the measurement, a real ceiling row |
| S-5 | Check simulated a call whose calldata it could not read | closed |
| S-6 | `SECURITY.md`'s "approves the exact batch total" false for ERC-721 and ERC-1155 | closed |
| S-7 | 9 of the contract's 15 errors reached the user as a bare selector | closed on the airdrop page in the round; **closed on the Check page afterwards**, where the same three newest errors were still unnamed, and `preflight.sh` now reads both pages |

Six of the seven were one reader being taught something its twin was not, and the round said so. The
answer is [`readers.md`](readers.md): every function that reads the recipient box and the contract's two
paste guards, listed, so a fix to one is checked against the others, and the rule that a commit fixing a
reader names its twins.

### Inherent limits — 1

I-1: one RPC endpoint is the sole witness for every "arrived", "skipped" and "held" verdict. That cannot be
engineered away in a browser page; it is disclosed, not solved.

### Round twelve, 10 September 2026 — all closed, one declined

Kept for the record. The full report is
[`audit-2026-09-10-twelfth-external.md`](audit-2026-09-10-twelfth-external.md). One blocker (a transaction
naming another chain read against this one: round eleven's B-4 surviving on the reader nobody re-checked),
seventeen should-fix closed, and S-6 declined with its reason: a returned `false` from an ERC-20 still reverts
the whole lenient batch, because this repository's own fixture `PaysThenLies20` moves the balance and *then*
answers `false`, and reporting a payment that happened as a skip is how a re-run pays someone twice. The
choice is written up in [`for-reviewers.md`](for-reviewers.md) decision 3 and pinned by tests in both
directions.

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
| Contract probes, round eleven | 14 of 20 |
| Contract probes, round twelve | 5 of 7 |
| Contract probes, round thirteen | 1 of 2, and the 1 is a control that passes either way |
| Round twelve browser probes | 0 of 10 |
| Round thirteen browser probes | 0 of 6 |

`./verify.sh` runs all of the above in one command and compares those counts against
[`test/findings-baseline.json`](../test/findings-baseline.json), so a later fix that quietly reopens an
earlier finding fails rather than passing. `./preflight.sh` runs the cheap consistency checks on every commit.

The one left in the Check set is the page correctly stating that no function name in the published source
matched, which is true and is not a defect: the finding was the *combination* with an unqualified "nobody owns
it", and that half is fixed.

The contract lines read backwards on purpose. These probes reproduce findings, so the assertions that now
FAIL are the fixed ones -- six from round eleven, two from round twelve, one from round thirteen. The rest are the reviewers' checks on
behaviour that was already correct.

`verify.sh` compares each probe file separately and **fails on a probe file the baseline has never heard of**.
That is not hypothetical tidiness: round twelve's probe file sat in the repository unwatched, because the
comparison named `AuditProbe.t.sol` specifically rather than every `test/Audit*.t.sol`.

## History

Blocking findings by round: 15, 11, 5, 9, 9, 4, 6, 3, 4, 3, 5, 1, 2. Thirteen rounds, each by a fresh model
given the code and no other context. Six times a fix from one round became the next round's finding, which
is the reason the newest code is always reviewed first.

The contract had been unchanged and clean for seven rounds. Round eleven ended that, round twelve found three
more things in it, and round thirteen found that round twelve's own guard was not the mirror it claimed to be.
BulkSend is now **v13**, deployed and verified. It has been through every mechanical check this repository
has -- 100% branch coverage, invariants, Slither, the fork suite against real mainnet contracts -- and
through no reviewer. It should go through a round before it goes anywhere near mainnet, and that round sees
v13.

Round twelve's own shape is the argument for that rule. Its single blocker and two of its three most serious
should-fix items were written the night before it ran: a fix applied to one reader and not its twin, a CI job
left red for eight commits, and a page committed but never deployed. None were subtle, and none would have
been caught by thinking harder -- only by a check that runs. All three now have one.
