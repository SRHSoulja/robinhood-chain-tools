# Round twenty-one — correctness and safety review

Commit under review: `42eab38` ("round twenty closed"). Reviewed 12 September 2026.
Scope as given in `PROMPT.md`. `lib/` and `src/research/` excluded.

Probe file added by this round: `test/web/audit-probe-21.mjs` (8 cases, all reproducing).

---

## The release bar I am judging against

Before software that moves other people's money goes in front of the public, I want six things to
be true. These are the criteria every finding below is sorted against.

1. **The contract cannot be made to move value the signer did not authorise.** No owner, no
   upgrade path, no delegatecall, no way for a later actor — including the author — to change what
   an already-signed transaction does. Allowance is the only authority, and it is spent only inside
   the transaction the user signed.
2. **Every statement the software makes about what happened is either true or explicitly uncertain.**
   "Sent", "skipped", "delivered", "matched", "no source published" are claims. A claim that the
   software cannot support from evidence it actually holds must be downgraded to "could not check",
   not rounded to the convenient definite. This is the single property that separates a tool a
   non-expert can act on from one that misleads them.
3. **Nothing is silently reinterpreted between what the user typed and what is signed.** No
   rounding, no rescaling, no reordering that changes who gets what, no dropped rows, no row
   invented. Where the page rewrites the user's own list, it must say what it is about to destroy
   before it destroys it.
4. **Double payment is prevented where it can be prevented, and named where it cannot.** A browser
   page cannot make a multi-tab, multi-device, replaced-transaction world atomic. It can be honest
   about exactly which cases it covers.
5. **What is served is what was reviewed.** Byte-identity between repository and deployment,
   reproducible third-party bundles pinned by digest, transport that cannot be downgraded, and a
   policy gate that a future commit cannot quietly relax.
6. **The evidence is falsifiable.** The test suite must be able to fail. A gate that can be
   satisfied by rewording, or skipped by a flag, is not a gate.

Against that bar: **a blocker is anything under (1), (2), (3) or (4) where a user acting reasonably
loses funds, pays twice, strands an asset, or acts on a false statement.** Everything else is a
should-fix or an inherent browser limit.

---

## Verdict

**Nothing here blocks release.** Ten findings, all demonstrated or checked against the running system, and
every one of them sits in category two — *should be fixed, does not block* — or category three. No user on
any input I could construct loses funds, pays twice, strands an asset, or is told something false about
whether their money moved.

Measured against the bar at the top:

| | |
| --- | --- |
| **1. the contract cannot be made to move what was not authorised** | **holds.** Byte-identical to the build at `0xf2eD…9232`, fully verified on the explorer, no owner, no upgrade path, no delegatecall, allowance-only. I found nothing new in it, and the fork suite agrees with 20 real collections and 20 real tokens each way. |
| **2. every statement is true or explicitly uncertain** | **holds where value moves; four leaks elsewhere.** F-1, F-2 and F-3 are this property failing in a *consumer* of a fix rather than in the fix, all on the read-only page; F-5 is a false sentence in the send log about a batch that demonstrably did not move. None puts a wrong number or a wrong recipient on the wire. |
| **3. nothing is silently reinterpreted between typed and signed** | **holds for what Send sends; twice it fails for what the page does to your list before that.** F-4 and F-6 both destroy or shrink a recipient list behind a confirmation that describes something else. Both are visible in the box afterwards, which is why neither blocks. |
| **4. double payment prevented where possible, named where not** | **holds.** This is the strongest part of the page and I could not get past it. |
| **5. what is served is what was reviewed** | **holds.** Verified live at review time, all three files, plus transport, CSP and the connector digest chain. |
| **6. the evidence is falsifiable** | **holds, with one crack.** `verify.sh` refused my own probe by name on the first run, exactly as designed. F-7 is its summary line contradicting its own exit status. |

**The single most consequential finding is F-3**, and it is worth being precise about why it is not a
blocker. `renderInner` passing `t.token` where `t` is now wanted disables *both* halves of
`unlimitedApproval` for any call carried inside another, so an ERC-20 approval between `totalSupply` and
`2^128` — the range that is "unlimited" in practice — loses its red warning inside a `multicall` or
`execute`. What saves it is that the sentence directly above the missing warning is still correct and still
alarming: *"Let 0xbeef… spend 1000000000000.0 STB of your Stable Thing, now and at any time in the future,
until you take it back."* The page does not claim the call is safe. It fails to add the emphasis it has for
exactly this shape. That is a missing warning, not a false statement, so it is a should-fix — but it is the
one I would fix first, and it is a one-line change (`unlimitedApproval(p, t)`).

**What would have made something a blocker.** So this verdict is measurable rather than a mood: I would have
called it a blocker if I had found (a) any input that makes BulkSend move an asset the caller did not name in
the transaction they signed; (b) any state where a recipient is recorded as delivered, or released from the
pending ledger, on evidence weaker than the token's own events in a receipt the page read; (c) any path where
the page offers a row for payment that it has reason to believe was already paid; (d) any statement rendered
as settled fact where the page holds an unreadable answer — *on a path a user would act on with money*; or
(e) any way to publish, or leave published, bytes that differ from this commit. I looked for each, named
where I looked in the sections above, and found none.

**What this verdict does not cover.** No wallet extension and no phone wallet was driven by me; every wallet
in everything I ran is written by this repository. I sent no transaction of my own composition on any
network, and read nothing from mainnet beyond `eth_getCode` and the read-only fork. The control-plane facts
`PROMPT.md` excludes I did not test, and I found nothing that contradicts any of them.

**On the pattern.** `PROMPT.md` says the pattern is now the finding: "nine times a fix from one round has
been the next round's finding, and the shape has narrowed to *the fix is right and its consumer or its
ordering was not checked*." That is exactly what this round found, and it is now ten. **Six of the ten
findings below are the same shape**, and four of them are in the fixes made by the commit under review:

- F-1 — round twenty's F-2 fix, applied at `check.js:300`, not at `check.js:344`.
- F-2 — round twenty's F-1 fix, applied to `out.partial`, which the proxy pill does not read.
- F-3 — round twenty's F-7 fix changed a function's signature and updated **one of its two call sites**.
- F-4 — round twenty's F-6 fix, guarded on `standard === '721'` when the page writes the same shape for 1155.
- F-5 — round nineteen's F-4 fix, correct in itself, rethrowing into a catch that contradicts it.
- F-6 — round eighteen's S-1 fix, given to the bare form of a file and not the headed form.

The narrowing is real. What has not been tried, as far as I can see, is the mechanical answer to it: F-3
would have been caught by a lint rule about a changed signature, F-1 and F-2 by grepping for the second
reader of `is_verified` (which is what `docs/readers.md` exists to do — it is applied to the recipient box
and not to the explorer record), and F-4 and F-6 by asking, at the moment of each fix, "which standard, and
which list shape, does this guard *not* cover?" `readers.md`'s discipline works. It is applied to one input.

---

## Findings at a glance

| # | what | category | file | shown |
| --- | --- | --- | --- | --- |
| F-1 | round twenty's F-2 fix not applied to the code behind a proxy: an unreadable explorer reply becomes "the code it runs has published no source" | should fix | `web/check.js:344` | demonstrated, `P21-1` |
| F-2 | a partially verified implementation behind a proxy is announced as fully published | should fix | `web/check.js:313`, `344` | demonstrated, `P21-2` |
| F-3 | round twenty's F-7 fix updated one of two call sites: inner calls lose both the supply test and the ERC-721 exception | should fix | `web/check.js:603` | demonstrated, `P21-3`, `P21-4` |
| F-4 | "Apply weight" eats the edition id and amounts of a bare ERC-1155 list the page itself wrote | should fix | `web/index.html:2084` | demonstrated, `P21-5` |
| F-5 | a gas-limit failure prints round nineteen's correct sentence and then the one it replaced, about the same batch | should fix | `web/index.html:3433`, `3442` | demonstrated, `P21-6` |
| F-6 | Assign's quantity reader and the parser read `address,tokenIds` with several ids in one cell differently: five recipients become two | should fix | `web/index.html:976` | demonstrated, `P21-7` |
| F-7 | `verify.sh` prints "Everything passes" on a run that failed its last gate | should fix | `verify.sh:255-281` | demonstrated |
| F-8 | round seventeen's S-5 still open, and the advice after it points back at the button that refused | should fix | `web/index.html:2268` | demonstrated, `P21-8` |
| F-9 | the mainnet gate table says "not met" for two gates the plan records as done, and contradicts itself on one | should fix | `docs/status.md:20-21` | reasoned, cross-checked |
| F-10 | three documents state browser-test counts the commands do not produce | should fix | `docs/status.md:44-45` | demonstrated by running them |

None is category one. Six of the ten are the repository's own known pattern — a correct fix whose consumer,
ordering or sibling shape was not checked — and four of those are in fixes made by the commit under review.

## Findings, in detail

Probe file: `test/web/audit-probe-21.mjs` (repository convention — a probe that **PASSES / REPRODUCES**
is a defect that is still present). Run it with `node test/web/audit-probe-21.mjs`. At `42eab38` it
reports **8 demonstrated, 0 not reproduced**. `./verify.sh` will refuse the file until
`test/findings-baseline.json` names it; that is the guard working, not a problem with the probe.

---

### F-1 — the round-twenty F-2 fix was not applied to the code behind a proxy
**Should be fixed; does not block.** Demonstrated (`P21-1`).
**File:** `web/check.js:344` (consumers at `web/check.js:841-845`, `868-869`, `1543`).

Round twenty F-2 taught `readAddress` that a 200 JSON body carrying no `is_verified` *boolean* is not
an answer to "is the source published", and downgraded it to `verified = null` + `explorerDown`
(`check.js:300`). Forty-four lines below, the *same question* is asked again about the implementation
a proxy actually runs, and that consumer was never changed:

```js
out.proxy.verified = res.ok ? !!(impl && impl.is_verified) : null;   // check.js:344
```

`explorerJson` returns `ok: true` for **any** 200 JSON body, and `!!undefined` is `false`.

**Input and state.** A contract that is an EIP-1167 (or slot-based) proxy. The explorer answers
`/smart-contracts/<implementation>` with HTTP 200 and a body that is not a Blockscout contract record —
a rate-limit envelope (`{"error":"rate limited","retry_after":30}`), a CDN/gateway error document, or an
explorer build that reports "not found" in the body rather than in the status.

**What it costs the user.** The page prints, as settled fact, the red pill **"the code it runs has
published no source"** and the line **"(the code it runs has no published source)"** — about code
nobody could check. No `explorerDown` pill is set on this path either, so nothing on the page hints
that the explorer was the problem. It is the exact sentence F-2 was raised to remove, one consumer
over. The error is in the conservative direction (a checkable contract is made to look unchecked), so
it does not block, but it is a false statement the user acts on.

**Reproduce.** `node test/web/audit-probe-21.mjs` → `P21-1`.

**Fix.** Give the implementation lookup the same three states the contract itself now has:

```js
out.proxy.verified = !res.ok ? null
  : typeof (impl && impl.is_verified) === 'boolean' ? impl.is_verified : null;
if (out.proxy.verified === null) out.explorerDown = true;
```

---

### F-2 — a partially verified implementation behind a proxy is announced as fully published
**Should be fixed; does not block.** Demonstrated (`P21-2`).
**File:** `web/check.js:313-314` (set from the forwarder), `344`, rendered at `841-848` and `901-902`.

`out.partial` is computed **only** from the forwarder's own `/smart-contracts` record, and
`out.proxy.verified` is a bare boolean with no partial state. So when the explorer says the
implementation is `is_partially_verified: true`, the page shows the green pill **"the code it runs has
published source"**, and the "What this section is, and is not" note — which has wording for exactly
this (`o.partial === true` → "only partially verified, so even the published source may not be all of
the code that runs") — reads the *forwarder's* `false` and stays silent.

The control in the same probe run shows the asymmetry: the identical explorer record read **without**
a proxy in front of it correctly produces **"source published, partly matched"**.

**What it costs the user.** A proxy in front of partially verified code reads as fully published
source. That is "safer than the evidence supports" — promise 6 — and it is the F-1-of-round-twenty
defect surviving in the proxy consumer.

**Extra note, mainnet-specific.** `deploy/render-worker.py` answers `is_partially_verified: null`
("null, not a claim") because the mainnet module API does not carry the field. Round twenty taught the
non-proxy path to render that as *"source published (whether the match is full or partial is not
known)"*. The proxy path has no such state at all, so on mainnet **every** proxy will read as
"the code it runs has published source" with the uncertainty silently dropped.

**Reproduce.** `node test/web/audit-probe-21.mjs` → `P21-2`.

**Fix.** Carry the implementation's `partial` the same way the contract's is carried
(`out.proxy.partial = impl.is_partially_verified === true ? true : (… == null ? null : false)`), and
give the proxy pill the same three-way wording the non-proxy pill already has.

---

### F-3 — round twenty's F-7 fix updated one of `unlimitedApproval`'s two call sites
**Should be fixed; does not block (but it is the one finding here on the "looks safer than it is" side).**
Demonstrated (`P21-3` and `P21-4`).
**File:** `web/check.js:603` (`renderInner`); the signature it calls is `web/check.js:458-463`.

`42eab38` changed `unlimitedApproval(p, token)` to `unlimitedApproval(p, target)` — second parameter is
now the whole `readAddress` record, and the function reads `target.standard` and `target.token` out of
it. The commit updated the call site in `callWarnings` (`check.js:923`) and left the other one alone:

```js
unlimitedApproval(p, t && t.token)      // check.js:603, renderInner
```

`t.token` is `{name, symbol, decimals, supply}` — it has neither `.standard` nor `.token`. So at this
call site **both halves of the function are disabled**: `target.token` is `undefined`, so the
supply comparison that `unlimitedFor` exists for never runs, leaving only the `2^128` fallback; and
`target.standard` is `undefined`, so F-7's ERC-721 exception never fires.

**F-3a — the false all-clear.** Paste `execute(TOKEN, 0, approve(spender, 1e30))` where `TOKEN` is an
ERC-20 with 18 decimals and a total supply of `1e27`. The approval is **a thousand times the entire
supply** and below `2^128`. The inner-call row renders with no "This inner call is an unlimited
approval" line. The identical bytes pasted on their own **are** flagged, by the call site that was
updated. The comment above `innerCalls` says this view exists because "a hex blob under a card titled
'everything it is asking for' is how an unlimited approval travels unremarked" — that is what it now
does again, for any approval in `[totalSupply, 2^128)`.

**F-3b — the false alarm F-7 was raised to remove.** `execute(NFT, 0, approve(spender, tokenId))` where
`tokenId >= 2^128` — an ordinary hash-derived ERC-721 id, as ENS and every contract that derives an id
from a name or hash uses — is announced in red as "This inner call is an unlimited approval". The same
bytes pasted alone are described correctly, because F-7's exception applies there.

**What it costs the user.** (a) A drain-sized approval hidden one level inside a `multicall` or
`execute` is shown with no warning, on the page whose whole purpose is to name it. (b) An ordinary
single-NFT approval is called an unlimited approval, which is the false statement round twenty already
fixed once.

**Reproduce.** `node test/web/audit-probe-21.mjs` → `P21-3`, `P21-4`.

**Fix.** One argument: `unlimitedApproval(p, t)` at `check.js:603`. Worth adding an assertion in
the suite that the two call sites are given the same kind of thing.

---

### F-4 — "Apply weight" still eats the ids in the bare form the page writes, for ERC-1155
**Should be fixed; does not block.** Demonstrated (`P21-5`).
**File:** `web/index.html:2084-2091` (the guard), `2110` (the rewrite).

Round twenty F-6 taught Apply Weight to refuse to rewrite a line that already names a token id in the
**bare** form this page writes for itself. The guard it added is

```js
if (standard === '721' && lines.some((line) => lineNamesId(line, acol))) { … refuse … }
```

Assign writes exactly the same bare form for ERC-1155 — `serializeRow([to, id, amount])`, i.e.
`0xabc,5,3` — and for an edition the id says *which* edition. With ERC-1155 selected, `acol` is null
(a bare list has no heading), so the rewrite branch is `addr + ' x' + n` and **both the edition id and
the per-wallet amount are replaced by a flat count**.

**Input and state.** ERC-1155 selected, holders read (which is what reveals the weighting controls),
the box holding `0x…111,5,3` / `0x…222,5,2`, "how many each" 4, Apply weight. Result:
`0x…111 x4` / `0x…222 x4`. The confirmation the user agreed to reads *"This rewrites the list so each
wallet gets 4 each. 2 wallets, 8 in total. There is no undo. Continue?"* — it counts wallets and never
mentions the edition or the amounts it is about to destroy.

**What it costs the user.** The pairing is destroyed with no undo. It is less severe than round twenty's F-6 was:
the resulting box does **not** parse (`"x4" is not a whole token id`), so nothing wrong is sent — the
user loses work and is told the list is broken, rather than sending the wrong thing. The same click on
ERC-20 has the same shape (`0xabc,1.5` → `0xabc x4` → "missing amount").

**Reproduce.** `node test/web/audit-probe-21.mjs` → `P21-5`.

**Fix.** Drop the `standard === '721' &&` qualifier and word the refusal per standard, or — better —
make the bare-list branch preserve the cells it is not rewriting the way `setQty` does for a headed
file, instead of rebuilding the line from the address alone.

---

### F-5 — a gas-limit failure prints round nineteen's fix *and* the sentence it replaced, about the same batch
**Should be fixed; does not block.** Demonstrated (`P21-6`).
**File:** `web/index.html:3424-3453` — inner `catch` at 3433, outer `catch` at 3442 (both verified).

Round nineteen F-4 gave the pre-broadcast gas-limit failure its own honest message. The fix is an inner
`try/catch` that logs and then **rethrows**:

```js
} catch (err) {
  dropPending(pid);
  log('  … it was not sent to your wallet at all. Those recipients are not held back. ' + …, 'bad');
  throw err;                                   // index.html:3437
}
const hash = await signer.sendUncheckedTransaction(req);
…
} catch (err) {                                 // index.html:3442 — catches the rethrow too
  if (isRejection(err)) { dropPending(pid); }
  else log('  that batch was handed to your wallet and this page did not get an answer. Those '
         + 'recipients are held back until it can read the chain: …', 'bad');
  throw err;
}
```

A JSON-RPC estimate failure is not a rejection (`isRejection` recognises only `4001`, `ACTION_REJECTED`,
`5750`), so the outer branch runs and both sentences are printed, in order, about one batch.

**Input and state.** An ordinary bulk send where `pageRpc.estimateGas` fails for the BulkSend call — the RPC
is rate-limiting, or the call now reverts because the approval was pulled or a recipient's state changed
between the test run and Send. The probe makes the page's own RPC refuse `eth_estimateGas` only when
`to` is BulkSend; the wallet is never asked anything (`walletWasAsked: false`).

**What it costs the user.** The log says, one line after the other:

> `this page could not work out a gas limit for that batch against its own RPC, so it was not sent to your
> wallet at all. Those recipients are not held back.`
> `that batch was handed to your wallet and this page did not get an answer. Those recipients are held back
> until it can read the chain: reload with the same wallet on the same network, and it will look for the
> transaction before offering them again.`

The second is false on every clause: nothing was handed to a wallet, the pending record was already dropped
by `dropPending(pid)`, and reloading will find no transaction because none exists. A user reading the tail of
the log believes a batch may be in flight and that their recipients are held — which is precisely the
uncertainty round nineteen F-4 was raised to remove. It errs in the safe direction (it makes an
unsent batch look possibly-sent rather than the reverse), which is why it does not block.

**Reproduce.** `node test/web/audit-probe-21.mjs` → `P21-6`.

**Fix.** Let the inner catch mark the error before rethrowing and have the outer one respect it, e.g.
`err.__beforeWallet = true` / `if (err && err.__beforeWallet) throw err;` as the first line of the outer
catch — or hoist the gas estimate out of the outer `try` altogether, which is what its own comment describes.

---

### F-6 — the quantity reader and the parser read the same headed file differently
**Should be fixed; does not block.** Demonstrated (`P21-7`).
**File:** `web/index.html:976-993` (`requestedNftQuantity`), against `1255-1265` (`parseList`) and
`1606-1631` (`deliveriesOn`).

`requestedNftQuantity`'s comment claims one reader: *"This is the same semantic reader used by list sizing;
Assign does not keep a parallel rule."* It is not the same reader. For a **named id column holding several
ids in one cell** — `address,tokenIds` with `"1 2 3"`, the shape `parseList` documents and supports ("A
tokenIds column holding '1 2 3' is the same thing one column over") and which `lineNamesId` splits on
`/[\s|]+/` — the three readers disagree:

| reader | `address,tokenIds` + `"1 2 3"` |
| --- | --- |
| `parseList` (what Send sends) | 3 deliveries |
| `deliveriesOn` (the picker's sizing) | 3 deliveries |
| `requestedNftQuantity` (what Assign asks for) | **1** |

Round eighteen S-1 fixed exactly this for the **bare** positional form (`0xabc,1,2,3` → 3); the named-column
equivalent was never given the same rule.

**Input and state.** ERC-721, box holding

```
address,tokenIds
0x…111,"1 2 3"
0x…222,"4 5"
```

"Check list" reports **5 recipients**. Press Assign (the page's own next step), agree to *"Every line already
names its token ids. Assign would throw those pairings away and pair the wallets with your holdings again.
Continue?"*, and the box becomes two lines — **2 recipients**. Nothing in the dialog, the message or the log
mentions the three deliveries that disappeared; the dialog speaks only of pairing.

**What it costs the user.** An airdrop is silently cut from five NFTs to two. Three recipients get nothing.
It is recoverable — the box visibly shrinks and "Check list" reports the smaller number — but the page is the
thing that shrank it, after a confirmation that described a different operation.

**Reproduce.** `node test/web/audit-probe-21.mjs` → `P21-7`.

**A second shape, same root, lower stakes.** A headed ERC-721 file that names *both* an id and an amount —
`address,tokenId,amount` with `0x…111,1,3` — is read as 1 delivery by `parseList` and by `deliveriesOn`, and
as **3** by `requestedNftQuantity`. The file is self-contradictory (an NFT id is not a quantity) and Assign
does ask before rewriting, so this is not worth a finding of its own; it is the same two rules disagreeing,
and the fix below covers it.

**Fix.** Give `requestedNftQuantity` the named-id-cell rule `deliveriesOn` already has: when
`col.id !== undefined` and that cell splits into more than one whole number, that count is the request. Better
still, have `deliveriesOn` call `requestedNftQuantity` for the id-cell case too, so there is genuinely one
rule rather than two that happen to agree in most shapes.

---

### F-7 — `verify.sh` can print "Everything passes" on a run that failed
**Should be fixed; does not block.** Demonstrated (see below).
**File:** `verify.sh:255-281`.

The last gate in `verify.sh` — the one that pins the eleven suite files whose weakening nothing else would
catch (`test/BulkSend.t.sol`, `BulkSendReal.t.sol`, `Reentrancy.t.sol`, `IdAmountProbe.t.sol`,
`Invariants.t.sol`, `Mocks.sol`, `RealTokens.sol`, `readers.test.mjs`, `web/lib.mjs`, `worker.test.mjs`,
`csp-gate.test.sh`) — sets `fail=1` *inside* the `if [ "$fail" -eq 0 ]; then` branch, and the branch then
prints its success sentence unconditionally:

```bash
if [ "$fail" -eq 0 ]; then
for pair in "worker:…" "contract_bulksend:test/BulkSend.t.sol" … ; do
  …
  if [ "$now" != "$was" ]; then say "  FAIL  $key suite file fingerprint changed …"; fail=1
  else say "  ok    …"; fi
done
  say "Everything passes, and nothing that was closed has reopened."     # ← always
  …
else
  say "Something is wrong above. Nothing should be committed on this tree."
fi
exit "$fail"
```

**Reproduce.** Extract `verify.sh` lines 255-282 verbatim into a script with `fail=0` and a baseline whose
`suite_files.contract_bulksend` differs, and run it:

```
  FAIL  contract_bulksend suite file fingerprint changed (test/BulkSend.t.sol). …
  Everything passes, and nothing that was closed has reopened.
  EXIT=1
```

**What it costs.** The exit status is correct, so CI (`tests.yml`) still fails — this is not a route to a bad
release through the pipeline. The cost is to the human workflow the repository documents: `./verify.sh` is
"the commit gate", and a maintainer who weakens one of the eleven pinned files and reads the end of the
output is told, in the document's own words, that nothing that was closed has reopened. The
"Something is wrong above" line never prints for this entire class of failure.

**Fix.** Move the `for pair in …` loop above the `if [ "$fail" -eq 0 ]` test, or re-test `$fail` after the
loop before printing the summary.

---

### F-8 — round seventeen's S-5 is still open, and the advice that follows it is a loop
**Should be fixed; does not block.** Demonstrated (`P21-8`). Listed as open in `docs/status.md:241`.
**File:** `web/index.html:2268-2280` (the round-trip check), `1373-1383` (`offerToAssign`).

`PROMPT.md` scope 0 says round seventeen's S-5 "is said to close here". It does not. A zero-address line is a
readable address to `addressOn`, so it survives `refuseForUnreadableLines` and the pairing block, is paired
with one of the sender's NFTs, and is then refused by `recipientProblem` inside the round-trip check. Assign
restores the list and says only:

> Assign stopped because its output did not round-trip through the recipient parser with the same wallets and
> quantities. Your original list was restored.

The zero address is never named. What is new since round seventeen is the second half: restoring the list
re-runs `parseList`, which sees a list of bare addresses and calls `offerToAssign`, overwriting the problems
panel with

> These are wallets with no token ids yet. **Press "Assign my token ids"** and the ones you hold are filled in
> for you.

— the button that has just refused. A user following the page's own instructions presses it again, gets the
same opaque refusal, and there is nothing anywhere on the page that names the line responsible.

**What it costs the user.** Assign is unusable on a list containing a zero address (a common artefact of an
exported holder list or a spreadsheet fill), with no path out that the page suggests. No funds move.

**Reproduce.** `node test/web/audit-probe-21.mjs` → `P21-8`.

**Fix.** Run `recipientProblem` over `wants` before the await, and refuse by line number and reason — the
page already has the sentence ("the zero address would burn the token; not allowed"); it just never reaches
this path. That is a smaller change than S-5's original write-up implies, and it also removes the loop.

**Does it matter more than you think?** Slightly. As a "stops without being named" item it is cosmetic. As a
dead end that the page's own next-step advice walks the user back into, it is the kind of thing a
non-technical user reads as "this tool is broken" and works around by deleting rows — which is the one
response that can lose a recipient.

---

### F-9 — the mainnet gate table and the plan disagree about whether two of the four gates are met
**Should be fixed; does not block (it is the checklist for the thing that would block).** Reasoned from
source, cross-checked against three documents in the same commit.
**File:** `docs/status.md:20` and `:21` against `docs/plan.md:50-59` and `:60-73`, and `docs/status.md:118`.

`docs/status.md` carries the table that decides whether mainnet may be switched on. Two of its four rows say
**not met**. `docs/plan.md`, in the same commit, records both as **Done, 11 September 2026**:

| gate | `status.md` (the gate table) | `plan.md` | `status.md` (the proof table, line 118) |
| --- | --- | --- | --- |
| production mainnet RPC (`status.md:20`) | **not met** — "the page names Robinhood's free public endpoint … Choose a production provider" | **Done** — "Each chain lists three endpoints in order … the integrity workflow probes every listed endpoint four times a day" (gate 9) | — |
| real-wallet rehearsal on testnet (`status.md:21`) | **not met** — "the manual MetaMask run predates v10" | **Done** — four runs, four transaction hashes, "every hash read back from the explorer" (gate 10) | **✅ "yes, four runs on 11 September 2026" against v13, ERC-721/1155/20 and WalletConnect** |

So `status.md` contradicts `plan.md` on both rows, and contradicts *itself* on the second: line 21 says the
manual MetaMask run predates v10; line 118 says four manual runs happened on 11 September 2026 against v13
and cites `real-wallet-run.md`, which `plan.md:68-71` fills in with four transaction hashes. The live RPC list in `web/index.html:173-180`
and the integrity workflow's "the RPC endpoints the page lists still answer, first and fallback" step confirm
gate 9's version.

**What it costs.** `PROMPT.md`'s own framing — "The plan lists two gates beyond the review round: a dedicated
production RPC and one real-wallet airdrop on the final page" — matches the **stale** table, not the plan.
The maintainer is working from a checklist that under-reports what has been done by two of four items, on the
document whose stated purpose is "so that the state of the project is readable from the repository rather
than from anyone's summary of it". A release checklist that is wrong in the *permissive* direction is the
dangerous kind; this one is wrong in the conservative direction, which is why it does not block. But a
checklist that is demonstrably unreliable in one direction is not evidence in the other either.

**Fix.** One of the two documents is the record. Make `status.md`'s gate table read from `plan.md`'s
resolutions (or vice versa) and add a `preflight.sh` check that the gate rows and the plan's gate items do
not disagree — the repository already has that habit for addresses and test counts.

**Is the gate list short?** Yes, by three items I would add before real money:

1. **The mainnet contract verified on the mainnet explorer, not merely byte-identical.** Gate 14 compares
   `eth_getCode` to the build. That proves the bytecode; it does not put readable source in front of the
   person the Check page is written for, and the Check page's own top-line pill is about published source.
2. **A first mainnet run bounded in value.** Nothing in the plan stages the rollout. For software whose
   failure modes are "paid twice" and "stranded", the first mainnet airdrop should be the maintainer's own
   assets, small, with the hashes read back — the same shape as gate 10, one network over.
3. **A written revoke drill.** `SECURITY.md` is right that "once you have approved it for a collection the
   page is the only lever anyone has", and that taking the page down revokes nothing. There is no gate that
   the Revoke button has been exercised against the mainnet contract by a real wallet. It is one transaction
   and it is the only user-side undo the design has.

---

### F-10 — three documents state browser-test counts the commands do not produce
**Should be fixed; does not block.** Demonstrated by running the commands.
**Files:** `docs/status.md:44-45`, `docs/for-reviewers.md:24`, `README.md:186`.

Round twenty closed a finding described as "two documents with wrong test counts". At `42eab38` three
documents still state counts that the commands beside them do not produce:

| claim | where | what I measured |
| --- | --- | --- |
| `node test/web/client.test.mjs   # 362 airdrop page tests` | `docs/status.md:44` | **380 passed, 0 failed** |
| `node test/web/check.test.mjs    # 129 Check page tests` | `docs/status.md:45` | **137 passed, 0 failed** |
| `npm install && npm test  # 477 browser tests` | `docs/for-reviewers.md:24`, `README.md:186` | **517** (380 + 137) |

`docs/harness.md:6` and `:74` also say 362/129, but in a "Why this exists" paragraph and a "Rules for the
implementer" list for work that is finished — those read as a record of what the suite was when that task was
written, not as a present claim, and I would leave them alone. The three above are present-tense statements
printed next to the command that disproves them.

Everything else in the same blocks is exactly right and I checked it: `forge test` really is 111 ordinary
tests plus 29 probes of which 9 must fail; the CSP gate, worker and readers counts hold; the fork suite is
4 of 4 with 20 and 20.

**What it costs.** Nothing directly. It matters because `docs/status.md` is the document `PROMPT.md` tells a
reviewer to disbelieve first and the one that carries the mainnet gate, and a number that takes thirty
seconds to check and is wrong is the cheapest possible signal that a document is not maintained. This is now
the second consecutive round to report a version of it, which suggests the problem is that it is fixed by
hand each time.

**Fix.** `verify.sh` already runs both suites and parses their summary lines. Have it (or `preflight.sh`)
compare those numbers against the three places that state them, the way `preflight.sh` check 3 already
compares the BulkSend address across the page, the manifest, the tests, the probes and four documents. A
count that is asserted cannot go stale.

---

## Areas examined and found sound

Silence elsewhere in this report means these were attacked and held.

### The contract (`src/BulkSend.sol` v13, `0xf2eD6359F5deE0334d68cd21d306D9D3E7a49232`)

- **Byte-identity, checked by me, not read from a document.** `eth_getCode` at that address on testnet is
  19,506 hex characters and **identical** to `out/BulkSend.sol/BulkSend.json → deployedBytecode.object`.
  The explorer additionally reports `is_verified: true`, `is_partially_verified: false`, compiler
  `v0.8.36+commit.8a079791`, cancun, optimizer on at 10,000 runs, and an ABI carrying all 15 custom errors —
  exactly what `docs/status.md` claims.
- **Promise 1 holds.** Every move is `transferFrom(msg.sender, …)`. No owner, no admin, no `delegatecall`, no
  upgrade hook, no constructor-set authority, no storage that a later transaction could repoint. There is
  nothing for anyone including the author to change later; the only authority is the allowance, and it is
  spent inside the caller's own transaction.
- **Promise 2 holds inside the contract.** `skipped` is only ever incremented on a `_tryCall` that returned
  `ok == false`, which reverted its own state changes, so a skip cannot have moved value. The other
  direction is guarded harder than it needs to be: an ERC-721 that *answers* a void function reverts the whole
  batch with `AmbiguousResult` rather than being counted delivered, in both modes (the strict branch reads
  `returndatasize()` directly, because a high-level call to a void function would have discarded it).
- **`_erc20Answer` and decision 3.** I agree with the decision and with its stated cost. `PaysThenLies20` in
  the repository's own fixtures is the argument: from inside the call there is no observable difference
  between "a conforming token declining" and "a token that moved the balance and then answered `false`", and
  the only reading that cannot produce a double payment is the one that takes the batch down. The cost —
  one blocklisted address failing a whole lenient batch — is real, is named in `docs/for-reviewers.md`, and
  is mitigated by the page's test run naming those addresses before anything is signed.
- **The four paste-guard questions.** I ran `forge test --match-path 'test/fork/MainnetGuards.t.sol'` against
  a read-only fork of Robinhood Chain mainnet: **4 passed** — 20 of 20 real ERC-721 collections accepted by
  the NFT guard and refused by the ERC-20 guard, 20 of 20 real ERC-20s accepted, and v12's single-probe guard
  shown to let all 20 through. No transaction, no key, no gas. I could not construct a legitimate ERC-20
  refused by any of the four. The residual category is a proxy or diamond whose fallback returns a 32-byte
  zero word for unknown selectors: `isApprovedForAll` would then read as a bool and the token would be
  refused with `IsAnNft`. That refusal is loud and both pages decode it into a sentence, so the cost is a
  false refusal a user can act on, not a silent wrong send. Worth one line in the docs rather than a code
  change.
- **The deferred returndata item (rounds fourteen/fifteen).** I agree it is not an asset path. The guard
  probes use high-level `staticcall` into `bytes memory`, so a hostile token can return a large buffer and
  burn the *caller's own* gas — on a token the caller pasted themselves, in a transaction that then reverts.
  Deferring it to a v14 is the right call.
- Baseline reproduced exactly: `forge test` → **135 passed, 9 failed**, the nine being the named probe files.
  `forge test --no-match-path 'test/{Audit*.t.sol,fork/*.t.sol}'` → 111 passed; the probes → 20 passed, 9
  failed of 29.

### Promise 7 — what is served is what is in the repository

Checked live, by me, at review time:

- `curl -sSL https://rhairdrop.gmgnrepeat.com/ | sha256sum` **==** `web/index.html`
- `curl -sSL https://rhcheck.gmgnrepeat.com/ | sha256sum` **==** `web/check.html`
- `curl -sSL https://rhairdrop.gmgnrepeat.com/wc.js | sha256sum` **==** `web/wc.js`
- plain HTTP answers **301** to `https://` on both hosts; **HSTS** `max-age=31536000; includeSubDomains` on
  the page and on every error response I sampled (`/x/46630/a..b`, `/nothing-here`, `/wc.js`), alongside
  `x-content-type-options`, `referrer-policy`, `cross-origin-opener-policy`.
- The **CSP header** on both hosts carries `frame-ancestors 'none'` and names exactly the SHA-256 of the
  inline script in *this* repository (`sha256-hBqUURE6…` for the airdrop page, `sha256-0DSMW8H8…` for Check),
  with no unsafe token in `script-src`. The external ethers build is pinned by path *and* SRI
  (`sha384-6Zl0Pc8z…`).

I agree with **not setting HSTS preload**. The `/cdn-cgi/*` gap `SECURITY.md` documents is real and preload
would not close it (Cloudflare answers that namespace before any Worker), and preload is a one-way door on a
domain that also serves other things. The document is unusually honest about this; I would leave it.

**The policy gate chain is closed.** `web/sync.sh` writes the hash into the meta tag; `deploy/publish.sh`
recomputes it and refuses to publish on drift (it checks, it never repairs — which is the right call, since a
publisher that edits what it ships produces bytes no commit contains); `deploy/csp-gate.py` holds the whole
policy to a table and refuses a directive it has never heard of, rather than ignoring it;
`deploy/render-worker.py` derives the response header from that same gated meta tag plus
`frame-ancestors 'none'`. I could not find a source in either policy that is unnecessary — and the Check
page's policy is materially tighter than the airdrop page's (no WalletConnect origins at all), which is the
right shape for a page that signs nothing.

**The WalletConnect chain is closed.** `publish.sh` refuses unless `sha256(web/wc.js) == EXPECTED-SHA256`,
passes that digest into the Worker, and the Worker refuses to serve a bundle whose digest differs;
`tests.yml` independently rebuilds from the pinned `web/wc-build` lockfile and requires
rebuilt == shipped == expected. I see no way for the signing-page connector to drift after review without a
deployment or a CI run failing.

### The workflows

Both are read-only and correctly scoped (`contents: read`; `integrity.yml` adds `issues: write` solely to
open its own failure issue). Actions are pinned to commit SHAs, the Foundry toolchain to `v1.4.1`, Node to
`22.20.0`, and `persist-credentials: false` is set on the checkout that then runs pull-request code. I looked
specifically for a way in and did not find one: nothing in either workflow interpolates untrusted input into
a shell, no `pull_request_target`, no secrets in `tests.yml` at all.

### Gate 14, the mainnet control

I read both copies of the step and exercised the pieces that are safe to exercise (`eth_getCode` reads only;
no mainnet transaction, nothing composed by me). The heredocs are inside YAML block scalars, so the `PY`
terminators land at column 0 and the substitution is sound. Failure modes on the enabling day: a missing
`deployments.mainnet.json`, a missing `BulkSend` key, an RPC that errors, or a page that names a different
address all fail the step (`set -euo pipefail` propagates the command-substitution failure in each case). The
one state that passes green and is not what it looks like is benign in the safe direction: the placeholder
gone and `LIVE_CHAINS` still testnet-only — mainnet stays off but nothing says so. I could not construct a
state where the page can spend mainnet gas against a contract the step did not check.

The narrower gap is in the *other* branch. While the placeholder is present, the step requires the literal
string `LIVE_CHAINS = new Set([46630])`. A change that leaves that literal intact and enables mainnet some
other way (`LIVE_CHAINS.add(4663)`) passes — but `cfg().bulk` is then the unsubstituted placeholder,
`bulkReady()` is false, and the only path that does not need it (`wallet`) still needs a live BulkSend for
ERC-20. It is a hole in the assertion, not a hole in the protection.

### The evidence gate, apart from F-7

`verify.sh` is the strongest part of this repository and I tried to get past it. I could not:

- The manifest check runs **before** dependencies are installed, so a deleted or unlisted probe fails in
  seconds. It refused my own `audit-probe-21.mjs` on the first run, by name, exactly as documented.
- Every probe is pinned three ways — file membership, complete source SHA-256, and a fingerprint of its
  assertion names *and* statuses — so wording a probe differently, deleting one assertion, or cancelling a
  newly reproducing finding against a newly fixed one all fail.
- Both browser suite files and eleven further suite/fixture files are pinned by whole-file SHA-256, so an
  assertion cannot be weakened without an explicit baseline change.
- The ordinary contract suites run **per file**, so an ordinary failure cannot hide by borrowing a
  probe-style test name.
- `unset ONLY` before each suite, plus the `(N of M cases run, filter …)` phrase that `lib.mjs` emits and
  `verify.sh` greps for, means a filtered run cannot be read as a whole one.

`test.sh` does not run the gate, and says so in its own comments; `tests.yml` runs `./verify.sh` as its
suite step rather than `npm test` or a filtered `forge test`, so there is no green path through CI that
skips it. `deploy/publish.sh` is independent of the gate — it checks a
clean tree and the CSP, not CI — but a page published from an unmerged commit would fail `integrity.yml`
within six hours, which is an acceptable answer.

### Round twenty's closures that I could not reopen

(Round twenty's own finding numbers, not mine.)

- **its F-4** (a headed `address,amount` list must pair): pairs, no dialog, 5 recipients from `3` + `2`. Fixed.
- **its F-5** (a partly paired list): the dialog now names the count ("already names its token ids on 1 of these
  2 lines"); dismissing it leaves the box byte-for-byte untouched; accepting re-pairs. Fixed.
- **its F-8/F-9** (the holder walk's "cut short" before "found none"): the ordering is right, including when the
  first page is the unreadable one.
- **its F-3** (`myTokenIds` marking a cut-short walk): handled for a wrong-shape page, a non-array `items`, and
  its own twenty-page ceiling, and the flag is carried into both consumers (Assign's shortfall message and
  the picker's "at least what is shown, not a full count").
- A headed `label,address` file — the address not in the first column — pairs correctly and is not
  mistaken for an already-paired list.
- `explorerJson`'s three states survive a 200 with the wrong shape, an empty object, and a JSON array where
  an object was expected, **for the contract itself**. (The proxy consumer is F-1/F-2.)

### Round nineteen's send-path changes, apart from F-5

I looked for the two paths `PROMPT.md` names.

- **`reconcilePending` while this tab has a hash-less record in flight.** I could not reach it within one
  tab: `lockForm` disables `#connect`, `disconnectWallet` refuses while `sending`, both wallet event handlers
  return early while `sending`, and `renderWalletChoice` builds a "Change wallet" button rather than a
  connect button whenever `me` is set. The cross-tab case exists — a second tab loading will walk this tab's
  hash-less record — but every branch it can take on such a record either holds the rows (`lookFor` is null →
  "sent to your wallet and never came back") or acts on a definite answer from the wallet's own
  `wallet_getCallsStatus`. I found no path that releases a row another tab is mid-sending.
- **A failure after `sendUncheckedTransaction` returns that is reported as "nothing sent".** I did not find
  one. Everything after that point either records the hash, holds the rows, or says it cannot account for the
  batch. The `TRANSACTION_REPLACED` branch below the `waitForTransaction` call is unreachable — the
  `.catch(() => null)` on the same line converts every rejection to `null` first — but the comment two lines
  above already states the resulting behaviour truthfully ("a replaced transaction is not reported as such
  here: it times out below and the rows are held"), and the next visit reconciles by calldata. Dead code
  that documents itself, not a defect.
- The **pending record before the wallet is asked** (round thirteen B-2) is written per-key, read back after
  writing, and a failed write stops the send rather than proceeding. `commitDelivered` writes the ledger and
  shrinks the pending record under the *run's* lock, in that order, and returns false rather than releasing
  anything if either half fails. `ledgerKey()` throws outside a locked send instead of falling back to
  `anon`. This is the part of the page I trust most.

### Rounds fourteen and fifteen's shared readers

- **`parsedListIsCurrent`, rechecked at every consumer.** Every path that can sign or simulate calls
  `requireCurrentParsedList()` — the preflight button, `preflight()` itself, `runSend` before the lock and
  again inside it — and `plan()` reads `parsedListIsCurrent() ? rows.length : 0`. `invalidateParsedList()`
  clears `rows` and `parsedListSource` together, so the only window where `rows` is populated and stale is a
  programmatic `.value` change with no `input` event. The one consumer that does not recheck in that window
  is `probeRow()` (`web/index.html:382`), and it feeds the gas measurement and therefore the batch-size cap —
  not what is sent. Both paths that *do* send re-invalidate before they use it. Not a finding.
- **`serializeRow` is a runtime invariant, not only a test.** It re-parses its own output with `splitRow` and
  throws if the cells differ, so a future separator or quoting change cannot silently corrupt a list because
  one writer was missed. Shuffle, Apply Weight, Assign and the picker all go through it. This is the right
  shape and I could not get a cell past it.
- **Shuffle.** Headed files shuffle only the standard's named payload cells and refuse outright if a column
  the standard needs is unnamed; the heading stays a heading; bare rows shuffle everything after the address
  as one unit, so a wallet's three ids travel together. Totals are preserved in every shape I tried, and the
  ERC-20 case asks first because that is the one where "who gets what" is the whole content.
- **The picker and the parser on an ERC-721 file that names both id and amount.** `deliveriesOn` reads the
  named id column first and only falls back to the quantity column when there is no id — so `0xA,1,1` under
  `address,tokenId,amount` is one delivery to both the parser and the picker, which is what round fourteen
  fixed. (The third reader, `requestedNftQuantity`, is F-6.)
- **The Check page's shared readers.** `resolveRequestSender` is used by both renderers (`check.js:1323` for
  a pasted batch, `:1583` for a single request), so "the request's sender is authoritative, the box fills in
  only where one is absent" is one rule. `simulateInOrder` refuses an answer with the wrong cardinality
  (`if (rs.length !== calls.length) throw`), and the all-calls verdict is gated on `simulatable`, which
  requires a readable sender, readable calldata and a readable destination for every entry.

### The Check page, apart from F-1, F-2 and F-3

It signs nothing and sends nothing: there is no signer, no `eth_sendTransaction`, no `wallet_*` method, and
no write to storage on any path I could find. `eth_simulateV1` is a read. The wording discipline is generally
very good — `codeUnreadable`, `implUnknown`, `beaconUnread`, `bodyMissing`, `explorerDown` and the three-way
`verified` are each distinct states with their own sentence, and the "What this section is, and is not" box
refuses to let an absence of matches read as an absence of powers. Round twenty's F-1 (`is_partially_verified:
null` → "not known") and F-7 (ERC-721 `approve` is not an allowance) are both correctly fixed **on the paths
that were changed**; F-2 and F-3 above are the consumers that were not.

---

## Where the tests are weaker than they look

`PROMPT.md` asks specifically whether the three known weaknesses hide a defect I can name. Two of them do.

### 1. `eth_estimateGas` is answered with a constant — and it hides F-5

This is not a theoretical gap. `web/index.html:3428-3438` is round nineteen's F-4 fix, and **nothing in any
suite or probe file exercises it.** `grep` for either of its two sentences across `test/web/*.mjs` returns
nothing. The only test that makes the estimate fail (`{ estimateGas: 'revert' }`, `client.test.mjs:3003`)
uses it for the gas-probe cap and never reaches a send. So a closed round-nineteen finding is pinned by no
evidence at all, and it is in fact half-broken — see F-5, which needed only an `eth_estimateGas` that fails
for the BulkSend call and succeeds for the token probe to reproduce.

**What to do:** the mock already accepts `O.estimateGas`; make it accept a predicate over `params[0].to` so a
test can fail the estimate for one destination, and add the F-4 assertion the fix never got.

### 2. Dialogs are auto-accepted by default — and it hides F-4 and F-6

Both suites install `page.on('dialog', …)` at `open()` and answer unconditionally. A confirmation is
therefore exercised as *a dialog that appeared*, never as *a dialog that said the right thing*. Two findings
in this report are exactly that failure:

- **F-4**: *"This rewrites the list so each wallet gets 4 each. 2 wallets, 8 in total. There is no undo."* —
  agreed to, and what it actually destroyed was the edition id and the per-wallet amounts, neither mentioned.
- **F-6**: *"Every line already names its token ids. Assign would throw those pairings away and pair the
  wallets with your holdings again."* — agreed to, and what it actually did was also cut five deliveries to
  two, which the sentence does not describe.

In both cases the confirmation *is* the safety mechanism — it is the last point at which the user can stop an
irreversible rewrite — and the suite's answer to it is "yes" before reading it.

**What to do:** the harness already records dialog text in the probe files (`page.__dialogs`). Promote that
into `lib.mjs`, and make the destructive-rewrite tests assert on the text, not only on the outcome.

### 3. The mock's `eth_call` falls through to a plausible word — half fixed

`client.test.mjs:234-238` now **throws** `unmocked eth_call <selector> to <address>` instead of inventing an
answer, with a comment explaining why. `check.test.mjs` was not given the same treatment: its `eth_call`
still ends `return word(1)`, so any selector the Check page starts reading tomorrow gets a truthy answer and
no test notices. I could not name a current defect this hides — every read `check.js` actually makes is
explicitly modelled — so this is a latent gap rather than a live one, and it is the kind that bites the
*next* change rather than this one. It is also the cheapest of the three to close: the exact pattern, with
its reasoning, already exists in the sibling suite file.

### A fourth, which nobody listed

The `web_probe_assertions` fingerprint in `test/findings-baseline.json` hashes each probe's **status plus
assertion name**, with the `<- detail` deliberately stripped. That is right for determinism. It does mean a
probe whose assertion silently stops testing anything — because the page's DOM ids moved and every
`page.$eval` now resolves to `''`, say — keeps its exact fingerprint while proving nothing. The source hash
catches a *changed* probe; nothing catches an *unchanged* probe that has quietly become vacuous against
changed page bytes. The suite's own `hangOnAddChain` story (`client.test.mjs:322-326`: a test that
"asserted the wrong sentence for years and passed") is this failure mode, one layer down. I have no cheap fix
to offer — a canary assertion per probe file that must always reproduce is the usual answer, and it is its own
maintenance burden — but it is worth knowing that the gate pins *that the evidence is unchanged*, not *that
the evidence still bites*.

---

## Inherent limits of doing this in a browser

These cannot be engineered away. For each, what the software should **say** rather than what it should do.
In every case the page already says something close; where I think the wording is short, I say so.

1. **A browser cannot make a multi-device world atomic.** `localStorage` is per-browser-profile;
   `navigator.locks` is per-profile. Two devices, or one device in a private window, share nothing. The page
   says this. I would add one sentence to the confirmation that goes out with every send on a run that has
   already delivered anything: *"This browser has a record of N of these as already paid. Another browser or
   another device has no such record."* The fact is documented; it is not present at the moment of decision.

2. **A token can lie.** `_erc20Answer`'s whole design, and `arrivalsFromReceipt`'s "the token reported N
   transfers in that transaction", both rest on the token's own events. The page already says "this is the
   token's own account of what it did" — that is the right sentence and it is in the right place.

3. **The explorer is a second opinion, not proof.** Holder snapshots, NFT inventories and source verification
   all come from an indexer that can lag, be rate-limited, or be wrong. The page's "cut short" and
   "could not check" vocabulary is the correct response and is now applied nearly everywhere — F-1 and F-2
   are the two consumers still missing it.

4. **A wallet's answer about its own batch is not evidence.** `readCallsStatus` handles this as well as it
   can: a `400` alongside a successful receipt becomes `partial`, not `failed`, because only `failed` and
   `reverted` release rows. That is the right asymmetry.

5. **A rejection the page does not recognise holds recipients back.** `isRejection` knows `4001`,
   `ACTION_REJECTED` and `5750`. A wallet that declines with anything else leaves the pending record in
   place, so those recipients are held rather than offered again. This is the safe direction and there is a
   remedy ("Review held rows" re-checks against the chain). I would not change the code. I would name the
   situation in the held-rows panel: *"A wallet that refuses in a way this page does not recognise looks the
   same as a wallet that never answered. If you are certain you cancelled it, re-check here."*

6. **An approval outlives the batch, and for ERC-721/ERC-1155 it is wider than the batch.** `SECURITY.md`
   states this exactly right, including that taking the page down revokes nothing and that only a
   transaction from the user's own wallet does. I would not soften a word of it.

7. **"Is this contract safe" is not a question any page can answer.** The Check page's function-name matching
   is a floor and never a ceiling, and the page says so in those words in the one place a reader will see it.
   This is the single best-written paragraph in the repository and it should not be shortened.

---

## Baseline reproduced, and what I ran

Everything below was run by me in this clone at `42eab38`.

| command | result |
| --- | --- |
| `forge test` | **135 passed, 9 failed** — exactly the nine probe reproductions named in `PROMPT.md` |
| `forge test --no-match-path 'test/{Audit*.t.sol,fork/*.t.sol}'` | 111 passed, 0 failed |
| `forge test --match-path 'test/Audit*.t.sol'` | 20 passed, 9 failed, 29 total |
| `forge test --match-path 'test/fork/MainnetGuards.t.sol'` | **4 passed** on a read-only fork of Robinhood Chain mainnet — no key, no gas, no transaction |
| `node test/web/client.test.mjs` | **380 passed, 0 failed** |
| `node test/web/check.test.mjs` | **137 passed, 0 failed** |
| `node test/readers.test.mjs` | 74 passed, 0 failed (matches `status.md`) |
| `node test/worker.test.mjs` | 31 passed, 0 failed (matches `status.md`) |
| `./test/csp-gate.test.sh` | 21 passed, 0 failed (matches `status.md`) |
| `./verify.sh` | refuses at the first check — `browser probe manifest differs from the baseline (unlisted: audit-probe-21)`. That is the guard working, and it is why the round-21 probe is not in the baseline. |
| `node test/web/audit-probe-21.mjs` (this round's probe) | **8 demonstrated, 0 not reproduced** |
| `eth_getCode` at `0xf2eD…9232` on testnet vs `out/BulkSend.sol/BulkSend.json` | identical, 9,752 bytes |
| explorer `/smart-contracts/0xf2eD…9232` | `is_verified: true`, `is_partially_verified: false`, 0.8.36, cancun, 10,000 runs, 15 errors in the ABI |
| `curl \| sha256sum` for both pages and `wc.js` against the repository | identical, all three |

Nothing I ran signed anything, sent any transaction I composed, or touched mainnet beyond `eth_getCode` and
the read-only fork. I did not look for or read any key.

## The probe file

`test/web/audit-probe-21.mjs`, in the repository's convention (a probe that **REPRODUCES** is a defect that is
still present). Eight cases, all reproducing at `42eab38`:

| case | finding |
| --- | --- |
| `P21-1` | F-1, the proxy's implementation record read as a definite "no source published" |
| `P21-2` | F-2, a partially verified implementation announced as fully published |
| `P21-3` | F-3a, an inner ERC-20 approval 1000× the supply with no unlimited-approval warning |
| `P21-4` | F-3b, an inner ERC-721 `approve` with a hash-derived id called an unlimited approval |
| `P21-5` | F-4, "Apply weight" eating an ERC-1155 edition id and amount |
| `P21-6` | F-5, both the correct and the contradicting send-failure sentence in one log |
| `P21-7` | F-6, `address,tokenIds` with several ids in one cell: five recipients become two |
| `P21-8` | F-8, the zero-address line, unnamed, with advice that loops |

`./verify.sh` will refuse the file until `test/findings-baseline.json` names it. To adopt it, add
`"audit-probe-21"` under `web_probes` with the count the run should hold at **after** the findings are
addressed — `0` if all eight are closed, `1` if F-8 (round seventeen's S-5) stays deliberately open, the way
`audit-probe-17` is held at `2` today — plus its source hash and assertion fingerprint. Adding it at its
current count of `8` would pin eight live defects as the expected state, which is the opposite of what the
baseline is for.
