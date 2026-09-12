# Round nineteen — external review of `robinhood-chain-tools` @ `39eaaf2`

Reviewed against commit `39eaaf2`. One probe file was added (`test/web/audit-probe-19.mjs`); nothing else in
the repository was changed, and `git status` is otherwise clean. No transaction was composed or sent, no key
was read or looked for, and no mainnet gas was spent. The only network use was read-only: `curl` against the
two live hosts and the two explorers, an `eth_getCode` against the testnet RPC, and the fork suite's
read-only mainnet fork.

---


> Published as written. The reviewer worked outside this repository against exact commit `39eaaf2`, on Opus.
> Its blocker F-1 and all eleven should-fix items are closed in the commit that publishes this file, against
> the reviewer's own probe (`test/web/audit-probe-19.mjs`, three of three now "fixed") and against the fixes
> it asked for in the form it asked for them; `status.md` lists each closure.

## The release bar I am judging against

"Ready" for software that moves other people's tokens on a public chain, driven by non-experts, means all
of the following are true at once. I am not grading on effort or on how careful the surrounding code looks.

1. **Authority is bounded by the signature.** The contract can move only what the caller has already
   approved, only inside the transaction the caller signed, and no key — including the author's — can
   change that afterwards. No owner, no upgrade, no pause, no delegatecall, no fee hook.
2. **Every statement the software makes about money is either true or explicitly marked unknown.** There
   are three states, never two: *it happened*, *it did not happen*, and *nobody could tell*. Collapsing the
   third into either of the first two is a defect of the same severity as losing the funds, because the
   user acts on the sentence, not on the chain.
3. **No double payment that the software could have prevented.** Crash, reload, closed tab, replaced
   transaction, two tabs, wallet that answers neither yes nor no — for each, either the recipient is not
   offered again, or the user is told in plain words that this is a case the page cannot cover.
4. **What is delivered is what was read.** The bytes in the textarea determine who gets what. No silent
   rounding, rescaling, reordering that changes allocation, dropped rows, or list that is quietly shorter
   than the source it was built from.
5. **Read-only means read-only.** The Check page can sign nothing and send nothing, and never renders a
   green or reassuring statement that rests on an answer it did not actually receive.
6. **What is served is what was reviewed.** Byte-identical pages, reproducible connector, a policy gate
   that cannot be satisfied by wording, and a deployed runtime equal to what this source builds.
7. **The evidence is load-bearing.** The tests that are cited as proof must actually assert the thing
   claimed, and must not be weakenable without the change being visible.

A finding **blocks release** if a user can lose funds, pay twice, or act on a false statement of fact.
It is **should-fix** if it degrades, misleads in a conservative direction, or makes a claim in the
documentation that is not true. It is an **inherent limit** if no amount of engineering in a browser,
against contracts nobody controls, can close it — in which case the only correct fix is what the page
*says*.

---

## Verdict

**One thing blocks release. Everything else is a should-fix or an inherent limit.**

### Blocks release

**F-1.** On the Check page, an explorer that reached the Worker and would not answer is reported to the user
as a contract that has published no source. It is live now, on a live public page, with no configuration
change required: the mainnet explorer sends no `Access-Control-Allow-Origin` (checked: `403`, `text/html`,
no ACAO), so **every** mainnet lookup on `rhcheck.gmgnrepeat.com` goes through `/x/4663`, and every failure
there — a Blockscout PRO rate limit on a 5-requests-a-second free tier, a 5xx, a timeout, a `status:"0"`
answer — produces the `{"error":"upstream"}` envelope, which `explorerJson` hands back as a definite answer.
Chain 4663 is an enabled, first-listed option on that page.

I want to be exact about the direction, because it matters and I am not going to overstate it: this makes
the page say something is **less** safe than the evidence supports, not more. It does not violate the
brief's promise 6 ("never presents a transaction or contract as safer than the evidence supports").
Nobody loses money directly. I am still calling it a blocker, for three reasons, and the maintainer can
weigh them:

1. It is the brief's own definition — "a user can lose funds **or act on a false statement**" — and the
   statement is presented as fact, in three places, including the caption printed directly beneath the
   plain-English sentence a non-technical reader takes their decision from.
2. It defeats the one design property the Check page is built around, in the exact line where that property
   is written down. `explorerJson`'s comment names the failure — "Reporting the third as the second would
   tell someone a contract has no published source when the truth is that nobody could check" — and the
   function's last line does precisely that, and only that.
3. The trigger is the *normal* failure mode of the only upstream the page has on mainnet, not an exotic one.
   A page that routinely says "no source published" about verified contracts teaches its users to disregard
   the sentence, and then it is silent when the sentence is true. That is the failure that costs money, one
   step removed.

**What would have to change for this to clear.** Checkable, in this order:

1. `web/check.js:248` reads `return { ok: false, data: null };` instead of `return { ok: reached, data: null };`.
2. A case in `test/web/check.test.mjs` whose mock answers `/x/4663/smart-contracts/…` with HTTP 200 and body
   `{"error":"upstream","status":502}`, asserting **positively** that the page renders "could not check for
   a published source" and the "the explorer would not answer" pill, and asserting that it does **not**
   render "no source published" or "No source has been published".
3. The same for `/transactions/…` (the "why it failed" path) and for the proxy-implementation lookup at
   `check.js:329`, which takes its value from the same function.
4. `node test/web/audit-probe-19.mjs` reports `R19-1` as **fixed** rather than `REPRODUCES`, and
   `test/findings-baseline.json` records `audit-probe-19` with the new count.

### Should be fixed, does not block

F-2 (the airdrop page's holder walk truncates silently on an unreadable answer — and this one *does* block
the mainnet switch-on, see below), F-3, F-4, F-5, F-6, F-7, F-8, F-9, F-10, F-11, F-12.

Of those, the two I would not let reach mainnet are **F-2** and **F-11**. F-2 is latent only because
`web/index.html:64` carries `disabled` on the mainnet option; the moment that attribute and `LIVE_CHAINS`
change, an operator can be handed the first hundred holders of a five-thousand-holder collection as "the
holder list", with nothing said. F-11 is that on the day the mainnet address is substituted, the
bytecode-equality check that runs four times a day silently stops covering anything that matters, and
nothing in the plan schedules its replacement.

### Inherent limits of doing this in a browser, against contracts nobody controls

These cannot be engineered away, and in every case the software already says so. I list them to be explicit
that I am not counting them against it, and to say where the wording could be one sentence better.

1. **Counting is not proof of payment.** A contract that accepts a transfer, returns success and moves
   nothing is indistinguishable from one that paid; a fee-on-transfer token delivers less while correctly
   returning `true`. Said in `BulkSend.sol`'s header, in the README, and in the page's own footer, which
   also says the page asks the chain who holds what afterwards rather than believing the counter. **Nothing
   to change.**
2. **A gas stipend cannot separate an expensive honest recipient from a hostile one.** `DEFAULT_GAS` is a
   policy, not a law. Said in the contract header and — better — in the page at `index.html:3149`:
   "A skipped wallet is one the token itself refuses. Send, then download the skipped list and retry those
   in strict mode, where each transfer gets the whole transaction's gas." **Nothing to change.**
3. **A hostile token can lie in its read functions**, so the after-the-fact ownership check can be fooled by
   the same contract that would fool the counter. Said in the page footer. **Nothing to change.**
4. **`localStorage` cannot reach another browser or another device**, so the double-payment protection is
   per-browser. Declared as design decision 5 and on the page. **Nothing to change.**
5. **The explorer lags the chain and is a comparison, not proof.** The snapshot's own message is unusually
   good here — it says the two block numbers "neither prove nor disprove that this list is consistent".
   **Nothing to change**, except that F-2 and F-3 are cases where the page fails to *reach* this honesty.
6. **A gas limit derived from an estimate can be too low if the chain moves between the estimate and the
   broadcast**, and the batch then reverts having spent the gas. The outcome is always safe — the whole
   batch unwinds, nothing is recorded as delivered — but I could not find anywhere the page says the
   transaction can fail and still cost money. **Suggested wording**, in the send confirmation next to
   "Estimated cost": "If the chain changes between now and when your wallet sends this, a transaction can
   fail and still cost its gas. Nothing is delivered when that happens, and nothing is recorded."
7. **`_mustBeNft` / `_mustNotBeNft` cannot be perfect**, because one selector serves two standards and a
   hybrid can answer both. Said in the contract's own comments, twice, in the right words ("It cannot be
   perfect: a hybrid can answer both"). **Nothing to change.**

### The ledger I was asked to disbelieve

I tested the round-eighteen closures rather than assuming them. B-1, B-2 and B-3 are genuinely closed: the
`status: "1"` + typed-result precondition is applied on all four paths and I could not get an answer past it;
the twenty-page ceiling does report `truncated`; the empty-but-real holders list is still an empty page and
not the envelope. S-7/S-8 (`cacheTtl: 0`, no key in any body or header) hold. S-10 holds, and does more than
it claims — with `gasLimit` set, `sendUncheckedTransaction` asks the wallet for nothing but
`eth_sendTransaction`, so "the wallet asked anything it need not be" is answered.

Two entries in `docs/status.md` are not true as written: **S-4** (F-5 — one and a half of three closed, and
deleting the line the fix added leaves every test green) and the gate table's first row (F-12(c) — three
rounds stale). Round eighteen's own **B-3** is closed in the Worker and reopened one layer up, in the page
(F-2) — which is the seventh instance of the pattern the brief names: a fix from one day is the next round's
finding, and this time it is the same finding at a different altitude.

---

## Findings

### F-1 — `check.js` reports "no source published" when the explorer refused to answer (BLOCKS RELEASE)

**Category:** blocks release — a user acts on a false statement of fact. See the Verdict for why I graded it
here rather than as a should-fix, including the argument against.
**Demonstrated.** `test/web/audit-probe-19.mjs`, assertion `R19-1`, reproduces it in a browser:
`{"saysNoSource":true,"saysCouldNotCheck":false,"explorerPill":false}`.
**File:** `web/check.js:224-249` (`explorerJson`), consumed at `web/check.js:289-290`, `329`, `40`.

`explorerJson` is built around a three-state contract, and its own comment states it:

> Three outcomes, and the difference matters: it answered, it answered "no such thing", or it would not
> answer at all. Reporting the third as the second would tell someone a contract has no published source
> when the truth is that nobody could check.

The last line of the function is

```js
return { ok: reached, data: null };
```

`reached` is set to `true` in exactly three places. Two of them (`r.status === 404`, and a success) either
return early or set `missing` and return `{ ok: true }` from inside the attempt loop. The **only** way
execution arrives at that final `return` with `reached === true` is the branch commented
`// reached, but it would not answer` — the `{"error":"upstream", status: N}` envelope with `N !== 404`.
So `ok: reached` evaluates to `ok: true` in precisely the case the function exists to distinguish, and
never in any other case.

The consumer then does:

```js
if (!scRes.ok) { out.verified = null; out.explorerDown = true; }
else if (!sc)  { out.verified = false; }
```

so `verified` becomes `false`, not `null`. Everything downstream is correct *given* `false`, which is what
makes this hard to see: the renderer at `check.js:819-826` and the notes at `879-881` carefully
distinguish `false` ("no source published") from `null` ("could not check for a published source"), and
`readingCaption` (`check.js:40`) appends **", and this one has published none."** to the plain-English
sentence describing the call. The "the explorer would not answer" pill at `check.js:831` is also
suppressed, because it keys on `explorerDown`, which is only set on the `!ok` branch.

**Exact input and state.** Load `rhcheck.gmgnrepeat.com`, leave the network on "Robinhood Chain" (chain
4663 — this option is *enabled and listed first* on the Check page, unlike the airdrop page where mainnet
is `disabled`), and paste any verified mainnet contract while the Worker's upstream is failing for any
reason other than 404: a Blockscout PRO rate limit (free tier is 5 req/s / 100K credits a day), a 5xx, a
timeout, an unbound `BLOCKSCOUT_KEY`, or a `status:"0"` NOTOK answer. Every one of those produces
`{"error":"upstream", status: N}` with `N !== 404` from `deploy/render-worker.py` (`upstreamFail`), HTTP
200.

**What it costs the user.** A statement of fact that is false: a verified, source-published contract is
reported as having published no source, in three places including directly under the sentence that explains
what the transaction does. It errs toward distrust rather than toward a false all-clear, so it does not
violate the brief's promise 6 and no one loses money to it directly. What it costs is the page's credibility on the
chain that has money on it: the mainnet explorer sends no `Access-Control-Allow-Origin` (verified during
this review: `403`, `text/html`, no ACAO header), so *every* mainnet lookup on the Check page goes through
`/x/4663`, and a rate limit on a 5-requests-a-second free tier is enough to make the page say this about
every contract it is shown. A warning that fires wrongly and often is a warning that stops being read.

**Why the suite does not catch it.** `test/web/check.test.mjs:101` is the only "explorer refuses"
simulation: `opts.explorerSick` returns HTTP **500** with `content-type: text/html`. That hits
`if (!r.ok) continue;`, leaves `reached === false`, and produces the correct `{ ok: false }` →
`verified: null`. The suite therefore proves the three-state design works for the one failure shape the
production Worker never emits, and never exercises the shape it always emits. `test/worker.test.mjs`
proves the Worker *produces* the envelope; nothing joins the two halves.

**Fix.** The final return must not treat "reached but would not answer" as an answer:

```js
return { ok: missing, data: null };
```

`missing` is already the flag meaning "definitively not there", and the `if (missing) return ...` inside
the loop already handles the early case. Then add a case to `check.test.mjs` whose mock returns HTTP 200
`{"error":"upstream","status":502}` for `/x/4663/smart-contracts/...` and asserts the page shows
"could not check for a published source" and the "the explorer would not answer" pill — not
"no source published".

---

### F-2 — the airdrop page's holder walk silently truncates on the upstream envelope (should be fixed now; blocks the mainnet switch-on)

**Category:** should be fixed but does not block release *today*; **blocks release** the moment `4663`
is added to `LIVE_CHAINS` / the mainnet `<option>` is un-disabled.
**Demonstrated.** `test/web/audit-probe-19.mjs`, assertion `R19-2`:
`{"holdersRequests":2,"linesLoaded":100,"saysIncomplete":false}` — the walk asked for page two, got an
answer it could not read, and wrote a hundred holders into the box saying nothing.
**File:** `web/index.html:451` (`explorer`), `web/index.html:1894-1913` (the `snap` walk).

`explorer()` is:

```js
async function explorer(path, chain = chainId()) {
  const r = await fetch(EXPLORER_API(chain) + path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('explorer ' + r.status);
  return r.json();
}
```

It has no idea the `{"error":"upstream"}` envelope exists. The Worker returns that envelope with HTTP
**200**, so `r.ok` is true and the envelope is handed back as if it were data. In the holders walk:

```js
for (let page = 0; page < 200; page++) {
  ...
  const d = await explorer('/tokens/' + addr + '/holders' + (next ? '?' + next : ''), chainAtStart);
  for (const it of (d.items || [])) { ... }          // envelope: adds nothing
  const p = d.next_page_params; if (!p) break;       // envelope: undefined -> break
  ...
  if (page === 199) truncated = true;
}
```

An envelope on page *k* is indistinguishable from "the last page, and it was short". `truncated` stays
`false`, the guard at `index.html:1913` does not fire, and the first *k*×100 holders are written into the
recipient textarea and presented as the collection's holder list.

This is the identical defect round eighteen's B-3 closed **inside the Worker** for the NFT inventory
("an upstream error mid-walk is the envelope, never a shorter inventory"). The Worker now refuses to
return a short list; the page's own multi-page walk still builds one.

**Exact input and state.** Chain 4663 selected, page served from `*.gmgnrepeat.com` (so `EXPLORER_API`
returns `/x/4663`), "Fetch holders" on a collection with more than 100 holders, and any upstream failure
from page 2 onward — a rate limit is the obvious one, since the free PRO tier is 5 requests a second and
100K credits a day and this walk issues up to 200 sequential requests for one button press.

**What it costs the user.** The operator airdrops to what they believe is every holder of a collection and
in fact pays the first *k*×100 the explorer happened to return before it stalled. The remainder are never
offered and nothing anywhere says the list was cut short — the page has a `truncated` mechanism for
exactly this and it does not fire. Recipients are stranded; the operator's statement to their community
("everyone who held on block N") is false.

**Today's reachability, stated precisely.** The defect is in the walk, not in the envelope: *any* HTTP-200
JSON body that is neither a page of holders nor an explicit end-of-list ends the walk as though it were the
last page. The probe demonstrates it on chain 46630 with the envelope as the body, because the code path is
the same whatever produced the body.

What differs is which upstream can actually produce such a body today:

* **Mainnet, through the Worker (`/x/4663`):** guaranteed. `upstreamFail` returns exactly this shape with
  HTTP 200 on every failure. But `web/index.html:64` marks the mainnet `<option>` `disabled` and
  `web/index.html:313` sets `LIVE_CHAINS = new Set([46630])`, so a user cannot select it. Latent, and
  becomes live with the one-line change `docs/plan.md` already schedules — the same framing round eighteen's
  own R18-7 probe used.
* **Testnet, direct:** I checked the real testnet explorer's failure shapes. A non-token address answers
  `404 {"message":"Not found"}` and a malformed page parameter answers `422`, both of which `explorer()`
  correctly turns into a throw. So Blockscout's own errors do not trigger it. What would is any
  200-with-JSON that is not a holders page: an intermediary's cached or synthesised JSON error, or a change
  to the REST shape. That is speculative, and I am not claiming it happens today.

So: not reachable through the UI today, certain on the day mainnet is enabled.

**Fix.** Teach `explorer()` the envelope, the way `check.js` already knows it:

```js
const j = await r.json();
if (j && j.error === 'upstream') throw new Error('explorer unavailable (' + j.status + ')');
return j;
```

and, separately, make the walk's success condition positive rather than inferred: a page that is neither a
full page nor an explicit "no more pages" must set `truncated = true` rather than `break` quietly. The
same applies to `myTokenIds` at `index.html:2247-2260` — see F-3.

---

### F-3 — the Worker says the inventory was truncated and the page throws that away, then blames the wallet (should be fixed)

**Category:** should be fixed but does not block release.
**Demonstrated or reasoned:** reasoned from source; the Worker side is proved by
`test/worker.test.mjs` ("twenty full pages stops at the ceiling and says truncated").
**File:** `deploy/render-worker.py` (inventory branch, `truncated` in the `upstreamOk` body) vs
`web/index.html:2247-2260` (`myTokenIds`), consumed at `web/index.html:2195-2205`.

Round eighteen's B-3 made the Worker say `truncated: true` when the inventory walk stopped at the
twenty-page ceiling (2,000 transfer records, not 2,000 held ids — an actively traded wallet reaches that
well below 2,000 held) or at the 2,000-id cap. `myTokenIds` reads `d.items` and `d.next_page_params` and
never looks at `d.truncated`.

The action taken on a short answer is safe: Assign refuses and leaves the box untouched. The *sentence* is
not. It says

> This list asks for N NFTs and this wallet holds `ids.length` of them.

which is a statement of fact about the wallet's holdings, asserted from an answer the Worker explicitly
flagged as incomplete. The problems box does add "a collection the explorer indexes slowly can also read as
fewer than you own", which softens it, but the headline is still a count the page has been told is wrong.
The same function is the one round eighteen taught the Worker not to lie about; the flag it added has no
reader.

**Fix.** In `myTokenIds`, carry `d.truncated` out (e.g. return `{ ids, truncated }`) and, when it is set,
replace the holdings claim with "this page could not read all of what this wallet holds (the explorer's
answer was cut short), so it cannot say whether you have enough". One sentence, and the flag stops being
decoration.

---

### F-4 — a failed gas estimate is reported to the user as "handed to your wallet" (should be fixed)

**Category:** should be fixed but does not block release.
**Demonstrated or reasoned:** reasoned from source.
**File:** `web/index.html:3366-3390`.

Round eighteen's S-10 moved the gas estimate onto the page's own RPC and made it a precondition of
broadcast:

```js
const pid = newPid();
... addPending(...)                       // the record is written first, deliberately
try {
  const req = await bulk[fn].populateTransaction(...args, onThisChain());
  req.from = me;
  req.gasLimit = (await pageRpc.estimateGas(req)) * 110n / 100n;   // <-- can throw
  const hash = await signer.sendUncheckedTransaction(req);
  ...
} catch (err) {
  if (isRejection(err)) { dropPending(pid); }
  else {
    log('  that batch was handed to your wallet and this page did not get an answer. Those recipients '
      + 'are held back until it can read the chain: ...', 'bad');
  }
  throw err;
}
```

`pageRpc.estimateGas` sits **inside** the same `try` as `sendUncheckedTransaction`, and
`populateTransaction` does too. If the estimate throws — page RPC unreachable, rate limited, or the batch
genuinely reverts against current state — the wallet was never asked, nothing was signed, nothing was
broadcast, and the page tells the operator the batch *was handed to their wallet* and holds those
recipients back pending a chain read that can never find anything.

**Exact input and state.** Any send where the page's configured RPC fails or the batch would revert, at
the moment of the estimate. Easiest trigger: the approval is revoked (or an id is sold) between "Check
list" and "Send", which makes `estimateGas` revert.

**What it costs the user.** A false statement of fact in the one direction the project treats as most
important (it claims a transaction may exist when none does), plus rows held back that require the
"Review held" flow to release. Conservative for funds, dishonest in wording — and it defeats the purpose
of the S-10 change, which was to *refuse before broadcast*, not to make a refusal look like an unknown.

**Fix.** Estimate outside the `try` that owns the wallet interaction, or tag the error. For example:

```js
let req;
try {
  req = await bulk[fn].populateTransaction(...args, onThisChain());
  req.from = me;
  req.gasLimit = (await pageRpc.estimateGas(req)) * 110n / 100n;
} catch (err) {
  dropPending(pid);   // nothing was signed and nothing was sent
  log('  this page could not work out a gas limit for that batch against its own RPC, so it was not sent '
    + 'to your wallet at all. Those recipients are not held back. ' + explainCallError(err), 'bad');
  throw err;
}
```

The distinction matters precisely because the record-first design makes "held back" the default: a
recipient must only be held back when there is a real possibility a transaction exists.

---

### F-5 — round eighteen's S-4(b) is recorded as closed and is not: delete the line the fix added and every test still passes (should be fixed)

**Category:** should be fixed but does not block release. This is an evidence finding, not a fund path.
**Demonstrated.** By deleting `web/index.html:2744` and re-running the case.
**File:** `test/web/client.test.mjs:1171` and `:1179`; the guard is `web/index.html:2744`;
the claim is `docs/status.md:164`.

Round eighteen's S-4 named three regressions that did not prove what their names claim. `docs/status.md`
records it as

> | S-4 | three regression tests proved less than their names | closed: the round-17 S-3 and gate-10 run-4
> tests assert the positive, read mid-send |

**(a) is genuinely fixed.** `client.test.mjs:1215` now holds `eth_getTransactionReceipt` for 3s, reads
`localStorage` at 1.5s, and requires exactly one pending record carrying a 64-hex hash. That is a positive
mid-send read and it would fail if the hash were recorded after the wait. Confirmed by inspection and by
running the case.

**(b) is not.** `client.test.mjs:1171` is unchanged and still asserts an absence
(`!/never came back with a transaction/`). The line added alongside it,

```js
check('gate-10 run-4 nothing was held by the reconnect: …',
      after.pending === 0 && after.delivered.some((n) => n === 1), …);
```

asserts an **end state**, and that end state does not depend on the thing the fix added. The fix is
`if (inFlightPids.has(e.pid)) continue;` at `web/index.html:2744`. `inFlightPids` appears in no test file
and no probe file in the repository (`grep -rn inFlightPids test/` returns only the *comment* at
`client.test.mjs:1176`).

**Reproduction (run, not reasoned):**

```
$ ONLY="gate 10, run 4" node test/web/client.test.mjs        # unmodified
  4 passed, 0 failed (1 of 110 cases run, filter "gate 10, run 4")

# delete web/index.html:2744 — the single line the round-18 fix added — then ./web/sync.sh
$ ONLY="gate 10, run 4" node test/web/client.test.mjs
  ok   gate-10 run-4 the phone-wallet connect path ran again mid-send
  ok   gate-10 run-4 reconciliation during an in-flight send does not call the batch lost
  ok   gate-10 run-4 and the send still completes
  ok   gate-10 run-4 nothing was held by the reconnect: no pending record remains and the delivery is recorded once
  4 passed, 0 failed
```

(The tree was restored; `git status` is clean apart from the probe file this review added.)

**(c) was dropped without being said.** Round eighteen's S-4(c) was that `audit-probe-17.mjs:257` (R17-4) is
a four-way conjunction that decays into a single-condition probe as fixes land. It is byte-for-byte the same
four-way conjunction today. `status.md`'s closure names only (a) and (b), so the row reads "closed" for a
finding that had three parts and closed one and a half.

**What it costs.** Nothing to a user today. It costs the ledger its meaning, which is the thing the brief
asks to be disbelieved first: a reviewer reading `status.md` would conclude the `inFlightPids` guard is
pinned by a regression, and it is pinned by nothing. The next refactor that drops it gets a green run.

**Fix.** Make the assertion depend on the guard. The cheapest honest version: have `reconcilePending`
increment a counter on the `inFlightPids` branch (`window.__skippedInFlight`), and assert it is exactly 1 in
that case. Then correct the `status.md` row to say which of the three parts closed.

---

### F-6 — the live monitor never asks the airdrop worker anything about `/x/`, and gate 11's own closure condition is only checked on Check (should be fixed)

**Category:** should be fixed but does not block release.
**Demonstrated.** Read the workflow; then read both live workers.
**File:** `.github/workflows/integrity.yml`, steps "the explorer passthrough never serves someone else's
document from this origin" and "the mainnet explorer answers through the Worker, not the upstream-error
envelope".

Both steps are written `for host in rhcheck.gmgnrepeat.com`, and the gate-11 step hardcodes
`https://rhcheck.gmgnrepeat.com/x/4663`. `deploy/render-worker.py` now generates the `/x/` route for **both**
targets, deliberately — its own comment says "Gate 11 needs this on both pages, not just Check: Assign's
holder-snapshot fallback and NFT inventory read through it on the airdrop page". Nothing watches that half.

Consequences, in order of how likely they are:

* `BLOCKSCOUT_KEY` is bound per-worker, by whichever `deploy/publish.sh` run published that worker
  (`BLOCKSCOUT_KEY_FILE` in `deploy/local.env`). Republishing `rh-airdrop` from a machine or a shell where
  that variable is unset silently drops the binding, and every mainnet explorer read from the airdrop page
  becomes the `{"error":"upstream"}` envelope — which, per F-2, the airdrop page does not recognise.
* The airdrop worker's `/x/` responses are not checked for being JSON, for status 200, for CSP or for HSTS.
  The rhcheck loop exists precisely because a non-2xx from a Worker is replaced by Cloudflare with this
  origin's own page.

**Current live state (checked during this review, read-only `curl`):** both workers answer
`/x/4663/smart-contracts/0x8876…` with `is_verified:true, name:"UniversalRouter"` and both answer the
holders page with a non-empty `items` array. So the binding is in place today on both. The finding is that
nothing would tell anyone if it stopped being.

**Fix.** Change both `for host in rhcheck.gmgnrepeat.com` loops to
`for host in rhcheck.gmgnrepeat.com rhairdrop.gmgnrepeat.com`, and parameterise the gate-11 step's host the
same way. Three characters of YAML for the only half of gate 11 nothing is watching.

---

### F-7 — the evidence gate pins the probes and the browser suites, and not one of the contract suites (should be fixed)

**Category:** should be fixed but does not block release.
**Demonstrated or reasoned:** reasoned from `verify.sh` and `test/findings-baseline.json`.
**File:** `verify.sh:89-110` (the ordinary-contract loop), `test/findings-baseline.json`.

Scope item 4 asks whether a test can be weakened without the fingerprint moving. It can, and the gap is
large and specific.

`findings-baseline.json` pins, by sha256: every probe source, every probe's assertion set, and the complete
files `client.test.mjs`, `check.test.mjs`, `worker.test.mjs`, `csp-gate.test.sh`, `readers.test.mjs`,
`lib.mjs`. That is genuinely strong — I could not find a way to weaken any of those without the fingerprint
moving.

What is pinned by nothing at all:

| file | tests | what pins it |
| --- | --- | --- |
| `test/BulkSendReal.t.sol` | 90 | nothing |
| `test/BulkSend.t.sol` | 13 | nothing |
| `test/Reentrancy.t.sol` | 4 | nothing |
| `test/Invariants.t.sol` | 2 (96 runs × 24 depth) | nothing |
| `test/IdAmountProbe.t.sol` | 2 | nothing |
| `test/Mocks.sol`, `test/RealTokens.sol`, `test/OnChainArt.sol` | the fixtures all of the above use | nothing |
| `test/fork/MainnetGuards.t.sol` | 4, incl. the 20-of-20 claim | nothing, and it is not run by `verify.sh` at all |

`verify.sh`'s contract loop asks one question per file — "did `forge test --match-path` exit 0" — and prints
"contracts: 5 of 5 ordinary test files passed". It does not pin the count, the test names, or the source. So
`test/BulkSendReal.t.sol` can go from 90 assertions to one `assertTrue(true)` and `./verify.sh` prints
`contracts: 5 of 5 ordinary test files passed` and `Everything passes, and nothing that was closed has
reopened`. The invariant suite — which is the strongest single piece of evidence in the repository, 2,304
random calls per run against *sent + skipped == rows* — has nothing holding it to that shape.

The baseline's own `_why` is candid that `suite_files` covers "the complete deterministic browser-suite
sources". The asymmetry is not stated anywhere, and `docs/status.md` describes the gate in terms that read
as covering everything: "Every historical probe is now bound both to its complete source hash and to its
exact assertion names and statuses."

**A second, smaller thing in the same file.** The four `suite_files` fingerprint checks for
`worker`/`csp_gate`/`readers`/`lib` are inside the `if [ "$fail" -eq 0 ]; then` branch, *before* the summary
line. A mismatch there sets `fail=1` and then the script prints

```
  FAIL  worker suite file fingerprint changed (test/worker.test.mjs). …
Everything passes, and nothing that was closed has reopened.
```

The exit code is correct (1). The last thing a human reads is "Everything passes."

**Fix.** Add `contract_suite_sources` to the baseline covering `test/*.t.sol` (non-`Audit*`), `test/Mocks.sol`,
`test/RealTokens.sol`, `test/OnChainArt.sol` and `test/fork/MainnetGuards.t.sol`, hashed the same way the
probe sources are; and add a per-file passed-count to `contract_suites` the way `contract_probes` already
does. Separately, move the four `suite_files` checks above the `if [ "$fail" -eq 0 ]` so the summary cannot
contradict the findings above it.

---

### F-8 — `is_partially_verified` is published as `false` rather than as "not known" (should be fixed)

**Category:** should be fixed but does not block release.
**Demonstrated or reasoned:** reasoned from source.
**File:** `deploy/render-worker.py`, `smart-contracts` branch; `docs/gate-11-explorer.md`, the field table;
consumed at `web/check.js:299` and rendered at `:825` and `:877`.

`docs/gate-11-explorer.md` states the rule the translation is meant to follow:

> Anything the module API cannot supply is `null`, never a guess: the readers already treat null as "could
> not check".

The module API's `getsourcecode` has no partial-verification field, and the translation supplies
`is_partially_verified: false`. `false` is not null, and it is the *reassuring* value: `check.js:825` prints
"source published and matched" rather than "source published, partly matched", and the sentence at
`check.js:877` — "This contract is only partially verified, so even the published source may not be all of
the code that runs" — cannot be reached for any mainnet contract. A partially verified contract on chain
4663 is presented as fully matched.

This is the only field in the table where the fallback is a claim rather than an absence, and the direction
is toward safety-not-supported-by-evidence, which is the promise (6) this page exists to keep.

**Fix.** Two halves, and both are needed because `!!null === false`: emit `is_partially_verified: null` from
the Worker, and change `web/check.js:299` to `out.partial = sc.is_partially_verified === null ? null : !!sc.is_partially_verified`,
with a third rendering ("whether the published source is the whole of the code was not checked"). If that is
judged not worth the code, the honest alternative is one line in `docs/gate-11-explorer.md` saying that on
mainnet this field is a stand-in and partial verification is not detected.

---

### F-9 — a failed dependency install is diagnosed as "the readers suite has failures", with nothing printed (should be fixed)

**Category:** should be fixed but does not block release.
**Demonstrated.** It happened to this review, on a clone the brief describes as having dependencies
installed.
**File:** `verify.sh:77`, `test.sh:14`.

Both scripts guard the install with `[ -d node_modules ] || npm install`. The guard is existence, not
currency. Commit `6f5233b` — the second commit before `HEAD` — added `ethers` as a devDependency for the new
`test/readers.test.mjs`. Any clone whose `node_modules` predates that commit has the directory and not the
package, so the guard does not fire and:

```
$ node test/readers.test.mjs
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ethers' imported from …/test/readers.test.mjs
```

`verify.sh` catches the non-zero exit and reports

```
  FAIL  the readers suite has failures:
```

followed by nothing, because its `grep -E '^  FAIL'` finds no line in a crash dump. A gate that says "the
suite has failures" and lists none, about a missing dependency, is exactly the class of thing `preflight.sh`
exists to convert into one line — its own header says so ("A stale CSP hash does not say 'stale CSP hash',
it says 'a checkbox in an unrelated test timed out'"). CI is unaffected: `tests.yml` uses `npm ci`.

**Fix.** Replace the guard with something that checks currency, e.g.
`npm ls --depth=0 >/dev/null 2>&1 || npm install --no-audit --no-fund`, or add a preflight check that every
`devDependencies` key resolves. Confirmed: after `npm install`, `node test/readers.test.mjs` reports
`74 passed, 0 failed`, matching `docs/status.md`.

---

### F-10 — round eighteen's S-6 guard reads the line positionally while every other reader reads it by column, so a headed list with a label column is re-paired at random without being asked (should be fixed)

**Category:** should be fixed but does not block release.
**Demonstrated.** `test/web/audit-probe-19.mjs`, assertion `R19-3`:
`{"dialogs":[],"after":"0x…222,72 | 0x…111,71","log":"Assigned 2 lines, paired at random."}` — the file
said `0x…111` gets id 11 and `0x…222` gets id 12; the box afterwards says 71 and 72, and no dialog was
raised at all.
**File:** `web/index.html:2151-2159` (the `alreadyPaired` block inside the Assign handler).

Round eighteen's S-6 (round seventeen's S-2) added exactly this:

```js
const alreadyPaired = $('list').value.split(/\r?\n/).filter((l) => addressOn(l, col)).every((l) => {
  const rest = splitRow(l.trim()).filter(Boolean).slice(1).filter((x) => !/^x\d+$/i.test(x));
  return rest.length > 0 && rest.every((x) => wholeText(x) !== null);
});
if (alreadyPaired && !confirm('Every line already names its token ids. …')) { … }
```

`col` is computed on the line above and passed to `addressOn`, correctly. It is then *not* used inside the
predicate: `splitRow(l).slice(1)` is "everything after the first cell", positionally. Every other reader in
this box — `boxColumns`, `addressOn`, `deliveriesOn`, `requestedNftQuantity`, `parseList`,
`unreadableLinesInBox` — reads by column name, and `web/index.html:946-949` (the `boxColumns` comment) says in so many words why:

> `readHeader` has always allowed the address column to be anywhere; assign, weighting and the picker each
> looked only at the first cell, so a file headed `label,address` was read as two wallets by one and as none
> at all by the others — the same valid file getting contradictory answers from the same page.

That is the same defect, in the one reader the fix for it did not reach.

**Exact input and state.** ERC-721 selected, a wallet holding ids, and this in the box (`label` is not in
`COLS`, so `readHeader` maps `to → 1`, `id → 2`, which is the supported case):

```
label,address,tokenId
founder,0x…111,11
artist,0x…222,12
```

Press "Assign my token ids". `rest` for line 2 is `['0x…111','11']`; `wholeText('0x…111')` is `null`, so
`alreadyPaired` is `false`, the confirmation never appears, and the hand-made pairing is replaced with a
random one from the wallet's holdings. The heading and the label column are discarded with it.

**What it costs the user.** An operator who has deliberately paired named wallets to specific token ids —
which is the whole point of a 1-of-1 or tiered allocation — loses that allocation with no prompt and no
undo (`confirmOverwrite` is not used by Assign). The count is unchanged, so the parse summary still reads
"2 recipients, 2 distinct wallets"; only *who gets what* changed, which is promise 5. The log says
"Assigned 2 lines, paired at random" **afterwards**, which is precisely the state round eighteen judged
insufficient and wrote this guard to replace.

**Fix.** Use the columns the function already has:

```js
const alreadyPaired = $('list').value.split(/\r?\n/).filter((l) => addressOn(l, col)).every((l) => {
  const cells = splitRow(l.trim());
  if (col && col.id !== undefined) return String(cells[col.id] ?? '').trim().split(/[\s|]+/).filter(Boolean)
    .every((x) => wholeText(x) !== null) && String(cells[col.id] ?? '').trim() !== '';
  const rest = cells.filter(Boolean).slice(1).filter((x) => !/^x\d+$/i.test(x));
  return rest.length > 0 && rest.every((x) => wholeText(x) !== null);
});
```

and add a case to `client.test.mjs` with a leading non-address column that asserts the dialog *is* raised.

---

### F-11 — nothing in the repository will ever check the mainnet contract's bytecode, and the gate list does not ask anyone to build it (should be fixed; it is a precondition of promise 7 on mainnet)

**Category:** should be fixed but does not block release. It is the answer to "say if the list is short."
**Demonstrated or reasoned:** reasoned from source, confirmed by running the testnet equivalents.
**File:** `preflight.sh` (check 3), `.github/workflows/tests.yml` (last step),
`.github/workflows/integrity.yml` (the bytecode step), `deployments.testnet.json`, `docs/status.md` ("The
gate"), `docs/plan.md`.

Promise 7 says "the deployed contract's runtime bytecode matches what the repository builds". On testnet
that is true and machine-checked in two places, four times a day, and I confirmed it by hand:

```
ok  deployed runtime == source build at 0xf2ed…9232 (9752 bytes)
ok  https://rhairdrop.gmgnrepeat.com/ == web/index.html
ok  https://rhcheck.gmgnrepeat.com/  == web/check.html
ok  https://rhairdrop.gmgnrepeat.com/wc.js == web/wc.js  (== web/wc-build/EXPECTED-SHA256)
```

Every one of those checks is hardcoded to testnet: the file is named `deployments.testnet.json` (there is no
other), the RPC in both workflows is `https://rpc.testnet.chain.robinhood.com`, and `preflight.sh` check 3
reads only that one manifest. `web/index.html:179` carries `bulk: '{{BULKSEND_MAINNET}}'`.

So on the day the mainnet placeholder is substituted, the property that has been proved continuously for
thirteen rounds stops being proved, silently, and nothing in the gate list says to rebuild it. Three items
are missing from the four in `docs/status.md`'s gate table:

1. **A mainnet deployment manifest and the same two equality checks against it.** Concretely:
   `deployments.mainnet.json`, `preflight.sh` extended to both, and both workflow steps parameterised over
   the two chains. Without it, "the page sends to the contract the manifest names, and the manifest names
   what this source builds" holds for the chain with no money on it and not for the chain with money on it.
2. **A review round with mainnet enabled.** Every browser suite and probe in this repository runs with
   `LIVE_CHAINS = new Set([46630])` and `<option value="4663" disabled>`. Round eighteen's R18-7 and this
   round's R19-2 both had to remove that attribute in the probe to reach the code under test. Flipping it is
   not a configuration change, it is the first execution of a code path, and F-2 is an example of a defect
   that lives only there. The gate should say "a clean round against a build with mainnet enabled", not
   "a clean round".
3. **A production explorer plan, alongside the production RPC plan.** Gate 9 correctly names Robinhood's
   public RPC as unsuitable for production and requires a fallback. Nothing says the same about the
   explorer, and on mainnet the explorer is not a convenience: it is where the recipient list comes from
   ("Fetch holders") and where Assign's fallback inventory comes from. The current answer is a free-tier
   Blockscout PRO key at 5 requests a second and 100K credits a day, behind which `web/index.html:1895`
   issues **up to 200 sequential requests for one button press**. That is a rate limit the design walks into,
   and per F-2 the failure is silent.

**Fix.** Add those three rows to the gate table in `docs/status.md` and the corresponding work to
`docs/plan.md`. Item 1 is the one I would not release without: it is the only promise in the list that is
currently *machine*-checked and would silently stop being.

---

### F-12 — smaller claims in the documentation that are not true of this tree (should be fixed)

**Category:** should be fixed but does not block release. Each is one line.
**Demonstrated.** Each was run or read against `39eaaf2`.

**(a) `docs/status.md` — "`forge test` # 111 contract tests, plus 29 reviewer probes of which 9 must FAIL".**
The counts are exactly right (111 = 13 + 90 + 2 + 2 + 4; 29 = 20 + 7 + 2; 9 fail). What the line omits is
that plain `forge test` *also* runs `test/fork/MainnetGuards.t.sol` — `foundry.toml` has no `no_match_path`
— so the real total on a networked machine is 144 tests, and plain `forge test` **makes an unannounced
network call to `https://rpc.mainnet.chain.robinhood.com`** from `vm.createSelectFork`. Both `test.sh` and
`verify.sh` are careful to exclude `test/fork/`; the documented one-liner is not, and the brief for this
round quotes "131 passed, 9 failed", which is the count without the fork suite. On this machine plain
`forge test` reported **135 passed, 9 failed**. Nothing is wrong with the fork suite — it passed 4/4 and
its 20-of-20 result is real — but a reviewer told "no network" who runs the documented command gets a
network read they were not told about, and one told "131 passed" sees a different number and has to chase it.
Fix: either set `no_match_path = "test/fork/*"` in `foundry.toml` (and keep the explicit
`--match-path` invocation for the fork run), or say in `status.md` that the plain command includes it.

**(b) `deploy/publish.sh:76` — "The hash is recomputed here and the file is corrected if it has drifted."**
It is not corrected. `deploy/csp-gate.py:17` says the opposite, deliberately and for a good reason ("This
checks; it does not repair. A publisher that edits the file it is about to ship is a publisher that ships
bytes no commit contains"), and `docs/for-reviewers.md:91` states the correct behaviour. The comment in the
publisher is the odd one out and says the thing the design specifically refuses to do.

**(c) `docs/status.md`, the gate table, row one** — "**not met** — round fifteen found five." Rounds
sixteen, seventeen and eighteen have run since; seventeen found no blocker and eighteen found one, which is
closed in this commit. The verdict ("not met") is right; the reason given is three rounds stale, in the one
table a reader consults to find out where the project stands.

**(d) `docs/status.md` — the S-4 row.** Covered in F-5: it records three regressions as closed when one and
a half are.

Verified correct, for contrast: the 74 `readers.test.mjs` checks, the 21 CSP-gate checks, the 31 worker
checks, the 111/29/9 contract split, `deployments.testnet.json` agreeing with `web/index.html`,
`web/wc.js` matching `EXPECTED-SHA256`, both live pages matching the repository byte for byte, and the
deployed runtime matching the build.

---

## The three known test weaknesses (scope 7)

The brief lists three and asks whether any hides a defect I can name. Two do.

**(1) Dialogs are auto-accepted by default — yes, it hides F-10.**
`client.test.mjs:278` is `page.on('dialog', (d) => (opts.dismissDialogs ? d.dismiss() : d.accept()))`. A
test that accepts every dialog cannot distinguish "the gate fired and the user said yes" from "the gate
never fired". The `alreadyPaired` confirmation added by round eighteen's S-6 *is* pinned — at
`client.test.mjs:1095`, which dismisses the dialog and asserts the list is untouched. That case uses a
**bare** list (`0x…111,11,12,13`). The case immediately after it (`:1103`) runs the same list with dialogs
accepted and asserts only the output shape, so it would pass identically with the guard deleted. Nothing
anywhere runs Assign on a *headed* already-paired list and observes whether the question was asked — which
is exactly the hole F-10 lives in. I had to read `page.__dialogs` in my own probe to see the guard had not
fired. Fix: make the default `d.dismiss()` (a dismissed confirm is the conservative branch, and a test that
needs "yes" can say so), or expose a dialog log the suite's `check` can assert on.

**(2) `eth_estimateGas` answers a constant — yes, it hides F-4.**
The mock does support a failure (`O.estimateGas === 'revert'`, `client.test.mjs:159`), which is better than
the brief suggests. But every use of it (`:2839`) is against `probeGas`, the batch-cap measurement. The
estimate that round eighteen's S-10 put in front of the broadcast — `req.gasLimit = (await
pageRpc.estimateGas(req)) * 110n / 100n` at `web/index.html:3372` — has **no test in which it fails**, so
the catch that follows it, and the sentence that catch prints, have never run. That sentence is F-4. Fix:
one case with `estimateGas: 'revert'` driven through `#send`, asserting that the log does not claim the
batch reached the wallet and that no pending record survives.

**(3) `eth_call` falls through to a plausible word — I cannot name a defect it hides.**
I looked for one: the contract's own paste guards are Solidity and are covered by `BulkSendReal.t.sol` and
the fork suite against real contracts, not by this mock; `detectStandard` and `readAddress` special-case the
selectors that matter (`0x01ffc9a7`, `0x313ce567`, `0x06fdde03`). The residual risk is real — an unknown
selector answering `1` means "the page never sees a token that does not implement this" — but I could not
turn it into a named defect, and I am not going to pad the list with one I could not.

---

## Areas examined and found sound

Silence elsewhere in this report means these were looked at and I did not find anything.

**`src/BulkSend.sol` (promise 1, promise 2, promise 3).** Read in full against the seven promises.

* Authority: every transfer is `transferFrom(msg.sender, …)` / `safeTransferFrom(msg.sender, …)`. No owner,
  no role, no `delegatecall`, no `selfdestruct`, no constructor argument, no storage other than the transient
  reentrancy slot, no upgrade path. There is nothing the author or anyone else can change after deployment.
  Promise 1 holds, and the deployed runtime at `0xf2eD…9232` is byte-identical to what this source builds
  (checked).
* Promise 2 in lenient mode: a skip is only recorded when `call` returned `false`, which unwinds state, so a
  skipped row cannot have moved value. Every "success that is not plainly a success" — a 721 or 1155 that
  answered anything at all, an ERC-20 that answered other than empty or exactly `1` — reverts the whole batch
  with `AmbiguousResult` rather than being counted either way. That is the right direction and it is applied
  in strict mode too (`returndatasize()` is checked after the high-level call, which a high-level call to a
  void function would otherwise discard).
* Promise 3, "all or nothing": strict mode forwards all gas (`_callAll`) and lets the token's own revert
  bubble, and `sent = n` is only assigned after the loop cannot have exited early.
* Promise 3, "skips only recipients that genuinely could not receive": the interesting attack is the
  insufficient-gas grief — set the transaction's gas limit just low enough that EIP-150's 63/64 rule starves
  each inner call, and every honest recipient is reported as having refused. `_tryCall` refuses this
  explicitly: `if (g - g/64 < stipend + GAS_RESERVE) revert OutOfGasForBatch(index)`. The batch dies instead
  of lying about who could receive, and (as its comment says) it also keeps `eth_estimateGas` from settling
  on a limit that skips rather than delivers. `GAS_RESERVE` of 40,000 is comfortably above the cost of
  copying 128 bytes of returndata plus a two-topic `LOG3` with a 256-byte payload. I could not construct a
  gas limit that produces a skipped-but-honest recipient.
* The stipend itself (`DEFAULT_GAS = 400_000`, caller range 100k–5M) is an inherent limit, correctly
  disclosed in the contract's own header: a recipient skipped for exhausting it "has not been judged unable
  to receive; it may simply be expensive."
* The four paste-guard questions (scope 3). I could not construct a legitimate ERC-20 that any of the four
  refuses. The one with reach is `isApprovedForAll(msg.sender, address(this))` returning a 32-byte word ≤ 1:
  that requires an ERC-20 whose fallback returns exactly 32 bytes of 0 or 1 for an arbitrary selector, which
  neither Solidity's default fallback, Vyper, a Diamond (EIP-2535) nor a standard proxy does. Nor could I
  construct an ERC-721 that answers none of `ownerOf(first)`, `ownerOf(last)` and `supportsInterface`, short
  of a collection with no ERC-165 whose first *and* last listed ids are both unminted — in which case the
  transfer would fail anyway. `forge test --match-path 'test/fork/MainnetGuards.t.sol'` ran here against the
  live mainnet fork and passed 4/4; 20 real collections refused by the ERC-20 path and accepted by the NFT
  path, 20 real ERC-20s accepted. The suite is not vacuous: without the network `vm.createSelectFork` in
  `setUp` fails the tests rather than skipping them.
* `_airdrop1155` has no standard guard, and does not need one: an ERC-20 and an ERC-721 both lack
  `safeTransferFrom(address,address,uint256,uint256,bytes)` (`0xf242432a`), so a mispaste reverts rather
  than moving anything.
* The reentrancy lock is transient (`tstore`), so the contract still stores nothing between transactions, and
  its stated purpose — stopping a recipient hook from emitting `Skipped`/`Airdrop*` events from this address
  into the receipt the client reads — is the right threat to name.

**Deferred item, and I agree it is deferred correctly.** `docs/for-reviewers.md` decision 3 (a `false` from
an ERC-20 takes down the whole lenient batch). `PaysThenLies20` in `test/RealTokens.sol` moves the balance
and then answers `false`, and from inside the call there is nothing that separates it from a blocklist
refusing a recipient. Reporting a payment as a skip is how a re-run pays twice; reverting costs one
transaction. The reasoning is right and the cost is stated. I would not change it.

**Delivery ledger and double-payment (promise 4, scope 5).** This is the strongest part of the page and I
tried hard to break it.

* The pending record is written *before* the wallet is asked, keyed per batch (`bulksend:pending:<pid>`), so
  nothing reads-modify-writes a shared array. `writePending` reads the record back and compares its `pid` and
  row count, which catches a quota failure that did not throw.
* A wallet error that is neither a rejection nor a success keeps the record. `isRejection` recognises only
  4001 / `ACTION_REJECTED` / 5750, so a wallet that declines with any other code *fails held*, which is the
  safe direction, and "Review held rows" then offers release behind a confirmation that says
  "Transaction: never came back from the wallet" and "That is this page being unable to answer, not the
  chain saying no." That is honest about the one case it cannot settle.
* Two tabs: `runSend` takes `navigator.locks.request('bulksend:' + runKey, { ifAvailable: true })` before
  anything is signed, refuses outright if the browser has no Lock API at all, and `ledgerKey()` throws if
  anything tries to record a delivery outside a locked send. The run key is frozen for the duration of the
  lock, so a wallet disconnecting mid-send cannot move the ledger to `anon` underneath it.
* Replaced transactions: followed only when `to`, `data` **and** `from` all match the recorded call; anything
  else is held with an explicit "the replacement may have paid different wallets entirely".
* `commitDelivered` writes the ledger, reads it back, and only then shrinks or drops the pending record. A
  failed read-back holds the rows rather than releasing them. The ledger is capped at 20,000 and refuses to
  evict.
* Cross-browser and cross-device duplication is an **inherent limit**, correctly declared in
  `docs/for-reviewers.md` decision 5 and in the page.

**Parsing and allocation (promise 5).** `parsedListSource` is the exact textarea string, `requireCurrentParsedList`
is called at the entry to `runSend` *and again inside the run lock* (because a script can change `.value`
without an input event while the lock is pending), and `finishParse` re-binds it. The only consumer of `rows`
that does not recheck is `probeRow`/`probeGas` (`web/index.html:387-393`), and it cannot change an
allocation: it picks one row to measure gas with, affecting the displayed cost and the batch-size cap and
nothing else. `wholeText` refuses `1.5` and refuses scientific notation by name rather than guessing;
`tooPrecise` refuses an ERC-20 amount with more decimals than the token has rather than rounding;
`splitRow` is RFC-4180 and `serializeRow` round-trips through it with a runtime assertion
(`web/index.html:931-945`). Duplicate ERC-721 ids are refused; repeated identical rows are numbered (`#1`, `#2`)
so a second payment to the same wallet is not swallowed by the first. Assign proves its own output by
re-parsing it through the canonical parser and comparing wallet-by-wallet quantities, and restores the
original list if that fails — which is a genuinely good pattern, and the reason F-10 costs pairings rather
than recipients.

**The shared serializer, Shuffle and Apply Weight (scope 2).** `serializeRow` quotes on every separator
`splitRow` will accept (`,` `\t` `;` `=` plus quotes and newlines) and on leading or trailing whitespace,
and then asserts its own round-trip through `splitRow` before returning — a runtime invariant, not only a
test, so a future separator change cannot corrupt a list because one writer was missed. Shuffle permutes
only the cells the *standard* names as payload (`[wcol.id]`, `[wcol.id, wcol.qty]`, `[wcol.qty]`), leaves
every other column attached to its wallet, keeps the header as a header, and refuses outright rather than
dropping a line that has no id yet. Apply Weight refuses a headed ERC-721 file that already names exact ids
(an amount cannot multiply a unique NFT) and refuses to write the `xN` shorthand into a headed file that
names no quantity column — the case where the page would otherwise produce a box it could not read back.
On an ERC-721 file naming both an id and an amount column, the picker and the parser agree (one delivery per
id, the amount ignored); `requestedNftQuantity` reads the amount column instead, and that divergence is
gated by the `alreadyPaired` confirmation — except through the hole F-10 describes. One rough edge, not a
finding: Shuffle has no `try`/`catch`, so if `serializeRow`'s invariant ever did throw, the box would be
left untouched (correct) with nothing said on screen (not).

**Assign's capture-before-await discipline (scope 0c).** Seven inputs are captured before the first `await`
(list bytes, token, standard, account, chain, random setting, "how many each") and all seven are compared
before anything is written, plus an `assignGeneration` counter so a newer Assign supersedes an older one.
The holder snapshot has the same shape (chain, collection address, account, checked before the walk, between
pages, and again before the write). I could not find an eighth input that moves unnoticed. The shared
quantity reader `requestedNftQuantity` and `deliveriesOn` agree with `parseList` on every input I
constructed — `0xA,1,2,3` (three), `0xA x3` (three), `0xA,5` (one), a headed file with both an id and an
amount column (one per id; the amount column is what Assign reads, but that path is gated by the
`alreadyPaired` confirmation — except through the hole in F-10).

**The Check page's read-only promise (promise 6).** `web/check.js` never *calls* `eth_sendTransaction`,
`personal_sign`, `eth_signTypedData` or `wallet_sendCalls` — every occurrence of those names is a string
literal or a comment describing a request the user pasted in. There is no `ethers.Wallet`, no
`BrowserProvider`, no `getSigner`: every provider is a `JsonRpcProvider`, and the only `window.ethereum`
call in the file is `eth_requestAccounts` (`check.js:1592`) behind the "Use mine" button, which fills the
`from` box. Simulation is `eth_call`/`eth_simulateV1`. The page's
three-state discipline (`verified`/`null`/`false`, `codeUnreadable`, `implUnknown`, `bodyMissing`,
`explorerDown`) is carefully built and carefully rendered — F-1 is a defect in one line of plumbing feeding
it, not in the design. The ordered-simulation cardinality check, the taint rule that a top-level refusal
removes the whole-request verdict, and the refusal to reuse a forwarder's ABI once a proxy is detected all
do what their comments claim.

**The shared readers of round fifteen (scope 1).** `parsedListIsCurrent` has three consumers and the two
that matter (`requireCurrentParsedList` at the top of `runSend` and again inside the run lock; Assign's
round-trip check) both recheck. `boxColumns`/`addressOn` are now used by every box reader, which is what
closed the "`label,address` read as two wallets by one reader and none by another" defect — with the single
exception F-10 names. The Check page's two request readers report the declared sender under one name
(`declaredFrom`) and the unreadable case under one name (`senderUnreadable`), so the renderer has one thing
to read; the two expressions that produce them are currently byte-identical duplicates rather than one
function, which is a twin that could drift and is the reason `docs/readers.md` exists. The
ordered-simulation cardinality rule — only a list where *every* call simulates may earn an all-calls
verdict, and a top-level refusal taints every subset verdict — does what its comments claim.

**Serving (promise 7, scope 8).** Checked live, read-only, during this review:

* `https://rhairdrop.gmgnrepeat.com/` is byte-identical to `web/index.html`; `https://rhcheck.gmgnrepeat.com/`
  to `web/check.html`; `https://rhairdrop.gmgnrepeat.com/wc.js` to `web/wc.js`, whose sha256
  (`d4c35a1b…64d7`) equals `web/wc-build/EXPECTED-SHA256`.
* Both hosts answer plain HTTP with `301` to `https`, send HSTS (`max-age=31536000; includeSubDomains`),
  `x-content-type-options`, `referrer-policy`, `cross-origin-opener-policy` and a full CSP header including
  `frame-ancestors 'none'` — on the page **and** on a `400` from a malformed `/x/` path. No preload, which I
  agree with: preload is a decision about every present and future subdomain of `gmgnrepeat.com` and cannot
  be undone quickly.
* The connector chain is closed: `web/wc.js` → `EXPECTED-SHA256` (publish refuses a mismatch, and refuses an
  empty or malformed expected digest) → `WC_SHA256` baked into the Worker → the Worker rehashes the fetched
  bytes and serves `502` on a mismatch → CI rebuilds from `web/wc-build/` with `npm ci` and pinned `esbuild`
  and requires rebuilt == shipped == expected → the integrity workflow compares the live bytes four times a
  day. I could not find a link in that chain that can be skipped without an explicit, announced bypass.
* `deploy/csp-gate.py` holds the *whole* policy to a table, not just `script-src`: fixed directives must
  match exactly, host directives are allowlists, and a directive the table has never heard of is refused
  rather than ignored. The hash set must be exactly one hash, its own — so a policy naming both the current
  and a previous script is refused, which is the subtle case. `test/csp-gate.test.sh` passed 21/21 here. If
  the page's hash and its script disagree, `publish.sh` computes the hash from the file it is about to ship
  and `csp-gate.py` refuses; it does not repair (see F-12(b) for the comment that says otherwise).
* Both workflows are read-only. `tests.yml` has `permissions: contents: read` and `persist-credentials: false`
  — important, since it runs pull-request code. `integrity.yml` has `issues: write` solely to open the
  failure issue, and every action is pinned to a commit hash rather than a tag. Neither takes a secret.
  The one thing I would add is the coverage gap in F-6.
* `SECURITY.md`'s Transport section is honest about the one place "every response" is not true, and I
  confirmed it holds today: `http://rhairdrop.gmgnrepeat.com/cdn-cgi/trace` answers `404` with no HSTS and
  no redirect, and the HTTPS form sends no HSTS either, because `/cdn-cgi/*` is answered by Cloudflare
  before any Worker runs. The document says so in those words, names the practical exposure honestly
  (Cloudflare's own beacon posts to `/cdn-cgi/rum` on this host, so it is not a namespace nobody touches),
  and `integrity.yml` asserts the current state so the sentence fails loudly if zone-level HSTS is ever
  turned on. That is the right way to carry a known gap.
* The two deliberately-unchanged round-seven items are still right: `static.cloudflareinsights.com` is
  injected at the edge after the Worker runs, so refusing it buys a console error and nothing else; and the
  shipped `web/wc.js` contains no `axios`, `form-data`, `follow-redirects` or `proxy-from-env` (checked).

**The Worker's translation (scope 0), beyond F-3/F-8.** The `status: "1"` + typed-result precondition is
applied on all four paths and I could not get past it: a `status:"0"` NOTOK, a body with no `status` at all,
a non-JSON content type, a non-2xx, a throw and a timeout all reach `upstreamFail`. The inventory netting is
keyed on `contractAddress|tokenID` lowercased, so two collections sharing an id cannot cancel, and a burn
(`to` = `0x0`, `from` = the wallet) nets `-1` and is filtered out; a self-transfer nets zero. The key never
appears in a response body or header and the subrequests carry `cf: { cacheTtl: 0 }`, so a keyed URL is not
an edge-cache key and a failure is not served to everyone for a minute. The `/x/` path regex admits only
`[A-Za-z0-9_\-/.]{1,200}` and rejects `..`, and `url.pathname` is percent-encoded, so an encoded traversal
cannot match. `redirect: 'manual'` keeps an explorer from putting a document on this origin. The integrity
workflow's gate-11 step asserts real content (a non-empty holders array, a known-unverified contract reading
`false`, a known-verified one reading `true` *with its name and a non-empty ABI*) — the envelope fails all
three, because `d.get("is_verified")` on the envelope is `None`, not `False`. It cannot pass on a wrong
answer, on the host it checks.

**The evidence gate, beyond F-7.** `verify.sh` genuinely cannot be satisfied by wording: probe *sources* and
probe *assertion sets* are both hashed, so renaming a probe, weakening one assertion, or cancelling a
reopened finding against a newly closed one all fail. The assertion fingerprint deliberately strips the
diagnostic after `<-` so wall-clock times do not move it. A probe file the baseline has never heard of fails
— I confirmed this is the guard working when I added `audit-probe-19.mjs`. `test.sh` does not run the
probes and does not claim to; CI runs `./verify.sh` and not `npm test`, with a comment explaining exactly
why. A filtered browser run (`ONLY=`) prints "N of M cases run" and `verify.sh` refuses it by name, and it
`unset ONLY` before each suite so an environment variable cannot silence a run. I found no path through
`test.sh` or CI that skips the gate.

---

## Notes on the state of the tree as received

- `forge test` on this tree reports **135 passed, 9 failed**, not the "131 passed, 9 failed" the brief
  states. The nine failures are the expected probe reproductions (`AuditProbe` 6, `Audit12` 2, `Audit13` 1)
  and match `test/findings-baseline.json` exactly. The four extra passes are `test/fork/MainnetGuards.t.sol`,
  which plain `forge test` runs because `foundry.toml` excludes nothing — 131 + 4 = 135. So the brief's
  number is the count *without* the fork suite, and the difference is F-12(a), not a discrepancy in the
  tree.
- `node test/worker.test.mjs` — 31 passed, 0 failed (matches `docs/status.md`).
- `node test/readers.test.mjs` — 74 passed, 0 failed, **after** `npm install`; see F-9 for why it did not run
  on the clone as received.
- `./test/csp-gate.test.sh` — 21 passed, 0 failed.
- `forge coverage` on `src/BulkSend.sol` — **100.00% (58/58) branches**, 100% (20/20) functions, exactly the
  claim in `docs/status.md`. (Lines 98.73%, statements 99.09%; neither is claimed.)
- `node test/web/client.test.mjs` — 362 passed, 0 failed; `node test/web/check.test.mjs` — 129 passed,
  0 failed. Both match `docs/status.md` exactly.
- `forge test --match-path 'test/fork/MainnetGuards.t.sol'` — 4 passed, against the live mainnet fork; the
  20-of-20-each-way claim is real and the suite is not vacuous without a network (`vm.createSelectFork` in
  `setUp` fails the tests rather than skipping them).
- Live, read-only: both pages and `/wc.js` are byte-identical to this commit; `web/wc.js` matches
  `web/wc-build/EXPECTED-SHA256`; both hosts 301 plain HTTP and send HSTS, CSP with `frame-ancestors 'none'`,
  `nosniff`, `referrer-policy` and COOP, on the page and on a `400`; the deployed runtime at
  `0xf2eD6359F5deE0334d68cd21d306D9D3E7a49232` is byte-identical (9,752 bytes) to what this source builds.
  Promise 7 holds in full, for testnet.

### The probe this round added

`test/web/audit-probe-19.mjs`, in the repository's convention — a probe that **PASSES** ("REPRODUCES") is a
defect that is still present.

```
$ node test/web/audit-probe-19.mjs
  REPRODUCES  R19-1 …the Check page reads the Worker's own {"error":"upstream"} envelope as a definite answer…
  REPRODUCES  R19-2 …an unreadable answer part way through the holder walk ends the walk as if it were the last page…
  REPRODUCES  R19-3 …Assign's "this list is already paired" confirmation reads the line positionally…

3 demonstrated, 0 not reproduced
```

It needs no network, no key and signs nothing. `./verify.sh` will refuse the file until
`test/findings-baseline.json` names it with the count it should hold at (`3` today, `0` once all three are
fixed) — that is the guard working, and I have deliberately not edited the baseline.
