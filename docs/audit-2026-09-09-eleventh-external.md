# Independent review — robinhood-chain-tools @ 33c29e0

Eleventh external round. Written to this file as the review proceeded, so the ordering is roughly the order
things were found, not the order of importance. Severity and category are on every finding.

---

## The release bar I am judging against

Before saying whether this is ready, here is what "ready" means to me for *this* class of software: a
browser page, holding no keys, that composes transactions moving other people's assets against contracts
nobody controls, aimed at people who are not developers.

A tool like this is ready for the public with real money when all six of these hold:

1. **No path loses funds that the user did not choose to risk.** Not "unlikely to"; no reachable path. A
   recipient list is delivered to exactly the addresses parsed, in exactly the quantities parsed, or the page
   refuses and says why. Nothing is rounded, re-scaled, reordered into a different allocation, or dropped
   without the user being told in a place they will see.

2. **No path pays anyone twice on the page's own initiative.** Double payment is the failure mode this
   category of tool exists to prevent, and it is unrecoverable. Where the page cannot know, it must hold, not
   release. A release must require an explicit human decision taken with the real evidence in front of them —
   and the page must not manufacture the appearance of evidence it does not have.

3. **Every claim the page makes is one the evidence supports.** "Delivered", "skipped", "not approved",
   "measured", "the chain will not confirm" — each of these is a factual assertion a non-technical user will
   act on. A claim that outruns its evidence is the same defect as a wrong transfer, because it produces the
   wrong action. Where the page cannot know, it must say it cannot know, and the difference between "the chain
   said no" and "I could not ask" must be visible.

4. **Hostile inputs cannot make the page do something else.** Token names, symbols, revert strings, metadata
   and RPC answers are all written by strangers. None may become markup, navigation, a signature, or an
   unbounded resource. An RPC that lies must be bounded in what it can make the page do, and the bound must be
   provable rather than believed.

5. **What is served is what was reviewed, and that is checkable from outside the operator's own account.**
   Bytecode, page bytes and bundle digest, all verifiable by a third party with no access to the deployment.

6. **The limits are stated.** Everything above has a boundary that cannot be engineered away in a browser.
   Ready means those boundaries are written down in the product, in the user's language, not only in the
   repository. A tool that is honest about what it cannot do is safer than one that is quietly optimistic.

Notably **not** on this bar: zero findings, a formal audit, a bug bounty, or perfection under an adversarial
token. Those are good; they are not the line for shipping a free, ownerless, fee-less tool whose worst case is
bounded by what the user approved.

Categories used below, as requested:

- **BLOCKS RELEASE** — a user can lose funds, pay twice, or act on a false statement.
- **SHOULD FIX** — real, but the user is not put at risk of funds or of acting on a falsehood.
- **INHERENT LIMIT** — cannot be engineered away in a browser against contracts nobody controls; the fix is
  what the software *says*, not what it does.

---

## Verified first, so the rest has a baseline

These were checked before anything else, because several findings below depend on them being true.

- **Deployed contract matches the repository.** `forge build` then `cast code
  0x91949D7328387A3613b29E56f6979Ae893ccd23C --rpc-url https://rpc.testnet.chain.robinhood.com` against
  `forge inspect BulkSend deployedBytecode`: **16,330 characters, byte-for-byte identical.** Promise 7's
  contract half holds. Demonstrated.

- **`0x1de5204e`, the one revert selector in the repository with no provenance anywhere in it,** resolves via
  the Openchain signature database to `StrictAuthorizedTransferSecurityRegistry__UnauthorizedTransfer()`. The
  page's plain-English rendering of it ("this collection only allows transfers through operators its creator
  approved") is correct. It is not in 4byte.directory, so a reviewer cannot check it from the obvious place —
  worth a source comment, not a finding.

- **Every other selector in `KNOWN`** was recomputed with `cast sig-event` and each maps to the error it
  claims: the OpenZeppelin v5 family (`ERC721InvalidReceiver` `0x64a0ae92`, `ERC721InsufficientApproval`
  `0x177e802f`, `ERC721IncorrectOwner` `0x64283d7b`, `ERC721NonexistentToken` `0x7e273289`,
  `ERC721InvalidSender` `0x73c6ac6e`, `ERC721InvalidOperator` `0x5b08ba18`, `ERC1155InvalidReceiver`
  `0x57f447ce`, `ERC1155InsufficientBalance` `0x03dee4c5`, `ERC1155MissingApprovalForAll` `0xe237d922`,
  `ERC20InsufficientAllowance` `0xfb8f41b2`, `ERC20InsufficientBalance` `0xe450d38c`, `ERC20InvalidReceiver`
  `0xec442f05`, `EnforcedPause` `0xd93c0665`) and the ERC721A family (`TransferFromIncorrectOwner`
  `0xa1148100`, `TransferToNonERC721ReceiverImplementer` `0xd1a57ed6`, `TransferCallerNotOwnerNorApproved`
  `0x59c896be`, `OwnerQueryForNonexistentToken` `0xdf2d9b42`, `TransferToZeroAddress` `0xea553b34`). No
  mis-mapping. This mattered: a wrong entry here is a wrong instruction to a user about their own funds, and
  two of these entries tell the user to turn a safety check off.

---

## How to reproduce the demonstrations

Everything marked DEMONSTRATED below is reproduced by four files I added. They are standalone, and no existing
file in the repository was modified.

    forge test --match-path test/AuditProbe.t.sol   # 20 assertions — the contract
    node test/web/audit-probe.mjs                   # 23 assertions — the airdrop page
    node test/web/audit-probe-check.mjs             # 21 assertions — the Check page
    node test/web/audit-probe-check2.mjs            #  6 assertions — the Check page
                                                    #   (VERBOSE=1 prints the page text verbatim per case)

Result on the tree as it stands: 20 / 23 / 20-of-21 / 6. The one that does not fire in `audit-probe-check.mjs`
is a second fixture for S-18 whose contract happened to carry a transfer validator, so a different branch
rendered; `audit-probe-check2.mjs` demonstrates S-18 cleanly. Every DEMONSTRATED finding below reproduces in at
least one of these files.

These are demonstrations, not regression tests. The regression tests belong next to the fixes, and each finding
says what the one to write is.

Baseline before I added anything, confirmed by running it: `forge test` 82 passing, `npm test` 355 passing
(252 airdrop + 103 check). With my probes, `forge test` is 102 passing. One note for anyone repeating this: the
check suite is `npm run test:check`, not mocha — there is no mocha in this project.

---

# BLOCKS RELEASE

## B-1 · The wallet-batch recovery releases already-paid recipients for re-payment on the wallet's word alone, with the contradicting receipt in its hand

**Category: blocks release. DEMONSTRATED** (`audit-probe.mjs`, P6, both variants).
**`web/index.html:2231-2234`, `:2284`, `:2831-2837`; `readCallsStatus` at `:2866-2882`.**

This is the one place where the page abandons the principle it is built on. Everywhere else — a transfer, a
network switch, a receipt — the page says the same thing: *do not believe the answer, read the chain.* The
footer says it, `switchChain`'s comment says it in so many words ("trusting that answer is the same mistake as
trusting a receipt instead of reading the chain"), and `confirmArrival` exists for no other reason.

Here it believes the answer. And it believes it in the single direction that cannot be undone.

**The mechanism.** `readCallsStatus` turns an EIP-5792 status into five states. Two of them, `failed` and
`reverted`, mean *nothing moved*, and both callers act on that by deleting the pending record outright:

```js
// reconcilePending, :2231
if (r.state === 'failed' || r.state === 'reverted') {
  log('… ' + (r.state === 'failed' ? 'never reached the chain' : 'reverted in full')
      + ', so nothing in it moved. Those recipients are back in the list.', 'warn', r.hash);
  dropPending(e.pid); resolved++; continue;
}
// sendViaWallet, :2831
if (rcpt.state === 'failed' || rcpt.state === 'reverted') { dropPending(pid); … break; }
```

Deleting the pending record is what makes those recipients payable again: `heldByPending()` is the only thing
holding them, and `dropAlreadyDelivered` releases every row the moment the record is gone. Nothing was written
to the delivered ledger, so on the next Send they are treated as never paid.

**Three separate reasons this is wrong, any one of which is enough:**

1. **`'FAILED'` is not in EIP-5792.** `readCallsStatus` maps `raw === 'FAILED' → 400`. The specification's
   `wallet_getCallsStatus` defines numeric codes (100/200/400/500/600); the earlier draft used the strings
   `PENDING` and `CONFIRMED`. `FAILED` appears in neither. So the page has taken a value no version of the
   specification defines, guessed what a wallet meant by it, and picked the interpretation that releases rows
   for re-payment — while the comment three lines above says "Anything we cannot read is 'unknown', never a
   success." A wallet emitting `FAILED` for a batch that partly landed pays every recipient in it twice. This
   is exactly the shape you asked me to hunt for in `check.js` — an ambiguity resolved by choosing an answer
   instead of reporting it — and it is here instead, on the write side, where it costs more.

2. **The evidence that contradicts the wallet is in the same answer.** `readCallsStatus` reads
   `st.receipts` and extracts `hash` from it — then throws the rest away. In P6 the wallet returns
   `{ status: 500, receipts: [{ transactionHash: H, status: '0x1', logs: [Transfer(me → R, 7)] }] }`. The page
   logs "reverted in full, so nothing in it moved" *with a link to H*, and releases the row. It had a receipt
   showing `status: 0x1` and the token's own Transfer event for that exact row, in the variable it was already
   reading, and did not look. It even hands the hash to the log so the user can click through to the
   transaction that disproves what the sentence above it says.

3. **Neither release is taken under the run lock**, in contradiction of the file's own invariant. The comment
   at `:2311-2316` states: *"Every change to what a run has delivered goes through here, under that run's lock,
   in this order: re-read, merge, write, read back, and only then shrink or drop the pending record. Doing it
   anywhere else is how a row ends up in neither place."* `$('review')` obeys this — `:1831` wraps its
   `dropPending` in `withRunLock`. `reconcilePending:2233`, `reconcilePending:2284` and `sendViaWallet:2832`
   do not: they call `dropPending` bare. `reconcilePending(true)` runs on every page load, so a second tab
   opening while the first is mid-send can delete that run's pending record from underneath it, with the
   lock held by the other tab and no contention at all.

**Exact input and state.** A wallet that supports EIP-5792 (`walletBatch === true`, so `deliveryPath()` is
`'wallet'`), a batch sent through `wallet_sendCalls`, and a subsequent `wallet_getCallsStatus` that answers
`500`, `400`, or the string `'FAILED'` for a batch in which any call actually executed. Also reachable with
no wallet misbehaviour at all through path 3: two tabs, one sending, one loading.

**What it costs the user.** Every recipient in that batch is paid a second time on the next Send, with no
confirmation, no warning and no trace — because the page has positively told the operator "nothing in it
moved. Those recipients are back in the list." Double payment is the one failure in this tool that cannot be
undone: for an NFT the second copy is a second asset gone; for an ERC-20 it is the amount again. There is no
`confirm()` in this path, unlike `$('review')`, so the operator is never given the chance to check.

**Reproduce.** `node test/web/audit-probe.mjs`, case P6. It seeds one pending wallet-batch record, has the
wallet answer `500` (and then `'FAILED'`) while handing over a successful receipt containing the transfer,
and asserts that (a) the pending record is deleted, (b) the row is *not* in the delivered ledger, so it is
payable again, and (c) the page states that nothing moved.

**The fix, in a form you can check later.** Three changes; the first alone clears the blocker:

- **Never release on a wallet's status alone when a hash is available.** In both callers, if
  `readCallsStatus` returned a `hash`, fetch that receipt from `cfg().rpc` and settle it the way
  `reconcilePending` already settles a `via: 'wallet'` batch — `arrivalsFromReceipt` plus `commitDelivered`.
  Release only when the receipt says `status === 0`, which is the chain's answer rather than the wallet's.
  Where there is no hash, the honest state is `unknown`: hold.
- **Delete the `'FAILED'` case.** Let an unrecognised status fall through to `unknown`, which holds. If some
  wallet in the wild really does emit it, add it back with the receipt check above in front of it.
- **Route every release through `withRunLock`,** so the invariant the file states is the invariant the file
  keeps. `dropPending` should not be callable outside it; make `commitDelivered` the only door, as the
  comment already claims it is.

Checkable afterwards: a test that answers `{status:500, receipts:[{status:'0x1', logs:[…]}]}` and asserts the
rows stay held; a test that answers `'FAILED'` and asserts the same; and `grep -n 'dropPending' web/index.html`
returning only calls inside a lock.

---

# SHOULD BE FIXED, BUT DOES NOT BLOCK

## S-1 · The NFT picker silently collapses a documented multi-id line, and its own counter tells the user the selection is complete

**Category: should fix (high). DEMONSTRATED** (`audit-probe.mjs`, P1).
**`web/index.html:1347-1358` (`walletsInBox`/`updatePickCount`), `:1385-1427` (`pickUse`), `:776-782` (`addressOn`).**

You asked that the picker "must never shorten the recipient list to fit what was selected." It does, and the
page's own counter conceals it.

The label above the box says: *"Several ids on one line send several: `0xabc,1,2,3`."* `parseList` honours
that — one line, three rows. `walletsInBox()` does not: it returns **one address per line**, because
`addressOn` reads a single cell. So for a list of `0xA,11,12,13`:

- `parseList` → **3 recipients**, confirmed on screen.
- `updatePickCount` → `need = 1`. The button reads "Select the first **1**". The pill reads "**1 chosen of 1
  wallet**" and turns green — the `ok` class — the moment one tile is clicked.
- `pickUse` accepts, because `chosen.length === wallets.length`, and rewrites the box as
  `wallets.map((w, i) => w + ',' + chosen[i])` — **one line**.
- The message is "Using the 1 you chose, paired in the order they are listed." The list is now 1 recipient.

Two of the three NFTs are gone from the list. The user is not told; they are told the opposite, by a green pill
that says the count is right.

The same root cause eats a per-wallet quantity. `0xA x3` — the form the page itself writes when you press
"Apply to the list", and the form the CSV quantity path converts a file into — is one entry in
`walletsInBox()`, so the picker asks for one NFT and `pickUse` writes `0xA,<id>`. Three become one.

**Cost.** Under-delivery, not loss: the undropped NFTs stay in the sender's wallet. Recoverable if noticed.
That is the only reason this is not in the blocking section — nobody is paid twice and nothing is lost. But it
is a straight violation of "a recipient list is delivered exactly as parsed", and the mechanism by which the
user is misled is the page actively asserting a number.

**Fix.** `walletsInBox()` should return one entry per *delivery*, not per line: expand a multi-id line into its
ids and an `xN` into N entries, using the same reader `parseList` uses. Then `need` is 3, `pickAll` selects 3,
and `pickUse` writes three lines. Where the picker genuinely cannot cover the list, it already has good
wording for that (`:1400-1420`) — this should reach it rather than route around it. Belt and braces: have
`pickUse` refuse when `rows.length` disagrees with `wallets.length`, since `rows` is the authoritative parse.

**Related, same shape, worth fixing together.** There are six readers for one input box and they do not agree
on separators: `splitRow` (`:744`) treats `=` as a separator, `parseList`'s bare path (`:1052`) treats `=` as a
separator, but `addressOn` (`:779`), `$('shuffle')` (`:1642`), `$('assign')` (`:1726`) and `$('dropContracts')`
(`:1702`) all use `/[,\t; ]+/` and do not. A disperse-format line `0xabc=1.5` is therefore a valid recipient to
`parseList` and invisible to the other four — and `$('assign')` (`:1724-1725`) drops an invisible line from the
box *silently*, with `if (!addr) continue;`, before overwriting the box. One function, used everywhere, is the
fix; you already wrote the comment saying so at `:766-769`.

## S-2 · A pending wallet-batch record from a different token standard makes Send throw before the run lock is taken — no message, no send, and the page's own remedies do not clear it

**Category: should fix (high). DEMONSTRATED** (`audit-probe.mjs`, P2).
**`web/index.html:2134-2136` and `:2162` (`arrivalsFromReceipt`), reached from `:2303`; entry at `:2612`.**

`arrivalsFromReceipt` reads `$('token').value` and `std()` **live**, not the token and standard the batch was
actually sent under. `reconcilePending` walks *every* pending record in the browser — every chain, account,
token and standard — and hands each one to it.

With a pending `via: 'wallet'` record whose rows are 721-shaped (`amount === undefined`) while the form is on
ERC-20, `:2162` evaluates `want.set(k, (want.get(k) || 0n) + r.amount)` → `0n + undefined` → **TypeError:
Cannot mix BigInt and other types**. The mirror case (a 20-shaped record while the form is on 721) dies at
`:2151` on `r.id.toString()` with `r.id` undefined.

`runSend` calls `reconcilePending(false)` at `:2612`, *outside* its own `try`. The throw escapes `runSend`,
escapes the click handler, and lands as an unhandled rejection. `lockForm(false)` runs in the `finally`, so
the form unlocks and the page looks completely normal. **The user presses Send and nothing happens and nothing
is said.** Every time.

It does not clear itself: the record is only dropped by a successful settle, which is the thing that throws.
"Forget what was delivered" (`:1841`) clears the *ledger* for the current run, not another run's pending
record, so the page's own remedy does not help. The remaining remedy is clearing site data — which destroys
the delivered ledger for every run and re-enables double payment across all of them. That escalation is why
this is high rather than routine, even though the immediate behaviour fails safe.

The same live-form read has a quieter consequence with no exception: a pending record for a *different token of
the same standard* is judged against the wrong contract's logs, so every row reads as unreported and the page
says *"the token reported 0 transfers in that transaction, which are now recorded, and N it did not report,
which stay held back. Check the transaction, then use 'Review held rows'."* That sentence is false — the page
never looked at that token's events. The rows correctly stay held, so the direction is safe, but the user is
being given a reason that is not the reason.

**Fix.** Carry the token, standard and decimals in the pending record (`addPending` already stores `chain`,
`bulk` and `via`), and have `arrivalsFromReceipt`, `confirmArrival`, `holdingsOf`, `groupKey` and
`readBatchReceipt` take them as arguments rather than reading the form. Separately, wrap `:2612` so a failure
inside reconciliation says so rather than killing the send in silence — `catch (e) { log('Could not read back
earlier batches: …. Nothing was sent.', 'bad'); return; }` — because a Send that does nothing and says nothing
is indistinguishable to the user from a page that is broken.

## S-3 · "Review held rows" can never confirm an ERC-20 or ERC-1155 row, and tells the operator the chain declined

**Category: should fix (high). DEMONSTRATED** (`audit-probe.mjs`, P5).
**`web/index.html:1817` calls `confirmArrival(rows, new Map())`; `:2090-2091` is where the empty map lands.**

`confirmArrival` judges fungible arrivals by a **before-and-after balance delta**. `$('review')` calls it with
`new Map()` as the "before". For every non-721 row, `before.get(k)` is `undefined`, so `:2091` pushes it
straight into `unknown` without the balance read mattering at all. **No ERC-20 or ERC-1155 row can ever come
back `arrived` from Review, whatever the chain says.**

The operator then sees, at `:1823-1827`:

> A batch sent on <date> has N lines **the chain will not confirm arrived**. … Release these to be sent again?

That is a statement about the chain's answer. The chain was asked and its answer was discarded; the page
structurally could not use it. P5 demonstrates this with `balanceOf` answering a large number for the
recipient — Review still reports every row unconfirmable, and the "now read as held by their recipient on
chain" line at `:1820` is unreachable for these standards.

This matters because it is the end of a funnel the page builds itself. `reconcilePending` tells the operator
*"Check the transaction, then use 'Review held rows'"*. Review then offers a release under a sentence
implying the chain has spoken. Acting on it means paying those recipients twice.

**Why it is not in the blocking section.** The confirm text that follows is correct, specific and strong:
*"Only do this if you have looked at that transaction and are satisfied they were not paid. If they were paid,
releasing them pays them twice."* An operator who does what that sentence says is safe. The page does not
release anything on its own initiative here. That is a real difference from B-1, and it is the whole
difference.

**Fix.** Use the evidence that works without a baseline: `reconcilePending` already settles this exact case
with `arrivalsFromReceipt(rc, rows)`, which reads the token's own Transfer/TransferSingle events out of the
stored `e.hash`. Review should do the same. Where genuinely no evidence is available, say so in those words —
*"this page kept no before-and-after reading for this batch, so it cannot tell you either way; the transaction
is the only record"* — rather than attributing the silence to the chain.

## S-4 · A hostile or broken RPC raises the batch cap above the un-measured fallback, and the page states the fabricated figure as a measurement

**Category: should fix. DEMONSTRATED** (`audit-probe.mjs`, P3).
**`web/index.html:303-304` (`measuredCap`/`maxBatch`), `:331-337` (`probeGas`), `:1936-1946` (`batchNote`).**

You wrote: *"a tiny answer only returns the cap to what it was before."* It does not. It doubles it.

`measuredCap()` is `Math.max(1, Math.floor(30_000_000 / (perRecipient * 1.15)))` and `maxBatch()` is
`Math.min(400, measuredCap() || 200)`. The un-measured fallback is **200**. An `eth_estimateGas` answer of
**21,001** passes both guards (`Number.isFinite`, `g > TX_BASE`), yields `perRecipient = 1`, and produces a cap
of **400** — twice the fallback, and the ceiling of the whole range. Demonstrated: `#batch.max` becomes `400`
and 400 is accepted with no clamp warning.

The guards do bound the *other* direction correctly, and I confirmed that: a huge answer drives the cap to 1
via `Math.max(1, …)`; `Number(bigint)` of an absurd value stays finite so `Number.isFinite` does not save you,
but the floor division does; a negative or sub-21,000 answer is rejected outright. The bound is real. It is
just not the bound you thought it was.

The worse half is what the page then says. `batchNote` renders, verbatim:

> This collection was measured rather than assumed: about **1** gas a wallet, so at most **400** fit inside one
> transaction's 32,000,000 gas.

The page is asserting a measurement, contrasting it with an assumption, and the number is nonsense from a
source the user does not control. The cost line goes the same way and under-states the fee.

**Cost.** Bounded and visible: a batch of 400 real transfers will not fit, so the transaction either fails
estimation and never goes out, or reverts out of gas and moves nothing. Wasted gas and a wasted afternoon, not
lost funds — which is why this is not blocking. But it is a fabricated number presented as a measurement,
which is the thing the whole probe was built to stop.

**Fix.** Sanity-floor the answer as well as ceiling it. Nothing that moves a token costs under ~21,000 gas of
its own; a plausible floor is the standard's cheapest observed cost, which you already have in
`fallbackPer()`. `if (g - TX_BASE < fallbackPer() / 4) return;` would reject 21,001 and keep the fallback. And
gate the word "measured": only claim it when `perRecipient` is inside a believable band, otherwise say the
chain gave an answer the page did not believe.

## S-5 · The measurement is never re-taken when the recipient list changes, only when the chain, token, standard or receiver-check does

**Category: should fix. DEMONSTRATED** (`audit-probe.mjs`, P4).
**`web/index.html:313-314` (`gasProbeKey`), `:318` (`orderForDelivery(rows)[0]`).**

You asked: *"Can an answer taken for one token ever be read for another, across a token change, a chain
change, a list change, or two probes in flight at once?"* Token, chain and standard: no — the key covers them,
and `if (gasProbeKey !== key) return;` after the await correctly discards an answer whose question changed, so
two probes in flight are handled. **List change: yes.** **Account change: also yes,** and that one is not on
your list.

`gasProbeKey` is `chain|token|standard|receiver-check`. It contains neither the row that was probed nor `me`.
The probe measures `orderForDelivery(rows)[0]` — the lowest id in the list — and `me` is baked into the
calldata as the `from`. Replace the list with entirely different ids of the same collection and the key is
unchanged, so `probeGas` returns at its first condition and the old number decides the cap. P4 demonstrates
it: two different lists, one probe ever sent, the cap unchanged. Switch accounts and the same thing happens,
with the additional wrinkle that the stale answer was measured for calldata naming a wallet that is no longer
connected.

**This is the answer to your ERC721A question.** You reasoned that probing the lowest id is safe "because the
list is delivered in ascending order and on a lazily-minted collection the first transfer is the dear one".
That holds for a contiguous ascending run starting at a batch-mint boundary — each transfer initialises the
next slot, so the walk is one step. It does not hold when the list is a *subset*. On a 10,000-token batch mint
where only slot 0 is initialised, transferring token 9,600 walks backwards ~9,600 uninitialised slots at cold
`SLOAD` prices. The probe would measure that honestly and drive the cap to 1 — conservative, and fine.

The dangerous version is the stale one this finding is about: measure a cheap contiguous list, then replace it
with a scattered one. The page keeps the cheap number and offers a cap sized for a collection it is no longer
sending.

**Also on the margin, since you asked "is 1.15 enough for a contract I did not measure":** probably, but there
is a class where it is not, and it is not exotic. The probe measures a transfer **by the owner**; BulkSend
transfers **as an operator**. Contracts that gate on `msg.sender != from` charge the operator path and not the
owner path. `getTransferValidator()` collections are detected and routed away (`:707`, `deliveryPath()` →
`'blocked'`), but the OpenSea `OperatorFilterer` pattern is not — its `onlyAllowedOperator` modifier is a
no-op when `from == msg.sender` and a cold external `CALL` into the registry otherwise. That is roughly
5,000–10,000 gas the probe never sees, on a base of ~40,000: **12–25%, against a 15% margin.** For a plain
ERC-20 the operator gap is the allowance `SLOAD` + `SSTORE`, ~3,000–4,000 gas, against a 15% margin on a
28,800-gas measurement — 4,320. Positive, but thin.

**Fix.** Two lines and one better idea:

- Put the probed row's id and `me` in `gasProbeKey`, so a list or account change re-asks. Cheap.
- Better, and it removes the whole owner-versus-operator argument: measure the thing you are actually going to
  send. Before the first batch, `estimateGas` the real `airdrop*(…)` call for a small slice (say 5 rows) with
  `from: me`, subtract `TX_BASE`, divide. That is the operator path, the loop overhead, the allowance write
  and the receiver check, all in one honest number, and it needs no margin guess at all. The page is already
  doing a `staticCall` of the whole chunk in preflight; this is the same call with `estimateGas` instead.

**Mitigating fact, which belongs in the record.** Nothing here can cause a silent over-send. `bulk[fn](...args)`
makes ethers estimate the real batch before broadcasting, so an oversized batch fails estimation and never
leaves the browser, and if it did the contract's `OutOfGasForBatch` reverts it. The cap being wrong costs a
failed attempt, never a partial delivery reported as complete.

## S-6 · `onlyOnce` releases the button while the first request is still live in the wallet, and says nothing has been sent

**Category: should fix. REASONED** (a demonstration would take 180 s of wall clock per case).
**`web/index.html:217-234`.**

You asked directly whether the three-minute window is wrong in either direction, and whether releasing it can
let two signatures reach the chain. It can, and the message is wrong about it.

`Promise.race([fn(), giveUp])` does not cancel `fn()`. At 180 s the race resolves, the `finally` sets
`signing = false` and re-enables the button — but the `eth.request` inside `fn()` is still outstanding, and in
MetaMask an unanswered request stays in the wallet's queue until the user acts on it. A user who presses again
at t=185 s and then answers *both* prompts sends two transactions. The log line at that moment says *"nothing
has been sent from here"*, which is true at that instant and not true about the future — it is the sentence
that invites the second press.

**Whether the window is right.** 180 s is a reasonable ceiling for a human answering a prompt, and shortening
it makes this worse rather than better. The problem is not the number, it is that release is unconditional.

**What it actually costs.** Very little, and that is why it is not blocking: `setApprovalForAll(x, true)` twice
is idempotent, `approve(bulk, total)` twice sets the same value twice (it is not `increaseAllowance`), and
`revoke` twice is idempotent. The cost is duplicated gas and the confusion of two prompts. It is worth fixing
because the fix is small and because the sentence is misleading, not because the current behaviour loses money.

**Fix.** Keep the release, change what it releases into. Set a flag when the timer fires, and on the next press
warn before proceeding: *"Your wallet still has the previous request open. Pressing again may produce a second
prompt; answering both will send two transactions."* Or re-arm the button in a distinct state ("Try again —
check your wallet first") rather than restoring `was`. Either way, drop "nothing has been sent from here" in
favour of "nothing has been sent yet, and the earlier request may still be waiting in your wallet."

**One related gap in the same guard.** `onlyOnce` refuses while `signing || sending`, but the Send handler
(`:2603`) refuses only while `sending` — it does not check `signing`. So Send is pressable while an Approve is
still unanswered in the wallet. The consequence is benign today (preflight reads the pre-approval state, finds
nothing deliverable, and stops without sending), but it is the same missing check the approve/revoke fix was
written for. `if (sending || signing) return;` at `:2604`.

## S-7 · An error message and a revert reason are attacker-controlled text presented as the page's own words

**Category: should fix. REASONED.**
**`web/index.html:2939-2947` (`decodeReason`), `:2948-2955` (`explainCallError`), rendered at `:2201`.**

When a token reverts with a standard `Error(string)`, `decodeReason` returns that string and the page prints it
as `skipped 0xabc…: <the token's words>` — with no attribution and no quotation. A hostile collection can
therefore write instructions that appear to come from the tool: *"Recipient blocked. Untick the safe-transfer
box and send again."* Everything is set with `textContent`, so there is no markup risk — the risk is entirely
that the sentence reads as the page's advice.

Second, smaller: `explainCallError`'s fallback loops over `KNOWN` and `OURS` doing `msg.toLowerCase().includes(sel)`
on the raw error text. A revert string containing the literal characters `0x64a0ae92` maps to the page's
"untick the safe-transfer box and a plain transfer reaches it" advice. The `e.data` branch runs first and
usually wins, so this needs an error object with no `data` — narrow, but the substring match over an
attacker-influenced string is not something you want in the path that decides which safety advice to give.

**Fix.** Quote and attribute: `skipped 0xabc… — the token says: "…"`. And in `explainCallError`, match the
selector only at the start of a hex payload, never as a substring of free text.

## S-8 · A 404 from the explorer passthrough is replaced by Cloudflare with the origin's `check.html`, stripped of every security header

**Category: should fix (high). DEMONSTRATED.**
**`deploy/publish.sh:183-185` — the `/x/` route forwards `upstream.status` verbatim.**

    $ curl -sS -D- -o /tmp/b.html \
        "https://rhcheck.gmgnrepeat.com/x/46630/tokens/0x0000000000000000000000000000000000000000"
    HTTP/2 404
    content-type: text/html; charset=UTF-8
    cache-control: no-cache
    server: cloudflare
    $ sha256sum /tmp/b.html web/check.html
    da5b5a6a…  /tmp/b.html
    da5b5a6a…  web/check.html

The upstream really 404s with 23 bytes of JSON. What reaches the browser is 104,486 bytes of `check.html` with
**none** of `secure()`'s headers: no `strict-transport-security`, no `x-content-type-options`, no
`referrer-policy`, no `cross-origin-opener-policy`, and no `content-security-policy` response header.

`frame-ancestors` cannot be expressed in a `<meta>` tag, so on this URL the Check page has **no framing
protection at all** — a page whose whole job is "read what you are about to sign", framable from anywhere, on
a host users have been told to trust. HSTS is also absent on a URL a visitor can land on first.

You already knew about this Cloudflare behaviour and worked around it: `publish.sh:219-221` says *"Cloudflare
replaces the headers on an error response from a worker, so a 404 here arrives without HSTS"*, and the Worker's
own catch-all returns 302 for exactly that reason. The `/x/` route was missed because its 404 is forwarded from
upstream rather than written literally. Adding any query string routes around it (`?cb=1` → 422 with all
headers), which is why it never showed up in testing.

**Why not blocking.** The page still carries its `<meta>` CSP, so script execution is still governed; the loss
is framing, HSTS and nosniff. And a framed Check page cannot be pre-filled at this URL — the deep-link
`?q=` reader at `check.js:1327` needs a query string, and a query string turns this response back into a
Worker-constructed 422. So the clickjacking value is real but thin: the page signs nothing.

**Fix.** Never forward a non-2xx upstream status. Return a fixed 200 with `{error:'upstream', status:…}` and
the full `secure()` header set; `check.js:223` already treats a 404 as "not found" and can read it from the
body. Then add a 404 case to `integrity.yml:71-86` — it currently tests a 400, two 302s and a 200, and 404 is
the one status Cloudflare intercepts, which is why this survived ten rounds.

## S-9 · The explorer passthrough serves third-party HTML, executable, from the tool's own origin, with no CSP

**Category: should fix (high). DEMONSTRATED.**
**`deploy/publish.sh:182-185`.**

    $ curl -sSi "https://rhcheck.gmgnrepeat.com/x/4663/stats" | head -4
    HTTP/2 403
    content-type: text/html; charset=UTF-8
    $ grep -o '<script[^>]*>' body.html
    <script nonce="DOFJtEJBlCeQJ38L0U5lyW">

5,733 bytes of a Cloudflare interstitial — a complete HTML document with an inline script — served from
`rhcheck.gmgnrepeat.com`. `secure()` replaces the upstream header set and contains no CSP, so the upstream's
own policy (which minted that nonce) is discarded and the inline script runs with no policy at all, in the
tool's origin. This is not a corner case: **every** `/x/4663/*` request returns it today, because Blockscout's
managed challenge now fires regardless of the spoofed user-agent that `publish.sh:173-176` was written for.

`const good = upstream.ok && content-type includes json` correctly refuses to *relabel* a bad response — but it
still streams `upstream.body` and copies the upstream `content-type`. Refusing to lie about the type is not the
same as refusing to serve the bytes. Compounding it, the Worker's `fetch` uses the default `redirect: 'follow'`
and appends `url.search` unfiltered, so the set of parties who can put a document on this origin is not "the
two explorer hosts" but "the two explorer hosts and anything they redirect to".

**Why not blocking.** Today the HTML is Cloudflare's, not an attacker's. Reaching it requires control of, or a
reflecting endpoint on, an explorer host. But a script in this origin can call `window.ethereum`, and the
wallet prompt would name `rhcheck.gmgnrepeat.com`.

**Fix.** Two lines: never pass `upstream.body` through when `!good`, and set `redirect: 'manual'`. Optionally
add `content-security-policy: default-src 'none'; sandbox` to `secure()`, so every non-page response is inert
by construction. Also worth correcting the now-false comment at `publish.sh:173-176`: the user-agent spoof no
longer works, and mainnet explorer lookups degrade on every request. (To Check's credit they degrade
*correctly* — `check.js:225` refuses a non-JSON body and reports "nobody could check" rather than "no source",
which is the false statement that code was written to prevent.)

## S-10 · The publish CSP gate counts hashes and checks nothing else, so `'strict-dynamic'` and a second inline script both publish cleanly

**Category: should fix (high). DEMONSTRATED** (the gate's own python blocks, extracted and run against
doctored copies; the repository files were not modified).
**`deploy/publish.sh:68` (the regex), `:74-95` (the gate).**

    === baseline ===                                PUBLISH GATE PASSED
    === 'strict-dynamic' added to script-src ===    PUBLISH GATE PASSED
    === 'unsafe-eval' 'unsafe-inline' added ===     PUBLISH GATE PASSED
    === https://evil.example added, default-src * ===  PUBLISH GATE PASSED
    === a second inline <script type="module"> ===  PUBLISH GATE PASSED
    === control: hash deliberately wrong ===        REFUSED (exit 1)
    === control: a second bare <script> ===         REFUSED (exit 1)

Two independent gaps.

**`'strict-dynamic'`.** With it present in `script-src`, host-source expressions are ignored and any script the
hashed inline script inserts loads from anywhere — which is precisely the property the hash was bought to
obtain. The gate ships it, because it only compares the *set of hashes* and never looks at the rest of the
policy.

**The counting regex.** `publish.sh:68` matches the literal `<script>`. `<script type="module">`, `<script >`
and `<script\n>` are invisible to it, so `assert len(blocks) == 1` still passes and the extra script is never
hashed. On its own that is fail-closed — the browser blocks an unhashed inline script. Combined with the first
gap, it is not. The same regex is in `web/sync.sh:22`, `test/web/client.test.mjs:339-341` and
`test/web/check.test.mjs:135-137`, so no layer catches it.

Trigger state: anyone editing the CSP line or adding a script tag with an attribute — a bad merge, a hasty fix,
a compromised authoring machine. The dirty-tree guard does not help, because a committed mistake is not dirty.

**Fix.** In the same python block, after the hash comparison: reject `'unsafe-inline'`, `'unsafe-eval'`,
`'strict-dynamic'`, `'unsafe-hashes'` and bare `*` anywhere in `script-src`; and diff the full set of non-hash
sources against a literal allowlist committed in the script, so an addition is loud and a deliberate change is
a one-line commit. Widen the regex to `<script(?:\s[^>]*)?>` and exclude tags carrying `src=`.

## S-11 · `/cdn-cgi/*` is answered before the Worker, so `SECURITY.md`'s HSTS claim is false, and zone-level "Always Use HTTPS" is off

**Category: should fix. DEMONSTRATED.**

    $ curl -sSI http://rhairdrop.gmgnrepeat.com/cdn-cgi/trace
    HTTP/1.1 404 Not Found
    Server: cloudflare
            <-- no Strict-Transport-Security, and no 301
    $ curl -sSI https://rhairdrop.gmgnrepeat.com/cdn-cgi/trace
    HTTP/2 404
            <-- no strict-transport-security

`/cdn-cgi/` is reserved by Cloudflare and handled ahead of any Worker, so `secure()` cannot reach it. The
absence of the redirect on the HTTP side also proves the zone-level **"Always Use HTTPS" is off** — the 301 you
do get on `/` comes from the Worker (it carries `cross-origin-opener-policy`), so the only thing pinning HTTP
visitors to HTTPS is code that cannot run on this namespace.

`SECURITY.md:12-14` says: *"Plain HTTP is redirected permanently, and every HTTPS response carries
`Strict-Transport-Security` — the successes, the redirects and the errors alike."* It is not "every". Practical
exposure is narrow — a visitor's first-ever contact would have to be a `/cdn-cgi/*` URL over HTTP — but the
Cloudflare beacon posts to `/cdn-cgi/rum` on this same host, so it is a routinely-hit namespace.

**Fix.** Enable zone-level HSTS and "Always Use HTTPS" in the Cloudflare dashboard; those apply to
Cloudflare-generated responses, which is the only layer that can cover `/cdn-cgi/*`, WAF blocks and 5xx
interstitials. Keep the Worker headers as defence in depth. Then the sentence in `SECURITY.md` becomes true.
Add a `/cdn-cgi/trace` assertion to `integrity.yml` so it stays true.

## S-12 · The contract counts an ERC-721 or ERC-1155 delivery without ever reading the call's return data

**Category: should fix. DEMONSTRATED** (`test/AuditProbe.t.sol`, `test_probe_F1a…`, `test_probe_F1b…`).
**`src/BulkSend.sol:158-171` (721 lenient), `:174-179` (721 strict, `sent = n`), `:225-232` (1155 lenient).**

The ERC-20 path is careful to a fault: three outcomes, and anything that is not exactly empty or exactly the
word `1` reverts `AmbiguousResult` (`:297-298`). The 721 and 1155 paths have no counterpart — `ok` alone means
delivered.

Point `airdrop721` at an ERC-20 that returns `false` rather than reverting (the repository's own
`test/RealTokens.sol:65` `False20` is this shape) and the contract reports `sent = 3, skipped = 0` with all
three balances still zero. That is "records a recipient as delivered when they may not have been paid" — the
second half of promise 2 — and it is silent. Worse, with the ERC-20 approved, `airdrop721(erc20, to, ids, …)`
reads `ids[i]` as an *amount*: 100e18 and 250e18 demonstrably left the sender and landed in the recipients,
reported as a 2-NFT airdrop.

**Why it is not blocking.** Through the page it is close to unreachable and, where reachable, caught. The page
picks the standard from the contract (`detectStandard`, `:346-352`) and corrects the dropdown, so an ERC-20
with `decimals()` never reaches `airdrop721`. More importantly, the page does not believe the contract's
counters: `confirmArrival` asks the chain afterwards, and for a 721 batch that means `ownerOf(id)`, which for
an ERC-20 masquerade reverts and lands every row in `unknown` — held, not recorded. That post-hoc chain read is
the thing that keeps a contract-level correctness gap from becoming a user-level one, and it deserves to be
said out loud rather than assumed.

**But the contract is a public, verified artifact** and the repository makes this promise about it directly. If
anyone builds a second client on it, this becomes their blocker.

**Fix.** In the lenient 721/1155 branches, after `ok`, require `returndatasize() == 0` — ERC-721
`transferFrom`/`safeTransferFrom` and ERC-1155 `safeTransferFrom` all return void — and otherwise
`revert AmbiguousResult(dst, i)`, the same shape the ERC-20 path already uses. In strict mode, stop asserting
`sent = n` for a call whose answer was never read. One comparison per row.

## S-13 · `ZERO_REASON` is the selector of an error this contract does not declare

**Category: should fix (minor). DEMONSTRATED** (`test/AuditProbe.t.sol`, `test_probe_F2…`).
**`src/BulkSend.sol:112`.**

`bytes internal constant ZERO_REASON = hex"9fabe1c1"` is `AddressZero()`. The contract's own error is
`ZeroRecipient(uint256)` = `0xef28bd44`. `grep -rn 9fabe1c1` over the whole repository, `web/` included,
returns exactly one hit — the constant itself — so nothing in this codebase can decode it, and
`decodeReason` falls through to "reverted with 0x9fabe1c1". A user whose spreadsheet contained a blank row gets
an unnamed reason in the one case where the contract knows the answer exactly.

**Fix.** `hex"ef28bd44"`, or better `abi.encodeWithSelector(ZeroRecipient.selector, i)` so the reason carries
the row, and add `ZeroRecipient` to the page's `OURS` table.

## S-14 · Smaller things, grouped

Each of these is real and small. File and line, what it costs, and the fix, in one line each.

- **`web/index.html:2141-2145` — `arrivalsFromReceipt` never checks the `from` field of a Transfer event.**
  A token that credits the recipient from somewhere else in the same transaction (a reflection, a mint, a
  rebase) counts toward `got`. Add `addr(l.topics[1]) === me` for the 721/20 cases and check the `from`
  argument for `TransferSingle`. Strictly better, no downside.
- **`web/index.html:2682` — `lastManifest` survives a cancelled confirmation.** Press Send, read the plan,
  cancel; "Download the exact list" stays enabled and hands over a manifest of a send that never happened,
  under a button whose comment calls it "the signed plan". Clear it in the cancel branch, and again on `break`
  from the send loop so it describes what went out rather than what was planned.
- **`web/index.html:516-531` — `eth.on('accountsChanged')` and `eth.on('chainChanged')` are registered on
  every successful `connect()` with nothing ever removed.** Reconnecting twice runs the handler twice; a
  handler left on a *disconnected* provider can still fire and clear `me`/`provider`/`signer` for a wallet the
  user has since replaced. The `sending` guard covers the dangerous window; outside it, the page can
  spuriously disconnect. Keep the handles and `removeListener` in `disconnectWallet`.
- **`web/index.html:645-653` — after `askWallet` times out on `wallet_switchEthereumChain`, the page
  immediately fires `wallet_addEthereumChain`.** Two requests are now queued in the wallet; the second usually
  errors `-32002`, and the page then tells the user their wallet "would not switch", which is not what
  happened. Also, the timed-out request's eventual rejection is unhandled. Distinguish "did not answer in
  time" from "refused" in `showManualNetwork`, and attach a `.catch(() => {})` to the losing promise.
- **`web/index.html:2013-2020` — `syncGasRow()` is not called from `plan()`,** so the gas-allowance row and its
  warning can be stale after a standard or delivery-path change. One line in `plan()`.
- **`deploy/publish.sh:296` — a deliberate `NO_PHONE_WALLET=1` publish exits 1** with a false "connector: DOES
  NOT match", because the guard tests `[ -f web/wc.js ]` rather than whether the connector was configured. It
  trains the operator to ignore the script's exit code. `[ -n "${WC_BUNDLE_URL:-}" ]`. Related: `NO_PHONE_WALLET`
  is the only bypass flag that announces nothing when in effect, and neither it nor `ALLOW_DIRTY_PUBLISH`
  appears in the script's own header block at `:10-21`, while `deploy/local.env` is sourced at `:29` before any
  gate — so a flag left uncommented there is a permanent silent bypass.
- **`.github/workflows/integrity.yml` — the monitor has exactly one notification channel, and GitHub disables
  scheduled workflows in a public repository after 60 days of no repository activity.** The quiet stretch is
  the one worth monitoring. Add the badge to `README.md` so the state is public rather than private to one
  inbox, add a failure step that opens an issue (`issues: write` scoped to that job), and note the 60-day rule
  in `docs/for-reviewers.md`.
- **`.github/workflows/tests.yml:16` — `actions/checkout` leaves `persist-credentials` at its default** while
  the job then runs PR-controlled code (`forge test`, `npm ci` with its lifecycle scripts, `npm test`,
  `npx esbuild` from the PR's own lockfile). The blast radius is genuinely tiny — `pull_request` not
  `pull_request_target`, `permissions: contents: read`, no secrets, a read-only fork token — so the realistic
  loss is Actions minutes. `persist-credentials: false` on both checkouts makes the argument complete.
- **`README.md:202-203` says "eight external audits"; there are ten** (`ls docs/audit-*.md | wc -l` → 10), and
  `SECURITY.md` and `docs/for-reviewers.md` both say ten. Understated rather than overstated, but a reader who
  counts finds the repository wrong about itself on a checkable number.
- **`web/index.html:2911` — `0x1de5204e` has no provenance in the repository.** It resolves (Openchain) to
  `StrictAuthorizedTransferSecurityRegistry__UnauthorizedTransfer()` and the plain-English rendering is
  correct, but it is not in 4byte.directory, so a reviewer cannot check it from the obvious place. One source
  comment.
- **`src/BulkSend.sol:364-380` — `_mustBeContract`'s comment overstates what it does.** It says the guard
  exists because "a low-level call to an address with no code succeeds with empty return data, which is also
  what USDT-style tokens return on success". A single `0x00` byte is code: `vm.etch(addr, hex"00")` passes the
  guard and produces the identical empty success through all six entry points. The hole cannot be closed on
  chain and you already document it honestly in the README's "what it cannot promise" — the fix is to reword
  the comment to say it refuses EOAs, which is what it does.


---

# BLOCKS RELEASE — the Check page

Four of the five below were found on the request reader and the transaction renderer. All were confirmed by me
in source after being demonstrated in a browser against a mocked chain. They share one root cause, stated once
at the end.

## B-2 · Calldata that lost its `0x` is silently replaced with empty calldata, and the page answers "No calldata: this is a plain transfer of ETH"

**Category: blocks release. DEMONSTRATED, and confirmed in source.**
**`web/check.js:998-1001` (`readTransaction`), rendered at `:867`. Contrast `:956` in the envelope reader.**

Paste this — an unlimited `approve`, with the `0x` prefix dropped, which is among the most common things that
happens to a hex string on its way through a chat window, a spreadsheet cell or a copy that caught one
character short:

    {"to":"0x2222…2222","data":"095ea7b3…ffffffff"}

The page answers, verbatim:

> **No calldata: this is a plain transfer of ETH.**  ·  would succeed  ·  about 47,272 gas

There is no note anywhere that the calldata could not be read. `readTransaction` does
`data: HEX.test(data) ? data : '0x'` and moves on. The page then simulates `0x` — different bytes from the ones
in the box — and reports a green verdict about them.

Thirty lines earlier, the `wallet_sendCalls` reader has exactly this check and refuses by name: *"Entry N has
calldata that is not whole bytes of hex, so what it would run cannot be read."* Same file, same paste, opposite
answer.

**What it costs the user.** This is the pre-signature path — the one the tool exists for. A user checking
whether it is safe to sign is told there is no contract call at all, in the sentence the page is built around,
with a green pill next to it. They sign an unlimited approval. Everything of that token in the wallet is then
spendable by the spender, at any time.

**Fix, checkable later.** Give `readTransaction` the same `invalid` path the envelope reader has: when
`HEX.test(data)` fails, mark the call unreadable, suppress the sentence, suppress the verdict pill, and say
what is wrong. Never substitute `'0x'` for something that was not empty. A test that pastes de-prefixed
calldata and asserts the words "plain transfer of ETH" do **not** appear.

## B-3 · A transaction whose body cannot be read is described as "A plain transfer of ETH, with no contract call"

**Category: blocks release. DEMONSTRATED, and confirmed in source.**
**`web/check.js:648` and `:651`, rendered at `:678` and `:688`.**

```js
const [tx, rc] = await Promise.all([p.getTransaction(hash).catch(() => null),
                                    p.getTransactionReceipt(hash).catch(() => null)]);
if (!tx && !rc) { … return; }                       // only catches BOTH missing
const parsed = tx ? parseData(tx.data, …) : { empty: true };   // no tx ⇒ "empty", not "unknown"
```

`{ empty: true }` is the page's word for *this transaction really had no calldata*. It is being used here for
*I could not read the calldata*. Those are opposite statements and the renderer cannot tell them apart. With
`tx === null` and a receipt present, the page prints:

> **A plain transfer of ETH, with no contract call.**  ·  succeeded  ·  To: **a new contract**
> What it announced moving: 0x…dEaD lets 0x…1111 spend **an unlimited amount** of TT — out of your wallet

Three false statements in the headline — it was not a plain transfer, there was a contract call, and no
contract was created — sitting directly above a movements list that contradicts all three.

**Trigger.** Either leg of that `Promise.all` failing on its own. ethers batches JSON-RPC calls by default, so
both requests usually travel in one HTTP body and a node under load can perfectly well return an error object
for one sub-request and a result for the other. A non-archive node that has pruned the transaction while
retaining the receipt does the same thing deterministically.

**What it costs the user.** The commonest reason a non-technical person pastes a transaction hash into this
page is "what did that actually do to me?" — after a suspicious signature, after a drainer scare, after a
dapp asked for something. Answering "a plain transfer of ETH, with no contract call" is a false all-clear on a
live, unrevoked, unlimited approval. They do not revoke.

The file's own comment at `:243-248` says this must never happen — *"a false all-clear built out of a
timeout"*. That lesson was applied to `getCode` and not to `getTransaction`.

**Fix.** Distinguish the two states. When `tx` is null and `rc` is not, say the transaction body could not be
read from this node, and suppress the lede, the "a new contract" rendering and the `Function` row entirely.
Render the receipt-derived movements — they are real — under a heading that says the body is missing.

## B-4 · `chainId` on `eth_sendTransaction` is read by nobody, so the page answers about a different chain without saying so

**Category: blocks release. DEMONSTRATED, and confirmed in source.**
**`web/check.js:905-906` (`TX_FIELDS` contains `'chainId'`, so it is not even reported as unrecognised) and
`:998-1002` (the returned object has no `chainId`). Contrast `:1148-1159`.**

Paste `{"method":"eth_sendTransaction","params":[{"from":…,"to":"0x…","data":"<approve max>","chainId":"0x1"}]}`
with the page set to Robinhood Chain testnet. The page produces the whole answer — sentence, `would succeed`,
gas, decoded arguments, movements, contract card — read against chain **46630**, and the string `chainId`
never appears anywhere in the output.

The `wallet_sendCalls` reader refuses the identical situation, in the page's own words: *"the same address is a
different contract on a different chain, and an answer from the wrong one is worse than none."* It is right,
and it is the same page.

**What it costs the user.** A confident, green, fully-decoded description of the wrong contract. The address
in the request may be a harmless token on 46630 and a drainer on chain 1. The user is told what the harmless
one does.

**Fix.** Read `o.chainId` in `readTransaction`, carry it on the returned shape, and route it through the same
check the envelope path uses. Note that a single call bypasses the batch renderer via the `kind:'call'` fast
path at `:1047-1050`, so the check has to be in `go()`'s call branch as well as in the batch branch.

## B-5 · When the token standard cannot be settled, the headline sentence picks ERC-20 — while the arguments beside it correctly say "token id or amount"

**Category: blocks release. DEMONSTRATED, and confirmed in source.**
**`web/check.js:406` (`const nft = t.standard === 'ERC-721' || t.standard === 'ERC-1155'`) against `:707`
(`relabel`).**

This is the answer to your question — *"find another place where an ambiguity in the input is resolved by
picking an answer instead of reporting the ambiguity"*. It is not in the request reader this time. It is in the
sentence.

`t.standard` is **three-state**: `'ERC-20'`, `'ERC-721'`/`'ERC-1155'`, or `null` meaning *unknown*. `null`
happens whenever `supportsInterface` is absent or unanswered **and** `decimals()` is absent or unanswered —
which covers a great many unverified NFT contracts, and covers *every* contract when the node is flaky, because
`readAddress:337-343` collapses "no such function" and "the node did not answer" into the same `null`.

`describeCall` reduces three states to two with `=== 'ERC-721' || === 'ERC-1155'`, so unknown becomes *not an
NFT* and the ERC-20 sentence is written. For `approve(0x…1111, 1)` on such a contract:

> **Let 0x…1111 spend 1 of your Mystery Punks, now and at any time in the future, until you take it back.**
>
> The arguments it is asking for:
> spender · address · 0x…1111
> **token id or amount** · uint256 · 1

The page contradicts itself inside one card. `relabel` at `:707` has the three-state logic and reports the
ambiguity honestly; the lede — the sentence a non-technical reader actually reads — picks. The code already
knows that it does not know.

`transferFrom(a, b, 7)` on the same contract renders "Move 7 from … to …", the amount reading of what may be
NFT #7.

**What it costs the user.** They read "spend 1" — a trivial amount — and approve. What they approved was
operator rights over NFT #1, or, with `setApprovalForAll` reached the same way, over the whole collection.
That is a specific NFT, gone.

**Fix.** Make `describeCall` take the standard as three states, as `renderArgs` already does. When it is
`null`, either withhold the sentence and say the contract does not identify its standard, or write both
readings: *"spend 1 — or approve NFT #1; this contract does not say which."* The wording exists twelve lines
away.

## The one root cause behind B-2, B-4 and S-15

`readEnvelope` validates every field it reads and reports what it could not read. `readTransaction` validates
nothing: `to` is not checked as an address, `data` is coerced, `value` is passed through raw, `chainId` is
dropped. Whichever reader a paste happens to land in decides whether the page is careful.

That is not four bugs, it is one: **the `eth_sendTransaction` path was never given the schema discipline the
`wallet_sendCalls` path was rewritten to have.** Fixing it as four separate patches will leave the fifth.
Extract one `readCall(o, index)` that both readers use and that returns `{to, data, value, invalid}` with the
same rules, and make the transaction reader a one-call envelope. It is also why `to: "not-an-address"` inside a
pasted list renders as *"An entry with no `to` is usually a contract being created"* (`:1246`) — the wrong
explanation, where the envelope reader would have named the problem.

---

# SHOULD BE FIXED — the Check page

## S-15 · `value` on the transaction path is never checked as a hex quantity, and the page states an ETH figure from it

**Category: should fix (high). DEMONSTRATED, and confirmed in source.**
**`web/check.js:1001` (`value: o.value`), consumed at `:869` and `:620`. Contrast `:960-961`.**

`{"to":"0x…","data":"0x","value":"1000000000000000000"}` renders **`1.0 ETH attached`**. `value` is a hex
quantity per JSON-RPC and EIP-1474; a decimal string is not one. The envelope reader checks it with `HEX_QTY`
and carries the comment that explains exactly this trap: *"'1' is not one wei here. This field is a hex
quantity, and a decimal that looks like a small number is exactly the shape something else would read as a
very different amount."*

**Why I am not putting this in the blocking section**, having considered it: the harmful reading requires a
client that hex-prefixes rather than refusing, and neither I nor the reviewer who found it verified that any
wallet does. If a wallet refuses, the user gets an error. If a wallet reads it as decimal wei, the page's
figure is correct. What is certainly wrong is that the page states a specific amount for a field whose
interpretation is genuinely ambiguous, when its own other reader refuses the identical input. That is a real
defect and a real inconsistency; it is not a demonstrated route to loss.

**Fix.** Apply `HEX_QTY` in `readTransaction`. On failure, report the value as unread rather than converting
it.

## S-16 · The unlimited-approval warning fires only for `approve`, and misses the two shapes that matter most

**Category: should fix (high). DEMONSTRATED.**
**`web/check.js:822-823`; inner calls `:522-525`; threshold `:394`.**

`approve(spender, 2^256-1)` gets the red box: *"at any point in the future, in any amount, without asking
again."* `increaseAllowance(spender, 2^256-1)` renders as ordinary grey prose with **no** note.
`permit(owner, spender, 2^256-1, …)` likewise. `increaseAllowance` is the standard route on tokens that make a
bare `approve` awkward, and `permit` is how an allowance is granted from a signature — the two most dangerous
approval shapes get the weakest treatment. The same gap repeats one level down: an unlimited
`increaseAllowance` inside a `multicall` gets no inner-call warning, while an unlimited `approve` there does.

Also `UNLIMITED` is `>= 2^200`. An approval of 2^199 is unlimited against every real token supply and gets
nothing at all.

**Fix.** Warn on the *argument*, not the selector: any of `approve`/`increaseAllowance`/`permit` whose amount
exceeds `totalSupply()` where it is known, and a much lower absolute threshold where it is not.

## S-17 · A refused input leaves the previous answer on screen

**Category: should fix. DEMONSTRATED.**
**`web/check.js:1081`, `:1087`, `:1088`, `:1268` — every early return in `go()` calls `say()` without `out()`.**

Ask a question, get a full green answer. Then paste `{"method":"personal_sign", …}`. `#msg` correctly says
`personal_sign` is a method this page does not read. `#out` still holds the entire previous card,
byte-identical. Same for empty input, an invalid sender address, and a cancelled address prompt.

This defeats the invariant the page states and tests at `:642-643` — *"the answer on screen always belongs to
the box above it"* — and it defeats it in the direction where a user believes a green verdict belongs to a
request the page refused to read. The not-found-transaction path at `:650` already calls `out()`, so the
pattern is established.

**Fix.** `out();` before each of those returns.

## S-18 · `owner() == 0` is stated as fact, and the sentence that qualifies it renders only in the other branch

**Category: should fix. DEMONSTRATED.**
**`web/check.js:764` against `:789`.**

A verified contract whose function names match no POWERS regex renders:

> Owner — **nobody: ownership has been given up**
> No function name in the published source matched the short list of names this page recognises.

The qualifier — *"plenty of contracts gate privileged functions on roles or their own rules instead, so on its
own it does not mean nobody can use them"* — is nested inside the `powers.length ? … : …` branch and does not
render. The two lines that do render read as "nothing dangerous, and nobody owns it" about a contract that may
be entirely `AccessControl`-gated. **Fix:** move the qualifier out of the powers branch, or fold it into the
`Owner` value itself.

## S-19 · Smaller Check-page items

- **`web/check.js:996` — `data` and `input` both present and different: one is picked, silently.**
  `{"to":…,"data":"0x06fdde03","input":"<approve max>"}` is described entirely from `data`; neither the word
  "input" nor "unlimited" appears in the output. The envelope reader flags a stray `input` explicitly at
  `:987`. go-ethereum rejects a transaction where both are set and unequal; other clients differ — which is
  precisely a case to report rather than resolve. Refuse, or show both.
- **`web/check.js:1127` — the green all-calls verdict is withheld for capabilities and schema problems but not
  for `notes`.** `unread = caps.length > 0 || schemaProblems.length > 0`. A `wallet_sendCalls` whose second
  call carries `input` instead of `data` fires a note, describes that call as "A plain transfer of ETH", and
  still earns the unqualified `run in order, every call succeeds`. A dropped field is exactly as much "part of
  the request not read" as a capability is. `unread = caps.length || schemaProblems.length || notes.length ||
  invalidMembers`.
- **`web/check.js:911` — a `chainId` with a leading zero is refused as "not a hex string".** I checked this
  against EIP-5792 rather than against the repository's description: the normative text does say "no leading
  zeroes", so refusing is defensible — **but the EIP's own example request uses `"chainId": "0x01"`.** The
  failure direction is safe, so this is not blocking; the message is what is wrong. Say "names chain 46630,
  written with a leading zero, which the specification does not permit", not "cannot be read".
- **`web/check.js:363` — `knownFunctions` assumes the ABI is an array.** `if (o.abi && o.abi.length)` is true
  for a JSON *string* ABI, which some Blockscout deployments return and which `ethers.Interface` accepts.
  Iterating a string yields characters, the list comes back empty, and the page reports *"No function name in
  the published source matched"* with `complete: true` — a false all-clear produced by a shape mismatch.
  `Array.isArray(o.abi)`. (REASONED; the live explorer's response type was not confirmed.)
- **`web/check.js:288` and `:483` — explorer-supplied values reach `ethers.getAddress` and
  `new ethers.Interface` outside any try.** A malformed explorer response throws into `go()`'s catch and prints
  "That did not work: …" instead of a page. Not a false statement, but the file is otherwise careful to keep
  the chain-only reading alive when the explorer misbehaves, and this is the one place that is not.
- **`web/check.js:183` and `:597` — chain-supplied strings are inserted at full length.** Text-only, so not
  XSS; a contract returning a megabyte `name()` or revert string puts a megabyte into the lede. Truncate.
- **`web/check.js:499` — `upgradeToAndCall`'s inner call is shown as going *to* the new implementation**, and
  the page then reads that address's own token state to describe it. It is `delegatecall`ed in the proxy's
  storage context. Right function, wrong address.

---

# INHERENT LIMITS OF DOING THIS IN A BROWSER

These cannot be engineered away against contracts and endpoints nobody controls. For each, what the software
should *say*. Several are already said well; where that is so, I say so, because the point of this section is
to distinguish "unsolved" from "solved by being honest".

## I-1 · A lying RPC endpoint

The pages read the chain through two hardcoded endpoints the user does not control and cannot override. The
three-state discipline throughout both files — reachable / said no / could not ask — covers *unreachable*, not
*dishonest*. An RPC returning `0x` for `getCode` makes a live contract read as an ordinary wallet with no
code. One returning `status: 0x1` makes any call "would succeed". One returning fabricated logs makes the
movements list fiction. On the airdrop side, one returning a plausible `estimateGas` shapes the batch.

**Say:** the airdrop page's footer already says the explorer is the final word about delivery. Check's footer
says only that everything is read from the chain. It should say *which* node, and that everything on the page
is that node's account of the chain. One sentence. It is the difference between a claim about reality and a
claim about a source.

## I-2 · A token that lies about its own state

`confirmArrival` is the strongest evidence a browser can get — the token's own answer about its own storage,
compared before and after — and the airdrop page says so in exactly those words at `:2122`: *"That is the
token's own answer about its own state, which is the strongest evidence available from a browser and still not
proof: a token written to lie can lie here too. The transaction is the record."* That is the right sentence and
I would not change it.

The recovery path is weaker and the page also says so at `:2294-2296` — a receipt's `Transfer` events are what
the token *claims* it did. Both disclosures are correct. **The remaining gap is small:** `arrivalsFromReceipt`
does not check the `from` field of those events (S-14), so a token that credits a recipient from elsewhere in
the same transaction counts toward delivery. That part is fixable and should be.

## I-3 · A wallet that reports a chain it is not on

`onSelectedChain` asks the wallet what chain it is on and believes the answer, because there is nothing else to
ask. Every *read* goes through the page's own RPC, so the exposure is narrow: a lying wallet means a signature
built for the wrong chain, which usually fails replay protection. The one that bites is `setApprovalForAll` or
`approve` sent to a token address that happens to hold a different, valuable contract on the chain the wallet
is really on.

**There is a partial defence available and it is worth the twenty lines:** ask the wallet's provider for a
block hash the page's own RPC just returned (`eth_getBlockByNumber` on the wallet's transport, compare
`hash`), and refuse to sign if it does not know it. That turns "the wallet says 46630" into "the wallet can see
the chain the page can see". It does not cover a wallet that proxies reads honestly and signs dishonestly —
nothing in a page can — but it closes the ordinary misconfiguration.

**Say, meanwhile:** nothing currently tells the user that the network name in the confirmation is the wallet's
own claim.

## I-4 · The delivery ledger is one browser profile

`localStorage`, scoped to chain, account, token and standard, keyed on parsed values with an occurrence number,
guarded by a cross-tab Web Lock, reconciled against the chain before it is trusted. That is about as far as a
browser goes, and the design is right. It still cannot help another browser, another device, a cleared cache or
a private window. **The footer says this, in plain words, and says the chain is the record. That is the correct
answer and it is already given.**

## I-5 · Name-matching is not behaviour analysis

Check reads function names against a list. A privileged function named something the list does not recognise is
invisible, and a harmless function named `mint` is flagged. The page says this repeatedly, frames the powers
section as a floor rather than a ceiling, and never contradicts itself about it — **except** at S-18, where the
qualifier fails to render in one branch. Fix that and this is honest.

## I-6 · The gas measurement is a measurement of the wrong call, by construction

The probe measures an owner's transfer; BulkSend performs an operator's. There is no way to estimate the real
`airdrop*` call before the approval exists, and no way to estimate the approval's effect without it — so some
gap is unavoidable. But it is not as unavoidable as the current design assumes: after the approval, and after
the first batch, the real numbers exist (`rc.gasUsed / chunk.length`). See S-5. What genuinely cannot be
removed is the first batch's estimate. **Say:** the batch cap is an estimate for the first transaction and
measured thereafter — which is both true and reassuring, rather than the present claim that the collection
"was measured".

## I-7 · A hostile collection writes the words in the picker and in the skip reasons

Metadata names, revert strings and images all come from whoever deployed the collection. The page handles the
markup risk correctly and comprehensively (see below). What it cannot do is stop a collection from writing
persuasive English. **Say:** attribute it. See S-7.

## I-8 · `import()` cannot carry Subresource Integrity

`web/index.html:450` imports `./wc.js` as a module, and a dynamic import has no SRI. Every link either side of
the browser is digest-checked; the browser itself checks nothing. This is not a route to unreviewed code —
everything cached *was* verified when fetched — it is a route to **un-revocable** code, because the Worker
serves it with `max-age=86400` on an unversioned URL. **The fix is available and the live Worker already
accepts it:** have `publish.sh` inline the digest into the page and import `'./wc.js?v=' + WC_DIGEST`, so the
browser's cache key is digest-bound. Verified working:
`curl -sSI "https://rhairdrop.gmgnrepeat.com/wc.js?v=d4c35a1b…"` → 200.

---

# EXAMINED AND FOUND SOUND

Silence elsewhere in this report means these were looked at.

## The contract

- **Promise 1 holds completely.** No owner, no admin, no initializer, no upgrade path, no `delegatecall`, no
  `selfdestruct`, no arbitrary-call primitive, no `receive`/`fallback`, no constructor, no storage. `from` is
  `msg.sender` at all six call sites — there is no path by which a third party's approval can be spent, tested
  across all three standards in both modes. `token` is fixed before the loop and never re-read. Storage slots
  0–3 and the transient slot verified zero after a batch; `owner()` and `upgradeTo()` verified absent.
- **The reentrancy lock.** Slot constant verified as `keccak256("bulksend.reentrancy.v1") - 1`. A reentrant
  recipient is skipped **and genuinely unpaid** — verified with sender and recipient separated so the balance
  is a real check, not a tautology.
- **The gas stipend under EIP-150 is the best thing in this repository.** `:336` requires
  `g - g/64 >= stipend + GAS_RESERVE` *before* the call, so `call(stipend, …)` forwards exactly the stipend
  rather than a silently clamped 63/64. The consequence is the property that makes the counters trustworthy at
  all: **the delivered set does not depend on the transaction's gas limit.** Verified identical `sent`/`skipped`
  and identical ownership at 6M, 15M and 30M with a gas hog and a return bomb in the batch, and swept 300k→3M
  in 150k steps asserting at every point that either the batch reverted having moved nothing, or `sent`
  equalled what actually moved. A caller cannot under-fund a batch into silently paying fewer people.
- **`GAS_RESERVE = 40,000` is sufficient** — worst-case post-call work is a `LOG3` with a 128-byte reason plus
  the summary event, an order of magnitude under. Verified empirically at both `MIN_GAS` and `MAX_GAS`.
- **A gas-starved inner call cannot leave persisting state**, so counting it skipped is honest. The only
  "paid then reported failed" shape would be a token that succeeds and answers wrong, which is what
  `AmbiguousResult` catches on the ERC-20 path.
- **Return-data truncation cannot manufacture a success**: a token that moves nothing and answers success with
  192 bytes is truncated to `REASON_CAP` and still refused, both modes.
- **Counters reconcile against real balances** on a mixed 12-row lenient ERC-20 batch with a blocklist.
- Array-length agreement, empty batches, duplicate recipients, EIP-7702 delegate detection (and its
  non-false-positive on a 23-byte non-delegation account), and per-recipient gas scaling (36,017 / 35,509 /
  35,469 at n = 50 / 200 / 400 — flat, not quadratic) all verified.
- **`foundry.toml`** pins `solc 0.8.36` and `evm_version = cancun`; reproducible. **Deploy scripts** take no
  constructor arguments and have no post-deploy configuration step.
- **Deployed runtime bytecode is byte-identical to what this repository builds** (16,330 characters).

## The airdrop page

- **The ledger's core is right, and it is the part that matters most.** The run key is frozen when the lock is
  taken (`sendRunKey`), `ledgerKey()` throws rather than falling back to `anon`, no wallet-disconnect handler
  clears `me` while `sending` (I checked all four: `disconnectWallet:402`, `accountsChanged:519`,
  `chainChanged:517`, the WalletConnect `disconnect:477`), `writeDeliveredFor` reads back after writing,
  `commitDelivered` records and releases together or does neither, and a failed commit breaks the send rather
  than continuing. `LEDGER_CAP` fails closed. Nothing is silently evicted. The occurrence numbering (`#n`)
  handles repeated identical lines and degrades in the conservative direction when the list is edited.
  **B-1 is the exception to this, not the rule** — everything routed through `commitDelivered` is correct.
- **The two-tab guard is real.** `navigator.locks.request(..., {ifAvailable: true})` with a genuine refusal to
  send when the lock is unavailable, and an explicit refusal to send at all when `navigator.locks` is absent
  rather than a silent downgrade.
- **`readBatchReceipt` is careful in a way I tried and failed to break.** Events must come from the BulkSend
  address, name this token, name this sender; exactly one summary; `sent + skipped` must equal the chunk
  length; every `Skipped` must bind to a distinct unclaimed row matched on address *and* id *and* amount; and
  any event that cannot be tied to a row sets `ambiguous`, which stops the run. A hostile recipient's receive
  hook cannot forge its way into this.
- **`confirmArrival` groups by address rather than by row**, so two rows paying one wallet are judged together
  and a short total attributes neither. Four outcomes, not two, and only `arrived` is ever written.
- **`orderForDelivery`** sorts BigInt ids numerically with the correct comparator, and the reasoning behind
  ascending order is right and measured.
- **`looksGenerated`** requires two independent signals before it will say a list looks counted, explicitly to
  avoid libelling vanity addresses, and its wording is careful that it can never say the reverse.
- **`shuffled` uses `crypto.getRandomValues`**, not `Math.random`.
- **Mainnet is off behind two independent gates** — `LIVE_CHAINS` checked first in `deliveryPath()`, and the
  `<option value="4663" disabled>` — plus a third, `bulkReady()` being false on the unfilled placeholder.
- **The NFT picker's markup handling is correct and I could not get anything through it.** `data:text/html` in
  an `image` field is rejected; `javascript:` is rejected; the source must match
  `data:image/(png|jpeg|jpg|gif|webp|svg+xml);` and is only ever an `<img src>`, where SVG is a passive context
  that cannot script or fetch; a non-string `name` becomes `null` rather than being stringified; names go in as
  `textContent` and are clipped; `URI_CAP`/`JSON_CAP`/`IMG_CAP` bound the work before decoding; `JSON.parse`
  creates an own `__proto__` property rather than walking the setter, so there is no pollution route. **On the
  two questions you asked:** not proxying the images is right — proxying would make your origin the fetcher of
  arbitrary collection URLs, and telling the user "this collection keeps its art on its own server, which this
  page does not fetch" is a better answer than a privacy leak on a signing page. Not widening `img-src` is
  right for the same reason.
- **The picker's identity handling is right** apart from S-1: `pickContext()` binds chain, account, standard
  and collection; it is re-checked at "Use these" and not only at open; `pickGen` discards a stale load; the
  pairing is in displayed order and says so.
- **`recipientProblem`** refuses the zero address, the BulkSend address and the token's own address, with a
  correct explanation of why each is unrecoverable.
- **The checksum-failure message.** You flagged this yourself. In its current form it is honest and complete: it
  names both possible causes, says nothing can distinguish them, says the workaround turns the check off rather
  than making a wrong address right, and says an address wrong by one character belongs to nobody. I checked
  the claim it makes — an all-lowercase address is indeed accepted by `ethers.isAddress` — and it is true. I
  would not change it. **An error message that offers a way around a safety check does deserve the scrutiny you
  gave it, and this one survives it.**
- **`tooPrecise` and `wholeText`** refuse rather than round, and refuse scientific notation by name with the
  right reason (the digits are genuinely gone). `SCIENTIFIC` and the thousands-separator hint are good.
- **The UTF-16 detection** (a NUL in the box) turns an unreadable per-line failure into one correct sentence.
- **The heading detection** is correctly conservative: a row is only skipped as a heading when its columns can
  be *read* as one, `alice.eth,1` is reported rather than dropped, and the two-pass whole-word matching
  genuinely prevents `tokenId` claiming the address column.
- **`checkTotals`** catches the case per-transfer simulation structurally cannot: amounts that individually
  pass and collectively exceed the balance or the allowance.
- **The ERC-20 approve is for the exact batch total, not unlimited**, and it clears a non-zero allowance first
  for tokens that require it. That is the right choice and it is rarer than it should be.
- **The strict-mode split refusal.** `plan()` disables Send when `!lenient() && batches > 1`, with the correct
  explanation that all-or-nothing only holds inside one transaction — and `sendViaWallet` repeats the refusal
  when the wallet rejects a batch as too large rather than quietly splitting it. That is promise 3 held
  properly at both layers.
- **The confirmation dialogue** states the network with "(REAL money)" or "(test network)", the exact per-transaction
  boundaries, the delivery order, which wallets are favoured by a partial run, and the number of signatures —
  and the manifest is written from the same list that is about to go out.
- **Every revert-selector mapping is correct** (all 19 recomputed; see the top of this report).

## The Check page

- **It signs and sends nothing.** The only `window.ethereum` call in the file is
  `eth.request({ method: 'eth_requestAccounts' })` at `:1287`. Everything else is a read-only
  `JsonRpcProvider`. No `eth_sendTransaction`, `personal_sign`, `eth_sign`, `eth_signTypedData*` or
  `wallet_sendCalls` is ever issued. Promise 6's first half holds.
- **XSS: clean, thoroughly.** `h()` routes every value through `textContent`/`createTextNode`. No `innerHTML`,
  `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function` anywhere in the file. The only
  `href` assignment builds `explorer + '/' + kind + '/' + value`, so no scheme can be injected even from a
  hostile RPC's `tx.from`. Every attribute key is a source literal. Token names, symbols, revert strings, panic
  text, ABI names, custom-error names and explorer contract names are all text nodes.
- **Simulation failure is distinguished from revert everywhere.** A thrown `simulate()` gives "could not be
  simulated" and **no verdict pill**; a reverted one gives "would fail" with the decoded reason. The batch path
  does the same, and the movements card is omitted rather than rendered empty. Neither is ever rendered as
  safe. This is the single most important thing on the page and it is right.
- **Method dispatch refuses by name.** Everything not `wallet_sendCalls` / `eth_sendTransaction` /
  `eth_signTransaction` is refused with "Nothing from it is shown below". `personal_sign`, `eth_sign` and
  `eth_signTypedData_v4` are never simulated, never described, never partly read. For a page that cannot read
  an EIP-712 payload, refusing is the right answer and it is the answer given.
- **The EIP-5792 schema check matches the specification field for field.** I checked each against the spec's own
  type definitions rather than against your description: `version` (required, string), `id` (optional, string),
  `chainId` (required, hex), `from` (optional, address), `atomicRequired` (required, boolean),
  `calls[].to/data/value/capabilities` (all optional, `value` a hex quantity), top-level `capabilities`
  (optional object). The required/optional split is right and nothing normative is unchecked. Three-state
  `atomicRequired` is correct. Keeping the raw `chainId` when unreadable rather than nulling it is right —
  "names a chain nobody can read" and "names no chain" are different, and the second gets answered against
  whatever the page is set to. Withholding the whole-request verdict when any capability is present is the
  correct reading of "the wallet MUST reject unsupported capabilities": a capability changes what the request
  means. Keeping the index of a member that is not a call, and withholding the sequence verdict, is right.
- **Proxy handling.** The forwarder's own ABI is set aside rather than used as a fallback; the implementation's
  ABI is used and labelled; a beacon is followed one step further and a silent beacon leaves the implementation
  *unknown* rather than standing in for it; the verification pill describes the code that runs.
- **`explorerJson`'s three outcomes** are correctly distinguished and correctly propagated to
  `verified: null` vs `false` — the difference between "not verified" and "nobody could check".
- **The mainnet explorer degradation is handled correctly.** Blockscout's challenge now fires on every
  `/x/4663/*` request regardless of the spoofed user-agent, so every mainnet explorer lookup fails —
  and `check.js:225` refuses the non-JSON body and reports "nobody could check" rather than "no source". The
  code comment is stale (S-9) but the behaviour is right.

## Hosting and supply chain

- **Redirect semantics.** Both hosts answer plain HTTP with **301**, not 302, and preserve path *and* query.
  HSTS is `max-age=31536000; includeSubDomains` on every Worker-constructed response reachable, error branches
  included.
- **No preload — I agree, and for the reason given.** `includeSubDomains` in the preload list binds *every*
  subdomain of `gmgnrepeat.com`, a domain that also carries the store, BBGP, Pate and the mall, enforced in
  shipped browser binaries and slow to unwind. Two Worker-hosted subdomains do not get to make that decision
  for the apex.
- **Header CSP and meta CSP agree exactly**, modulo the Worker appending `frame-ancestors 'none'` — verified
  byte-for-byte against both files on both live hosts. Where they differ the header wins for the right reason.
  A browser enforces the intersection, so the meta tag cannot weaken the header. Sending both is correct.
- **The `check.js` → `check.html` splice is verified, not merely self-consistent.**
  `test/web/check.test.mjs:143-147` asserts `block === '\n' + js` — that the HTML carries the *current* JS, not
  just that its own hash matches itself. Both test files independently recompute the CSP hash. I re-ran the
  splice: in sync. This is the strongest thing in the browser suites.
- **`web/wc-build/package-lock.json`**: all 305 packages have `integrity` and `resolved`, all exact versions,
  all `sha512`, every host `registry.npmjs.org`. **The axios claim is true** — `grep -c` on `web/wc.js` for
  `axios`, `form-data`, `follow-redirects`, `proxy-from-env` returns 0/0/0/0, case-insensitively and including
  camelCase variants.
- **Action pinning is real, not decorative.** All three SHAs resolve to real commits in the correct upstream
  repos and match the claimed tags today. Node and Foundry versions pinned in *both* workflows — the integrity
  workflow explicitly refuses to let `stable` drift, which is the subtle version of that mistake and it is
  already handled.
- **Workflow privilege posture.** `permissions: contents: read` at workflow level on both. **No
  `pull_request_target` anywhere. Zero `${{ … }}` expressions in either file**, so there is no script-injection
  surface via `github.event.*` at all. No secrets referenced.
- **The integrity workflow compares bytes, not liveness** — sha256 of the live body against the repo file for
  both pages *and* `wc.js`, plus repo-bundle vs `EXPECTED-SHA256`, plus the page still naming the recorded
  contract and still having mainnet disabled, plus full `eth_getCode` equality against a freshly built runtime.
  Runs are green four times a day. The `grep -q` / `pipefail` trap at `:91-92` is a real one and it is
  correctly avoided.
- **Live state matches the repository right now.** `curl -s https://rhairdrop.gmgnrepeat.com/ | cmp -
  web/index.html` → identical; same for check; `curl -s …/wc.js | sha256sum` = `sha256sum web/wc.js` =
  `EXPECTED-SHA256` = `d4c35a1b…`. **Promise 7 holds in both halves.**
- **The connector digest chain is closed.** Lockfile → esbuild → `EXPECTED-SHA256` → publish-time equality
  check → origin upload → digest-keyed fetch verified before Worker activation → Worker fetch that is *both*
  digest-keyed and digest-checked, failing **502** rather than substituting → post-activation body comparison →
  CI re-comparison four times a day from outside Cloudflare with no secrets. There is no TOCTOU: the bytes that
  are hashed are the bytes that are returned. The two open ends are the browser (I-8) and
  `ALLOW_DIRTY_PUBLISH=1`, which is bounded and monitored by the workflow — subject to S-14's note that the
  workflow will switch itself off after 60 days of repository quiet.
- **`publish.sh`'s other guards.** The `EXPECTED-SHA256` well-formedness check genuinely closes the "an empty
  expected digest silently skips the comparison" hole. `verify_body` compares bytes rather than status, with a
  retry loop, and announces the "no URL to verify" case loudly rather than passing quietly. The
  `WC_BUNDLE_URL`-unset trap is properly closed: not configuring the connector is now a decision that must be
  made out loud.
- **CSP source-by-source**, all justified: `default-src`/`object-src`/`base-uri`/`form-action` all `'none'`;
  `cdnjs` carries a correct `integrity` + `crossorigin`; every `connect-src`, `img-src`, `font-src` and
  `frame-src` entry traces to a real caller (the WalletConnect modal accounts for most of them). Four minor
  tightenings worth taking, none rising to a finding: `style-src 'self'` is dead weight on both pages (no
  `<link rel=stylesheet>`); `script-src 'self'` is dead weight on `check.html` (no same-origin script);
  `img-src blob:` on index.html is probably dead weight (the only `createObjectURL` builds a CSV download, not
  an image); and `pulse.walletconnect.org` is Reown telemetry the modal degrades silently without — a cheap
  third party to remove from a signing page. Pinning `cdnjs` to the full file path rather than the whole host
  is also free. `style-src 'unsafe-inline'` is currently unavoidable (34 `style=` attributes in index.html, and
  CSP2 cannot hash a style *attribute*), but it is removable on `check.html`, which has only three.
- **`deploy/publish.sh:172`'s `..` check is unreachable** — WHATWG URL parsing collapses dot segments before
  `url.pathname` is read, and the path regex excludes `%`. Traversal is genuinely contained, by the `/api/v2`
  prefix and by normalisation, not by that line. Worth a comment saying so, so nobody later relies on it.

---

# WHERE THE TESTS ARE WEAKER THAN THEY LOOK

You asked for this specifically. `forge test` → 102 passing (82 yours + my 20 probes);
`npm test` → 355 passing (252 airdrop + 103 check). The suites are genuinely good — real OpenZeppelin and
ERC721A rather than hand-rolled mocks, well-chosen adversarial tokens, and test names that carry the finding
id they guard. These are the specific soft spots.

**Assertions that cannot fail.** Four in `test/web/check.test.mjs` — `:303` `!/Nothing in .* lets anyone/`,
`:341` `!/No tokens and no ETH move/`, `:481` `!/decoded from the contract/`, `:644` `!/would still happen/`.
**None of those strings exists anywhere in `check.js`.** They are tombstones for text deleted in earlier
rounds. They will pass whatever the page renders.

**Every negative assertion also passes on empty output.** Both browser suites drive the page with fixed
`waitForTimeout` values and then assert `!/…/.test(t)`. On a loaded machine a slow render makes the assertion
pass for the wrong reason. Assertions that pair a negative with a positive are immune; the standalone ones are
not. Each should carry an "and the expected sentence IS present" companion.

**The simulation mock never looks at what is being simulated.** `check.test.mjs:66-67` records only
`calls.length` and `calls[].from`; `to`, `data` and `value` are never inspected, and the mock returns the same
logs for every call regardless of calldata. **No test in the suite can catch the page simulating different
bytes than it describes — which is exactly B-2 and S-15.** Capturing `{to, data, value}` and asserting them
against the pasted input would have caught both.

**Reentrancy is tested against a tautology.** `test/Reentrancy.t.sol:90-96` asserts `sent == 0, skipped == 1`
and nothing else. `Reenterer._one()` sets `to[0] = address(this)` and the token was minted to `address(r)` at
`:92`, so the recipient's balance is 10 whether or not the transfer happened. **If the lock regressed to
"skipped but paid", this test would still pass.** It needs sender and recipient separated.

**The boundary case is tested in one mode only.** `test/BulkSendReal.t.sol:783-789`
(`test_aContractThatAcceptsAndMovesNothingIsCountedAsSent`) uses `lenient=false`, which returns `sent = n` from
a code path that consults no call result. The lenient paths reach the same conclusion through entirely
different code and were untested — which is how S-12 survived nine rounds.

**The mocks behave better than real tokens.** `test/Mocks.sol` `MockERC20.transferFrom` and
`MockERC721.transferFrom` both `require`-and-revert; neither ever returns `false`. So `test/BulkSend.t.sol` on
its own can never exercise the false-return path at all. `RealTokens.sol` rescues this, which means every
safety-relevant assertion should live in the real-token file and the mocks should be treated as rehearsal
fixtures only.

**Length and empty checks were 721-only.** The ERC-1155 three-way array agreement and the ERC-20 pair had no
test.

**A 420,000-gas-wide bound.** `test/BulkSendReal.t.sol:528`
`assertLt(bombGas, deafGas + LENIENT_GAS() + 20_000)` would still pass if `REASON_CAP` regressed badly; the
`assertLt(bombGas, 600_000)` on the next line is the assertion doing the work.

**The flagship griefing test spot-checks 3 of 120 rows.** `test/BulkSendReal.t.sol:210-218` asserts `sent`,
`skipped` and ownership of ids 1, 2 and 120. The other 117 are unverified. `assertEq(t.balanceOf(me), skipped)`
reconciles the whole batch in one line.

**Nothing asserted gas-limit independence** — the single property that makes `sent`/`skipped` trustworthy.
There was a test that an underfunded batch reverts; there was none that two *sufficient* gas limits produce the
same delivered set.

**A read-only "power" is tested by a name that matches nothing.** `check.test.mjs:263` asserts `!/balanceOf/`,
which holds even if the `mutating` filter is deleted, because `balanceOf` matches no POWERS regex anyway. It
needs a view function whose *name* matches one, e.g. `{name:'mint', stateMutability:'view'}`.

**The central promise of the Check page is untested.** There is no assertion anywhere that the page issues no
signing method. A mock provider recording every `request({method})` would fix that in ten lines, and it is the
one test whose absence is most surprising.

**Never exercised at all**, and each is a finding above: a receipt with no transaction body (B-3); non-hex
`data` (B-2); an unvalidated `value` (S-15); `chainId` on the transaction path (B-4); a contract whose standard
cannot be settled (B-5); `increaseAllowance`, `permit`, `burnFrom`, `upgradeToAndCall` (S-16); `owner()`
returning zero (S-18); a wallet-batch status of 400/500/`'FAILED'` (**B-1**); a pending record from a foreign
standard (S-2); a list change after a gas probe (S-5); `paused === true`; the `?q=` deep link; and
`window.ethereum`, which is never injected in the check suite at all.

**On `--allow-file-access-from-files`.** You asked whether it weakens what the suite proves. It does, slightly
and unavoidably: the pages under test run from `file://` with cross-file reads permitted, so the suite cannot
observe same-origin restrictions and cannot see anything the real CSP would block. In exchange it reaches the
WalletConnect import path through a stand-in module, which is where a delivery once went missing. That is a
good trade and I would keep it — but it means the mocked suite proves *behaviour*, never *policy*, and the CSP
must be proved elsewhere. The publish gate and the integrity workflow are where, which is why S-10 matters
more than its severity suggests.

**And the general point you raised, confirmed.** Four defects were found last round by driving the live pages
against testnet that the mocked suite could not reach. The pattern holds here: B-3 lives in a partial RPC
failure the mock never produces (its `answer()` either returns or throws for a whole method, never for one leg
of a batch); S-2 lives in cross-run state the mock never seeds; B-1 lives in a wallet status the mock never
returns. **Every one of the four is a case where the mock's data is cleaner than reality.** The cheapest
general fix is a fault-injection mode in `chainAnswer`: a flag that makes any named method fail intermittently,
and a seeded-storage option, run once over the existing cases.

---

# THE VERDICT

**48 findings: 5 that block release, 35 that should be fixed and do not block (17 written up individually, 18
smaller ones grouped), and 8 inherent limits.**

## Something blocks release. Here is exactly what has to change.

Measured against the bar at the top of this report, this fails on **item 2** (no path pays anyone twice on the
page's own initiative) and **item 3** (every claim the page makes is one the evidence supports). It passes on
items 1, 4, 5 and 6 — with the qualifications recorded above.

I want to be precise about the shape of the failure, because it is not what the history of this repository
would predict. **The contract is clean.** Six rounds found nothing in it and I found nothing that threatens
anyone's funds either; the gas-stipend design in particular is better than most audited code I have read, and
the property it buys — that the delivered set does not depend on the transaction's gas limit — is the thing
that makes the whole tool's honesty possible. **The ledger's core is clean**, and it is a genuinely hard piece
of engineering done right. **The supply chain is closed**, byte for byte, and checkable by a stranger.

The five blockers are all in the same place: **the sentence the page writes about what it just read.** Four of
them are the Check page telling a user something the evidence does not support, and one is the airdrop page
believing a wallet instead of the chain. In every case the correct logic already exists twelve to thirty lines
away, in the sibling code path, usually with a comment explaining precisely the trap that the other path then
falls into. This is the pattern your own history predicted — *"the unreviewed thing in this repository is
always whatever was written last"* — arriving one layer up from where you were looking for it.

### To clear B-1 (airdrop: releases already-paid recipients on a wallet's word)

- `reconcilePending:2231` and `sendViaWallet:2831` must not call `dropPending` on a `failed`/`reverted` status
  when `readCallsStatus` returned a `hash`. Fetch that receipt from `cfg().rpc` and settle it through
  `arrivalsFromReceipt` + `commitDelivered`, as `reconcilePending` already does for a confirmed wallet batch.
  Release only on `receipt.status === 0`.
- Delete the `raw === 'FAILED' → 400` mapping in `readCallsStatus:2869`. An unrecognised status must fall
  through to `unknown`, which holds.
- Every `dropPending` must be inside `withRunLock`, as the comment at `:2311-2316` already claims.

**Checkable later:** a test that answers `{status: 500, receipts: [{status: '0x1', logs: [Transfer…]}]}` and
asserts the rows stay held; the same for `'FAILED'`; and `grep -n 'dropPending' web/index.html` showing only
calls inside a lock.

### To clear B-2, B-4 and S-15 (Check: the transaction reader validates nothing)

Extract one `readCall(o, index)` used by **both** `readEnvelope` and `readTransaction`, returning
`{to, data, value, invalid}` under one set of rules: `to` must match `/^0x[0-9a-fA-F]{40}$/` or be absent;
`data` must pass `HEX` or the call is marked unreadable and **never** silently becomes `'0x'`; `value` must pass
`HEX_QTY` or is reported unread. Then make `readTransaction` a one-call envelope that also reads `o.chainId`
and routes it through the existing chain check — including in `go()`'s `kind:'call'` fast path at `:1047-1050`,
which bypasses the batch renderer.

**Checkable later:** paste `{"to":"0x…","data":"095ea7b3…"}` (no `0x`) and assert the words "plain transfer of
ETH" do not appear; paste a request with `"chainId":"0x1"` while set to 46630 and assert the page refuses.

### To clear B-3 (Check: an unreadable transaction body reads as a plain ETH transfer)

`showTransaction:651` must distinguish *no calldata* from *could not read the calldata*. When `tx` is null and
`rc` is not, suppress the lede, the "a new contract" rendering and the `Function` row, and say the body could
not be read from this node. Render the receipt's movements under a heading that says so.

**Checkable later:** a test where `getTransaction` throws and `getTransactionReceipt` succeeds, asserting the
page does not say "A plain transfer of ETH".

### To clear B-5 (Check: an unknown token standard is written up as ERC-20)

`describeCall:406` must treat `t.standard` as three states, as `renderArgs:707` already does. On `null`, either
withhold the sentence or write both readings.

**Checkable later:** a contract answering neither `supportsInterface` nor `decimals`, with
`approve(0x…, 1)` — assert the output does not contain "spend 1 of your".

## What I would fix next, after the blockers

In this order, and the reasoning is the same each time: it is the ones where the page states something it did
not check. **S-3** (Review tells the operator the chain declined when it never asked) and **S-2** (a dead Send
button that says nothing, whose only remaining remedy destroys the ledger) are the two that can end in a double
payment via a user's own reasonable next step. **S-1** is the picker silently reducing a delivery while its
counter says otherwise. **S-8** and **S-9** put an unprotected and an executable page on the tools' own
origins. **S-10** is the publish gate that would ship `'strict-dynamic'`.

## Two things I want to say plainly, because a report of only defects misrepresents what is here

First: **the design that catches most of what the contract cannot.** S-12 is a real correctness gap in
`BulkSend` — the 721 and 1155 paths count a delivery without ever reading the call's return data — and the
reason it is not a blocker is that the page does not believe the contract. It asks the chain afterwards, per
row, with four outcomes rather than two, and holds anything it cannot settle. That decision is what turns a
contract-level bug into a non-event for users. It is the single best structural choice in this repository and
it should not be traded away for anything.

Second: **the disclosures are already right in most of the places that matter.** "That is the token's own
answer about its own state… still not proof: a token written to lie can lie here too." "This can only tell you
a list looks made up. It cannot tell you a list is real." "It is a convenience, not a guarantee." "The
transaction is the record." Those sentences are the product of someone who understood the difference between
what is known and what is assumed. The five blockers are all places where a code path did not live up to what
those sentences promise — not places where the promise was never made.

## On the question you actually asked

You asked for a standard you could measure against, because a verdict with no criteria can never be met. So, to
be unambiguous: **fix the five items above and this clears my bar.** Nothing in the should-fix list, taken
alone or together, would keep me from saying yes — they are quality, not safety, with the two exceptions I
named. Nothing in the inherent-limits list can be fixed and none of it needs to be; four of the eight are
already disclosed in the product in the right words, and the other four need a sentence each.

I would also say this, since you asked for the standard rather than the answer: **a clean round on this
repository is reachable, and it is probably the next one.** The contract has been clean for seven rounds and
has not changed. The supply chain is closed and independently checkable. The ledger's core is right. What is
left failing is a specific, bounded class — the newest rendering code writing a sentence stronger than its
evidence — and every instance of it in this report has its own correct implementation already sitting in the
same file.
