# Audit — round eighteen

Commit `79d6446`. Written as the review proceeded; sections are added in the order they were examined, not in
order of severity. The verdict and the full finding table are at the end.

---


> Published as written. The reviewer worked outside this repository against exact commit `79d6446`, on Opus.
> Its blocker B-1, its root cause B-2, B-3 and S-2 are closed in the commit that publishes this file, against
> the reviewer's own probe (`test/web/audit-probe-18.mjs`, kept under the round's number): R18-1 to R18-5 and
> R18-7 read fixed there; R18-6 (S-1) reproduces until the two quantity readers agree, and is tracked in
> `status.md` with the rest of the should-fix items.

## The release bar I am judging against

Software that moves other people's money in a browser, against contracts nobody controls, is ready for the
public when all five of these hold:

1. **No path loses funds that the user did not authorise.** The contract can only move what was approved, in
   the transaction that was signed, and no later change by anybody — including the author — can widen that.
2. **Every statement the software makes about what happened is either true or explicitly marked unknown.**
   "Delivered", "skipped", "verified", "safe" are claims. A claim made on evidence that was never obtained is
   worse than silence, because silence invites the user to go and look. This is the bar that separates a tool
   from a liability: a page whose whole purpose is to tell a non-technical user whether a contract is
   trustworthy must never answer that question from a failed lookup.
3. **No path pays the same person twice** under the failure modes the browser actually produces — reload,
   crash, tab eviction, two tabs, a replaced transaction, a wallet that never answers — and the software says
   plainly which of those it cannot cover.
4. **What is deployed is what was reviewed**, and that is checkable by someone who does not trust the author:
   page bytes, contract runtime bytecode, connector digest, policy headers.
5. **The limits that cannot be engineered away are stated in the product, not only in the docs.** A hostile
   token can lie; one RPC node is one witness; an explorer can be wrong. The software's job there is to name
   the evidence it used and refuse to upgrade it into proof.

Points 1, 3, 4 and 5 are, on this commit, met to a standard I would call unusually high for this class of
software. Point 2 is not met, on mainnet, in production, today. Details below.

---

## BLOCKER B-1 — the Worker reports **every unverified mainnet contract as verified**, and the Check page prints that in green

**Category: blocks release** (a user acts on a false statement).
**Demonstrated**, against the live deployment and offline against the rendered Worker.
**Scope item 0.** `deploy/render-worker.py:133-150` (the `smart-contracts` translation).

### The defect

```js
const r = (Array.isArray(res.json.result) ? res.json.result[0] : null) || {};
const isVerified = r.ABI !== 'Contract source code not verified';
```

When the module API's `result` is not an array — which is what Blockscout's Etherscan-compatible
`getsourcecode` returns for an **unverified** contract (`{"message":"Contract source code not verified",
"result":null,"status":"0"}`), and also what it returns for a rate-limit, a rejected key or any `NOTOK`
envelope — `r` becomes `{}`, `r.ABI` is `undefined`, and `undefined !== 'Contract source code not verified'`
is **true**. The Worker then emits `is_verified: true` with `name: null`, `abi: []`, `compiler_version: null`.

`docs/gate-11-explorer.md` states the rule this breaks in its own words: *"Anything the module API cannot
supply is `null`, never a guess."* The one field that cannot be null — a boolean — is the one that is guessed,
and it is guessed in the unsafe direction.

### Demonstrated on the live deployment

Real mainnet contracts on chain 4663, asked through the deployed Worker, 11 September 2026:

```
$ curl -s https://rhcheck.gmgnrepeat.com/x/4663/smart-contracts/0x324f1fddc6df85859e52f43f365d6b06670b74a1
{"is_verified":true,...,"name":null,"abi":[],"compiler_version":null,...}
$ curl -s https://rhcheck.gmgnrepeat.com/x/4663/smart-contracts/0x0259828e953e24c0d9a32e4c06ea655deb2c6351
{"is_verified":true,...,"name":null,"abi":[],...}
$ curl -s https://rhcheck.gmgnrepeat.com/x/4663/smart-contracts/0x0000000000000000000000000000000000000001
{"is_verified":true,...}        # an address with no code at all
```

Contrast, same host, same minute — the translation is otherwise working, so this is not "the key is unbound":

```
$ curl -s https://rhcheck.gmgnrepeat.com/x/4663/smart-contracts/0x8876789976decbfcbbbe364623c63652db8c0904
{"is_verified":true,...,"name":"UniversalRouter","abi":[{...real ABI...}],...}
```

So the positive case is right and the negative case is inverted. Of the seven mainnet contracts I sampled from
one recent block, two are genuinely verified and report correctly; **five are not verified and every one of
them reports `is_verified: true`.**

### Reproduced offline, no network and no key

```bash
python3 deploy/render-worker.py web/check.html /tmp/w.mjs check '' '' sha256-test
node -e '
const w = (await import("file:///tmp/w.mjs")).default;
globalThis.fetch = async () => new Response(
  JSON.stringify({status:"0",message:"Contract source code not verified",result:null}),
  {status:200,headers:{"content-type":"application/json"}});
const r = await w.fetch({url:"https://x/x/4663/smart-contracts/0x"+"11".repeat(20),headers:{get:()=>null}},
                        {BLOCKSCOUT_KEY:"k"});
console.log(await r.json());   // => { is_verified: true, ... }
' --input-type=module
```

### What it costs the user

`web/check.js:292` — `out.verified = !!sc.is_verified`. `web/check.js:818-825` then renders the headline
verification row with status `ok` (green) and the words **"source published and matched"**, and `check.js:878`
suppresses the *"No source has been published"* warning that is the entire reason a non-technical user opens
this page. A user pastes the address of an unverified contract — which is what a scam contract on a young
chain looks like — and Check tells them, in its strongest positive phrasing, that the source is published and
matched. They sign. This is the exact failure the page exists to prevent, and it fires on every unverified
mainnet contract, not on an edge case.

It also degrades `docs/for-reviewers.md`'s and `README.md`'s claim that the page never presents a contract as
safer than the evidence supports: the evidence here is an error envelope.

### Why the suites did not catch it

`test/worker.test.mjs` models the unverified case as `result: [{ABI: "Contract source code not verified"}]` —
the *Etherscan* shape, not the shape Blockscout returns. The fixture file even defines a `NOTOK` fallback
answer (`return okJson({status:'0',message:'NOTOK',result:'not found'})`) for an unknown address, but **no
test ever asks for an unknown address**, so the fallback is dead fixture. Every one of the nine translation
assertions is against a well-formed upstream answer.

### The fix, in a form you can check later

Do not derive a boolean from an absence. Require the success shape before deriving anything, and return the
upstream envelope otherwise:

```js
const arr = Array.isArray(res.json.result) ? res.json.result : null;
const okShape = String(res.json.status || '') === '1' && arr && arr.length;
if (!okShape) {
  // "not verified" and "could not check" are both non-answers to this reader; only one of them is a claim.
  return upstreamFail(res.status || 200);
}
const r = arr[0];
const isVerified = typeof r.ABI === 'string' && r.ABI !== 'Contract source code not verified' && r.ABI.trim() !== '';
```

`explorerJson` in `web/check.js:224` already turns `{"error":"upstream"}` into `ok:false` → `out.verified =
null` → *"could not check for a published source"* (amber), which is the correct answer for both the
unverified-upstream-shape case and the API-error case. If you want unverified to read as "no source
published" rather than "could not check", you must first establish what Blockscout actually returns for an
unverified contract on this chain and assert that exact body in a fixture.

**Clears when:** `node test/worker.test.mjs` contains a case whose upstream is a *verbatim capture* of the
module API's real answer for an unverified chain-4663 contract, asserting `is_verified === false` or an
`{"error":"upstream"}` envelope — and a second case whose upstream is `{"status":"0","message":"NOTOK",
"result":"Max rate limit reached"}`, asserting the envelope; and
`curl -s https://rhcheck.gmgnrepeat.com/x/4663/smart-contracts/0x324f1fddc6df85859e52f43f365d6b06670b74a1`
no longer says `"is_verified":true`.

---

## B-2 — the same absence-is-an-answer bug in the other three translated paths

**Category: should be fixed but does not block — on its own.** No current reader turns any of these three into
a false positive statement, which is the only reason this is not a second blocker; but it is B-1's root cause
in three more places and it must be closed by the same change, because fixing `is_verified` alone leaves
these. Demonstrated offline and live. `deploy/render-worker.py:101-132`.

Same root cause, three more places. With an upstream that answers HTTP 200, JSON, `{"status":"0",
"message":"NOTOK","result":"..."}` — the shape a rate-limited or key-rejected module API returns:

| path | Worker emits | truth |
| --- | --- | --- |
| `/transactions/{h}` | `{"status":"error","from":{"hash":null},"to":{"hash":null}}` | nothing is known |
| `/tokens/{a}/holders` | `{"items":[],"next_page_params":null}` | nothing is known |
| `/addresses/{w}/nft` | `{"items":[],"next_page_params":null,"truncated":false}` | nothing is known |

Live confirmation of the first: `curl -s .../x/4663/transactions/0x00…01` → `"status":"error"`.

Today `web/check.js:731` reads only `revert_reason` from that body, so the fabricated `"status":"error"` is
not currently rendered — but it is a field invented rather than nulled, sitting in a response shape the page
is written against, and the next reader that consults `status` will report a successful transaction as
reverted. The holders and inventory cases surface as *"The explorer returned no holders for that address"*
and *"Your wallet does not appear to hold anything in this collection, or the explorer would not say"* — the
second sentence is honest about both cases; the first is not (it asserts the explorer answered).

Fix: in `mod()`, treat `String(json.status) !== '1'` as `{ok:false}` for every action, so all four paths
return `upstreamFail` instead of a translated void. That single change also closes B-1.

---

## B-3 — the NFT inventory silently truncates on a mid-pagination upstream error, and `truncated` does not say so

**Category: should be fixed but does not block.** Reasoned from source, mechanism demonstrated by the same
offline harness. `deploy/render-worker.py:113-131`.

The derivation walks up to 20 pages of `tokennfttx` and stops early when `result.length < 100`. A page that
comes back as a 200 error envelope yields `result = []` (not an array → `[]`), length 0 < 100, so the loop
**breaks and returns what it has as a complete inventory**, with `next_page_params: null` and
`truncated: false`. The free tier is 5 requests a second and this loop issues up to 20 sequential requests for
one page view, so a rate-limit mid-walk is the expected failure, not an exotic one.

Separately, hitting the 20-page (2,000-transfer) ceiling also returns `truncated: false`; `truncated` is only
set by the 2,000-*entry* cap, which is a different limit.

Cost: Assign's explorer fallback (`web/index.html:2228`, used for collections without
`tokenOfOwnerByIndex`) sees fewer ids than the wallet holds. The consequence is benign in direction —
`web/index.html:2174` refuses to write the box when `ids.length < totalWanted` and says *"a collection the
explorer indexes slowly can also read as fewer than you own"* — so this costs a confusing refusal, not a
wrong airdrop. I checked the netting for an over-count and could not construct one: the walk is newest-first,
so truncation only ever drops the oldest events, and a kept suffix that begins with a send nets to −1 and is
filtered by `e[0] > 0`. Mint, transfer out, transfer back, transfer to a third party, burn, two collections
and self-transfer all net correctly.

Fix: `if (!res.ok) return upstreamFail(...)` already exists; add the status check from B-2 so an error page is
not mistaken for a short page, and set `truncated = true` when the loop exits at `page === 20`.

---


## The probe file

`test/web/audit-probe-18.mjs` — seven assertions, all of which currently **REPRODUCE**. Round-number naming,
as the repository does it (`audit-probe-12`, `-13`, `-17`); the prompt's `audit-probe-14` is the name round
fourteen used.

```
$ node test/web/audit-probe-18.mjs
  REPRODUCES  R18-1 an upstream that says the contract source is NOT verified is translated into is_verified: true
  REPRODUCES  R18-2 an upstream rate-limit envelope is translated into is_verified: true rather than the envelope
  REPRODUCES  R18-3 a transaction lookup that failed upstream is reported as status "error" with invented null from/to
  REPRODUCES  R18-4 a holders lookup that failed upstream is reported as an empty holders page
  REPRODUCES  R18-5 an NFT-inventory page that failed upstream ends the derivation early and is reported complete
  REPRODUCES  R18-6 a bare list naming several ids on one line is five deliveries to the picker and two to Assign
  REPRODUCES  R18-7 (with the mainnet option enabled) the holder snapshot pages through two chains' explorers
  7 demonstrated, 0 not reproduced
```

`./verify.sh` refuses the file, in under a second, before installing anything or starting a browser:
`FAIL  browser probe manifest differs from the baseline (unlisted: audit-probe-18).` The guard works.

To adopt it, add to `test/findings-baseline.json`: `"audit-probe-18": 7` under `web_probes`, its sha256 under
`web_probe_sources`, and its assertion fingerprint under `web_probe_assertions`. The count should fall to 0 as
the findings close.

**The gate itself is green at this commit.** With the probe file held aside so the manifest matched, a full
`./verify.sh` run here ends with *"Everything passes, and nothing that was closed has reopened"*: 5 of 5
ordinary contract files, 355/355 airdrop-page, 129/129 Check-page, 21/21 publish-policy, 23/23 worker, and
every probe count and fingerprint — `audit-probe` 8, `audit-probe-17` 3, `audit-probe-check2` 1, the rest 0,
`AuditProbe` 14, `Audit12` 5, `Audit13` 1 — exactly at the baseline. Nothing in this report is a regression in
the sense the baseline measures; B-1 is in code the baseline never covered.

---

## S-1 — one recipient box, two quantity readers, and Assign silently drops the difference

**Category: should be fixed but does not block** — though it is the closest thing in the page to a promise-5
failure, and I would fix it before mainnet. **Demonstrated** (`audit-probe-18.mjs`, R18-6).
`web/index.html:971-983` (`requestedNftQuantity`) against `web/index.html:1579-1607` (`deliveriesOn`).

### The input

A bare ERC-721 list that puts several token ids on one line — a documented shape; the page's own error text
at `web/index.html:1319` says *"For an NFT you may list several ids on one line — `0xabc,1,2,3` sends three"*:

```
0x…111,11,12,13
0x…222,21,22
```

### What each reader makes of it

| reader | used by | answer |
| --- | --- | --- |
| `parseList` (`web/index.html:1303`) | Check list, the send plan | **5 recipients**, 2 distinct wallets |
| `deliveriesOn` (`:1579`) → `walletsInBox` | the picker, list sizing | **5 deliveries** |
| `requestedNftQuantity` (`:978-982`) | **Assign** | no `xN` on the line, so the fallback: **1 each, 2 in total** |

`requestedNftQuantity` only looks for an `xN` cell; the multi-id form is invisible to it. `deliveriesOn` has
a branch for it (`rest.length > 1 && rest.every(whole)` → `rest.length`); the shared reader does not.

### What it costs the user

Pressing **"Assign my token ids"** on that list rewrites the box to two lines and logs
*"Assigned 2 lines, paired at random. They still go out lowest id first…"*. Three of the five allocations are
gone, with no message, no problem line, and no dialog. Assign's own round-trip guard
(`web/index.html:2193-2205`) cannot catch it: it compares Assign's output against `wants`, and `wants` is
already the under-count. The picker, on the identical box, demands five NFTs be chosen. Observed:

```
parsed: "5 recipients, 2 distinct wallets"   pickNeed: 5   linesAfterAssign: 2
after: 0x…222,74 | 0x…111,75
```

The user's own file said five people-worth of NFTs; two go out. Nothing on the page says the other three were
dropped. This is the "dropped rows" clause of promise 5, reached through a button the page actively steers the
user towards (`offerToAssign` highlights it in amber).

### Relation to the open S-6

Round seventeen's open S-6 is the same two readers disagreeing about `x0`, where the disagreement produces a
**refusal**. This one produces a **silent rewrite**, which is the worse direction. It is a different input and
a different consequence, so it is not covered by that entry.

### Fix

Give `requestedNftQuantity` the branch `deliveriesOn` already has: with no named quantity column, if every
cell after the address is a whole number and there is more than one, the requested quantity is that count.
Better still, make `deliveriesOn` call `requestedNftQuantity` so there is genuinely one reader, which is what
the comment above `requestedNftQuantity` claims ("One quantity reader for every feature that interprets an
ERC-721 allocation request").

**Clears when:** `node test/web/audit-probe-18.mjs` reports R18-6 as `fixed`.

---

## S-2 — the holder snapshot is the reader that waits and is not Assign (and round seventeen's S-7 understates it)

**Category: should be fixed but does not block today; must be fixed before mainnet is enabled.**
**Demonstrated** (`audit-probe-18.mjs`, R18-7). `web/index.html:1875-1944`.
**This is the answer to scope item 0d's second half.**

First, the first half: Assign captures seven inputs before its first `await` (`web/index.html:2137-2139`) and
compares all seven after (`:2147-2154`). I looked for an eighth and there is not one. `boxColumns()`,
`requestedNftQuantity`, the `perWallet` clamp and `refuseForUnreadableLines` all run before the await;
`serializeRow` reads nothing but its arguments; the post-await `parseList()` re-derives from the box Assign
itself just wrote and is then required to round-trip to the same wallets and quantities **and** to satisfy
`parsedListIsCurrent()`. Round seventeen's S-1 is genuinely closed, in the code and not in the wording:
`eachAtStart` at line 2139 is compared at line 2153, and the value it guards is baked into `wants` above it.

The holder-snapshot handler is the same shape with none of that. It awaits up to 200 explorer pages and
captures nothing:

- `explorer()` resolves `EXPLORER_API()` **per request** (`web/index.html:446-449`), which reads `chainId()`
  live. Changing the network dropdown mid-read sends the remaining pages to the **other chain's explorer**,
  for what is a different contract at that address, and both answers are concatenated into one recipient list.
  Demonstrated: the probe records the hosts actually asked —
  `["explorer.testnet.chain.robinhood.com","robinhoodchain.blockscout.com"]` — and the resulting box contains
  one holder from each. Nothing in the log mentions it.
- `snap = { chain: chainId(), … }` at `:1925` then labels the blend with the **new** chain, so the stale-chain
  guard at `:2027` agrees with it and proportional weighting runs on mixed numbers.
- `startBlock` and `endBlock` come from two different chains, so the "the chain moved from block X to Y" line
  at `:1905` is meaningless in precisely the case it exists to flag.
- `$('snapAddr')` can also change during the read; the `input` listener at `:1952` only fires while `snap` is
  already set, so it does not see a change made during the read.

**Reachability, stated honestly.** The shipped page carries `disabled` on the mainnet `<option>`
(`web/index.html:64`), so a user cannot select a second network today and this is **not reachable on the live
page**. The probe removes that attribute — which is exactly the edit that enables mainnet — and the defect
appears immediately. So this is a defect that ships *with* mainnet enablement, not before it.

**Why S-7 in `docs/status.md` understates it.** That row reads "the snapshot records the network after its
wait", which describes a mislabelled snapshot. The actual consequence is a **recipient list assembled from two
chains**, offered to the user as one collection's holders. That is a list defect, not a metadata defect, and
the ledger should say so.

Fix: capture `chainId()`, `me` and `$('snapAddr').value` before the loop; pass the captured chain into the
explorer URL rather than re-reading it; refuse to write the box or set `snap` if any of them moved, with the
message Assign already uses.

---

## S-3 — the evidence gate does not fingerprint its two newest suites

**Category: should be fixed but does not block.** Demonstrated by reading `verify.sh` against
`test/findings-baseline.json`. `verify.sh:118-129` and `:135-140`; `test/findings-baseline.json`.

Scope item 4 asks whether a test can be weakened without the fingerprint moving. For the browser suites and
every probe file, no: `suite_files` pins the sha256 of `client.test.mjs` and `check.test.mjs`,
`web_probe_sources` / `contract_probe_sources` pin every probe's complete source, and
`*_probe_assertions` pin each probe's assertion names and statuses. I tried to think of a way past that and
could not: deleting an assertion moves the file hash, renaming one moves the assertion fingerprint, and
cancelling a reopened finding against a newly fixed one moves the fingerprint even though the count is equal.
That part is genuinely strong.

Two suites are outside it, and they are the two newest:

| suite | run by `verify.sh` | source pinned | count compared |
| --- | --- | --- | --- |
| `test/web/client.test.mjs` | yes | **yes** | (pass/fail) |
| `test/web/check.test.mjs` | yes | **yes** | (pass/fail) |
| `test/csp-gate.test.sh` | yes | **no** | **no** |
| `test/worker.test.mjs` | yes | **no** | **no** |

`verify.sh` requires only that each exits 0. For the CSP gate it then prints
`"  $(grep -E '^[0-9]+ passed' …), every weakening refused"` — so a file reduced from 21 checks to 1 prints
"1 passed, every weakening refused" and the gate is green. For the worker suite, all 23 assertions could be
deleted and `verify.sh`, `test.sh` and CI would all stay green.

That matters here specifically: `test/worker.test.mjs` is the only automated evidence for the code in which
**B-1** lives, and the `_why` string in the baseline claims the gate covers "complete deterministic
browser-suite sources", which invites the reader to think the coverage is wider than it is.

Also worth knowing: `test.sh` deliberately runs no baseline comparison at all (it greps the probes' suite
lines and discards them). That is stated in its own comments and CI runs `./verify.sh` rather than `test.sh`
(`.github/workflows/tests.yml`), so there is no CI path that skips the gate. I checked both workflows for a
way in and found none — see the sound list.

Fix: add `worker` and `csp_gate` entries to a `suite_files`-style section and compare their sha256, and
compare the CSP gate's `N passed` against a baseline number.

---

## S-4 — three regression tests that do not prove what their names claim

**Category: should be fixed but does not block.** Reasoned from the source of the suites.

Scope item 0c asks whether the `round-17 S-3`, `gate-10 run-4`, `gate-10` and `gate-9` regressions prove what
they claim. Three of them are weaker than they read.

**(a) `client.test.mjs:1160` — "round-17 S-3 the hash the wallet returned is written down at once".**

```js
check('round-17 S-3 the hash the wallet returned is written down at once',
      pend.length === 0 || pend.every((p) => p.hash !== null), …);
```

In that scenario the mock supplies a receipt and an `ownerOf` that confirms arrival, so the send completes —
which the very next assertion checks. Completion runs `commitDelivered` → `dropPending(pid)`
(`web/index.html:2854`), which removes the record. So `pend` is necessarily `[]` and the assertion is
satisfied by its first disjunct without ever inspecting a hash. The property is genuinely pinned, but by
`audit-probe-17.mjs` R17-4 (which holds the receipt at null so the record survives), not by this test. Fix:
drop the `pend.length === 0 ||` disjunct and run the scenario with no receipt, or assert against the record
captured mid-send.

**(b) `client.test.mjs:1120` — "gate-10 run-4 reconciliation during an in-flight send does not call the batch
lost"** asserts only that a particular sentence is *absent* from the log. It would pass equally if
reconciliation never ran, if the connect path stopped calling it, or if the sentence were reworded. The test
does prove the connect path ran, but not that `reconcilePending` reached the `inFlightPids` check at
`web/index.html:2720` — which is the line the fix added. Fix: expose a counter, or assert the positive
(reconciliation ran and resolved zero batches).

**(c) `audit-probe-17.mjs:257` — R17-4** is a four-way conjunction
(`sent===1 && hash===null && !/sent, waiting/ && listLocked`). It reads "fixed" now, and the substance *is*
fixed — the hash is recorded before the wait, at `web/index.html:3355-3358`. But a future regression that
restored only one of the four conditions would still read "fixed", and the diagnostic already shows
`listLocked: true`. Conjunctive probes decay into single-condition probes as fixes land.

**Not a defect:** gate-9's two tests do prove what they claim (first endpoint dead → the second is used and
said out loud; first endpoint up → nothing else is asked and nothing is said), and `gate-10`'s ERC-20
confirmation-units test asserts both the presence of `x1.5` and the absence of `x1500000000000000000`, which
is the right shape.

---

## S-5 — "Why it failed" can be today's answer under a heading about the past (round seventeen's open S-10), and B-2 makes it the *normal* path on mainnet

**Category: should be fixed but does not block.** Reasoned from source. `web/check.js:729-736`, rendered at
`:755`.

```js
if (failed) {
  const ex = (await explorerJson('/transactions/' + hash)).data;
  if (ex && ex.revert_reason) why = …;                      // the real reason, from the explorer
  if (!why) { const s = await simulate({from: tx.from, to: tx.to, data: tx.data, value: tx.value});
              if (!s.ok) why = decodeRevert(s.reason, …); } // a re-run against TODAY's state
}
…
failed && why ? note('bad', 'Why it failed', why) : null
```

Both answers are printed under the same heading, with nothing distinguishing them. A transfer that failed last
month for insufficient allowance and has since been approved re-simulates with a different error — or
succeeds, in which case `why` stays null and the page says nothing, which is the honest outcome by accident.

I am raising it again rather than leaving it as an open item because **B-2 turns the fallback into the
mainnet default**: when the module API's `gettxinfo` returns anything but a well-formed success, the Worker
emits no `revert_reason`, so every mainnet failed-transaction lookup falls through to the re-simulation. The
open item's severity was assessed before that code existed.

Fix (wording, not behaviour): when the reason came from the re-run, head it *"Running it again now fails
with"* and add *"That is today's answer. The reason it failed at the time may have been different."*

---

## S-6 — round seventeen's S-2 is nearer a fund path than the ledger says

**Category: should be fixed but does not block.** Reasoned from source; the behaviour is already pinned by
`audit-probe-17.mjs` R17-2, which reproduces.

`docs/status.md:159` records S-2 as "Assign re-pairs an already-paired list without asking" and says of the
group "none is a fund path". For a fungible drop that is right. For ERC-721 it is not quite: the probe's own
output shows `0x…111,42 / 0x…222,41` becoming `0x…111,41 / 0x…222,42` with `dialogs: 0` and Send armed. Token
ids in a collection are not interchangeable — a 1/1 and a floor piece are both "one NFT" to this page. The
confirmation lists only the first and last row of each transaction (`web/index.html:3259`), so on any list
longer than two the swap is invisible unless the user opens the downloadable manifest and compares it against
a file they no longer have in the box.

Nothing is lost from the sender's balance, so "fund path" in the ledger's sense is defensible. But the asset
that reaches each named person is not the one the user's own file named, and it is irreversible. I would move
it from "none is a fund path" to "delivers a different asset than the list named", which is a promise-5
statement, and either ask before re-pairing a fully-paired list or say in the log which ids moved.

---

## S-7 — the Worker caches upstream failures for 60 seconds, and a comment says it does not

**Category: should be fixed but does not block** on its own; it multiplies B-1. Reasoned from source.
`deploy/render-worker.py:76` and `:169-175`.

Both upstream fetches carry `cf: { cacheEverything: true, cacheTtl: 60 }`. `cacheTtl` instructs Cloudflare to
cache the response *whatever its status*, so a rate-limit envelope or a challenge page is stored at the edge
and served for the next minute — to every visitor, including after the upstream has recovered.

The comment immediately below the passthrough's own fetch says the opposite:

```
// Only a real answer is worth keeping. The explorer occasionally answers a challenge page instead, and
// caching that for a minute serves the failure to everyone who asks in that minute … A transient error
// must not become the cached answer.
```

The code under that comment does not decline to cache the bad answer; it declines to *relabel* it, which the
next comment block does say accurately ("Refusing to relabel a bad response is not the same as refusing to
serve its bytes"). The first comment therefore claims a property the code does not have, in the file that has
had the least review in the repository.

Combined with B-1 this is what turns a momentary blip into a minute of confident wrong answers: one
rate-limited `getsourcecode` is cached for 60 seconds and every visitor asking about that contract in that
window is told its source is published and matched.

Fix: drop `cacheTtl` and use `cacheEverything` with the upstream's own cache headers, or re-fetch with
`cf: { cacheTtl: 0 }` when the answer was not good; and correct the comment either way.

---

## S-8 — the Blockscout key travels in the subrequest URL, so it is part of the edge cache key

**Category: should be fixed but does not block.** Reasoned from source. `deploy/render-worker.py:66-79`.

```js
u.searchParams.set('chain_id', '4663');
u.searchParams.set('apikey', env.BLOCKSCOUT_KEY);
…
r = await fetch(u.toString(), { …, cf: { cacheEverything: true, cacheTtl: 60 } });
```

The key never reaches a response — I fed the translation three different error shapes and nothing echoed it,
and `test/worker.test.mjs` asserts the same across all four paths, correctly. But `cacheEverything` keys the
edge cache on the full subrequest URL, so the secret becomes part of a cache key, and it is present in the
outbound URL of every subrequest for any request logging the account has or later enables.

Caller-supplied parameters cannot overwrite it (`chain_id` and `apikey` are `set` last), which is the right
order. The exposure stays inside Cloudflare, which the maintainer has placed outside this review's scope, so
I am not calling it a leak. It is a code choice with a cheaper alternative: send the key in a request header
if the PRO API accepts one, or at minimum keep `apikey` out of a cached URL by fetching with
`cf: { cacheKey: <url without the key> }`. Whatever is chosen, the current arrangement means **rotating the
key is the only remedy if a Cloudflare log is ever exported**, so the key should be treated as rotatable and
the rotation step written down.

---

## S-9 — no gate covers what happens when the key's quota runs out

**Category: should be fixed but does not block.** Reasoned from source and from `docs/gate-11-explorer.md`.

The free tier is 5 requests a second and 100,000 credits a day. One Check lookup of a proxy costs two
`getsourcecode` calls plus a `gettxinfo`; one Assign fallback costs up to **20** sequential `tokennfttx`
calls. Nothing in the repository monitors credit consumption, and nothing degrades gracefully when it is
exhausted: today, because of B-1 and B-2, exhaustion produces *false* answers; after they are fixed it
produces a page on which every mainnet explorer feature is silently dark, with only the per-feature "could not
check" sentences to explain it.

The integrity workflow's gate-11 step looks like it covers this and does not: it greps the holders response
for `"items"`, and B-2's empty-page translation contains `"items"`. A quota-exhausted Worker would keep that
check green. Fix: assert `items` is a non-empty array for a collection known to have holders, and add a
`smart-contracts` assertion for a contract known to be unverified.

---

## Scope item 6 — what the software says about itself

Tested rather than read. Almost all of it holds; four things do not.

**Verified as stated.** `forge test` here reports 144 total — 111 ordinary + 29 probes (9 of which must fail)
+ the 4-test read-only mainnet fork suite, which ran because this machine has network. Without the fork suite
that is exactly the 131 passed / 9 failed the prompt describes, and exactly `status.md`'s "111 contract tests,
plus 29 reviewer probes of which 9 must FAIL". `./verify.sh` (run here with my own probe file held
aside, so the manifest matched) reports `client page: 355 passed, 0 failed`, `check page: 129 passed, 0
failed`, the publish gate `21 passed, 0 failed`, the worker suite `23 passed, 0 failed`, and every probe count
and fingerprint exactly at the baseline. `./preflight.sh` is clean and the fork suite is 4 of 4. The deployed contract, both served pages and the connector are
byte-identical to this commit. `node test/web/audit-probe-17.mjs` reads exactly as the prompt says: `fixed`
for R17-1, R17-3, R17-4 and both controls, `REPRODUCES` for R17-2, R17-5, R17-6.

**(a) `docs/status.md:18-21` — three of the four rows in the mainnet gate table are stale, and the file
claims to be current.** The header says *"Last updated 11 September 2026, against BulkSend v13 and round
seventeen."* The table then says:

| row | `status.md` says | `plan.md`, same commit, says |
| --- | --- | --- |
| a review round with no release blockers | **not met** — round fifteen found five | round seventeen found none; "Blockers by round: … 1, 0" |
| a production mainnet RPC plan | **not met** — the page names Robinhood's free public endpoint | gate 9 **Done, 11 September**: three endpoints per chain, probed in order, monitored |
| a current real-wallet rehearsal on testnet | **not met** — the one manual MetaMask run predates v10 | gate 10 **Done, 11 September**: four runs from the maintainer's own wallet, hashes listed |
| explicit permission from the maintainer | **not given** | (the only row that is current) |

The error direction is conservative — it under-reports readiness rather than over-reporting it — so nothing is
authorised that should not be. But the prompt calls `status.md` "the ledger to disbelieve first", and on the
one question that ledger exists to answer, three of its four rows disagree with `plan.md` in the same
repository at the same commit. Round seventeen's S-9 was "four documents described the state two commits
ago"; this is the same defect, one round later, in the table that decides whether mainnet may be enabled.

**(b) `docs/status.md:159` understates round seventeen's S-7.** "The snapshot records the network after its
wait" describes a mislabelled snapshot. The demonstrated behaviour (S-2 above, probe R18-7) is a recipient
list assembled from two chains' explorers. That is a different sentence and a different severity.

**(c) `docs/plan.md` carries two copies of the blocker history and they disagree.** The header says
"Blockers by round: 15, 11, 5, 9, 9, 4, 6, 3, 4, 3, 5, 1, 2, 4, 5, 1, 0" (seventeen rounds); the
"What a 'clean' round means" paragraph says "Blockers by round so far: 15, 11, 5, 9, 9, 4, 6, 3, 4, 3, 5, 1,
2" (thirteen), and draws a conclusion from it ("It has not trended to zero"). One list, one place.

**(d) gate 11 is recorded as closed on evidence that never included the negative case.** `plan.md` records
reading live "a real mainnet collection's holders … its verification record with a 90-entry ABI …". A 90-entry
ABI is a *verified* contract. The gate's own done-when deferred the one check that would have caught B-1 —
"BulkSend's own verification once it is deployed" — and the integrity step that was supposed to close the gate
tests only the holders path. So gate 11 was closed against four positive readings and no negative one, and
B-1 is the direct consequence. Whatever else changes, the rule worth taking from this is: **a translation
layer is closed by reading the failure shapes, not the success shapes.**

**The mainnet gate list is short.** `plan.md` lists gates 9 to 12 and marks all four Done. Beyond fixing B-1
and B-2 I would add three items before the placeholder is substituted:

1. **A live negative-case read of all four translated paths**, against known-unverified, known-missing and
   rate-limited inputs, plus an integrity step that asserts the *negative* answers and a non-empty `items`
   array rather than the presence of the key `"items"`.
2. **A credit-and-rate budget for `BLOCKSCOUT_KEY`**, with a stated behaviour on exhaustion and a rotation
   procedure (S-8, S-9).
3. **One commit that flips mainnet on.** Enabling mainnet means editing `web/index.html` (the
   `{{BULKSEND_MAINNET}}` placeholder, `LIVE_CHAINS`, and the `disabled` attribute on the `<option>`) — and
   `integrity.yml` asserts `grep -qF "LIVE_CHAINS = new Set([46630])"`, so the monitor goes **red** the moment
   mainnet is enabled and stays red until that assertion is changed. Change both in one commit, or the first
   thing the new deployment does is teach its operator to ignore a red integrity badge. S-2 (the snapshot
   reader) must be fixed in that same commit, because removing the `disabled` attribute is what makes it
   reachable.

---

## Scope item 7 — the three known test weaknesses, judged

**(a) "Dialogs are auto-accepted by default, so confirmation gates are exercised as dialogs rather than as
gates."** This hides nothing I can name. Both harnesses record dialog messages and several tests assert on
them — `client.test.mjs:2487` asserts the *content* of the send confirmation, and `audit-probe-17.mjs`
asserts `dialogs.length === 0` to prove a gate is *missing* (R17-2). The machinery to test a gate as a gate is
present and used. The residual risk is only that a gate deleted outright would leave no trace in a test that
merely accepts whatever appears; `confirmOverwrite()` in the snapshot path is the one such gate I found with
no assertion behind it.

**(b) "The mock answers `eth_estimateGas` with a constant."** This hides one thing worth naming: the page
derives its batch cap from a measured estimate (`window.__gasQuote` → `perRecipient`, `PROBE_MARGIN`,
`maxBatch()`), and against a constant no browser test can show that the cap keeps a full batch under the block
gas limit. That property is only covered by the live scripts, which are outside `npm test` and run on demand.
It is a real gap, but a gap in coverage rather than a defect I can demonstrate.

**(c) "The mock's `eth_call` falls through to a plausible word for an unknown selector."** This is now true of
only one of the two suites. `client.test.mjs:228-232` was hardened: an unmocked `eth_call` throws
`unmocked eth_call <sel> to <to>` with `revertData`, deliberately. `check.test.mjs:65` still ends `return
word(1)` — every unmodelled call answers a successful `1`. I could not turn that into a demonstrated defect
today, because Check's positive statements come from the explorer rather than from `eth_call`. What it means
structurally is that a Check reader that ever infers a property from a call the mock does not model will be
tested against a fabricated success — which is precisely the shape of B-1, one layer down. I would fix it to
match the airdrop suite; the prompt's own list should be narrowed to name `check.test.mjs` alone.

**A fourth, not on the list:** `test/worker.test.mjs` and `test/csp-gate.test.sh` are the only suites whose
sources the evidence gate does not pin (S-3).

---

## S-10 — gate 12 is not met: the test run, the mid-send re-check and the gas estimate all read through the wallet's RPC

**Category: should be fixed but does not block.** **Demonstrated** — I instrumented the wallet provider and
counted what the page asked it between pressing Send and `eth_sendTransaction` returning.
`web/index.html:3095`, `:3100`, `:3306`, `:3341`.

`docs/plan.md` gate 12 says: *"The send path must not depend on the wallet's RPC. S-3's fix takes the hash
from `eth_sendTransaction` and waits on this page's RPC; gate 9's production endpoint then covers every read
the page makes."* Marked Done. The first clause is true. The last one is not.

Measured, one ERC-721 batch, one recipient, everything else mocked:

```
wallet was asked, from pressing Send to eth_sendTransaction returning:
{ "eth_chainId": 4, "eth_accounts": 2,
  "eth_call 0xb097e731 to 0xf2ed6359": 1,      <- the test run's staticCall, on BulkSend
  "eth_estimateGas": 1,
  "eth_sendTransaction": 1 }
```

`eth_chainId`, `eth_accounts` and `eth_sendTransaction` are questions only the wallet can answer. The other
two are reads, and gate 9's three-endpoint fallback does not reach either of them:

- **`web/index.html:3095`** — `preflight()` builds its BulkSend contract on
  `new ethers.BrowserProvider(eth).getSigner()`, so the `staticCall` at `:3100` runs on **the wallet's node**.
  That call is the gate for "all or nothing" (`if (!lenient() && pre.willSkip) return`), the gate for
  `pre.willDeliver === 0`, and the source of the numbers the user agrees to in the confirmation dialog.
- **`web/index.html:3306`** — the same `bulk` object is re-used for the per-batch re-check inside the send
  loop, so the decision to continue or stop mid-airdrop is also the wallet's node's opinion.
- **`web/index.html:3341`** — `onThisChain()` is `{ chainId }` only, so `populateTransaction` sets no
  `gasLimit` and ethers' `sendUncheckedTransaction` estimates gas through `this.provider`, which for a
  `JsonRpcSigner` is the `BrowserProvider`: another wallet-RPC read, and one that must succeed before
  anything is broadcast.

**Cost.** No funds are lost and nothing is double-paid: a failed estimate throws before broadcast (record
kept, rows held), and the receipt and the delivery check still run on the page's own RPC, so "delivered" is
still the page's node's answer. What is wrong is smaller and worth fixing anyway:

1. The numbers in the confirmation the user signs off on come from a node neither the page nor the user chose,
   and the page never says which.
2. The mid-send re-check's error path (`:3307`) reports **any** failure as
   *"… The chain has changed since the test run, so nothing further was sent."* `explainCallError`
   (`:3625-3636`) passes a transport error straight through, so a rate-limited wallet node produces a
   confident statement about the chain that was derived from not reaching one. That is the same class of
   claim-without-evidence as B-1, three orders of magnitude smaller.
3. The whole point of gate 9 was that one endpoint is one witness; the two reads that decide whether to send
   at all are outside it.

Fix: build the preflight/re-check contract on `new ethers.JsonRpcProvider(cfg().rpc)` (it needs no signer —
`staticCall` takes `from` as an override), and set `gasLimit` on the populated transaction from an estimate
made on the page's own RPC. Then correct gate 12's sentence, or narrow it to "the hash and the receipt".

**Clears when:** the same instrumentation shows `eth_chainId`, `eth_accounts` and `eth_sendTransaction` and
nothing else asked of the wallet between Send and the hash.

---

## Scope item 0b — the RPC fallback, examined

`pickRpc` (`web/index.html:260-275`) is sound in the ways the scope asks about, with one gap.

- **The log line is not an injection surface.** `new URL(url).host` is taken from the hardcoded `CHAINS[].rpcs`
  array, never from a response, and `log()` writes through `textContent`. Nothing attacker-controlled reaches
  it.
- **A probe racing a send** does not corrupt anything. `chainChanged` sets `stopFlag` and calls `pickRpc`;
  the send loop re-reads `cfg().rpc` per receipt wait, so a switch mid-wait can point the wait at a node that
  has not seen the transaction — which times out and holds the rows. Safe direction.
- **A fallback that answers the right chain id and lies afterwards** is not defended against and cannot be;
  that is L-1 above, and the fix is wording, not code.
- **Six `connect-src` RPC hosts** is the right number: each of the six appears in a `rpcs` array and is
  probed, and a policy that named fewer would break the fallback.
- **The gap (S-11).** `reconcilePending(true)` runs at page load (`web/index.html:3662`), before any wallet is
  connected and therefore before `pickRpc` has ever run, so it reads through `CHAINS[chain].rpc` — the first
  endpoint, the one the page's own comment calls rate-limited. If that endpoint is down, the load-time
  catch-up silently resolves nothing (it is called with `quiet`), and the three-endpoint fallback that exists
  precisely for this does not cover the one read whose job is to stop a second payment. The safety property
  survives, because `runSend` reconciles again (`:3181`) after `pickRpc` has run; the cost is that the page
  offers a stale "held back" state until the user tries to send. Fix: `await pickRpc(...)` for each chain that
  has a pending record before the load-time reconcile, or move the reconcile after the first successful probe.

---

## Inherent limits — what the software should *say*

These cannot be engineered away in a browser against contracts nobody controls. All four are already stated
somewhere; in each case I think the statement is in the wrong place or one clause short.

**L-1 — one node is one witness, and gate 9 quietly made it "whichever of three answered first".**
`pickRpc` (`web/index.html:260-275`) replaces `c.rpc` with the first endpoint that returns the right chain id,
and every later read — including `confirmArrival`, which is what turns a row into "delivered" — goes through
it. A fallback that answers `eth_chainId` correctly and lies afterwards produces a false "read back as held by
their recipient". The page logs the substitution once, as a warning, at the moment it happens; the delivery
line (`:2596`) says "through one configured RPC node" without naming it. **Should say:** name the host in the
delivery line itself, every time — "read back through `robinhood-sepolia-rpc.publicnode.com`" — because the
claim is only as good as that node and the log line has scrolled away by then.

**L-2 — a replaced transaction cannot be followed, and the message names the wrong likely cause.** Since S-3
the receipt is awaited with `provider.waitForTransaction(hash)` (`web/index.html:3367`), which never raises
`TRANSACTION_REPLACED`; the handler at `:3370-3385` is therefore unreachable from this path, and a speed-up or
cancel times out at three minutes. Holding the rows is the right direction and the next visit reconciles by
hash and calldata (`:2741-2757`). But the timeout message (`:3386`) explains the state as *"If this is a
multisig wallet, the batch is waiting for the other signers"* — naming the rarer cause and not the common one.
**Should say:** "…or you used Speed up or Cancel in your wallet, which replaces the transaction with a
different hash. Either way these recipients are held back and this page will look for the transaction again
next time." (I would also delete the dead `TRANSACTION_REPLACED` branch, or restore a path that can raise it,
because dead error-handling reads as coverage.)

**L-3 — a hostile token defeats every check, in both directions.** Already said well, in the footer and in the
delivery line, and `readBatchReceipt`'s cardinality checks plus the contract's `nonReentrant` close the
injected-event route. No change needed.

**L-4 — "verified" means the source matches the bytecode, not that the contract is honest.** Check says
"source published and matched", which is exactly right. No change needed — provided B-1 is fixed, because
today that sentence is printed on evidence that does not exist.

---

## Areas examined and found sound

Silence elsewhere in this report means these were looked at.

**The contract, `src/BulkSend.sol` (v13, all 482 lines read).**
- Promise 1 holds. Every transfer is `transferFrom(msg.sender, …)` built with `abi.encodeCall`; there is no
  owner, no upgrade path, no `delegatecall`, no `selfdestruct`, no payable entry point, no way for anything
  but the caller's own approval to be spent, and nothing the author can change afterwards. The `token`
  address is caller-supplied, which only ever lets the caller point at their own assets.
- `nonReentrant` uses transient storage, so the contract stores nothing between transactions and a recipient
  hook cannot re-enter to forge `Skipped`/`Airdrop*` events into the receipt the client reads.
- Promise 2 at the contract layer: `_erc20Answer` treats anything that is not empty-or-exactly-1 as
  unreadable and reverts the batch, in both modes, rather than calling a possibly-completed transfer
  "skipped". The declined round-twelve S-6 (a returned `false` still reverting the lenient batch) is the right
  call and `docs/for-reviewers.md` decision 3 states the reason correctly: `PaysThenLies20` in this
  repository's own fixtures moves the balance and then answers `false`, so nothing observable separates the
  two and only one mistake pays someone twice.
- Promise 3: strict mode reverts on any failure including an ambiguous non-empty return, so all-or-nothing is
  all-or-nothing; lenient mode skips only a reverted call, a zero recipient, or a stipend exhaustion, and
  `_tryCall`'s `g - g/64 < stipend + GAS_RESERVE` pre-check means an honest recipient is never skipped because
  the batch, rather than the recipient, ran out.
- The four ERC-20 guard questions: I could not construct a legitimate ERC-20 that any of them refuses.
  `supportsInterface(0x80ac58cd)` returning 1, a 32-byte `isApprovedForAll` answer, or a 32-byte `ownerOf`
  answer all require the token to implement an NFT function; the residual risk is a 1-in-2³² selector
  collision or a catch-all fallback that returns exactly 32 bytes, and both are noted in the source. Nor could
  I construct an NFT that answers none of the four: `isApprovedForAll` is mandatory in both ERC-721 and
  ERC-1155, and a token old enough to lack it (CryptoPunks-style) also lacks
  `transferFrom(address,address,uint256)` and so moves nothing. `forge test --match-path
  'test/fork/MainnetGuards.t.sol'` ran here against real mainnet contracts: 4 of 4 suites pass, 20 of 20 each
  way, no key, no gas, no transaction.
- Deployed runtime is byte-identical to what this source builds: 9,752 bytes at
  `0xf2ed6359f5dee0334d68cd21d306d9d3e7a49232`, compared directly against
  `out/BulkSend.sol/BulkSend.json.deployedBytecode` at solc 0.8.36 / cancun / optimizer 10,000.

**Promise 7, both halves, verified by hand.** `curl | cmp` on both hosts: the served airdrop page is
byte-identical to `web/index.html` (271,425 bytes) and the served Check page to `web/check.html` (130,426
bytes). The connector chain is closed end to end: `web/wc-build/EXPECTED-SHA256`, `sha256sum web/wc.js` and
the live `/wc.js` are all `d4c35a1b…64d7`; `publish.sh` refuses to publish on any mismatch, bakes the digest
into the Worker, probes the origin at the digest-keyed URL first, and both workflows re-check it.

**Transport and policy.** Both hosts answer plain HTTP with a 301 that itself carries HSTS, and every
constructed response — 200, 301, 302, 400 and `/wc.js` — carries HSTS, `nosniff`, `referrer-policy`,
`cross-origin-opener-policy` and a locked-down CSP. `frame-ancestors 'none'` is present on the header (it
cannot come from the meta tag). No `unsafe-inline` in `script-src`; the page's own inline script is named by
SHA-256 and `preflight.sh` check 1 fails if the hash and the script disagree, so the "stale hash" case is a
build failure rather than a silently dead page. Every `connect-src` source on both pages is reachable from
that page's code; I checked for an unnecessary one and found none (`api.coinbase.com` is used by both,
`robinhoodchain.blockscout.com` is needed by a fork served off this origin). Not setting `preload` is right:
preload is a decision about every subdomain of `gmgnrepeat.com`, and this repository does not control them.

**`.github/workflows/`.** Both are read-only. `tests.yml` has `permissions: contents: read` and
`persist-credentials: false`, and runs `./verify.sh` rather than `test.sh` or a probe-excluding `forge test`.
`integrity.yml` adds `issues: write` for one step that only opens or comments on an issue, and holds no
secrets. Both pin actions to commit SHAs and the Foundry toolchain to `v1.4.1`. Neither runs code from a fork
with any credential, and neither can write to the repository or to Cloudflare. I looked for a way in and did
not find one. (`integrity.yml`'s gate-11 step is weaker than it looks — it greps for `"items"`, which B-2's
empty-page translation also satisfies — but that is a coverage gap, not a way in.)

**The ledger and the pending record (scope 5).** Read end to end. A record is written before the wallet is
asked and only removed on a definite refusal (`isRejection`); anything else keeps it and holds the rows. Each
batch is its own localStorage key, so no read-modify-write of a shared array can lose another tab's record;
`writePending` and `writeDeliveredFor` both read back what they wrote, because a quota failure is not always
thrown. Sends take `navigator.locks` with `ifAvailable` and refuse to run without it; `ledgerKey()` throws
rather than recomputing the key mid-send, so a wallet that disconnects between signing and arrival cannot move
the ledger to `anon`. `commitDelivered` records and releases together or does neither. `arrivalsFromReceipt`
attributes only transfers whose `from` is the recorded sender, so a reflection or mint in the same transaction
cannot count as delivery, and `readBatchReceipt` requires exactly one summary event, from this contract, about
this token, with `sent + skipped == chunk.length`. Every failure direction I traced ends in "held", not in
"released". Two tabs, a closed tab, a reload, a wallet error that is neither rejection nor success, and a
record for a batch the wallet rejected unrecognisably all end with rows held rather than re-offered.

**Round fifteen's fixes (scope 1).** `parsedListIsCurrent()` is rechecked at all five consumers that can act
(`preflight`, the test run, approve, and twice in `runSend` — once before the lock and once inside it, at
`web/index.html:3214`, which is the one that matters). I looked for a consumer that acts on `rows` without
rechecking and did not find one: `export` and `manifest` only write files, `plan()` rechecks, and the picker,
Shuffle, Apply Weight and Drop-contracts operate on the box text rather than on parsed rows.

**Round fourteen's shared serializer (scope 2).** `serializeRow` quotes every separator `splitRow` accepts
and asserts its own round trip at runtime, so a future separator change fails loudly instead of corrupting a
list. On an ERC-721 file that names both id and amount, the picker and the parser agree: `deliveriesOn`
returns 1 when a non-blank id column is present, and `parseList` reads the id and ignores the quantity. (They
diverge on a *partially* blank id column, where `parseList` calls the blank lines a hole in the file and
`deliveriesOn` falls through to the quantity — but the picker rewrites the box explicitly and re-parses, so
the divergence is visible rather than silent.)

**The Worker's path handling.** `/x/(4663|46630)/…` is anchored, the character class excludes `?`, `#`, `@`
and backslash, `..` is refused explicitly, and the translation layer builds its upstream URL with
`URLSearchParams` rather than string concatenation. I could not escape the host. The key cannot reach a
response body: every error path returns only a status number, and the three error shapes I fed it echoed
nothing. The testnet path is untouched by the translation (verified live: `/x/46630/smart-contracts/0xf2eD…`
still returns the raw Blockscout REST object), and mainnet without a binding still returns the
`{"error":"upstream"}` envelope.

**Promise 6's first half — the Check page signs nothing and sends nothing.** Verified by reading every
wallet interaction in `web/check.js`. The page never constructs a signer: `rp()` is
`new ethers.JsonRpcProvider(cfg().rpc)` and every question goes through it as `eth_call`, `eth_getCode`,
`eth_getStorageAt`, `eth_getTransaction*` or `eth_simulateV1` with `validation: false`. The single call to
`window.ethereum` is `eth_requestAccounts` behind the "use my wallet" button (`web/check.js:1591`), whose
success message is *"Nothing is signed on this page."* There is no `eth_sendTransaction`, no `personal_sign`,
no `signTypedData` and no `wallet_*` request anywhere in the file; every other occurrence of those strings is
the page *describing* a request someone pasted into it. `simulateInOrder` requires exactly one result per
requested call (`:695`), which is round fifteen's B-04 fix, and it is a real cardinality check rather than a
truthiness one.

**`EXPLORER_API()` on a fork of the page served elsewhere** (asked explicitly in scope item 0).
`web/index.html:446-448` routes to `/x/4663` only when `location.origin.endsWith('gmgnrepeat.com')`, and to
`https://robinhoodchain.blockscout.com/api/v2` otherwise. A fork on any other host, on chain 4663, therefore
asks the mainnet explorer directly; it sends no `Access-Control-Allow-Origin`, so the browser refuses the read,
`explorer()` throws, and every caller's `catch` produces the page's existing honest sentences — *"or the
explorer would not say"*, *"The explorer returned no holders for that address"*. The failure is total rather
than partial, so a fork gets no answer rather than a wrong one. That is the right degradation.

The `endsWith` test is loose — it matches `evilgmgnrepeat.com` as well as `rhairdrop.gmgnrepeat.com` — but the
loose match is harmless in both directions: a fork on such a host would request `/x/4663/…` from **its own**
origin, not from the real Worker, and nothing lets a page served elsewhere reach the real Worker's key. I
would still tighten it to a check on `.gmgnrepeat.com` with the leading dot, or to an exact origin, because a
suffix test that can be satisfied by registering one domain is the kind of thing that is correct until it is
copied somewhere it is not.

**Preflight.** `./preflight.sh` is clean here, and its checks are the right ones: the CSP hash matches the
script, `check.html` carries the *current* `check.js` (a stale copy would hash correctly against itself), the
page/manifest/tests/probes/documents all name the same live BulkSend, and all 15 contract errors reach the
user as a sentence on **both** pages.

---

## Verdict

### Does anything block release?

**Yes — one thing, and it is live in production right now.**

**B-1** — whose root cause, **B-2**, also sits under three other translated paths — means that on Robinhood
Chain mainnet, today,
the deployed Check page tells a user that **every unverified contract has published and matched source**. I
demonstrated it against the live deployment, against real mainnet addresses, and offline against the rendered
Worker. The airdrop page cannot send on mainnet (`LIVE_CHAINS`, and the `{{BULKSEND_MAINNET}}` placeholder),
so no funds move through this path — but Check's mainnet selector is one click away on a page whose entire
purpose is to answer "is this contract safe to sign for", and it answers with the safest possible words on
evidence that does not exist. Against the bar I set at the top, that is a clean failure of point 2, and it is
a failure in the one direction that matters.

**What would have to change for B-1 and B-2 to clear**, in a form checkable later:

1. `mod()` in `deploy/render-worker.py` treats `String(json.status) !== '1'` — or, better, any answer that is
   not the exact success shape each action defines — as `{ ok: false }`, so all four translated paths return
   the `{"error":"upstream"}` envelope instead of a translated void.
2. `is_verified` is derived only from a present, string-valued `ABI` field on a `result[0]` that exists.
3. `test/worker.test.mjs` gains a case per translated path whose upstream is a *verbatim capture of the real
   module API's answer* for the failure being modelled — an unverified chain-4663 contract, and a `NOTOK`
   rate-limit envelope — asserting the envelope or a correct negative, never a positive.
4. `curl -s https://rhcheck.gmgnrepeat.com/x/4663/smart-contracts/0x324f1fddc6df85859e52f43f365d6b06670b74a1`
   no longer answers `"is_verified":true`, and `.../0x8876789976decbfcbbbe364623c63652db8c0904` still answers
   `"is_verified":true` with the `UniversalRouter` ABI.
5. `node test/web/audit-probe-18.mjs` reports R18-1 through R18-5 as `fixed`.
6. The integrity workflow's gate-11 step asserts a non-empty `items` array and a known-negative
   `smart-contracts` answer, rather than the presence of the string `"items"`.

Nothing else I found blocks release. The contract, the ledger, the send path's safety direction, the serving
chain and the evidence gate are in better shape than any of the seventeen prior rounds' reports would lead a
reader to expect, and I say that having tried to break each of them.

### The honest shape of this round

Seventeen rounds have hardened the two things this project started as — a contract and a page — to the point
where I could not find a way to lose funds, pay twice, or be told a transfer happened that did not. The
blocker I found is in the newest code, written after the last review, reviewed by nobody, shipped to
production the same day, and closed as a gate on four positive readings and no negative one. That is not a
coincidence and it is the most useful thing in this report: the process that produced a clean round seventeen
is sound, and the thing that defeated it was code that went live between rounds. If one rule comes out of
this round, it should be that **a gate is closed by reading its failure shapes**.

### Findings, sorted

| | finding | category | shown |
| --- | --- | --- | --- |
| **B-1** | every unverified mainnet contract is translated to `is_verified: true`; Check prints "source published and matched" | **blocks release** | demonstrated, live and offline |
| **B-2** | the same absence-is-an-answer bug in the transaction, holders and NFT-inventory translations | should fix — same root cause and same fix as B-1 | demonstrated |
| B-3 | the NFT inventory ends early on an upstream error and reports itself complete (`truncated: false`) | should fix | demonstrated |
| S-1 | `requestedNftQuantity` and `deliveriesOn` disagree on a multi-id line; Assign silently drops the difference | should fix | demonstrated |
| S-2 | the holder snapshot captures and rechecks nothing across its wait; blends two chains once mainnet is enabled | should fix, **before mainnet** | demonstrated |
| S-3 | the evidence gate does not fingerprint `worker.test.mjs` or `csp-gate.test.sh` | should fix | reasoned |
| S-4 | three regression assertions that pass vacuously or on absence | should fix | reasoned |
| S-5 | "Why it failed" can be today's re-simulation under a heading about the past; B-2 makes it the mainnet default | should fix | reasoned |
| S-6 | round seventeen's S-2 (Assign re-pairs a paired list) is nearer a fund path than the ledger records | should fix | reproduced by R17-2 |
| S-7 | upstream failures are edge-cached for 60s, and a comment claims they are not | should fix | reasoned |
| S-8 | the Blockscout key is in the subrequest URL and therefore in the edge cache key | should fix | reasoned |
| S-9 | no gate covers key-quota exhaustion; the integrity check that looks like it does is satisfied by an empty answer | should fix | reasoned |
| S-10 | gate 12 is not met: the test run, the mid-send re-check and the gas estimate read through the wallet's RPC | should fix | demonstrated |
| S-11 | the load-time reconcile runs before `pickRpc`, so gate 9's fallback does not cover the read that prevents double payment | should fix | reasoned |
| D-1 | three of four rows in `docs/status.md`'s mainnet gate table contradict `plan.md` at the same commit; S-7's description understates it; two disagreeing blocker lists in `plan.md`; gate 11 closed on positive readings only | should fix | verified |
| L-1 | one node is one witness, and gate 9 made it "whichever of three answered first" | inherent limit | — |
| L-2 | a replaced transaction cannot be followed; the timeout message names the rarer cause | inherent limit | — |
| L-3 | a hostile token defeats every check in both directions | inherent limit — already said well | — |
| L-4 | "verified" means source matches bytecode, not that the contract is honest | inherent limit — already said well | — |

### On the open round-seventeen items

The prompt asks whether I disagree that none of S-2, S-5, S-6, S-7, S-10, S-11 is a fund path. I disagree
about two, in degree rather than in kind: **S-2** delivers a different asset than the user's list named, to a
named person, irreversibly, with no dialog and no log line (S-6 above); and **S-7** is not "the snapshot
records the network after its wait" but "the recipient list is assembled from two chains" (S-2 above), which
becomes reachable on the day mainnet is enabled. S-5, S-6, S-10 and S-11 I agree are not fund paths; S-10 I
have re-raised only because B-2 changes how often it fires.

I also agree with the two deliberate declines. Round twelve's S-6 (a returned `false` still reverting the
lenient batch) is right for the reason `for-reviewers.md` gives, and this repository's own `PaysThenLies20`
fixture is the argument. The guard-probe returndata item is a gas path, not an asset path, and rewriting
assembly inside an otherwise-unchanged v13 to clear a non-blocking recommendation would add contract risk to
remove none.
