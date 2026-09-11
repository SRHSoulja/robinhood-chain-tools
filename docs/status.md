# What is tested, what is not, and what is still open

Last updated 11 September 2026, against BulkSend **v13** and round seventeen.

This file exists so that the state of the project is readable from the repository rather than from anyone's
summary of it. Everything here is a count or a verdict that can be reproduced by running the command beside
it. Where something has not been tested, it says so; where a finding is open, it says so.

## The gate

**Testnet only. Mainnet is switched off in the page itself**, not by intent: the mainnet BulkSend address is
an unsubstituted `{{BULKSEND_MAINNET}}` placeholder, so `bulkReady()` is false and the send refuses there.

Four things have to be true before that changes, and all are currently false:

| | state |
| --- | --- |
| a review round with no release blockers | **not met** — round fifteen found five. B-01 through B-04 have focused regressions and fixes in the current working tree; the live-page mismatch cannot close until the exact remediation commit receives a clean independent review and is published. A fresh exact-commit round still has to find none |
| a production mainnet RPC plan | **not met** — the page names Robinhood's free public endpoint, which [the official documentation](https://docs.robinhood.com/chain/connecting/) calls rate-limited and not recommended for production. Choose a production provider, keep credentials out of the page, and monitor/fail over reads before enabling mainnet |
| a current real-wallet rehearsal on testnet | **not met** — the v13 live scripts are green, but their wallets are written by this repository. The one manual MetaMask run predates v10. Run the final page through an injected wallet and the phone/WalletConnect path on testnet once each |
| explicit permission from the maintainer, given after that round | **not given** |

No one item alone is enough. The deployer holds about 0.002 mainnet ETH that someone else sent, which is enough
for three deployments, which is exactly why the rule is written down: available is not permitted. Its mainnet
nonce is 0.

Current unreleased validation, 11 September 2026: the complete current-tree gate passed all five ordinary
contract test files, 348/348 airdrop-page tests, 129/129 Check-page tests, and 21/21 publish-policy checks.
Every historical probe is now bound both to its complete source hash and to its exact assertion names and
statuses; an ordinary Solidity failure can no longer hide by borrowing a probe-style function name. The
reproducible WalletConnect rebuild matched its shipped and expected SHA-256. The separate read-only mainnet
fork also passed all four tests: 20/20 real
ERC-721 collections were accepted by the NFT guard and refused by the ERC-20 guard, and 20/20 real ERC-20
tokens were accepted. No transaction was signed or broadcast and no ETH was spent.

## What runs

```
./test.sh                              # everything below except the live scripts
forge test                             # 111 contract tests, plus 29 reviewer probes of which 9 must FAIL
node test/web/client.test.mjs          # 348 airdrop page tests
node test/web/check.test.mjs           # 129 Check page tests
./test/csp-gate.test.sh                #  21 checks that a weaker published CSP is refused
forge test --match-path 'test/fork/MainnetGuards.t.sol'   # the paste guards against 20 real mainnet
                                       #   collections and 20 real tokens, on a read-only fork
```

The 111 include `test/Invariants.t.sol`: a handler drives all three paths with random lists, 2,304 calls per
run, and after every one the contract must still satisfy *sent + skipped == rows*, *sent means it moved*, and
*BulkSend holds nothing*. Branch coverage of `src/BulkSend.sol` is 100% (58 of 58); it was 82% before v13's
tests were written, and the missing arms were all on the ERC-1155 and ERC-20 paths.

`./verify.sh` runs all of that, plus every probe file, and compares the exact probe-file manifest, exact
counts, and fingerprints of every probe assertion's name and status against
[`test/findings-baseline.json`](../test/findings-baseline.json). It also pins the complete browser-suite files.
A deleted or renamed probe, a lower count, or one reopened finding cancelling one newly fixed finding now
fails. Any evidence change requires an explicit reviewed baseline update.

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
| the deployed pages match these files | **yes** since the round-sixteen commit `4cc8a1c` was published: both HTML pages and `wc.js` byte-identical, checked by the publisher, by an independent fetch, by round seventeen's reviewer, and by the integrity workflow four times a day | ✅ |
| ERC-1155 batches really land | `live-send-all.mjs`, on chain: 3 recipients each holding 2 of an edition | ✅ |
| ERC-20 batches really land | `live-send-all.mjs`, on chain: 3 recipients each holding exactly 1.5, to the wei | ✅ |
| any of it against a real wallet extension, automatically | **no** — every wallet in every test here is written by this repository | ❌ |
| any of it against a real wallet extension, by hand | **yes, four runs on 11 September 2026** against the published page and v13, from the maintainer's own wallet: ERC-721, ERC-1155 and ERC-20 from a browser wallet and ERC-721 from a phone over WalletConnect with the tab backgrounded; every hash read back from the explorer and the chain agrees with the page ([`real-wallet-run.md`](real-wallet-run.md)) | ✅ |
| a real broadcast transaction on mainnet | **never, by design**; current evidence is read-only calls and local fork execution only | ❌ |

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

Round seventeen, 11 September 2026, against `4cc8a1c`. The full report is
[`audit-2026-09-11-seventeenth-external.md`](audit-2026-09-11-seventeenth-external.md), published as written.
**No release blocker**, the first round of seventeen to find none. Eleven should-fix items, six inherent
limits. Its probe file is `test/web/audit-probe-17.mjs` (the reviewer named it `audit-probe-14`; kept under
the round's number like the others).

### Round seventeen should-fix

| | | |
| --- | --- | --- |
| S-1 | Assign captured six inputs before it waited; "How many each" was the seventh | closed: captured and compared like the others, regression beside the round-sixteen one |
| S-3 | the bulk send hung, form locked, when the wallet's RPC could not look up the transaction it had just broadcast; the hash it returned was never written down | closed: the hash comes straight from `eth_sendTransaction`, is recorded at once, and the receipt is awaited on this page's own RPC; a replaced transaction times out and its rows are held, which is the safe direction |
| S-4 | three early returns left the holder-snapshot button dead | closed: `finally` |
| S-9 | four documents described the state two commits ago | closed |
| S-8 | the mainnet gate list was short by two items the code depends on | recorded as gates in `plan.md`: an explorer that answers this origin on mainnet (today the mainnet explorer answers the worker with a Cloudflare challenge, so Assign's fallback, holder snapshots and Check's source verification would be dark there), proven by an integrity step; and the wallet-RPC dependence, which S-3 removes from the send path |
| S-2, S-5, S-6, S-7, S-10, S-11 | Assign re-pairs an already-paired list without asking; a zero-address line stops Assign without being named; `x0` read as one delivery by the picker and refused by Assign; the snapshot records the network after its wait; Check's "why it failed" can be today's reason presented as then's; a second tab's reconciliation waits silently on the first | **open**; none is a fund path, and the reviewer says so |

Round sixteen, 11 September 2026, against `ebc910b`. The full report is
[`audit-2026-09-11-sixteenth-external.md`](audit-2026-09-11-sixteenth-external.md), published as written.
One release blocker, two should-fix findings, and it re-checked every round-fifteen blocker and found each
closed.

### Round sixteen release blocker

| | | |
| --- | --- | --- |
| R16-B01 | an older asynchronous Assign completion overwrote newer recipient input and re-armed Send | **closed** against the reviewer's own delayed-RPC reproduction, which is in `client.test.mjs` and failed before the fix: Assign captures the box, token, standard, account, network and pairing setting before its first await and refuses to write if any of them changed; a newer Assign supersedes an older one |

Twins of that reader, enumerated: the holdings snapshot also waits and then writes the box, and was left
alone because it asks first, with the current line count in the question, so a newer edit is in front of the
user before anything is overwritten; the picker, Shuffle, Apply Weight and Drop-contracts write without
waiting. R16-S01 (a regression check with a trailing word boundary that adjacent spans never satisfy) and
R16-S02 (this file's command table) are closed. The live-page mismatch it lists as an operational blocker is
cleared by publishing the commit that carries this file; the integrity workflow re-checks it four times a day.

Round fifteen, 11 September 2026, against `9426c2c`. The full report is
[`audit-2026-09-11-fifteenth-external.md`](audit-2026-09-11-fifteenth-external.md), published byte-for-byte
unchanged. Five release blockers, two should-fix findings, and five inherent/operational limits.

### Round fifteen release blockers

| | | |
| --- | --- | --- |
| B-01 | editing the recipient textarea after parsing left the old parsed/send plan armed | fixed in the current tree: parsed rows are bound to the exact textarea bytes; input synchronously clears parsed and derived state; preflight, approval and Send revalidate, including after the send lock is held; exact user-edit, programmatic-edit and no-wallet-request regressions added |
| B-02 | Assign ignored named quantity/amount columns and silently underallocated ERC-721s | fixed in the current tree through one shared quantity reader for named columns and bare `xN`; generated output is parsed by the canonical parser and compared to the requested wallet/quantity meaning before it is accepted; named/quoted/fractional regressions added alongside existing bare-CSV coverage |
| B-03 | Check replaced a single transaction's declared sender with the UI sender | fixed in the current tree: compact and multi-request renderers share one sender resolver, a valid declared sender wins, mismatches are displayed, and an unreadable explicit sender is never simulated through a UI substitution |
| B-04 | empty, short, null, malformed or extra ordered-simulation results were announced as complete success | fixed in the current tree: exactly one result with exactly one recognized-status member per requested call is required; every malformed equivalence class falls into the existing isolated-check warning and explicit send confirmation |
| B-05 | neither public HTML page matches the reviewed artifact | closed by publishing the round-sixteen commit, live bytes compared to the repository afterwards (the reviewed-then-published rule held: nothing was published between rounds fourteen and sixteen while blockers were open); until then a read-only fetch on 11 September confirmed both HTML hashes differed, while `wc.js` and the deployed v13 testnet runtime still match. Publish only the exact commit that first passes the full gate, CI, and a fresh zero-blocker review, then fetch and compare it externally |

Round fifteen S-02 is fixed in the current tree: the evidence gate pins complete probe-source hashes and
explicit probe-file inventory, and ordinary contract suites must exit cleanly by file rather than by test-name
substring. A scratch-copy tamper check proved a one-byte probe-source change fails before the long suites run.

Round fifteen S-01 remains deliberately deferred. The guard probes run before any transfer and a failure
reverts the transaction, so the demonstrated consequence is caller gas loss, not asset movement, false
delivered accounting, or widened authority. Fixing it requires new contract bytecode and another deployment;
rushing an assembly probe rewrite into otherwise unchanged v13 would add contract risk to clear a
non-blocking recommendation. The next contract version should cap probe gas and inspect fixed-size returndata,
with burn-gas and returndata-bomb fixtures, before deployment. Until then a hostile or pathological token can
consume most of a submitted transaction's gas during classification, and that limitation is not hidden.

Round fourteen, 10–11 September 2026, against `f5b7614`. The full report is
[`audit-2026-09-11-fourteenth-external.md`](audit-2026-09-11-fourteenth-external.md), published byte-for-byte
unchanged. Four release blockers, seven should-fix findings, and five inherent/operational limits.

### Round fourteen release blockers

| | | |
| --- | --- | --- |
| B-1 | Shuffle discarded headings and rewrote numeric metadata positionally, turning labels into additional ERC-721 ids | fixed in the current tree by shuffling only the standard's named payload cells through one round-trip-checked serializer; exact numeric-metadata reproduction added |
| B-2 | Apply Weight parsed quoted CSV and wrote it back unquoted, allowing a metadata fragment to replace the token id | fixed in the current tree through the same serializer; quoted comma, semicolon and equals metadata plus unchanged-id assertions added |
| B-3 | Check gave the readable subset of a mixed JSON paste an unqualified green whole-request verdict | fixed in the current tree: every accepted request keeps its original position and any top-level refusal taints every subset verdict; auditor's exact mixed input added |
| B-4 | the public BulkSend page served `790c9b5`, not reviewed `f5b7614` | closed by publishing the round-sixteen commit, after B-1 through B-3 were committed and independently re-checked by rounds fifteen and sixteen; publishing the known-broken intermediate page would close a hash mismatch by shipping its defects |

Round fourteen's S-1, S-3, S-4, S-5, S-6 and S-7 are also fixed in the current tree: named ERC-721 ids
control picker cardinality; the evidence ledger is exact rather than count-only; connector reproducibility
runs before the deliberate bytecode gate; ERC-20 approval withdrawal is exercised directly and in the
invariant handler; front-door counts are current; and Check discloses its single-RPC boundary. S-2, bounded
guard-probe returndata, is not a demonstrated asset-loss path and remains a documented contract-hardening
decision rather than being rushed into otherwise unchanged v13 production code before release.

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
| S-4 | a low estimate understated the quoted cost about 3x while labelled "at most" | closed: the measurement is an estimate; the dearest surveyed comparison is explicitly a fallback, not a ceiling |
| S-5 | Check simulated a call whose calldata it could not read | closed |
| S-6 | `SECURITY.md`'s "approves the exact batch total" false for ERC-721 and ERC-1155 | closed |
| S-7 | 9 of the contract's 15 errors reached the user as a bare selector | closed on the airdrop page in the round; **closed on the Check page afterwards**, where the same three newest errors were still unnamed, and `preflight.sh` now reads both pages |

Six of the seven were one reader being taught something its twin was not, and the round said so. The
answer is [`readers.md`](readers.md): every function that reads the recipient box and the contract's two
paste guards, listed, so a fix to one is checked against the others, and the rule that a commit fixing a
reader names its twins.

### Inherent limits — 1

I-1: one RPC endpoint is the sole witness for every "arrived", "skipped" and "held" verdict. No browser can
turn a token's own answer into independent proof, but relying on one node is still reducible operational risk,
not an excuse to stop at disclosure. A production provider plus an independently operated fallback/monitor is
now part of the mainnet gate above.

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
