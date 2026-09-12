# Twentieth external review — Robinhood Chain tools

Commit under review: `11d52c6` ("round nineteen closed: an unanswered explorer is an error, not an answer;
the in-flight guard was unreachable and is gone").
Reviewer: Claude (Opus 5). Date: 2026-09-11.

Status: **complete**.

---

## 1. The release bar I am judging against

Before saying whether this is ready, here is what "ready" means for *this* kind of software: a browser page
that asks a wallet to move real assets to many strangers at once, plus a read-only page that tells
non-technical people whether a transaction is safe.

A tool like this is ready to put in front of the public with real money when all seven of these hold.

1. **Authority is bounded and immutable.** The contract can move only what the caller approved, only inside
   the transaction the caller signed, and nobody — the author included — can widen that later. No owner, no
   upgrade path, no pause, no fee hook, no way to make a later transaction spend an earlier approval.
2. **Every statement the software makes about what happened is either true or marked unknown.** There are
   three states, not two: *it happened*, *it did not happen*, *nobody could tell*. Collapsing the third into
   either of the other two is the defect class that costs money here, and it is the one to hunt. "Skipped"
   must never cover "may have moved"; "delivered" must never cover "may not have arrived"; "no source
   published" must never cover "the explorer would not answer".
3. **Double-payment is structurally prevented, not merely unlikely.** The record that stops a second payment
   must be written before the irreversible act, not after it, and must survive the tab dying at the worst
   possible moment. Where it cannot (a different browser, cleared storage), the page must say so in those
   words rather than imply coverage it does not have.
4. **The list the user typed is the list that goes out.** Byte-for-byte: no silent rounding, rescaling,
   reordering that changes who gets what, deduplication, or dropped rows. Any transformation is shown and
   agreed to before it is applied.
5. **Fail-safe under uncertainty, and the direction is always the same.** When the software cannot tell, it
   holds back rather than releasing, refuses rather than sends, and says "could not check" rather than
   producing a clean bill of health. Over-holding costs a user an afternoon; under-holding costs them the
   assets.
6. **What is deployed is what was reviewed.** The served pages are byte-identical to the audited commit, the
   deployed runtime bytecode matches what this repository builds, every piece of third-party code the page
   executes is pinned by digest, and there is a mechanical gate that fails if any of that drifts.
7. **The evidence is adversarial.** The tests must be constructed so that weakening one is louder than
   fixing the bug. A suite that can be quietly edited into passing is not evidence.

Two things explicitly **do not** count against the bar, because they cannot be engineered away in a browser
against contracts nobody controls: a hostile token lying in its view functions, and an RPC node or explorer
being stale or wrong. For those, the bar is not correctness but *honesty*: the page must say which of its
statements are the token's own word and which are its own reading, and must not upgrade evidence to proof.

**Severity categories used below**, as requested:

- **BLOCKS RELEASE** — a user can lose funds, pay twice, or act on a statement the software presents as fact
  that is not.
- **SHOULD FIX** — real, reproducible, but the cost is wasted time, a confusing message, or a claim that is
  wrong in a direction that cannot cost assets.
- **INHERENT LIMIT** — cannot be fixed by code; the finding is about what the page should *say*.

---

## 2. Findings

Nine findings. Eight are **demonstrated** with a runnable probe: `test/web/audit-probe-20.mjs`, which
carries nine assertions (F-3 has two independent triggers) and reads "REPRODUCES" on all nine at commit
`11d52c6`. The ninth (F-8) is demonstrated by running the suites and reading the numbers. Run it with `node test/web/audit-probe-20.mjs`. Per this repository's
convention a probe that REPRODUCES is a defect that is still present.

`./verify.sh` will refuse the file until `test/findings-baseline.json` names it. That is the guard working,
and the baseline entries to add once these are triaged are given at the end of this section.

---

### F-1 — The Check page states "source published and matched" about a contract whose verification it cannot tell is full or partial (mainnet only)

**Category: should be fixed but does not block.** Demonstrated (`P20-1`).

**Where.** `deploy/render-worker.py`, the `/smart-contracts/` branch of the mainnet translation:
`is_partially_verified: null,   // round nineteen F-8: the module API does not say; null, not a claim`.
Consumed at `web/check.js:302` — `out.partial = !!sc.is_partially_verified;` — and rendered at
`web/check.js:828` and `web/check.js:880`.

**Input and state.** Network set to Robinhood Chain (4663) on the Check page; any address whose
`/x/4663/smart-contracts/<addr>` answer comes from the Worker's module-API translation with
`BLOCKSCOUT_KEY` bound — i.e. every mainnet contract lookup as the site is deployed today. The Worker
deliberately answers `is_partially_verified: null` because Blockscout's Etherscan-style module API does not
carry the field. `!!null` is `false`, so the page takes "not known" and prints the one word that distinguishes
the two cases.

**What the user sees.** The green pill reads **"source published and matched"**. The page has a distinct,
weaker pill for the other case — "source published, partly matched" — and a sentence that goes with it:
"This contract is only partially verified, so even the published source may not be all of the code that
runs." Neither can ever appear on mainnet. The probe shows the same page renders the partial wording
correctly when the field is a real `true`, so the wording is present and simply unreachable on that network.

**What it costs.** A user reads "matched" as "somebody has shown that this source produced this bytecode".
For a partial match that is not quite what has been shown, and this page exists to be precise about exactly
that distinction. It is the one place in this audit where the page is *more* reassuring than its evidence
supports, which is the direction the release bar cares about. It is not a blocker because a partial
verification is still a verification: the deployed code does match the published source modulo the metadata
hash, so nobody loses funds acting on it.

**Fix.** Keep the three states the Worker already distinguishes. In `readAddress`, write
`out.partial = sc.is_partially_verified === true ? true : (sc.is_partially_verified === null || sc.is_partially_verified === undefined ? null : false)`
and give the pill a third branch — "source published (whether the match is full or partial is not known)" —
for `null`. Check against: the same probe, with `P20-1` reading "fixed", plus a case asserting the pill does
not contain the word "matched" when `is_partially_verified` is `null`.

---

### F-2 — `explorerJson` accepts any 200 JSON body as a real answer, so a body that is not an answer becomes the definite claim "no source published"

**Category: should be fixed but does not block.** Demonstrated (`P20-2`).

**Where.** `web/check.js:224-250` (`explorerJson`) and `web/check.js:290-293` (`readAddress`).

**Input and state.** Any explorer or intermediary that answers `/smart-contracts/<addr>` with HTTP 200,
`content-type: application/json`, and a body that is JSON but is not a Blockscout contract record. The probe
uses `{"error":"rate limited","retry_after":30}`. A body of `null`, `[]`, `{}` or `{"message":"Not found"}`
does the same thing.

**What happens.** `explorerJson` decides "this is a real answer" from the HTTP status and the content-type
alone. The round-nineteen fix added one shape check — `j.error === 'upstream'`, the Worker's own envelope —
and nothing else. Any other JSON is returned as `{ ok: true, data: j }`. `readAddress` then runs
`out.verified = !!sc.is_verified`, and a record with no such field yields `false`, which the page states as:
pill "no source published", plus "The bytecode is public and this page has read it, but nobody has shown
which source code produced it. **Nobody outside the people who deployed it knows what this contract does.**"

**What it costs.** A wrong answer the user would act on, in the safe direction: a legitimate verified
contract is described as unverified and anonymous. Not a blocker — nobody loses funds by being told
something is *less* trustworthy than it is — but it is precisely the failure mode round nineteen was closing
(`ok: reached` read as `ok: answered`), reached through the other half of the same function, and it makes the
page's most important negative statement unreliable.

**Fix.** Make `explorerJson` a typed reader rather than a transport reader. Either pass a validator per path
(`/smart-contracts/` must carry `is_verified`; `/tokens/.../holders` and `/addresses/.../nft` must carry an
`items` array) and treat a failed validation exactly as a 5xx — retry, then `ok: false` — or narrow
`readAddress` so that `out.verified` is only set to `false` when `sc` is `null` (a real 404) or
`typeof sc.is_verified === 'boolean'`, and `null` otherwise. Check against: `P20-2` reading "fixed".

---

### F-3 — `myTokenIds` ends a cut-short inventory walk as a complete one, and Assign states the resulting count as fact

**Category: should be fixed but does not block.** Demonstrated twice (`P20-3a`, `P20-3b`).

**Where.** `web/index.html:2258-2278` (`myTokenIds`), consumed at `web/index.html:2177` and
`web/index.html:2208-2223` (Assign) and at `web/index.html:1508` / `1548` (the picker).

**Input and state.** Two independent triggers, both reproduced:

- **(a) a page that is not a page.** The wallet's inventory is read across several explorer pages. Page one
  is real and says there is more; page two comes back HTTP 200 with a JSON body that has no `items` array
  (`{"message":"Not found"}` in the probe). `(d.items || [])` contributes nothing, `d.next_page_params` is
  `undefined`, the loop `break`s, and the partial answer is returned as the whole inventory.
- **(b) the walk's own ceiling.** `for (let page = 0; page < 20 && …)`. When the explorer is still offering a
  next page on the twentieth request, the loop exits on the page counter and nothing is recorded.

In both cases `out.truncated` is never set, so Assign's guard at `index.html:2208`
(`if (ids.truncated) { … 'the explorer's answer was cut short' … }`) does not fire.

**What the user sees.** "This list asks for 60 NFTs and this wallet holds 50 of them. Nothing has been
changed." — a statement of fact about the wallet's holdings, derived from a read that stopped early. The
probe prints exactly that line for both triggers.

**Contrast, which is why this is a finding and not a design choice.** The holder walk 350 lines above does
handle this: `if (!p) { if (!Array.isArray(d.items)) truncated = true; break; }`, and it has an explicit
`if (page === 199) truncated = true;` for its own ceiling. The inventory walk, reviewed at the same time for
the same property in round nineteen (F-3), received only the Worker's `truncated` flag — which the mainnet
Worker sets and no direct explorer ever will.

**What it costs.** No funds. Assign changes nothing and the message carries a hedge ("a collection the
explorer indexes slowly can also read as fewer than you own"). The cost is a false statement about the
user's own holdings and a blocked workflow they cannot diagnose. The picker has a sharper version of the
same: `web/index.html:1548` prints "**You hold** N; this shows the first M … For more than that, 'Assign my
token ids' uses **everything you hold**" — two definite claims from a possibly truncated list, and the second
one is false whenever Assign would stop.

**Fix.** Give `myTokenIds` the holder walk's two lines:
`if (!Array.isArray(d.items)) { out.truncated = true; break; }` before the item loop, and
`if (page === 19 && d.next_page_params) out.truncated = true;` at the end of the loop body. Then have the
picker read `ids.truncated` and say "at least N" instead of "You hold N". Check against: `P20-3a` and
`P20-3b` reading "fixed".

---

### F-4 — Assign reports a headed `address,amount` list as "already names its token ids", and refuses to pair it

**Category: should be fixed but does not block.** Demonstrated (`P20-4`).

**Where.** `web/index.html:2155-2166`, the already-paired check added for round eighteen S-6 and moved onto
column names by round nineteen F-10.

**Input and state.** Paste into the recipient box, with ERC-721 selected:

```
address,amount
0x0000000000000000000000000000000000000111,3
0x0000000000000000000000000000000000000222,2
```

and press **Assign my token ids to these wallets**.

**What happens.** `boxColumns()` reads the heading as `{to: 0, qty: 1}`. The already-paired test branches on
`col && col.id !== undefined`; there is no id column, so it falls through to the *positional* branch, which
takes "everything after the first cell that is not `xN`" — the amounts — finds them all whole numbers, and
concludes the list is paired. The page then asks:

> Every line already names its token ids. Assign would throw those pairings away and pair the wallets with
> your holdings again. Continue?

and on "no" says **"Left as it is: every line already names its ids."** No line in that file names an id.

**Why this shape matters.** It is not an exotic file. `parseList` has a dedicated branch for it
(`index.html:1196-1237`): "In the wider ecosystem an NFT file with a quantity column but no id column means
'how many of yours'". The page's own label under the box tells the user that `quantity` (*how many*) is a
supported column, and `offerToAssign` tells them the way to fill in ids is to press Assign. A user who
pastes such a file and presses the button the page points at is told the opposite of the truth about their
own file, and the workflow stops.

**What it costs.** No funds. A false statement about the user's input and a dead end: the only ways out are
to press "Check list" first (which rewrites the file into the `x3` form through a different confirmation) or
to answer "yes" to a question whose premise is wrong. A user who trusts the page and answers "no" cannot
proceed.

**Fix.** Make the positional branch conditional on there being no heading at all, not merely no id column.
The whole test should read: if `col` exists, a list is paired only when `col.id !== undefined` and every id
cell is present and whole; if `col` is null, use the positional rule. One line:
change `if (col && col.id !== undefined) { … }` to `if (col) { if (col.id === undefined) return false; … }`.
Check against: `P20-4` reading "fixed", and a case proving a headed `label,address,tokenId` file is still
recognised as paired (round nineteen F-10's own case, which must not regress).

---

### F-5 — A partly-paired list is read as "not paired", so Assign discards the ids that were named, at random, with no question

**Category: should be fixed but does not block.** Demonstrated (`P20-5`).

**Where.** The same block, `web/index.html:2155-2166`. The test is an `.every()` over the lines, so one
unpaired line makes the whole list unpaired.

**Input and state.** Bare list, ERC-721, "Random" left at its default (it is `checked` in the markup,
`index.html:94`):

```
0x0000000000000000000000000000000000000111,11
0x0000000000000000000000000000000000000222 x2
```

Press **Assign**.

**What happens.** Line two carries only an `xN`, so `rest.length > 0` is false for it and `alreadyPaired` is
false. No dialog. Assign rewrites the box, and because Random is on, it re-pairs at random. The probe's
resulting box is `0x…222,73 | 0x…222,72 | 0x…111,71`: the hand-typed pairing of `0x…111` with id 11 is gone,
and nothing in the log or the message mentions that a pairing was discarded. (`Assigned 3 lines, paired at
random.` is the only thing said.)

**What it costs.** No funds directly — the list is still shown, and "Check list" then Send still happen after
this. But the single defence this page has against "Assign silently changed who gets what" is the round
eighteen S-6 confirmation, and it does not cover the mixed case, which is the likeliest way a real list gets
into this shape (a user pins a few specific pieces to specific wallets and lets the rest be assigned).

**Fix.** Ask when *any* line names an id, not only when every line does: change the `.every()` to a count,
and word the confirmation with the number ("3 of these 20 lines already name a token id; Assign will replace
those pairings too. Continue?"). Better still, honour them: pair only the lines that do not already carry an
id. Check against: `P20-5` reading "fixed".

---

### F-6 — "Apply weight" guards a headed file's token ids and silently destroys the same ids in the bare form this page itself writes

**Category: should be fixed but does not block.** Demonstrated (`P20-6`).

**Where.** `web/index.html:2054-2060` — the guard — and `web/index.html:2078-2094`, the rewrite.

The guard reads:

```js
if (standard === '721' && acol && acol.id !== undefined
    && lines.some((line) => String(splitRow(line)[acol.id] ?? '').trim())) {
  say('msgList', 'That file already names the exact NFT id on each line. … Nothing has been changed.', 'bad');
  return;
}
```

`acol` is `boxColumns()`, which is non-null only when the first line reads as a **heading**. Every list this
page writes for itself is bare: `Assign` and the picker's "Use these" both emit `serializeRow([to, id])`,
which is `0xabc…,71` with no heading. So `acol` is `null`, the guard is skipped entirely, and the rewrite
falls into its bare branch — `return acol ? setQty(l, each) : addr + (each > 1 ? ' x' + each : '')` — which
returns **only the address**.

**Input and state.** Exactly the page's own suggested order, with one step out of sequence:

1. Read a collection's holders (this is what reveals the weighting controls at all: `weightRow` is
   `display:none` until a snapshot with a non-zero total, `index.html:1953`).
2. Press **Assign my token ids to these wallets**. The box is now `0x…111,73` / `0x…222,72`.
3. Press **Apply weight**.

Nothing in between clears the snapshot — `forgetSnapshot` is called only when the network or the collection
address changes (`index.html:845`, `1971`, `2046`), never when the list changes — so the control is still
there and still enabled.

**What happens.** The confirmation the user is shown is:

> This rewrites the list so each wallet gets 1 each.
>
> 2 wallets, 2 in total.
>
> There is no undo. Continue?

It counts wallets. It does not mention token ids. On "Continue" the box becomes two bare addresses and both
pairings are gone. The probe captures exactly this.

**What it costs.** No funds: `parseList` then reports the list as "wallets with no token ids yet" and the
message tells the user to press Assign again. What is lost is the *choice* — if those ids came from the
picker, which exists precisely so a sender can decide which piece goes to which wallet, that decision is
destroyed by one click under a confirmation that describes something else. For ERC-1155 and ERC-20 the same
branch drops the amount column too, though there at least the next parse flags the rows.

**Fix.** Make the guard about the content of the line, not about whether the file has a heading. Replace the
condition with one that works for both shapes — for each line, "does this line already carry a whole number
after the address" (`deliveriesOn`/`requestedNftQuantity` already answer it for both shapes) — and keep the
existing refusal wording. Failing that, at minimum name the loss in the confirmation: "… and the token ids
already on 2 of these lines will be removed." Check against: `P20-6` reading "fixed", with the existing
headed-file refusal case still passing.

---

### F-7 — On the Check page an ERC-721 `approve(spender, tokenId)` is called "an unlimited approval … in any amount" whenever the id is at or above the collection's `totalSupply`

**Category: should be fixed but does not block.** Demonstrated (`P20-7`).

**Where.** `web/check.js:419-427` (`unlimitedFor`), `web/check.js:433-444` (`APPROVAL_SHAPES` /
`unlimitedApproval`), used at `web/check.js:899-905` in `callWarnings`.

```js
function unlimitedFor(v, token) {
  …
  const sup = token && token.supply … ? BigInt(token.supply) : null;
  if (sup && sup > 0n) return n >= sup;
  return n >= BEYOND_ANY_SUPPLY;
}
```

Comparing the number in an approval against the token's own supply is the right rule for an ERC-20, and the
comment above it explains at length why 2^200 was not. `approve(address,uint256)` is the **same selector on
ERC-721**, where that number is a token id and not an amount, and `unlimitedApproval` never asks which
standard it is looking at — while `describeCall`, twenty lines below, does exactly that and gets it right.

**Input and state.** Paste into the Check page, with a sender in the box:

```json
{"to":"<an ERC-721 whose totalSupply() is 100>","data":"0x095ea7b3…<spender>…<0x1f4>"}
```

Token ids are not dense. A collection that has burned any of its pieces, that numbers from a serial, or that
mints from a pool has live ids above its `totalSupply()` as a matter of course, so this is not a contrived id.

**What the user sees.** The lede sentence, correct:

> Let 0x…bEEF move Serial Collection #500. It stays allowed until you take it back.

and directly beneath it, in red:

> **This is an unlimited approval** — It lets 0x…bEEF take that token out of your wallet at any point in the
> future, **in any amount**, without asking again.

The page contradicts itself about the transaction in front of the reader, in the loudest box it has.

**What it costs.** The direction is conservative — it over-warns, it does not under-warn — so nobody loses
funds directly. The cost is the page's own credibility on the single warning it most needs to be believed.
Someone who approves one NFT, sees the red box, checks, and finds it was wrong, has been taught that the red
box is noise. That is what the next unlimited ERC-20 approval will be read against.

**Fix.** Make `unlimitedApproval` standard-aware, the way `describeCall` already is. The shape table is the
natural place: for `approve(address,uint256)` only, return `null` when
`token.standard === 'ERC-721' || token.standard === 'ERC-1155'` (on ERC-721 the honest warning is a different
one — "this lets them take that specific piece at any time until you revoke it" — which the lede already
says). `increaseAllowance` and `permit` exist on no ERC-721 and need no change. Check against: `P20-7`
reading "fixed", and `check.test.mjs:216`'s existing ERC-20 unlimited-approval case still passing.

---

### F-8 — Two documents state browser-test counts that are wrong, and disagree with each other

**Category: should be fixed but does not block.** Demonstrated (I ran every suite).

**Where.** `docs/status.md:28` and `docs/status.md:42-43`; `docs/for-reviewers.md:24`.

**What they say versus what the suites print**, on this commit:

| claim | where | actual |
| --- | --- | --- |
| "362/362 airdrop-page tests, 129/129 Check-page tests" | `docs/status.md:28` | **367** and **131** |
| "`node test/web/client.test.mjs`  # 362 airdrop page tests" | `docs/status.md:42` | **367** |
| "`node test/web/check.test.mjs`   # 129 Check page tests" | `docs/status.md:43` | **131** |
| "`npm install && npm test`  # 477 browser tests" | `docs/for-reviewers.md:24` | **498** |

Three different totals across two files (491, 477, 498), none of them the right one. Every other count I
checked is exact: 111 ordinary contract tests, 29 probe assertions of which 9 must fail, 21 CSP-gate checks,
31 Worker checks, 74 reader checks, and `forge test` reporting 135 passed / 9 failed across 144.

**What it costs.** `docs/status.md` opens with "This file exists so that the state of the project is readable
from the repository rather than from anyone's summary of it. Everything here is a count or a verdict that can
be reproduced by running the command beside it." A reviewer who does exactly that gets a different number on
the first line they check, and the natural inference — that the tree has moved since the file was written —
is one a reader cannot distinguish from the file simply being wrong. That is a small cost on its own and a
real one for a document whose entire purpose is to be checkable. It is also the one claim in the whole
repository that is *trivially* automatable: `verify.sh` already parses both "N passed, M failed" lines.

**Fix.** Either update the four numbers in the same commit that adds browser cases — the round-nineteen
closure added five and two and did not — or, better, have `preflight.sh` fail when a count written in
`docs/status.md` does not match what the suite prints, so the document cannot drift again. Check against:
`grep -o '[0-9]* airdrop-page tests' docs/status.md` matching the suite's own summary line.

---

### F-9 — The holder walk marks itself cut short and then never says so, because the empty-list check returns first

**Category: should be fixed but does not block.** Demonstrated (`P20-8`).

**Where.** `web/index.html:1917-1919`:

```js
const uniq = [...new Set(holders)]…;
if (!uniq.length) { log('The explorer returned no holders for that address.', 'bad'); return; }
if (truncated) { say('msgList', 'Stopped after ' + holders.length + ' holders, so this list is incomplete…'); return; }
```

Round nineteen's F-2 taught this walk to set `truncated` when a page comes back that is not a page of items
(`if (!p) { if (!Array.isArray(d.items)) truncated = true; break; }`, `index.html:1911-1912`), and that part
works. The two checks after it are in the wrong order, so the branch that reports it is **unreachable
whenever the unreadable page is the first one** — which is the commonest case, because the first page is the
only one every lookup makes.

**Input and state.** Paste a collection address into "Read a collection's holders, as the explorer has them"
and press Fetch, at a moment when the explorer answers HTTP 200 with a JSON body that is not a holders page.
The probe uses `{"message":"Not found"}`; a gateway's own JSON, a cached error document, or a Blockscout
version that reports not-found in the body rather than the status all do it.

**What the user sees.** "The explorer returned no holders for that address." That is a statement about the
collection. The truth is that nobody could read the answer. The user's reasonable next step — concluding the
address is wrong, or that the collection has no holders, and going to look for a different one — is the wrong
step.

**What it costs.** No funds; the box is not written. Wasted time and a false statement, in the same class as
F-2 and F-3 and reachable through a third function. It is worth fixing with those two because the three
together are the page's whole "could not check" story, and it is a two-line change.

**Fix.** Test `truncated` before `!uniq.length`, and give the zero-holders case its own honest wording for
the case where the walk completed and genuinely found none. While there: "The explorer returned no holders
for that address" also fires when every holder returned *was* your own wallet and the `h !== me` filter
removed them all, which is a second thing that sentence is not true about. Check against: `P20-8` reading
"fixed", and round nineteen's `R19-2` case still reading "fixed".

---

### Baseline entries, and where the probe lives

The probe is `test/web/audit-probe-20.mjs` in the repository (a copy is also at `audit-probe-20.mjs` beside
this report). `./verify.sh` refuses it until `test/findings-baseline.json` names it — I ran it and it fails
in seconds with `FAIL  browser probe manifest differs from the baseline (unlisted: audit-probe-20)`, which is
the guard working exactly as described.

As it stands today, with all nine reproducing, the three entries would be:

```json
"web_probes":            { "audit-probe-20": 9 },
"web_probe_sources":     { "audit-probe-20": "2df92cc39153cc322fbeb63f3ad1ff1361a5810c6b2754ede51b41f916ce91f9" },
"web_probe_assertions":  { "audit-probe-20": "bd8d20897df19232b1b4e1dd371cb53874176e00ae8e34ab8a860a1f018766b3" }
```

The count drops by one for each finding closed, and the assertion fingerprint changes with it — which is the
point of it. If any of the nine is declined rather than fixed, leave it at the count that reflects that and
say which in `docs/status.md`, the way S-5 and S-6 are recorded now.

---

---


## 3. Answers to the specific questions in the brief

### 0. The explorer path end to end, after round nineteen

Attacked every consumer of an explorer answer on both pages with the six shapes named in the brief. Results:

| shape | Check `explorerJson` → `readAddress` | airdrop `explorer()` → holder walk | airdrop `explorer()` → `myTokenIds` |
| --- | --- | --- | --- |
| the `{"error":"upstream"}` envelope | retried, then **could not check** ✓ | throws, **"Could not read holders"** ✓ | throws, **"Could not read your token ids"** ✓ |
| a real 404 | **no source published** ✓ (correct: a 404 on `/smart-contracts/` *is* "not verified") | throws ✓ | throws ✓ |
| a 5xx | retried, then **could not check** ✓ | throws ✓ | throws ✓ |
| **a 200 JSON body of the wrong shape** | **"no source published", stated as fact — F-2** | on a later page, **"cut short"** ✓; **on the first page, "the explorer returned no holders" — F-9** | **returned as a complete inventory — F-3a** |
| `items` with no `next_page_params` | n/a | end of walk ✓ (this is Blockscout's own end-of-list signal, not a truncation) | end of walk ✓ |
| `truncated: true` | n/a | n/a (the Worker never sets it on holders) | carried out to Assign ✓ |

Three failures, all written up above (F-2, F-3, F-9). The asymmetry is the striking part: the holder walk got the
`Array.isArray(d.items)` guard in round nineteen and the inventory walk, sitting two hundred lines below it
and reviewed in the same round for the same property, did not. The inventory walk also has a second, older
way to end early that nothing marks — its own `page < 20` ceiling (F-3b).

One further mainnet-only gap, listed here rather than as a finding because the airdrop page has mainnet
switched off (`LIVE_CHAINS = new Set([46630])`, `index.html:308`): the Worker derives the NFT inventory from
`module=account&action=tokennfttx`, which on Blockscout is the **ERC-721** transfer feed. `myTokenIds` asks
for `?type=ERC-721,ERC-1155` and the Worker ignores the parameter, so an ERC-1155 holding on mainnet would
come back as "you hold none of this". The message for that case is hedged ("or the explorer would not say"),
so it is honest, but the hedge is doing work the code should be doing. It also nets ERC-1155 transfers `±1`
per event rather than by value, which would be wrong for editions if that feed ever carried them.

### 0b. The send path after round nineteen F-4 — the "before the wallet" / "the wallet was asked" boundary

**Found sound.** I could not construct a misreport in either direction.

The inner `try` (`index.html:3382-3396`) covers exactly two statements. `populateTransaction` on an
`ethers` v6 contract bound to a signer does not touch the wallet: it resolves the fragment, encodes the
arguments and merges the overrides, and `onThisChain()` (`index.html:367`) supplies only `chainId`, so
nothing in it calls `getAddress`, `getNonce` or `getFeeData` on the signer. `pageRpc.estimateGas` goes to
the page's own RPC by construction. So everything in that `try` really is before the wallet, and
`dropPending(pid)` + "it was not sent to your wallet at all" is true whenever it fires.

The other direction — a failure *after* `sendUncheckedTransaction` returns being reported as "before the
wallet" — cannot happen, because the inner `try` closes before that line and `dropPending` appears nowhere
after it except under `isRejection`.

There is one *pre*-wallet failure that is reported as "the wallet was asked": `sendUncheckedTransaction`
itself throws before `eth_sendTransaction` if `tx.from` does not match the signer's address, or if the
provider is gone. That lands in the outer catch, is not a rejection, and holds the rows. That is the
conservative direction (over-holding, recoverable through "Review held rows") and I would leave it.

`updatePending(pid, …)` — which writes the hash — sits **outside** the try. If it throws (a storage quota
failure mid-send), the record survives with `hash: null` and its `call` data intact, which is enough for
`reconcilePending` to find the transaction later. Also the safe direction.

### 0c. Reconciliation after round nineteen F-5 — can `reconcilePending` run against this tab's own in-flight record?

**The claim holds, but for a weaker reason than the comment gives.** `reconcilePending` has exactly three
call sites: the end of `connect()` (`index.html:673`), the top of `runSend()` before any lock is taken
(`3223`), and page load (`3717`).

- **Page load and `runSend`'s own call** happen before this tab has created a record for the send in
  progress, so neither can meet one.
- **`connect()`** is the interesting one. The comment says "while a batch is out the connect controls are
  locked". They are not, exactly: `lockForm`'s `FORM` array (`index.html:2483`) names `'connect'` and does
  **not** name `'connectWc'`, the "Phone wallet · WalletConnect" button, which is a static element in the
  markup (`index.html:53`) and has its own path into `connect()` via `connectPhoneWallet`. What actually
  makes it unreachable is that `renderWalletChoice` returns early when `me` is set (`index.html:484-491`) and
  never draws that button while connected. So the property is real but it rests on a rendering branch rather
  than on the lock the comment points at; a future change to either disconnect handler that leaves `me`
  falsy mid-send would make `connectPhoneWallet → connect → reconcilePending` reachable. Adding
  `'connectWc'` to `FORM` costs one word and makes the comment true as written.
- **A provider event** cannot reach it: `accountsChanged` and the WalletConnect `disconnect` handler both
  return early when `sending` (`index.html:657`, `608`), and `chainChanged` only sets `stopFlag` and calls
  `pickRpc`.
- **A second tab** *can* run `reconcilePending` against the first tab's hash-less record, and what it prints
  is: "A batch of N from <date> was sent to your wallet and never came back with a transaction. Connect the
  same wallet on the same network and reload…". That is misleading — the batch is at that moment sitting in
  the other tab's wallet prompt — but it releases nothing, and for the same list the second tab then fails
  to take the run lock and stops. I would not call it a finding.

**One thing I would change, reasoned not demonstrated.** `withRunLock` (`index.html:2879`) requests the lock
*without* `ifAvailable` and without a timeout, and `reconcilePending` walks **every** run in the browser, not
only the one on screen. So: tab A is mid-send on list X and holds `bulksend:X` for the whole run; tab B
presses Send on a different list Y; tab B's pre-lock `reconcilePending` reaches a mined receipt for one of
tab A's records, calls `commitDelivered(runX, …)`, and blocks on tab A's lock until tab A's entire run
finishes. Tab B's form is already locked by the click handler and nothing is printed. For a long airdrop
that is several minutes of a page that looks frozen and says nothing — the exact shape this file elsewhere
treats as a defect ("the form unlocked in the finally, the page looked normal, and Send did nothing and said
nothing", `index.html:3220-3222`). It is not a deadlock: reconciliation is deliberately outside the lock in both
tabs, so there is no cycle. Fix: log a line before reconciling ("checking batches this browser has already
sent…") and give `withRunLock` an `AbortSignal.timeout` so a wait that long reports itself.

### 0d. Assign's already-paired check after F-10

Both directions exist and both are written up: **F-4** (recognised as paired when nothing is paired — a
headed `address,amount` file) and **F-5** (paired and not recognised — any list where only some lines carry
an id). The round-nineteen fix moved the *headed* case onto column names correctly; what it did not do is
stop the positional branch from running on a headed file that simply has no id column, and it left the
`.every()` that makes partial pairing invisible.

### 1. Round fifteen's fixes

- **`parsedListIsCurrent` rechecked at every consumer.** I traced all eight call sites of
  `requireCurrentParsedList`/`parsedListIsCurrent` (`index.html:1120, 2238, 2367, 2989, 3059, 3173, 3218,
  3256`). Every path that simulates, approves, or sends rechecks, including *inside* the run lock
  (`3256`) after reconciliation and lock acquisition, which is the recheck that matters. `parseList` calls
  `invalidateParsedList` first, so every early return disarms. I found no consumer that acts on `rows`
  without a recheck. **Sound.**
- **The shared quantity reader.** `requestedNftQuantity` and `parseList` agree on every input I could
  construct where both run, including the round-eighteen S-1 case (`0xA,1,2,3`) and the headed
  `address,tokenId,amount` case that round fifteen fixed in `deliveriesOn`. They disagree on `0xA x3` in a
  *mixed* list — the parser reports it as "not a whole token id" and the reader reads it as 3 — but Assign
  cannot act on that list, because `refuseForUnreadableLines` and the parse problems both fire first.
  The one place the disagreement bites is F-5, and that is about the pairing check rather than the reader.
- **The sender resolver both Check renderers share** (`check.js:1223`). Declared wins, the box is a fallback
  only when nothing was declared, an unreadable declared sender stays explicit and suppresses simulation.
  I could not find a renderer that reaches past it. **Sound.**
- **The ordered-simulation cardinality check.** `completeOrderedSimulation` (`index.html:3044`) checks the
  count and, for each entry, that it is a non-array object with a `status` of exactly `0x0` or `0x1`; a
  short, padded or malformed answer throws and downgrades to the per-call check *with a confirmation*
  (`index.html:3276`). `check.js:693`'s `simulateInOrder` checks the count. **Sound.**

### 2. Round fourteen's shared serializer, and picker/parser agreement

`serializeRow` quotes every separator `splitRow` accepts and then re-parses its own output, throwing if the
round trip is not exact — a runtime invariant, not only a test. Shuffle goes through it on both branches.
**Apply weight does not on its bare branch**, and that is F-6: `addr + (n > 1 ? ' x' + n : '')` is safe as a
string but it is built from the address alone, so everything else on the line is dropped.

Picker and parser agree on an ERC-721 file naming both id and amount: `deliveriesOn` returns 1 for
`0xA,1,1` under `address,tokenId,amount` (the round-fifteen fix) and `parseList` produces one row. I could
not make them disagree on any headed file.

### 3. `src/BulkSend.sol` v13

Read in full and checked against the deployment: `cast`-equivalent `eth_getCode` at
`0xf2eD6359F5deE0334d68cd21d306D9D3E7a49232` on testnet is **byte-identical** (9,752 bytes) to
`out/BulkSend.sol/BulkSend.json → deployedBytecode.object`, verified during this review.

On promise 1: every transfer is `transferFrom(msg.sender, …)` or `safeTransferFrom(msg.sender, …)`, built
with `abi.encodeCall` so the `from` is not caller-controlled; there is no `delegatecall`, no `fallback`, no
`receive`, no payable entry point, no owner, no role, no upgrade hook, and the only storage written is a
transient reentrancy slot cleared inside the same transaction. **I found no way for anyone, the author
included, to widen what it can move.**

On the four ERC-20 guard questions: I could not construct a *legitimate* ERC-20 that any of them refuses.
The two that could produce a false refusal are selector collisions — a token with a function at
`0xe985e9c5` returning a 32-byte 0 or 1, or at `0x6352211e` returning 32 bytes — and the fork suite answers
that empirically for the twenty real mainnet tokens it tests. The NFT that answers none of `_mustBeNft`'s
three questions is the documented one: a bare-`require` ERC-721 with no ERC-165 whose first *and* last listed
ids are both burned or unminted. That refuses the batch rather than mis-sending it, and the probe for it is
in the closed set.

The one thing genuinely outside the guards is the documented one, and I agree it is an **inherent limit**: a
single `0x00` byte is code, and a `STOP` contract succeeds with empty returndata for every call, so it
passes `_mustBeContract`, passes all four `_mustNotBeNft` probes (each returns `ok` with zero-length
returndata, and the length checks correctly refuse to read that as an answer), and then returns the same
empty success a USDT-style token returns — counted as delivered. Nothing on chain separates it from a real
token. What the software should *say*, and does: the page's post-batch check reads balances back rather than
believing the counter, and the contract's own header states that "counting is not proof of payment. The
chain is."

### 4. The evidence gate

**I could not satisfy it by wording, and I could not find a way to weaken a test without the fingerprint
moving.** Specifically:

- Each probe's **complete source** is sha256-pinned (`web_probe_sources`, `contract_probe_sources`) *and*
  its assertion names-plus-statuses are fingerprinted from the run's own output. Editing an assertion moves
  the source hash; renaming one moves the assertion fingerprint; deleting one moves both and the count.
- The **browser suite files themselves** are pinned (`suite_files.client`, `.check`), as are `worker`,
  `csp_gate`, `readers`, `lib`, and the five ordinary contract suites plus `Mocks.sol` and `RealTokens.sol`.
  So an ordinary regression assertion cannot be quietly deleted either.
- A probe file the baseline has never heard of **fails** (I hit this myself: `verify.sh` refuses
  `audit-probe-20.mjs` until the baseline names it). A named file that is missing fails. A file named in
  `*_probe_sources` but not in the inventory fails.
- The `ONLY=` filter is `unset` before each suite and a filtered run is refused by name
  (`*'cases run'*` → FAIL), so a partial green cannot pass as a full one.
- `test.sh` deliberately excludes the probes and says so; **CI does not use it**. `.github/workflows/tests.yml`
  runs `./preflight.sh` then `./verify.sh`, on `push` to main and on `pull_request`, with
  `permissions: contents: read` and `persist-credentials: false`, every action pinned to a commit SHA. I
  found no path through CI that skips the gate.

Three things it does **not** cover, worth stating rather than as findings: `foundry.toml` and `remappings.txt`
are not pinned, so a compiler or EVM-version change is invisible to the gate (the deployed-bytecode step
catches the consequence, but only for the contract that is already deployed); `test/fork/MainnetGuards.t.sol`
is neither pinned nor run by `verify.sh`, by design and stated; and `test/OnChainArt.sol` is in the tree,
unpinned, and referenced by nothing — dead weight rather than a hole.

One small robustness point: contract probe counts default to **0** on a run that produces no "N passed" line
(`eval "now_probe_$n=\${c:-0}"`), where the browser probes default to 999. A contract probe file that failed
to compile would therefore report 0 rather than an obviously-wrong number — but the assertion fingerprint of
an empty run cannot match the baseline's, so the gate still fails. Worth making it 999 for symmetry.

### 5. The pending record and the delivery ledger

**Found sound.** The record is written before the wallet is asked on both paths, with `rowsToJson`,
the run key, the chain, the token, the standard, the sender, and (on the bulk path) the exact calldata. The
only outcome that deletes it is a recognised refusal. A wallet error that is neither rejection nor success
keeps it, and the rows stay held; "Review held rows" is the way out and it re-reads the chain, names the
evidence it used ("events" / "chain" / *neither*), shows the rows, and requires an explicit confirmation
whose text says "If they were paid, releasing them pays them twice."

An unrecognised rejection — a wallet that refuses with a code other than 4001 / `ACTION_REJECTED` / 5750 —
holds rows that were never sent. That is a real cost in user time and it is the correct direction; Review is
the remedy and it exists.

Two tabs: the per-batch `localStorage` key means no whole-array read-modify-write, the run lock is taken with
`ifAvailable` and refused loudly if another tab holds it, `ledgerKey()` throws rather than defaulting if a
send ever tried to record outside a lock, `writeDeliveredFor` reads back what it wrote, and `commitDelivered`
records and releases together or does neither. The honesty statement the promise requires is on the page
itself (`index.html:162`): "another browser, another device, a cleared cache or a private window will not know
about it."

### 6. What the software says about itself

`README.md`, `SECURITY.md` and `docs/for-reviewers.md`'s transport and hosting claims: I checked the
externally observable ones during this review and they all hold — both pages and `/wc.js` are byte-identical
to this commit over the wire, `web/wc.js` matches `web/wc-build/EXPECTED-SHA256`, plain HTTP 301s on both
hosts, HSTS and the full four-header set are present on `/`, on a 400, on a 302 and on `/wc.js`, the CSP
header is exactly the meta policy plus `frame-ancestors 'none'` on both hosts, and the deployed runtime is
byte-identical to what this source builds. **No preload is the right call** and I would not change it: HSTS
preload is a decision about every subdomain of `gmgnrepeat.com` for as long as the list takes to unwind, and
this project owns two of them.

The counts are the part that has drifted — see F-8 below.

On `docs/plan.md`'s two remaining gates: see the verdict section for what I would add to that list.

### 7. The test suites' known weaknesses

The brief asks whether any of the three hides a defect I can name. **All three do, and they are this round's
findings.**

- **Dialogs auto-accepted.** F-4, F-5 and F-6 all live in confirmation behaviour. F-4 is only *visible* when
  a dialog is dismissed rather than accepted — accept it and Assign proceeds and looks normal. F-6's whole
  content is what the confirmation does and does not say. A suite that accepts every dialog by default
  cannot see any of them. This is the most valuable of the three to fix: a `dialogs: 'dismiss'` variant of
  the existing Assign and Apply-weight cases, asserting the message the page then shows, would have caught
  F-4 and F-6 at the time each was written.
- **`eth_call` falling through to a plausible word for an unknown selector.** F-3 lives in
  `myTokenIds`'s explorer fallback, which is only reached when the *enumerable* path fails — and a mock that
  answers `tokenOfOwnerByIndex` plausibly never reaches it. The fall-through keeps the enumerable path
  succeeding, so the branch F-3 is in gets little browser coverage.
- **`eth_estimateGas` answered with a constant.** This is the weakest of the three in my reading. It hides
  nothing I can name today: round nineteen's F-4 fix put the estimate in its own `try` and the *failure*
  branch is what matters, which a constant does exercise if a case makes it throw. I would still vary it,
  because the 110% headroom on `req.gasLimit` is an unasserted number and a constant can never show it is
  too small.

### 8. How it is served

Checked live and all sound; see section 6. On the two questions asked specifically:

- **If the hash and the script disagree**, three things fire, in this order: `web/sync.sh` is what *writes*
  the hash and it asserts exactly one inline script; `preflight.sh` fails the commit ("web/index.html
  carries a CSP that matches its script" — I ran it, clean); and `deploy/publish.sh` recomputes the hash
  from the file it is about to ship and `deploy/csp-gate.py` refuses unless `script-src`'s hash set is
  **exactly** that one hash — presence is explicitly not enough, so a policy naming both the new hash and a
  stale one is refused. The publisher does not repair, which is the right call: repairing would ship bytes
  no commit contains. The Worker's header is derived from the same meta tag by `render-worker.py`, so header
  and document cannot disagree. **The chain is closed.**
- **Is any source in the policy unnecessary?** One: `script-src 'self'` on the **Check** page. `check.html`
  carries one external script (the pinned cdnjs `ethers` file, by full path, with SRI) and one inline script
  that the policy names by hash; it loads nothing same-origin, and the Worker 302s every path but `/` anyway.
  The airdrop page genuinely needs `'self'` for `import('./wc.js')`. Dropping it from the Check page's policy
  costs nothing and narrows what an injected `<script src>` could reach for. Everything else in both policies
  I could tie to a real fetch. The Check page's policy is already the narrower of the two — no WalletConnect
  hosts, no `frame-src`, no `font-src`, `img-src 'self' data:` — which is the right shape for a page that
  signs nothing.
- **The WalletConnect chain is closed.** `web/wc-build/` holds the entry point, a lockfile and the expected
  digest; CI rebuilds with a pinned `esbuild` invocation and requires rebuilt == shipped == expected;
  `publish.sh` refuses to publish unless `web/wc.js` matches `EXPECTED-SHA256` *and* the origin already
  serves those exact bytes at the digest-keyed URL; the Worker re-hashes on every fetch and 502s on a
  mismatch; the integrity workflow re-checks the served bytes four times a day. I verified the served
  `/wc.js` matches both the repository file and `EXPECTED-SHA256` today.
- **The two workflows are trustworthy.** Both are `contents: read`; `integrity.yml` adds `issues: write`
  solely to open its own failure issue and uses `actions/github-script` pinned to a SHA. `tests.yml` uses
  `pull_request`, not `pull_request_target`, so a fork's code never runs with a privileged token, and it
  sets `persist-credentials: false` before running that code. Neither takes input from the thing it is
  watching. I found no way in through either.

### The declined and deferred items

- **Round twelve's S-6 (`false` from an ERC-20 reverts the whole lenient batch).** I agree with the
  decision. I disagree with one sentence of the reasoning in `docs/for-reviewers.md` decision 3: reading the
  recipient's balance before and after does **not** cost "more gas than the transfers" — two `balanceOf`
  reads are roughly 5,000 gas against a 30,000–50,000 gas transfer. The reason to reject it is better than
  that and is worth writing down instead: `balanceOf` is *the same contract's word* as `transferFrom`'s
  return value, so reading it adds no independent evidence — `PaysThenLies20` could as easily lie there — and
  a fee-on-transfer or rebasing token makes the delta unreadable even when the token is honest. The
  conclusion stands; the stated reason is the weak part.
- **The guard-probe returndata item (rounds fourteen/fifteen).** Still a gas path, not an asset path. Agree
  it does not need a v14 on its own.
- **Round seventeen S-5 and S-6.** S-5 (a zero-address line stops Assign without being named) is now
  slightly worse than when it was deferred, because F-4 and F-5 are in the same block and a single rewrite of
  that block could close all three. S-6 (`x0` read as one delivery by the picker and refused by Assign) I
  would leave.
- **`static.cloudflareinsights.com` in `script-src`** — agree, and the reasoning is right: Cloudflare injects
  the beacon after the Worker runs, so refusing it buys a console error per load and nothing else.
- **The `axios` advisories** — I confirmed the shipped bundle: `grep` for `axios`, `form-data`,
  `follow-redirects` and `proxy-from-env` in `web/wc.js` finds nothing. Agree, not a finding.

---

## 4. Areas examined and found sound

Silence elsewhere in this report should mean something, so here is what I actually looked at and did not
find a problem with.

**The contract (`src/BulkSend.sol`, all 482 lines).**

- Authority. Every transfer is `transferFrom`/`safeTransferFrom` with `msg.sender` as the source, encoded
  with `abi.encodeCall` so the `from` is never caller-supplied. No `delegatecall`, no `fallback`, no
  `receive`, no payable function, no owner, no role, no upgrade path, no pause, no fee, no rescue. The only
  storage is one transient reentrancy slot, cleared in the same transaction. Promise 1 holds, and I could
  not find a way for the author to change it after the fact.
- `sent + skipped == n` in all three paths, with `sent = n` assigned outside the loop in strict mode and the
  invariant suite (2,304 random calls per run) asserting it. Branch coverage is exactly the claimed 100%
  (58/58) — I ran `forge coverage` to check.
- Skipped never covers "may have moved": a `_tryCall` that returns `ok == false` reverted, so its state is
  gone. A success carrying returndata on a 721 or 1155 path, or anything other than empty-or-exactly-1 on
  the ERC-20 path, takes the whole batch down rather than counting either way. Promise 2 holds inside the
  contract.
- The stipend arithmetic. `g - g/64 < stipend + GAS_RESERVE` reverts rather than letting EIP-150 silently
  clamp, which is what keeps `eth_estimateGas` from settling on a limit that skips rather than delivers.
  `REASON_CAP` bounds the returndata a hostile recipient can make the batch pay for. `_checkGas` refuses a
  stipend in strict mode rather than accepting and ignoring it.
- `_mustBeContract` refuses an EIP-7702 delegation designator by prefix rather than by length alone.
- The reentrancy lock. Its stated purpose — stopping a recipient's hook from emitting real `Skipped` and
  `Airdrop*` events from this address into the receipt the client reads — is the right threat and the right
  fix, and `readBatchReceipt` independently refuses to trust a receipt whose numbers do not add up.

**The airdrop page.**

- The strict-mode promise. `plan()` computes `strictSplit = !lenient() && batches > 1` and **disables Send
  entirely** with "\"All or nothing\" only holds inside one transaction. This list needs N." That is a gate
  rather than a disclosure, and it is why the option label "if any wallet fails, send nothing" is literally
  true. I went looking for a multi-transaction strict run and could not produce one. Promise 3 holds.
- The pre-send confirmation. It names the network in words a non-technical reader can act on ("REAL money" /
  "test network, nothing of value"), the exact per-transaction boundaries with first and last recipient, the
  delivery order, what a stop or a failure would mean for who was paid, the number of signatures, and it
  writes the same list to a downloadable manifest that is invalidated the moment the list changes. This is
  the best-constructed part of the page.
- `serializeRow`'s self-check: it re-parses its own output and throws if the round trip is not exact, so a
  future separator change cannot silently corrupt a list because one writer was missed.
- `splitRow` keeps empty cells and only pops a single trailing separator, so a blank id column cannot shift
  every later cell left. `wholeText` accepts `1.0` and refuses `1.50`; `SCIENTIFIC` refuses `1.23457E+11`
  by name rather than guessing the lost digits; `tooPrecise` refuses an amount with more decimals than the
  token has rather than rounding it. Promise 5 holds on every input I tried.
- `readHeader`'s two-pass whole-word matching (never a substring), which is why `tokenId` does not claim the
  address column through its "to".
- Duplicate rows are numbered (`base + '#' + n`) so two identical lines are two payments and the ledger can
  hold both, and the numbering is per row-key rather than per position, so reordering the list does not
  shift the keys.
- The delivery ledger and the pending journal: see section 3.5. Promise 4 holds for everything it claims,
  and the page states the cases it cannot cover in the footer.
- `arrivalsFromReceipt` filters on `from == the recorded sender` for all three log shapes, so a token that
  credits a recipient from somewhere else in the same transaction cannot count toward this batch.
- `confirmArrival`'s four answers, and that only `arrived` is ever written to the ledger.
- `upgradedWalletsThatCannotReceive` asks the delegate itself rather than matching a list of known ones.
- `looksGenerated` requires *both* signals before it will say a list looks made up, and says explicitly that
  it can never say the reverse.

**The Check page.** Beyond F-1, F-2 and F-7: the three-state handling of an unreadable `getCode`
(`codeUnreadable`, never "an ordinary wallet"); `bodyMissing` being distinguished from `empty` so a pruned
node cannot produce "a plain transfer of ETH" above an unlimited approval; the proxy handling (the
forwarder's own ABI is set aside rather than left as a fallback, a beacon is followed one more step and
`beaconUnread` is said out loud); `knownFunctions` describing itself as "a floor and never a ceiling" in the
case where it reads selectors from bytecode; nested calls decoded to a bounded depth with the cutoff
*announced* rather than silently returning nothing; `parseData` counting trailing bytes the ABI decoder
ignores and warning that a contract reading `msg.data` directly can act on them. Promise 6 holds on the
"signs nothing, sends nothing" half absolutely — there is no signer, no wallet connection and no write path
on that page at all.

**Serving and provenance.** Verified live during this review, not taken from the documentation: both pages
and `/wc.js` byte-identical to this commit; `web/wc.js` == `EXPECTED-SHA256`; plain HTTP 301 on both hosts;
HSTS plus `x-content-type-options`, `referrer-policy` and `cross-origin-opener-policy` on `/`, on a 400, on a
302 and on `/wc.js`; the CSP response header exactly the meta policy plus `frame-ancestors 'none'`; and the
deployed runtime at `0xf2eD…9232` byte-identical (9,752 bytes) to what this source builds. Promise 7 holds.

**The evidence gate.** See section 3.4. I tried to get a weakened test past it and could not.

---

## 5. Verdict

**Nothing here blocks release.**

Measured against the bar in section 1: authority is bounded and immutable (1); the three-state discipline
holds everywhere it decides whether value moved, and the nine places I found where it slips are all in what
the page *says* rather than in what it does (2); double-payment is prevented structurally, by a record
written before the irreversible act and a cross-tab lock, with the gaps stated on the page (3); the list is
delivered as parsed (4); the software fails toward holding, refusing and "could not check" in every path I
traced (5); what is deployed is what was reviewed, and I checked that over the wire rather than believing it
(6); and the evidence is genuinely adversarial — I could not weaken a test without the gate noticing (7).

Nine findings, none of them a blocker:

| | finding | category |
| --- | --- | --- |
| F-1 | "source published and matched" about a verification the page cannot tell is full or partial | should fix |
| F-2 | any 200 JSON body read as a real explorer answer → "no source published" as fact | should fix |
| F-3 | a cut-short inventory walk returned as a complete one; Assign states the count as fact | should fix |
| F-4 | a headed `address,amount` list reported as "already names its token ids" | should fix |
| F-5 | a partly-paired list re-paired at random with no question | should fix |
| F-6 | "Apply weight" silently eats the ids in the form this page writes itself | should fix |
| F-7 | an ERC-721 `approve(spender, id)` called "an unlimited approval … in any amount" | should fix |
| F-8 | two documents state browser-test counts that are wrong and disagree | should fix |
| F-9 | the holder walk's "cut short" branch is unreachable when the first page is the unreadable one | should fix |

**Inherent limits — what the software should *say*, not do.** Three, and the page already says all three;
I list them so that "no blockers" is not read as "no residual risk":

1. **A token can lie in its view functions.** `balanceOf`, `ownerOf` and `totalSupply` are the same
   contract's word as `transferFrom`'s return value. `PaysThenLies20` in this repository's own fixtures moves
   a balance and then answers `false`; a `STOP` contract answers every call with an empty success and is
   counted as a USDT-style delivery. No amount of on-chain probing settles this. The page says it — "That is
   the token's own answer… It is evidence, not proof: a hostile token can lie" — and the contract header says
   "Counting is not proof of payment. The chain is." Keep both sentences exactly as they are.
2. **A node or an explorer can be stale or wrong.** Every chain answer reaches the browser through one RPC.
   The page's `confirmArrival` can read a recipient as short because they sent tokens out between the two
   reads, or as arrived because someone else paid them in the same block. The page holds rather than releases
   in the first case and hedges the second. What it should keep saying, and does: "delivered through one
   configured RPC node… Compare the transaction on the explorer; if the two disagree, stop before sending
   again."
3. **`localStorage` cannot protect another browser, device or private window.** Structural, unfixable in a
   page with no server. Stated in the footer in those words. The right wording is already there.

### What I would fix first, if the list were mine

F-4 and F-5 together, in one rewrite of the twelve lines at `index.html:2155-2166`, with F-6's guard folded
into the same change — three findings, one block, and it closes round seventeen's deferred S-5 on the way
past. Then F-1, which is one `!!` and is live on mainnet today. Then F-2, F-3 and F-9 together: they are one
defect — an unreadable answer becoming a definite negative — reached through three different functions, and
the three of them are the page's whole "could not check" story.

### The gate list in `docs/plan.md` is short by one thing, and it is a big one

The four gates in `docs/status.md` are the right four. What is missing is not a gate before mainnet but a
control *for* mainnet: **every automated check on the deployed contract is hardcoded to testnet.** Both
`.github/workflows/tests.yml` and `.github/workflows/integrity.yml` read the address from
`deployments.testnet.json` and query `rpc.testnet.chain.robinhood.com`. On the day the mainnet address is
substituted for `{{BULKSEND_MAINNET}}`, the single strongest control this project has — "the deployed runtime
is byte-for-byte what this source builds", re-checked from outside the Cloudflare account four times a day —
will still be watching a testnet contract that holds nothing, and nothing at all will be watching the
contract that holds real approvals. `integrity.yml` also asserts
`grep -qF "LIVE_CHAINS = new Set([46630])"`, so it will fail loudly at that moment, which is the right time
to do the work — but that makes it a step in the enabling change, and steps in a change are exactly the
things that get done in the same breath as "it's failing, just update the grep". Write it down as its own
gate: *before mainnet is enabled, both workflows check the mainnet deployment as well, and `integrity.yml`
asserts the page names the mainnet address it was reviewed against.*

Two smaller additions I would make to the same list:

- **A stated position on what happens after something goes wrong on mainnet.** The contract is immutable and
  has no pause, which is the right design; the consequence is that once a user has approved BulkSend for a
  collection, the only lever anyone has is the page. Republishing the page with mainnet off does not revoke
  an approval. The page has a Revoke button and the footer tells people to use it, which is the correct
  answer — but "the page is the only lever" deserves to be a sentence in `SECURITY.md` rather than an
  inference a reader has to make.
- **Gate 11's key is on a free tier.** The mainnet explorer path depends on a Blockscout PRO key bound as a
  Worker secret, on a tier the Worker's own comment describes as five requests a second, for an API
  Blockscout is in the middle of migrating. `integrity.yml` does check it four times a day and would fail if
  it went dark, which is genuinely good — but there is no stated position on what happens when it does, and
  the honest degradation ("could not check for a published source" on every mainnet contract) makes the Check
  page's headline claim unavailable rather than wrong. That is the right failure mode; it should be a
  documented expectation rather than a surprise.

### What a clean round would have to look like

The first gate is "a review round with no release blockers", and the pattern the brief names is that eight
times a fix from one round has been the next round's finding. **This round found no blocker.** But I will not
claim the pattern is broken, because three of the nine are in the round-eighteen and round-nineteen work:

- **F-1** is the page mishandling a field the round-nineteen Worker fix introduced *honestly*. `null` was
  chosen deliberately, with a comment saying "null, not a claim"; `web/check.js`'s `readAddress` turns it into a claim with `!!`.
- **F-2** is the other half of the very function round nineteen repaired. `explorerJson` was taught that
  "reached" is not "answered"; it was not taught that "answered" is not "answered *this question*".
- **F-9** is round nineteen's own new `truncated = true` line being unreachable in the commonest case,
  because the branch that reports it was already ordered after a `return`.

So the pattern is intact, and it has a shape worth naming: it is no longer "the fix is wrong" — all three
fixes are right — it is **"the fix is right and nothing checked the consumer, or the order, around it."**
That is a smaller class and a more tractable one. The practical answer is the one under section 3.7: the
suites auto-accept dialogs and mock plausible answers, so the cases that would have caught these three
(dismiss the dialog; answer 200 with the wrong body; make the *first* page the bad one) are exactly the cases
the harness makes hard to write. Three fixtures — a dialog-dismissing page, a wrong-shape explorer answer, a
first-page failure — would close that gap for future rounds better than any amount of re-reading.

The gate's own wording is the thing to hold to: "the round that finds none on a tree that then does not
change has not happened." This tree will change if these nine are fixed, so this round does not close that
gate either — it is the second round since the gate was written (seventeen was the first) to find no blocker,
not the round after which nothing changed. What it does say is that the remaining work is entirely in what
the pages *say*, and that none of the nine touches the paths where value moves.
