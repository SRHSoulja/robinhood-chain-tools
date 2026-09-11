# Independent review, round seventeen: commit `4cc8a1c`

Target: `robinhood-chain-tools` at `4cc8a1ce441787168637a1a3eaadb3ccc609bb3b` ("round sixteen: Assign captures
every input before it waits ..."), the working tree in this directory, clean at the start of the review.
Everything below was read from that tree, run against it, or fetched read-only from the public hosts, the
testnet RPC and the mainnet explorer. No transaction was composed or signed, no key was read, nothing outside
this directory was opened, and mainnet was touched only by read-only HTTPS requests.

This file was written as the review progressed and finished after every command in the appendix had run.


> Published as written. The reviewer worked in a fresh clone outside this repository against exact commit
> `4cc8a1c`. One change of fact to know when reading it: the probe file it wrote as `test/web/audit-probe-14.mjs`
> is kept in this repository as `test/web/audit-probe-17.mjs`, under the round's number like every other probe
> file; its contents are the reviewer's.

## The release bar I am judging against

Software that lets a member of the public sign a transaction moving their own assets, and that keeps the
only record of what it has already moved, is ready to be put in front of people with real money when all of
the following hold at once:

1. **Authority.** Nothing the user did not sign can move an asset, and nobody, the author included, can
   change that later. (Promise 1.)
2. **No false accounting.** The software never records "paid" for a transfer that may not have paid, and
   never records "not paid" for a transfer that may have. Where it cannot tell, it holds the row and says so.
   (Promises 2, 4.)
3. **The plan that is signed is the plan on screen.** Every input the user can see is the input the
   transaction is built from at the moment of signing, and a change to any of them after the plan was made
   disarms it. (Promises 3, 5, and the whole of rounds fifteen and sixteen.)
4. **No wrong verdicts.** A read-only tool never states a transaction or contract is safer than the evidence
   supports, and labels every inference as an inference. (Promise 6.)
5. **What runs is what was reviewed.** The served pages and the deployed bytecode are byte-identical to the
   reviewed commit, and a change to either is visible from outside. (Promise 7.)
6. **Honest limits.** Where the browser cannot know something (one RPC, a lying token, another device), the
   page says so in the place the user would otherwise be misled.
7. **The project's own description of itself is true on the day it is read.**

A finding **blocks release** when a user of the page as served can lose funds, be paid twice, have funds
stranded, or act on a statement the software makes that is false. A finding **should be fixed** when it is a
real defect, a false statement about the software rather than by it, or a gap that would become a blocker
under a plausible extra condition. An **inherent limit** is a thing a browser page against contracts nobody
controls cannot do, where the deliverable is the sentence the page should say.

## Verdict

**Nothing in this commit blocks release under that bar.** I looked for a fund-loss, double-payment,
stranding or false-verdict path in every area listed in the scope, wrote a probe file that reproduces the
defects I did find, and the worst of them costs a user a stuck page, an under-delivered airdrop they can
finish in a second round, or a re-pairing they pressed a button to get. The two release blockers of the last
two rounds (parsed rows outliving their bytes; an older Assign overwriting a newer edit) are closed against
their own reproductions and against mine.

Eleven findings should be fixed. Three of them are worth doing before mainnet: an input the round-sixteen
fix does not capture, a send path that can hang on a wallet-side read, and a mainnet gate list in
`docs/plan.md` that is short by two items the code already depends on. Four documents currently make claims
about the repository that were true two commits ago and are not true now. Six inherent limits are listed
with what the page should say; three of them it already says, and three need a sentence.

The probe file for this round is `test/web/audit-probe-14.mjs`. It follows the repository's convention: an
assertion that reads `REPRODUCES` is a defect that is present. It reproduces six findings and carries two
controls that confirm the round-sixteen fix holds for the inputs it does capture. `./verify.sh` refuses the
file until `test/findings-baseline.json` names it, which is the gate working (appendix).

---

## Blocks release

None.

---

## Should be fixed, does not block

### S-1 · Assign captures six inputs before it waits and "How many each" is the seventh

**Severity:** medium. **Category:** should fix. **Demonstrated** by probe `R17-1`.

**Where:** `web/index.html:2084` reads `#each` into `perWallet` and bakes it into `wants` before the
`await myTokenIds(...)`; the post-wait comparison at `web/index.html:2107-2112` checks the box, token,
standard, account, network and the random-pairing checkbox and not `#each`. The control is not disabled
during the wait (only `#assign` is).

**Trigger:** two bare addresses in the box, "How many each" = 1, press Assign, change "How many each" to 3
while the holdings read is in flight (an explorer or RPC that takes a second is enough), let the read finish.

**Observed:** the box is rewritten with one id per wallet, the log says `Assigned 2 lines, paired at random`,
the parse summary says 2 recipients, and Send is enabled, while the control beside the button reads 3. This is
the round-sixteen defect with a different input, which is exactly what the round-sixteen comment in the
handler says it is guarding against ("every input is captured before the first await, and the completion
refuses to write unless every one of them is still exactly what it read").

**Cost to the user:** the airdrop they send delivers a third of what they had just asked for. Nothing is lost
or paid twice (each id is its own ledger key), and the confirmation names the count, so this is an
under-delivery a second round can finish. It does not qualify as a false statement: every sentence the page
prints is true of what it wrote.

**Fix:** capture `$('each').value` with the other six and add it to the `changed` chain; or disable `#each`
for the duration of Assign the way `#assign` is. Add the probe's case to `client.test.mjs` beside the
round-16 B-01 regression. While there, note that the twin controls `#cap` and `#weight` are read by Apply
Weight synchronously and need nothing.

### S-2 · Assign silently re-pairs a list that already names every id; its twin refuses the same input

**Severity:** medium. **Category:** should fix. **Demonstrated** by probe `R17-2`.

**Where:** `web/index.html:2073-2176`. Assign reads only the address and the quantity from each line; a
line `0xA,42` is read as "0xA wants one" and the 42 is discarded. Apply Weight refuses this exact input at
`web/index.html:1998` ("That file already names the exact NFT id on each line ... Nothing has been changed"),
and the picker's "Use these" pairs in the order shown rather than shuffling for the same reason ("choosing
them and then shuffling would undo the choosing").

**Trigger:** a hand-paired list `0xA,42` / `0xB,41`, random pairing unticked, press Assign.

**Observed:** the box becomes `0xA,41` / `0xB,42`, no confirmation is shown, the log says `Assigned 2 lines,
lowest id first`, Send is armed on the new pairing.

**Cost to the user:** a rarity-sensitive drop that was paired by hand goes out paired by id order. It is
user-initiated and visible in the manifest, so it is not a fund-loss path, but it is the shape the reader map
exists to prevent: one writer refuses an input and its twin rewrites it without a word. The list also cannot
be undone.

**Fix:** when every readable line already carries an id (bare `addr,id`, or a headed file with a non-empty id
column), refuse with the Apply Weight sentence, or confirm with the number of pairings that will change. The
holdings snapshot's `confirmOverwrite` is the existing pattern.

### S-3 · The bulk send hangs, form locked, when the wallet cannot look the transaction up after sending it

**Severity:** medium. **Category:** should fix; it also lengthens the mainnet gate list (see S-8).
**Demonstrated** by probe `R17-4`; the ethers behaviour it depends on was confirmed in the pinned
`ethers.umd.min.js` (appendix).

**Where:** `web/index.html:3289`, `tx = await bulk[fn](...args, onThisChain())`. The contract is bound to a
`JsonRpcSigner` over the wallet's provider, so ethers 6.13.4's `sendTransaction` obtains the hash from the
wallet's `eth_sendTransaction` and then polls `eth_getTransactionByHash` **through the wallet** until it can
build a `TransactionResponse`. An error answer from that poll that is not `NETWORK_ERROR`, `BAD_DATA`,
`CANCELLED` or `UNSUPPORTED_OPERATION` is retried every four seconds forever ("failed to fetch transation
after sending (will try again)" in the bundle). A `null` answer is also retried forever.

**Trigger:** the wallet's own RPC for this chain (MetaMask's configured endpoint, the WalletConnect relay
path on a phone) answers `eth_sendTransaction` with the hash and then answers `eth_getTransactionByHash` with
a JSON-RPC error. Robinhood's public endpoint is the one the page itself names, and its documentation calls
it rate-limited; a `-32603`/`429`-shaped error from it is the ordinary case, not an exotic one.

**Observed:** `eth_sendTransaction` was asked exactly once, the pending record exists with `hash: null`, the
log stops after `Batch 1 of 1: 1 recipients …`, the form stays locked, "Stop after this batch" does nothing,
and the hash the wallet already returned is never written down. After a reload the record is held with the
message "was sent to your wallet and never came back with a transaction"; for an ERC-721 batch "Review held
rows" then settles it by `ownerOf`, for ERC-20 and ERC-1155 the user is asked to decide by hand with no hash
to look at.

**Cost to the user:** no funds are lost and nothing is paid twice; the held-row design does its job. The cost
is a page that is stuck until the tab is closed, and for fungible batches a manual explorer search for a
transaction whose hash the page had in hand. On a phone, where the tab is backgrounded while the wallet
answers, this is the likeliest shape of a "nothing happened" report.

**Fix:** ask the wallet for the hash directly and wait on the page's own provider:
`const hash = await signer.sendUncheckedTransaction(txRequest)` (ethers' `JsonRpcSigner` exposes it; it
returns after `eth_sendTransaction`), write `hash` into the pending record immediately, then
`new ethers.JsonRpcProvider(cfg().rpc).waitForTransaction(hash, 1, 180000)` and read the receipt from the
page's RPC. The replacement detection in the existing `catch` (`TRANSACTION_REPLACED`) has to be re-done by
hand in that design (compare nonce, or use `provider.getTransaction(hash)` with `replaceableTransaction`).
Cheaper alternative that fixes only the second half: when `bulk[fn]` rejects, read
`err.info && err.info.sendTransactionHash` and store it before rethrowing, so at least the `NETWORK_ERROR`
case leaves a hash behind.

### S-4 · "Fetch" holders: three early returns skip re-enabling the button

**Severity:** low. **Category:** should fix. **Demonstrated** by probe `R17-3`.

**Where:** `web/index.html:1861` (no holders), `1862` (truncated), `1867` (overwrite declined) `return` from
inside the `try`; `$('snap').disabled = false` is after the `catch` and never runs on those paths.

**Cost:** the button is dead until the page is reloaded, on the exact inputs a user retries (a wrong address,
a declined overwrite). No safety consequence.

**Fix:** `finally { $('snap').disabled = false; }`.

### S-5 · Assign on a list holding the zero address stops without naming the line

**Severity:** low. **Category:** should fix. **Demonstrated** by probe `R17-5`.

**Where:** `addressOn` (`web/index.html:915`) accepts the zero address, the BulkSend address and the token's
own address as wallets; `wants` therefore includes them; the generated line is refused by `recipientProblem`
inside `parseList`; the round-trip check at `web/index.html:2157` restores the box and reports "Assign
stopped because its output did not round-trip"; the restored bare list then goes through `offerToAssign`,
which replaces the problems panel with "Press Assign my token ids".

**Cost:** a loop with no way out and no line number. Not a fund path (the parser refuses the row every time).

**Fix:** run `recipientProblem` on each `addressOn` result inside Assign before the wait and refuse with the
line number, the way `refuseForUnreadableLines` does for unreadable lines.

### S-6 · `x0` is one delivery to the picker and a refused line to Assign

**Severity:** low. **Category:** should fix. **Demonstrated** by probe `R17-6`.

**Where:** `deliveriesOn` at `web/index.html:1563` reads `xN` with `parseInt` and maps a non-positive result
to 1; `requestedNftQuantity` at `web/index.html:939` reads the same token through `wholeNumber`, which
refuses 0. The picker sizes the list at 1 for `0xA x0` and "Use these" pairs one NFT with it; Assign refuses
the line. `bareish` in `parseList` (`web/index.html:1232`) also accepts `x0` as a bare line.

**Cost:** a line that says "none" delivers one through the picker. Contrived input, but it is the reader
disagreement the scope asked for by name: the quantity reader and the list sizer read one token differently.

**Fix:** make `deliveriesOn` call `requestedNftQuantity` for the bare form too and treat `null` as an
unreadable line (so `refuseForUnreadableLines` catches it), rather than as 1.

### S-7 · The holdings snapshot records the network after the wait and reads the explorer during it

**Severity:** low. **Category:** should fix. **Reasoned from source**; not demonstrated, because the mock
answers both explorers from one route.

**Where:** `web/index.html:1836-1900`. `EXPLORER_API()` is evaluated on every page of the holder walk,
`me` is read after the walk, and `snap.chain` is `chainId()` at `1887`, after the walk. A network change
mid-walk (the mainnet option is disabled today, so this is a testnet-to-mainnet-later concern) produces a
holder list drawn from two explorers and a `snap` that claims one chain. Apply Weight then trusts
`snap.chain === chainId()`.

**On the asymmetry the prompt asked about:** leaving the snapshot without Assign's capture-and-refuse is
**defensible for fund safety and wrong for consistency.** Defensible, because the snapshot writes bare
addresses and nothing else, and a bare list can never arm Send: `parseList` either offers Assign (ERC-721)
or refuses every line for a missing amount (ERC-20, ERC-1155). So an older snapshot completing over a newer
edit can discard typing, after a question that names a count, but cannot re-arm a stale plan, which is the
thing round sixteen was about. Wrong for consistency, because the rule the handler comment states ("every
reader that waits captures what it read") is now true of one waiting writer and not the other, and the next
round will read it as a rule with an exception. Capture `chainId()`, `me` and `$('snapAddr')` before the
first await and refuse the write if any moved; keep the count question.

### S-8 · The mainnet gate list is short by two items the code already depends on

**Severity:** medium, because the gate is what decides when real money is exposed. **Category:** should fix.
**Demonstrated** for the explorer (appendix: the mainnet explorer answers API requests with a Cloudflare
managed challenge, `403 cf-mitigated: challenge`, and the live Check worker's `/x/4663/...` passthrough
returns `{"error":"upstream","status":403}`); **reasoned** for the wallet-side RPC (S-3).

`docs/plan.md` lists, beyond a clean round: a dedicated production RPC and one real-wallet airdrop on the
final page. Two more things are false today and would stay false after both of those are done:

1. **The mainnet explorer is unreachable from a browser and from the worker.** On mainnet, "Assign my token
   ids" falls back to the explorer for any collection without `tokenOfOwnerByIndex`, "Fetch" holders is
   explorer-only, and Check's source verification and revert reasons are explorer-only. All three will fail
   on mainnet as things stand. The page's sentences for those failures are honest ("or the explorer would not
   say"; "Could not read holders"; "could not check for a published source"), so this is not a false
   statement, but it is a large part of the product being dark on the network the gate is about, and nothing
   in the gate list would notice. Add: an explorer that answers this origin on mainnet (an API key, an
   allowlisted origin, or a different indexer), proven by the integrity workflow, which today asserts only
   that `/x/4663/stats` returns JSON, which the `{"error":"upstream"}` envelope does.
2. **The wallet's RPC is not the page's RPC.** A production RPC in `CHAINS[4663].rpc` covers every read the
   page makes itself and none of the reads ethers makes through the wallet after `eth_sendTransaction`
   (S-3). Until the send path stops depending on those, "production RPC" is half a gate. Add the S-3 change,
   or a documented rehearsal of a wallet on the public endpoint under load.

Two smaller things worth a line in the same list: the `BATCH_ROOM` of 30,000,000 is written against the
testnet's 32,000,000 limit and should be re-read from mainnet before the placeholder is filled; and the
mainnet address will live in a `deployments.mainnet.json` that no workflow reads today, so the bytecode
step in both workflows needs a mainnet twin in the same commit that flips `LIVE_CHAINS`.

### S-9 · Four documents describe the state two commits ago

**Severity:** low individually; the project's own finish line says this is release-relevant ("`status.md`
accurate on the day it is read"). **Category:** should fix. **Demonstrated** by reading them against the
tree and the live hosts.

- `docs/status.md`, the "What that actually proves" table: "the deployed pages match these files: **no**",
  and the surrounding sentence about publication being withheld. Both live pages are byte-identical to this
  commit (appendix). The round-fifteen B-05 row says the mismatch "closed by publishing the round-sixteen
  commit", so the file contradicts itself.
- `docs/for-reviewers.md:14-17` ("As of the round-fifteen review, neither live HTML page is byte-identical
  to this tree") and `:131` ("its live-page mismatch carried into round fifteen and remains open"). Both
  stale. `:25` says 471 browser tests.
- `README.md:249-251`: "fourteen adversarial review rounds", "the first thirteen rounds' blocking findings
  are fixed; round fourteen's findings and their closure state are published". Sixteen have run.
  `README.md:186` says 450 browser tests; `docs/status.md` says 343 and 129 (472); `for-reviewers.md` says
  471. The suites print 343 and 129 (appendix).
- `SECURITY.md` names the fifteenth report as "the most recent review in full".

None of these misleads a user about money. They mislead a reviewer about what has been checked, which is the
thing `readers.md` and `status.md` exist to prevent, and `preflight.sh` could catch the first two: it already
reads these files for tombstoned addresses; a check that the live-page row of `status.md` agrees with the
integrity workflow's last result is one more line.

### S-10 · Check's "Why it failed" can be a reason from today, presented as the reason from then

**Severity:** low. **Category:** should fix. **Reasoned from source.**

**Where:** `web/check.js:728-736`. For a failed transaction the page asks the explorer for the recorded
`revert_reason`; when there is none it re-simulates the call against `latest` and prints whatever reverts
now under the heading "Why it failed" (`web/check.js:755`). The comment says "usually"; the heading does not.

**Trigger:** a transfer that failed last week for lack of approval, of an id since burned. The card says
"that token id does not exist".

**Cost:** a wrong explanation of a past event, in the page whose whole promise is not to over-state. Nobody
loses money on it directly. Say which it was: "the explorer recorded no reason; run again against the chain
as it is now, it fails with: ...".

### S-11 · Reconciliation in a second tab waits, silently, for the first tab's whole run

**Severity:** low. **Category:** should fix. **Reasoned from source.**

**Where:** `web/index.html:2672-2755`. `runSend` reconciles every pending record before taking its own
lock; `settle` calls `commitDelivered`, which takes the *other* run's lock without `ifAvailable`
(`web/index.html:2797`). Tab A mid-send on run R holds R's lock for the entire multi-batch run. Tab B
pressing Send on any run S, once A's first receipt is readable, blocks inside reconciliation with its form
locked and no message until A finishes. Not a deadlock (A never waits on B) and not a ledger hazard (the
lock is doing its job); a user staring at a locked form with nothing in the log.

**Fix:** in reconciliation, take the lock with `ifAvailable: true` and log "another tab is mid-send on that
run; its batches will be caught up when it finishes", leaving the rows held.

---

## Inherent limits, and what the page should say

- **I-1 · One RPC is the witness for every arrival, and the wallet's RPC is a second witness the page cannot
  see.** Already said in the footer and in the "arrived" log line ("evidence, not proof"). What is not said:
  that a *wallet-side* read failure looks like the page freezing (S-3). Until S-3 is fixed the batch log line
  should say, after `Batch n of m`, "waiting for your wallet to hand back the transaction; if this line does
  not change, the wallet has the request and this page cannot take it back".
- **I-2 · A token can lie in `ownerOf`, `balanceOf` and its events.** Said, in the right places. Nothing to
  add.
- **I-3 · The ledger is per browser, per account, per token.** Said in the footer. It should also say that
  "Forget what was delivered" and "Review held rows" are the two ways a human overrides it, and that both
  can pay twice; the Review dialog says so, the Forget dialog says "removes the protection", which is close
  enough.
- **I-4 · A replaced transaction the page did not see** (speed-up while the tab was closed) leaves a hash
  with no receipt. The page holds the rows and says "is not on the chain"; for ERC-721 Review settles it by
  ownership, for fungibles it cannot. The Review dialog already says "no transaction hash was recorded" only
  for the hashless case; for this case it should say "the hash this page has was replaced in your wallet;
  find the replacement in your wallet's activity and check it on the explorer".
- **I-5 · The paste guards cannot tell a hybrid token from either standard**, and refuse ERC-404-style tokens
  by design. `NotAnNft`/`IsAnNft` sentences already say what to do. Nothing to add.
- **I-6 · The mainnet explorer is not the page's to fix.** Until S-8 item 1 is resolved, the mainnet pages
  should say up front, next to the network selector, that holder snapshots, non-enumerable Assign and source
  verification are unavailable on mainnet, rather than discovering it per feature.

---

## The scope, item by item

### 0 · The Assign handler after round sixteen, and the next reader that waits

Read in full (`web/index.html:2066-2196`), attacked with the inputs the prompt listed, and with two Assigns
in flight, an account switch mid-read, and a late explorer answer. The generation counter is sound: a second
Assign cannot be clicked (the button is disabled), a programmatic second one supersedes and the first returns
without touching the box. The six captured inputs are compared by value; my controls `R17-c1` (account
switch during the read, with the wallet then answering `eth_accounts` with the new account) and `R17-c2`
(random-pairing toggle) both read "fixed", and the round-16 regression in `client.test.mjs` covers the box.
`myTokenIds` re-reads `me` and `cfg()` after awaits (`web/index.html:2178-2196`), so an account switch and
switch-back inside one enumeration could blend two accounts' ids; the post-wait comparison would not catch
that, `unheldIds` in the test run would, and it needs a wallet to flip twice inside one read. Noted, not
filed. The round-trip check compares wallet and quantity multisets and `parsedListIsCurrent()`; it does not
compare ids, and does not need to, because the ids came from the same read.

What the capture misses is S-1 (`#each`). The other waiting writer, the holdings snapshot, is S-7 and S-4.
Beyond those two, every writer of the box (`parseList`, the CSV upload, the picker, Shuffle, Apply Weight,
Drop-contracts) writes synchronously after its last read; I checked each against `readers.md` and the map is
complete for writers. It is incomplete for *readers*: `probeGas()` reads `rows` without the currency check
(advisory only, and `rows` is emptied by the invalidator first, so harmless) and the wallet-path test-run
summary reads `rows.length` where it means `ordered.length` (`web/index.html:3046`; cosmetic: "3 of 5 would
be delivered" after two were left out as already delivered).

### 1 · Round fifteen's fixes

- `parsedListIsCurrent` is rechecked at `plan`, the test-run click, `preflight`, `approve`, `runSend`
  before reconciliation and again under the run lock. I looked for a consumer of `rows` that does not
  recheck: `probeGas` (above), the manifest download (reads `lastManifest`, which the invalidator clears),
  `export` (reads `skippedRows`, cleared by the invalidator). None is executable state. **Sound.**
- The shared quantity reader: S-6 is the input Assign and the picker read differently. A second, milder one:
  in a headed file with no quantity column, `requestedNftQuantity` still hunts the row for an `xN` cell
  (`web/index.html:938-940`), so `label,address` with a label of `x2` is two deliveries to Assign and one
  to the picker. Same fix as S-6: the bare-form search should apply only when `col` is null.
- The sender resolver in `check.js` (`resolveRequestSender`, `web/check.js:1219-1231`) is used by both
  renderers; I traced the compact path (`kind === 'call'`) and the batch path and found no substitution of
  the UI sender for an explicit unreadable one. **Sound.**
- `completeOrderedSimulation` (`web/index.html:2962-2973`): exactly one block result, exactly `expected`
  calls, each an object with status `0x0`/`0x1`. I could not find a malformed shape that passes; a
  `status: '0x1'` with a `returnData` of a revert is not distinguishable from success by any client, and the
  page does not claim to. **Sound.**

### 2 · The shared serializer, and the id-and-amount ERC-721 file

`serializeRow` refuses its own output if `splitRow` would not cut it back into the same cells
(`web/index.html:890-907`); every writer except `pickUse` goes through it, and `pickUse` writes
`checksummedAddress + ',' + decimalId`, which contains nothing `splitRow` splits on. A file headed
`address,tokenId,amount` with `0xA,1,1`: `parseList` reads one id per row (the named id wins), `deliveriesOn`
reads one (`web/index.html:1547-1553`), Apply Weight refuses to weight it (`1998`), Assign reads the named
`amount` as the quantity and discards the id (S-2). The picker and parser agree; Assign is the odd one, as
filed.

### 3 · `BulkSend.sol` v13

Read line by line. Runtime on chain at `0xf2ed…9232` is 9,752 bytes and byte-identical to the build from
this source (appendix). Nothing stored, no owner, every transfer `transferFrom(msg.sender, ...)`, transient
reentrancy lock (`tload`/`tstore`; the chain is on ArbOS 61 per `foundry.toml` and the deployment proves
Cancun opcodes work on testnet; confirm the same ArbOS on mainnet before deploying, since the alternative is
a failed deployment, which is safe).

The four questions in `_mustNotBeNft`: ERC-165 for `0x80ac58cd`, `isApprovedForAll(sender, this)` answering
32 bytes ≤ 1, `ownerOf(amounts[0])`, `ownerOf(amounts[n-1])`. **Is there a legitimate ERC-20 refused by any
of them?** Only one with a catch-all fallback that returns a 32-byte word to any selector, or one that
implements `isApprovedForAll` (ERC-404 hybrids and "ERC-20 plus NFT" dual tokens), which the code refuses on
purpose and says so. I could not name a plain ERC-20 in the wild with either property; the fork suite's
20-of-20 is consistent with that. **Is there an NFT that answers none of `_mustBeNft`'s three?** A
collection with no ERC-165 whose first and last listed ids are both dead. It is refused, the failure
direction is refusal, and `testBareRevert721_withNeitherIntrospectionNorOperators_isTheResidual` pins the
mirror case. The `airdrop1155` no-guard argument in `readers.md` (selector `0xf242432a` exists on neither
other standard) is correct.

`_tryCall`'s pre-check `g - g/64 >= stipend + GAS_RESERVE` guarantees the callee gets exactly the stipend
under EIP-150; `_erc20Answer` accepts only empty or exactly `1`; strict mode's `_callAll` bubbles the token's
own error. The `Skipped` event for ERC-721 carries `amount = 1`, and the page's row matcher treats an absent
row amount as a wildcard, so it matches. **Sound.** Nothing new beyond the deferred returndata item (below).

### 4 · The evidence gate

`verify.sh` pins: the exact probe-file inventory, the sha256 of every probe source, the status+name
fingerprint of every probe assertion, the counts, and the sha256 of both ordinary browser suite files.
**Can it be satisfied by wording?** No: a wording change in a probe moves its source hash. **Can a test be
weakened without the fingerprint moving?** Three ways, none of which the gate claims to cover but which its
description in `status.md` ("a test cannot be quietly weakened") over-states:

- The ordinary Forge suites (`BulkSendReal.t.sol`, `Invariants.t.sol`, ...) are not pinned. Most closed
  *contract* findings are pinned only there (the `readers.md` table names the test for each branch), so
  weakening `testBareRevert721_throughTheErc20Path_isCaughtByTheLastIdWhenTheFirstIsDead` to a no-op is a
  green run with no baseline change.
- The fixtures the pinned probes import (`test/RealTokens.sol`, `test/Mocks.sol`) are not pinned. A fixture edit changes what a probe measures without moving the probe's hash, as long as the
  pass/fail status is unchanged.
- The *reason* a probe fails is not fingerprinted, only that it fails. A probe that starts failing for an
  unrelated reason (a fixture that no longer compiles is caught, since the count drops; a fixture that
  reverts earlier is not) keeps its "fixed" reading.

None of these is a path an accident takes without a diff someone reviews, and the gate is a guard against
accidents, not against a maintainer. Say that in `status.md` rather than "cannot be quietly weakened", and
consider pinning `test/*.sol` the way the two `.mjs` suites are pinned; it is one more `sha256sum`.

**Is there a path through `test.sh` or CI that skips it?** `test.sh` skips it by design and says so.
`tests.yml` runs `preflight.sh` then `verify.sh` on every push to `main` and every pull request, actions
pinned by SHA, Foundry and Node pinned, `npm ci` from lockfiles, `persist-credentials: false`,
`contents: read`. The fork suite is outside both `verify.sh` and CI (documented). I found no skip.

I ran `./verify.sh` on the clean tree: exit 0, every count and fingerprint at baseline (appendix). With my
probe file present it fails in under a second at the manifest check, which is the behaviour the prompt
describes.

### 5 · The pending record and the delivery ledger

`addPending` is written before `eth_sendTransaction` and before `wallet_sendCalls`; only `isRejection`
(4001, `ACTION_REJECTED`, 5750) and the wallet's own 5740 "too large" drop it. Every other error keeps the
record and holds the rows. A wallet error the page does not recognise therefore lands on the safe side, and
"Review held rows" is the way out; for ERC-721 it decides by `ownerOf`, for fungibles it tells the user it
cannot decide and asks. Two tabs: `navigator.locks` with `ifAvailable` on the send, waiting locks on every
ledger write, per-batch keys so no whole-array rewrite. A replaced transaction is followed only when `to`
and `data` match. A wallet-batch status of 600 is held, not released, and a 400/500 alongside a successful
receipt is held as a contradiction. I traced each of these and found no path that writes "delivered"
without a chain read or releases a row on a wallet's word. **Sound**, with S-3 as the one gap (a record that
never learns its hash although the wallet returned it) and S-11 as a usability note.

The ledger ignores `ethers`' mapping of any message matching `/user denied/i` to `ACTION_REJECTED`; a wallet
that used those words for a post-broadcast failure would have its record dropped. I know of none that does.
Noted, not filed.

### 6 · What the software says about itself

Counts: `forge test` reports 135 passed and 9 failed, which is the documented 131 plus the four fork tests
that run whenever mainnet is reachable; `client.test.mjs` 343/343; `check.test.mjs` 129/129; the CSP gate
21/21; `preflight.sh` clean. The deployed bytecode and both live pages match. The claims that are wrong are
S-9. The `docs/for-reviewers.md` design decisions: I agree with all six; on decision 3 see below. The plan's
gate list is S-8.

### 7 · The suites themselves

The three known-open harness items, and whether they hide a defect I can name:

- **Dialogs auto-accepted by default.** The `#send` confirmation and the "how many each" file rewrite have
  dismiss-side tests (`client.test.mjs` around 1750, 2196, 2384, 2873). The other five `confirm()` gates
  (Shuffle for ERC-20 at `web/index.html:1959`, Apply Weight `2032`, the snapshot overwrite `2062`, Review
  release `2238`, Forget `2259`) and the weaker-check confirm (`3193`) are exercised only as accepted
  dialogs in the suite. I could not name a defect behind any of them; each is a plain `if (!confirm) return`.
  What the default hides is not a defect but *whether the gate is still there*: removing any of those five
  `confirm` calls is a green run. Worth one dismiss test each. It matters less than the maintainer thinks.
- **`eth_estimateGas` answers a constant.** The tests set 173,843, 90,000, 60,000 and `'revert'`. None sets a
  value small enough to reach `probeRefused = true` (`web/index.html:403`; the threshold for ERC-721 is a per
  recipient figure under 38,250, so an estimate under 59,250). That branch, which is the one that stops a
  node's nonsense answer from setting the batch cap to 400, has no test. A regression that removed it would
  be green. That is a defect class the constant hides, and it is worth one test with `estimateGas: 25000`.
  It matters about as much as the maintainer thinks.
- **`eth_call` falls through to a plausible word.** No longer true: the harness now throws `unmocked
  eth_call <selector>` for any selector it does not model (`client.test.mjs:228`), and the comment says why.
  The prompt's list is one item stale.

Where the tests are weaker than they look, beyond the three: the wallet-path test-run count line (item 0)
and the `probeRefused` branch (above). The suites' assertion texts are regex matches on the log; several are
broad (`/changed.*Check list again/i`), but each I sampled fails against the parent behaviour as the
sixteenth round showed for its own.

### 8 · How it is served

All fetched read-only on 11 September 2026 (appendix): both HTTP hosts answer 301 to HTTPS with HSTS
`max-age=31536000; includeSubDomains` and a locked-down CSP; both HTTPS roots serve bodies byte-identical to
`web/index.html` and `web/check.html`; the CSP header equals the meta tag plus `frame-ancestors 'none'`;
the airdrop host serves `/wc.js` with the digest in `web/wc-build/EXPECTED-SHA256`; unknown paths on both
hosts, `/wc.js` on the Check host, and malformed `/x/` paths answer 302 or 400 with the full hardening set.
`/cdn-cgi/*` is documented as the exception. **Preload not set:** I agree; it is a decision about the apex
domain, and first-HTTPS-contact pinning plus the Worker's own 301 cover these two hosts.

CSP: the hash names the one inline script; `sync.sh` writes it, `preflight.sh`, the CSP gate, `publish.sh`
and the integrity workflow all check it. **If hash and script disagree** the browser executes nothing, the
page is a static form with dead buttons, and four independent checks refuse to publish it; fail-safe.
**Unnecessary sources:** `style-src 'unsafe-inline'` is needed (both pages set `style` attributes through
`setAttribute`), and it cannot execute script. `connect-src` names the mainnet RPC and explorer on the
airdrop page while mainnet is disabled; harmless, and premature by one flip. `https://api.coinbase.com` is
contacted on every load of both pages for a dollar figure labelled "about"; the cost is every visitor's IP
address sent to a third party on a signing page. Worth either dropping the dollar figure or proxying the
price through the Worker.

The WalletConnect chain: `entry.js` → lockfile (304 integrity hashes, esbuild 0.25.10) → `web/wc.js` →
`EXPECTED-SHA256` → the digest baked into the Worker → the bytes served, rebuilt and compared in CI on every
push and compared live four times a day. **Closed**, up to the contents of the pinned upstream packages,
which nothing in this repository can vouch for, and the Reown allowlist, which is control plane.

The two workflows: read-only permissions except `issues: write` on the scheduled one; both pin actions by
SHA; `tests.yml` runs pull-request code with no credentials and no secrets exist to leak. Neither is a way
in. One note: the integrity job's `/x/4663/stats` check is satisfied by the `{"error":"upstream"}` envelope
(S-8), so it proves the Worker is up and not that the mainnet passthrough works.

---

## The predecessors' ledger, tested

`docs/status.md` claims every blocker from rounds fourteen to sixteen is closed against its reviewer's own
reproduction. I re-ran every probe file (`verify.sh`, at baseline), re-ran the round-16 regression, and
attacked each closed item afresh:

| round | item | my result |
| --- | --- | --- |
| 14 B-1, B-2 | Shuffle / Apply Weight serializer | closed; round-trips, refuses on the id-bearing file |
| 14 B-3 | mixed JSON paste verdict | closed; `unread` taints the sequence verdict (`check.js:1322`) |
| 14 B-4, 15 B-05 | live pages ≠ repo | closed by this publish; `status.md` still says open (S-9) |
| 15 B-01 | rows outlive bytes | closed; six consumers recheck (item 1) |
| 15 B-02 | Assign quantity | closed for named and `xN` forms; S-6 is a corner it left |
| 15 B-03 | sender substitution | closed |
| 15 B-04 | simulation cardinality | closed |
| 16 B01 | stale Assign overwrite | closed for six inputs; S-1 is the seventh |
| 16 S01 | `\bwould succeed\b` regression | closed (`check.test.mjs:698-700` drops the trailing boundary and also asserts the ordered-verdict sentence is absent; the reviewer's stronger suggestion, querying the pill element, was not taken, and the weaker fix is adequate because the sentence check is independent of span flattening) |
| 16 S02 | status command table | closed for the table; the proof table one section up is now the stale one |

**Deferred on purpose, and whether I would change either:**

- **Round twelve S-6, a returned `false` reverts the whole lenient ERC-20 batch.** Keep it. The argument in
  `for-reviewers.md` decision 3 is right: from inside the call, `PaysThenLies20` and a blocklist refusal are
  the same bytes, and "skipped" is the one word that must never be wrong. The cost is a whole batch refused
  for one blocklisted address, and the page's test run names that address before anything is signed, so the
  cost is a retry with one line removed, not a loss. What would change my mind: a balance read before and
  after each transfer inside the contract, which the maintainer priced and rejected; I agree with the price.
- **Rounds fourteen and fifteen's guard returndata.** Keep it deferred. `_mustBeNft`/`_mustNotBeNft` copy
  whatever a hostile token returns; the cost is the gas of one reverted transaction, paid by a sender who
  chose to airdrop the hostile token, and the page's own test run (`staticCall` under the node's call gas
  cap) fails before anything is signed, so through the page it costs nothing. It is a v14 item because
  fixing it is new bytecode, and new bytecode without a finding is how round twelve's blocker was born.

---

## Areas examined and found sound

So that silence elsewhere means something:

- `BulkSend.sol`, every function, both modes, all three standards, and the four guard questions.
- The reentrancy lock's slot constant and transient semantics.
- `parseList` for all three standards, headed and bare, quoted and whitespace-separated, thousands
  separators, scientific notation, `1.0`, too many decimals, duplicate ids, the zero/BulkSend/token
  addresses, the "how many each" file, UTF-16 uploads.
- `finishParse` occurrence numbering and `dropAlreadyDelivered` (legacy keys honoured).
- `orderForDelivery` (stable, numeric, pairing preserved) and the manifest/confirmation text.
- `readBatchReceipt`: one summary, this token, this sender, skipped rows matched by id and amount and used
  once, `sent + skipped == chunk.length`.
- `arrivalsFromReceipt`, `confirmArrival`, `reportArrival`, `commitDelivered`, `writeDeliveredFor` (read
  back after write, capped, never evicted).
- `readCallsStatus` (600 held, 400/500 with a successful receipt held as a contradiction, unknown strings
  held).
- `sendViaWallet` including the 5740 halving that stops the run rather than continuing under an old
  agreement.
- The form lock set (`FORM`), `onlyOnce`, the `signing` guard on Send.
- `switchChain`/`askWallet` (a timed-out request is reported as still waiting, not refused).
- `check.js`: `readEnvelope`, `readTransaction`, `readJsonRequests`, `resolveRequestSender`,
  `completeOrderedSimulation`'s twin `simulateInOrder`, `innerCalls` depth cap, `describeCall`'s three-state
  standard, `contractCard`'s three-state verification, `powersOf`'s "matches nothing proves nothing"
  wording, `movements` never concluding from silence. No signing method is called anywhere in the file.
- `deploy/publish.sh`, `deploy/csp-gate.py`, `web/sync.sh`, `test/csp-gate.test.sh`, both workflows,
  `.githooks/pre-commit`, `script/Deploy.s.sol`'s chain-id guard.
- `test/Invariants.t.sol` (the three properties over 2,304 calls, `fail_on_revert`), `test/fork/MainnetGuards.t.sol`.

---

## What would make this "ready"

No blocker means there is nothing that has to change for the page to be safe on testnet today. For mainnet,
the checkable list is:

1. S-1 fixed and its case added beside the round-16 regression. Check: the probe reads "fixed".
2. S-3 fixed, or at minimum the `sendTransactionHash` half. Check: probe `R17-4` reads "fixed" with the hash
   in the pending record while the wallet still cannot answer `eth_getTransactionByHash`.
3. S-8's two items added to `docs/plan.md`'s gate, with the explorer one proven by an integrity-workflow
   step that fails on `{"error":"upstream"}` for `/x/4663/`.
4. S-9's three documents corrected, and `preflight.sh` taught to fail when `status.md`'s live-page row
   disagrees with `curl | cmp`.
5. S-2, S-4, S-5, S-6, S-7, S-10, S-11 as the maintainer prioritises; none of them gates real money.
6. Then the two gates the plan already lists, in the order the plan gives them.

---

## Appendix: what was run, and what it said

All on 11 September 2026 against the clean tree at `4cc8a1c`.

| command | result |
| --- | --- |
| `./preflight.sh` | clean, 9 of 9 |
| `forge test` | 135 passed, 9 failed (the nine expected probe failures; includes the 4 fork tests, which ran because mainnet was reachable) |
| `./verify.sh` | exit 0; contracts 5 of 5 files; airdrop page 343 passed, 0 failed; Check page 129 passed, 0 failed; CSP gate 21 passed; every probe count and fingerprint exactly at baseline |
| `./verify.sh` with `test/web/audit-probe-14.mjs` present | exit 1 at the manifest check: "browser probe manifest differs from the baseline (unlisted: audit-probe-14)" |
| `node test/web/audit-probe-14.mjs` | 6 demonstrated, 2 not reproduced (the two controls) |
| `cast code 0xf2ed…9232` vs `out/BulkSend.sol/BulkSend.json` | 9,752 bytes, identical; runtime sha256 `2df1c04f…382f87` |
| `curl https://rhairdrop.gmgnrepeat.com/ \| cmp - web/index.html` | identical |
| `curl https://rhcheck.gmgnrepeat.com/ \| cmp - web/check.html` | identical |
| `curl https://rhairdrop.gmgnrepeat.com/wc.js \| sha256sum` | `d4c35a1b…3064d7`, equals `web/wc.js` and `EXPECTED-SHA256` |
| `curl -I http://rhairdrop…/`, `http://rhcheck…/` | 301 to https, HSTS, CSP, COOP, nosniff, referrer-policy |
| `curl -I https://…/nope`, `/wc.js` on rhcheck, `/api/v2/x` | 302 to `/` with the full header set |
| `curl -I https://rhairdrop…/`, `https://rhcheck…/` | 200, HSTS, CSP header = meta tag + `frame-ancestors 'none'` |
| `curl https://cdnjs…/ethers/6.13.4/ethers.umd.min.js` | SRI `sha384-6Zl0Pc8z…` matches both pages; bundle contains `sendTransactionHash` and the "will try again" poll |
| `curl https://robinhoodchain.blockscout.com/api/v2/tokens/…/holders` (and `/addresses/…/nft`) | 403, `cf-mitigated: challenge`, HTML body |
| `curl https://rhcheck.gmgnrepeat.com/x/4663/smart-contracts/0xA000…0000` | 200, `{"error":"upstream","status":403}` |
| `curl https://rhcheck.gmgnrepeat.com/x/46630/smart-contracts/0xf2ed…9232` | 200, the verified source |
| `curl https://explorer.testnet.chain.robinhood.com/api/v2/tokens/…/holders` | 200, JSON, `access-control-allow-origin: *` |

Probe output (two long diagnostic fields shortened with `...`, nothing else changed):

```
  REPRODUCES  R17-1 an Assign completion writes the "how many each" value it read before the wait, not the one now on screen, and arms Send on it
                 {"lines":2,"each":"3","sendEnabled":true,"log":"Assigned 2 lines, paired at random. They still go out lowest id first, which is the cheapest order."}
  fixed       R17-c1 (control) an account change during the wait is accepted and Assign writes the old account's ids
                 {"box":"0x0000000000000000000000000000000000000801\n","msg":"Assign stopped: the connected account changed while your holdings were being read. Nothing has been changed. Press Assig"}
  fixed       R17-c2 (control) toggling random pairing during the wait is accepted and Assign writes anyway
                 {"box":"0x0000000000000000000000000000000000000801\n","msg":"Assign stopped: the random-pairing setting changed while your holdings were being read. Nothing has been changed. Press "}
  REPRODUCES  R17-2 Assign silently swaps which wallet gets which id on a list that already named every id, with no confirmation and no refusal
                 {"before":"0x0000000000000000000000000000000000000111,42\n0x0000000000000000000000000000000000000222,41\n","after":"0x0000000000000000000000000000000000000111,41\n0x0000000000000000000000000000000000000222,42","dialogs":0,"sendEnabled":true}
  REPRODUCES  R17-3 after the explorer returns no holders, the Fetch button stays disabled until the page is reloaded
                 {"disabled":true,"log":"Reading holders of 0x00000000… from the explorer.The explorer returned no holders for that address."}
  REPRODUCES  R17-4 a wallet that answers eth_sendTransaction but cannot answer eth_getTransactionByHash leaves the send hanging, the form locked, and the pending record without the hash the wallet already returned
                 {"sent":1,"pending":[{"hash":null,"rows":1}],"listLocked":true,"log":"... transaction 1: 1 recipients, 0x0000…000041 id 7Batch 1 of 1: 1 recipients …"}
  REPRODUCES  R17-5 Assign on a list holding the zero address reports only that its output did not round-trip, and nothing on screen names the zero-address line
                 {"msg":"Assign stopped because its output did not round-trip through the recipient parser with the same wallets and quantities. Your original list was restored.","problems":"These are wallets with no token ids yet. Press \"Assign my token ids\" ..."}
  REPRODUCES  R17-6 the picker counts "x0" as one delivery while Assign refuses the same line: two readers of one quantity disagree
                 {"pickNeed":"1","assignMsg":"One line asks for \"x0\", which is not a whole number of NFTs from 1 to 1000. Fix it and try again."}

6 demonstrated, 2 not reproduced
```

To adopt the probe file: add `"audit-probe-14": 6` to `web_probes` in `test/findings-baseline.json`, its
source sha256 to `web_probe_sources`, and the assertion fingerprint `verify.sh` prints on the first run to
`web_probe_assertions`; the count should fall as each finding is fixed, and the baseline should be lowered
with each fix, never raised.
