# What is tested, what is not, and what is still open

Last updated 12 September 2026, against BulkSend **v13** and round twenty-one.

This file exists so that the state of the project is readable from the repository rather than from anyone's
summary of it. Everything here is a count or a verdict that can be reproduced by running the command beside
it. Where something has not been tested, it says so; where a finding is open, it says so.

## The gate

**Live on testnet and on mainnet.** BulkSend v13 was deployed to Robinhood Chain (4663) on 12 September 2026 at
`0x904412cfe982f33385f486aaff8c8a4a6f4b5fbf` (tx `0xfde31639…`, block 61365130), from the release tree `bf4c61d`, on the
maintainer's explicit authorization. Its runtime read back from the mainnet RPC is byte-identical to what this
source builds and to testnet's v13 (keccak `0xc1a27e659b…`); `deployments.mainnet.json` is the record, and gate 14
re-derives that comparison in both workflows. Source verification: Sourcify exact match; the mainnet explorer's own
verification API answers non-browser clients with a challenge, so it is verified there through Sourcify's import or
the browser form. The page's fresh-visit default is mainnet, testnet stays one click away, and the last choice is remembered;
the footer's contract line re-renders on every switch (a regression pins fresh, switched, and remembered states).

Four things had to be true before mainnet, and on 12 September 2026 all four were. Gate 14 is the control that
now watches it:

| | state |
| --- | --- |
| a review round with no release blockers | **met** — rounds seventeen, twenty and twenty-one found none; after twenty-one the product tree did not change: the only commit before the deploy was release mechanics (`bf4c61d`: the mainnet deploy entry point, preflight tolerating the mainnet address, one plan sentence), with `src/BulkSend.sol` and both pages untouched |
| a production mainnet RPC plan | **met**, 11 September 2026 — each chain lists three endpoints in order (Robinhood's own, then PublicNode, then Pocket on mainnet), all answering the right chain id and `eth_simulateV1` when checked; the page probes them in order at connect and on a network change and reads through the first that answers, saying so when it is not the first. The integrity workflow probes every listed endpoint four times a day and fails if the first, or every fallback, for a chain stops answering. No credential: all three are public, and the Worker keeps no RPC. See `plan.md`'s gate 9 |
| a current real-wallet rehearsal on testnet | **met**, 11 September 2026 — four runs from the maintainer's own wallet against the published page and v13: ERC-721, ERC-1155 and ERC-20 from a browser wallet, and ERC-721 from a phone over WalletConnect with the tab backgrounded. Every hash read back from the explorer and the chain agrees with the page ([`real-wallet-run.md`](real-wallet-run.md); see also the proof table below and `plan.md`'s gate 10) |
| explicit permission from the maintainer, given after that round | **given**, 12 September 2026, after round twenty-one, in writing: "MAINNET DEPLOYMENT IS EXPLICITLY AUTHORIZED", naming the release-mechanics commit `bf4c61d` |
| gate 14: both workflows check the mainnet deployment as well | **met** (round twenty) — before mainnet is enabled, both `.github/workflows/tests.yml` and `integrity.yml` check the mainnet deployment as well, and `integrity.yml` asserts the page names the mainnet address it was reviewed against. Since 12 September 2026 the placeholder is gone, the page names the live mainnet address `0x904412cfe982f33385f486aaff8c8a4a6f4b5fbf`, `LIVE_CHAINS` is `[46630, 4663]`, and the mainnet branch of that step runs on every push and four times a day against the live page, comparing the mainnet runtime to the build |

No one item alone was enough, and the deployment happened only when all four held. The deployer's mainnet
nonce is 1: one transaction, the v13 deployment, about 0.00021 ETH; the rest of its balance is untouched.

Validation at the release, 12 September 2026: the complete gate passed on the release tree and again on the
mainnet-enabling tree: all five ordinary contract test files, the whole airdrop-page suite, the whole Check-page
suite, and every publish-policy check, with zero failures anywhere, and CI repeated it on every push since. The suites print their own counts when they run; `./verify.sh`'s output is the
record of what passed, not a number retyped here (round 21 F-10 -- this document is the one `PROMPT.md` tells
a reviewer to disbelieve first, so a count that goes stale by hand is the cheapest possible signal that it
is not maintained).
Every historical probe is now bound both to its complete source hash and to its exact assertion names and
statuses; an ordinary Solidity failure can no longer hide by borrowing a probe-style function name. The
reproducible WalletConnect rebuild matched its shipped and expected SHA-256. The separate read-only mainnet
fork also passed all four tests: 20/20 real
ERC-721 collections were accepted by the NFT guard and refused by the ERC-20 guard, and 20/20 real ERC-20
tokens were accepted. No transaction was signed or broadcast and no ETH was spent.

## What runs

```
./test/quick.sh [area ...]             # the inner loop: node layers in five seconds, plus the browser cases of an area
./test.sh                              # everything below except the live scripts
forge test                             # 111 contract tests, plus 29 reviewer probes of which 9 must FAIL
node test/web/client.test.mjs          # the airdrop-page suite; prints its own count when it runs
node test/web/check.test.mjs           # the Check-page suite; prints its own count when it runs
./test/csp-gate.test.sh                #  21 checks that a weaker published CSP is refused
node test/worker.test.mjs              #  31 checks on the Worker's mainnet explorer translation, offline
node test/readers.test.mjs             #  74 checks on the page's own recipient-box readers, extracted from its bytes, in node
ONLY=assign node test/web/client.test.mjs   # any area of the browser suite alone; a filtered run says so and verify refuses it
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
| a real broadcast transaction on mainnet | **one**: the v13 deployment, tx `0xfde31639c69dcac7f7dbf7b48a4b06891664fe48a3675223bd39c3ae22881e7c`, 12 September 2026, from `DeployBulkSendMainnet`; the live scripts still refuse any chain but 46630 | ✅ |

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
about this project.** Mainnet is the one to watch: the deployer's nonce there is 1, spent on the one v13
deployment on 12 September 2026, and any further movement would be news.

## Where the numbers come from

Gas figures in [`gas-and-batches.md`](gas-and-batches.md) are measured, not estimated, and the method is in
that file. The ERC-721 survey covers 58 collections live on mainnet; the ERC-20 survey covers 29 and the
ERC-1155 survey covers 6, which is every one that was findable and measurable. Six is not enough to describe
a distribution, only its top, and the file says so.

## Open findings

Round twenty-one, 12 September 2026, against `42eab38`, on Opus. The full report is
[`audit-2026-09-12-twenty-first-external.md`](audit-2026-09-12-twenty-first-external.md), published as
written. **No release blocker.** Ten should-fix items; six of them the repository's own known pattern -- a
fix from an earlier round whose consumer, ordering, or sibling shape was not checked -- and four of those are
in fixes made by the commit under review. Its probe is `test/web/audit-probe-21.mjs`.

### Round twenty-one findings

| | | |
| --- | --- | --- |
| F-1 | round twenty's F-2 fix (a 200 body with no real `is_verified` boolean is not an answer) was applied to the contract's own explorer read and not to the code behind a proxy | closed: both reads now go through one function, `verificationOf`, so the question can no longer be answered twice -- `check.test.mjs` round-21 F-1 |
| F-2 | a partially verified implementation behind a proxy was announced as fully published, because `out.partial` came from the forwarder's own record and `out.proxy.verified` was a bare boolean with no partial state | closed: `verificationOf` (the same function F-1 uses) returns the implementation's own partial state, and the pill and the "what this section is" note both read it through one shared wording function, `partialSuffix` -- `check.test.mjs` round-21 F-2 |
| F-3 | round twenty's F-7 fix changed `unlimitedApproval`'s second parameter to the whole address record and updated one of its two call sites (`callWarnings`); the other (`renderInner`, for a call carried inside another) still passed the old shape, silently disabling both the supply comparison and the ERC-721/1155 exception | closed: the second call site now passes the same argument as the first; both call sites checked by grep, only these two exist -- `check.test.mjs` round-21 F-3a (the missed warning) and F-3b (the false alarm) |
| F-4 | round twenty's F-6 fix ("Apply weight" refuses to eat a line's already-named id) was gated on `standard === '721'`; ERC-1155 writes the identical bare form for an edition (`0xabc,id,amount`) and was not covered, so one click replaced both the edition id and the per-wallet amount with a flat count | closed: the bare-form guard now also covers ERC-1155; a HEADED ERC-1155 file naming both an id column and an amount column is a different, already-safe shape (`setQty` touches only the amount cell) and stays unguarded on purpose -- checked against the two existing tests that exercise exactly that headed shape (`map-3`, `round-14 B-2`), which still pass; ERC-20 stays excluded, matching Assign's own early refusal for that standard -- `client.test.mjs` round-21 F-4 and its control |
| F-5 | a gas-limit failure before the wallet was ever asked printed round nineteen's correct sentence and then, from the outer `catch` its inner `catch` rethrows into, the sentence it replaced, about the same batch | closed: the inner catch marks its error before rethrowing (`err.__beforeWallet = true`) and the outer catch returns immediately on that mark; checked `sendViaWallet`, the sibling send path, which has no equivalent two-catch shape and needed no change -- `client.test.mjs` round-21 F-5 |
| F-6 | `requestedNftQuantity` (what Assign asks for) and `deliveriesOn` (what the parser and picker size for) read a named id cell holding several ids differently, so `address,tokenIds` with `"1 2 3"` parsed as five recipients and Assign asked for one per wallet | closed: the "several ids in one cell" rule is now one function, `idCellDeliveryCount`, called from both readers, so they cannot disagree about this cell again; also checked the second shape the report named (`address,tokenId,amount` with a single id) -- both readers now agree it is one delivery, not the amount -- `readers.test.mjs` and `client.test.mjs` round-21 F-6 |
| F-7 | `verify.sh`'s summary could print "Everything passes" on a run that had already failed, because the loop pinning eleven suite-file fingerprints set `fail=1` inside the `if [ "$fail" -eq 0 ]` branch that then printed its success sentence unconditionally | closed: `$fail` is re-tested once, after that loop, before either summary sentence prints -- `test/verify-summary.test.sh`, a new small shell test that extracts and exercises the real block rather than a copy of it |
| F-8 | round seventeen's S-5: a zero-address line survived every guard, was paired with a real id, and was only refused afterward by Assign's round-trip check, which never named it; restoring the list then re-parsed it as address-only and told the user to press the very button that had just refused | closed: `recipientProblem` is now checked on each line, by number, before Assign ever reads the chain, so the loop's second half (the round-trip check's generic restore-and-reparse) is never reached for this case -- `client.test.mjs` round-21 F-8 |
| F-9 | `status.md`'s mainnet gate table said "not met" for the production-RPC and real-wallet-rehearsal gates that `plan.md` and `status.md`'s own proof table (line 118) already recorded as done | closed: the gate table now states the same two gates as met, in the same terms as `plan.md`'s gate 9 and gate 10 and this file's own proof table, resolving the self-contradiction |
| F-10 | three documents (`status.md`, `for-reviewers.md`, `README.md`) stated numeric browser-test counts the commands beside them do not produce, plus one historical count in `plan.md`'s own archived round-thirteen notes | closed: the four prose counts now say where the number comes from (the suites print their own; `./verify.sh`'s output is the record) instead of a hardcoded figure; `preflight.sh` gained a check refusing any future prose line in `docs/*.md` or `README.md` matching a browser-test count, excluding the dated audit reports on the same grounds check 3 and check 4 already exclude them (they are a past reviewer's own measurement of a past commit, not a present claim) |

Eight of the ten findings have a probe assertion; all eight now read fixed. F-7 and F-9/F-10 are process and
documentation fixes with their own tests instead (a new shell test, and `preflight.sh`).

Round twenty, 12 September 2026, against `11d52c6`, on Opus. The full report is
[`audit-2026-09-12-twentieth-external.md`](audit-2026-09-12-twentieth-external.md), published as written.
**No release blocker.** Nine should-fix items, none on the contract and none on a path where value moves;
three of them are edges of round nineteen's own fixes ("the fix is right and nothing checked the consumer, or
the order, around it"). Its probe is `test/web/audit-probe-20.mjs`.

### Round twenty findings

| | | |
| --- | --- | --- |
| F-1 | "source published and matched" stated about a verification the page cannot tell is full or partial | closed: `out.partial` is now three states (`true`/`false`/`null`, matching what the mainnet Worker's `is_partially_verified` actually knows) rather than `!!sc.is_partially_verified`; the pill reads "whether the match is full or partial is not known" on `null`, never "matched" — `check.test.mjs` round-20 F-1 |
| F-2 | any 200 JSON body was read as a real explorer answer, so a body with no `is_verified` in it at all became the definite claim "no source published" | closed: `readAddress` reads `sc`'s fields only when `typeof sc.is_verified === 'boolean'`; anything else is "could not check", the same as an unreached explorer — `check.test.mjs` round-20 F-2 |
| F-3 | `myTokenIds` ended a cut-short inventory walk (a wrong-shaped page, or the walk's own twenty-page ceiling) as a complete one, and Assign and the picker stated the resulting count as fact | closed: `myTokenIds` now marks itself `truncated` on both triggers, the two lines the holder walk already had; Assign says "the explorer's answer was cut short" instead of a false shortfall, and the picker says "at least N" instead of "You hold N" — `client.test.mjs` round-20 F-3a, F-3b, and the picker case |
| F-4 | a headed `address,amount` list (a "how many each" file with no id column at all) was reported as "already names its token ids", and refused | closed: the positional pairing test now runs only when the file has no heading at all, not merely no id column — `client.test.mjs` round-20 F-4 |
| F-5 | a list where only some lines already named an id was read as "not paired" by an `.every()`, and re-paired at random with no question | closed: counted instead of `.every()`d; a partial match now asks too, naming how many of how many — `client.test.mjs` round-20 F-5 |
| F-6 | "Apply weight" refused to eat the ids in a headed file but silently ate them in the bare `address,id` form Assign and the picker write for themselves | closed: the guard reads a line's id the same way (`lineNamesId`) regardless of whether the file has a heading — `client.test.mjs` round-20 F-6 |
| F-7 | an ERC-721 `approve(spender, tokenId)` at or beyond the collection's `totalSupply` was called "an unlimited approval ... in any amount" | closed: `unlimitedApproval` is standard-aware now, the way `describeCall` already was; it defers to the single-NFT sentence on `approve(address,uint256)` for ERC-721/ERC-1155 — `check.test.mjs` round-20 F-7 |
| F-8 | two documents (this file and `docs/for-reviewers.md`) stated browser-test counts that were wrong and disagreed with each other | closed: corrected in this commit to the counts the suites themselves print, including the cases this round added |
| F-9 | the holder walk's "cut short" branch was unreachable whenever the FIRST page was the unreadable one, because the empty-list check ran first | closed: `truncated` is tested before `!uniq.length`; a genuinely empty result and a result whose only holder was the connected wallet now read differently too — `client.test.mjs` round-20 F-9 |

All nine of the reviewer's probe assertions read fixed. Gate 14, in "The gate" above, closes the reviewer's
other finding: no automated check watched the mainnet deployment.

Round nineteen, 12 September 2026, against `39eaaf2`, on Opus. The full report is
[`audit-2026-09-12-nineteenth-external.md`](audit-2026-09-12-nineteenth-external.md), published as written.
**One release blocker**, in the fix for the previous one: the Check page's explorer reader returned "reached"
as "answered", so the upstream-error envelope the Worker sends when the explorer will not answer was rendered
as "no source published". Its probe is `test/web/audit-probe-19.mjs`.

### Round nineteen findings

| | | |
| --- | --- | --- |
| F-1 | an unanswered explorer lookup read as "no source published" on the live Check page | **closed**: an unanswered lookup is `ok: false` and reads "could not check for a published source"; a positive case with the envelope as the mock's answer |
| F-2 | the airdrop page's holder walk ended early on the envelope and called the first hundred holders the list | closed: `explorer()` throws on the envelope; a page that is neither full nor an explicit end is a walk cut short, and is said to be |
| F-3 | the Worker's `truncated` flag was thrown away and the wallet blamed | closed: the inventory carries it out and Assign says the count is not known |
| F-4 | a failed gas estimate was reported as "handed to your wallet" | closed: estimated before the wallet is asked; on failure the record is dropped and the message says nothing was sent |
| F-5 | round eighteen's S-4(b) closure did not depend on the guard it named | closed, by removing the guard: making the test depend on it showed nothing reconciles mid-send (the connect controls are locked while a batch is out, a dropped phone session keeps `me` and only stops the loop), so the in-flight skip was dead code claiming a protection. The run-4 message was the pre-send reconciliation reporting an EARLIER record the wallet never answered. Two cases now pin that: a mid-send drop offers no connect control and the batch still lands, recorded once; an older hash-less record is reported before the next send, which still goes out, and the record stays held |
| F-6 | the live monitor never asked the airdrop Worker about `/x/` | closed: both Workers, every step |
| F-7 | the evidence gate pinned no contract suite | closed: seven contract files pinned |
| F-8 | `is_partially_verified` published as false rather than not known | closed: null |
| F-9 | a stale dependency install read as "the readers suite has failures" | closed: the quick loop checks the dependencies resolve |
| F-10 | Assign's already-paired check read positionally while every other reader reads by column | closed: by column when there is a heading; a headed-list case |
| F-11 | nothing would ever check the mainnet contract's bytecode after the address swap | recorded as gate 13 in `plan.md` |
| F-12 | four documentation claims not true of the tree | closed |

All three of the reviewer's probe assertions read fixed. Round eighteen's probe reads seven of seven fixed and
round seventeen's two, both open items listed above under round seventeen.

Round eighteen, 11 September 2026, against `79d6446`, on Opus. The full report is
[`audit-2026-09-11-eighteenth-external.md`](audit-2026-09-11-eighteenth-external.md), published as written.
**One release blocker**, live at the time: the Worker's new mainnet explorer translation read every unverified
contract as verified, because a module-API answer that was not an answer (an unverified record with no ABI
key, a rate-limit envelope, a rejected key, an unknown transaction) was translated into a field instead of
into "could not check". Its probe is `test/web/audit-probe-18.mjs`.

### Round eighteen findings

| | | |
| --- | --- | --- |
| B-1 | every unverified mainnet contract read as verified, in green, on the live Check page | **closed**: every translated path requires the module API's success shape or returns the upstream-error envelope; verified means a non-empty ABI string was published; fixtures are verbatim captures of the real answers for an unverified contract, a rate limit, a rejected key and an unknown transaction |
| B-2 | the same absence-is-an-answer defect in the other three paths | closed, same rule |
| B-3 | an upstream error mid-way through the NFT inventory walk ended it as a complete inventory | closed: the envelope; and the twenty-page ceiling now says truncated |
| S-1 | `0xabc,1,2,3` was three deliveries to the parser and the picker and one to Assign | closed: the shared quantity reader knows the multi-id form |
| S-2 | the holder snapshot waited without Assign's guard; a network change mid-read blended two chains | closed: chain, address and account captured; the walk asks the captured chain; nothing written if any moved |
| S-3 | the evidence gate did not fingerprint the Worker and publish-gate suites | closed |
| S-4 | three regression tests proved less than their names | (a) closed: the round-17 S-3 test reads the hash mid-send. (b) closed by round nineteen's F-5, differently from how round eighteen said: the guard it named was unreachable and is removed; the gate-10 run-4 tests now pin the drop and the older-record report instead. (c) not changed: the R17-4 probe's four-way conjunction is the reviewer's and stays as written, which is the honest reading of an external probe |
| S-5 | a failure reason found by re-running was headed as the reason at the time | closed: headed as today's answer |
| S-6 | Assign re-paired an already-paired list without asking (round seventeen's S-2) | closed: it asks first; a No leaves the list untouched |
| S-7 | the Worker edge-cached a failed upstream answer for a minute | closed: module subrequests are not edge-cached |
| S-8 | the key in the subrequest URL was part of the edge cache key | closed by the same change |
| S-9 | no gate covered the key's quota running out | recorded: a quota-out is now the envelope, which every reader treats as "could not check"; the integrity step reads a real holders page and two known contracts four times a day |
| S-10 | the test run, the mid-send re-check and the gas estimate still read through the wallet's RPC | closed: the reads run on the page's RPC; the gas limit is estimated there and refused before broadcast if it cannot be |

All seven of the reviewer's probe assertions read fixed. Every closure is against the reviewer's own
reproduction or a verbatim capture, not against an argument.

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
| S-2, S-5, S-6, S-7, S-10, S-11 | Assign re-pairs an already-paired list without asking; a zero-address line stops Assign without being named; `x0` read as one delivery by the picker and refused by Assign; the snapshot records the network after its wait; Check's "why it failed" can be today's reason presented as then's; a second tab's reconciliation waits silently on the first | **open** except S-5, which round twenty-one's F-8 closed (the zero-address line is named by number before anything is read from the chain; the round-17 probe's R17-5 now reads fixed and its baseline count is 1, with R17-6 the one left open by decision); none is a fund path, and the reviewer says so |

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
