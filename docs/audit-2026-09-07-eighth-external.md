# Independent correctness, safety, and site-security reaudit

> **Status: every blocking finding in this report is fixed, and every non-blocking one addressed.** Published
> unedited. Eighth external review.
>
> All three blockers were about what a request actually says, and all three are the same underlying error:
> the page was resolving an ambiguity in the input by picking an answer instead of reporting the ambiguity.
> A call inside a `wallet_sendCalls` request has no sender of its own, so a `from` written on one is not
> something any wallet would honour; two `eth_sendTransaction` requests pasted together are a transport group,
> not a sequence; and `atomicRequired: false` permits a wallet to run the batch, run it atomically anyway, or
> refuse it outright, so saying the earlier calls "would still happen" states one of three possibilities as
> fact.
>
> S-01 is the third time a fix of ours has become the next round's finding: the run-keyed lock added in round
> seven let two tabs wait on each other's runs. Reconciliation now happens before the lock is taken.

---

Reviewed commit: `7ce012ec231cfc924381d0d915643e101d84c0d7`

Date: 2026-09-07

## Release bar and verdict

For a public wallet-connected tool handling real value, release-ready means that the exact network, sender,
calls, recipients, amounts, ordering, and execution model described to the user are the ones actually checked
and signed; uncertainty cannot become a false delivery or an invitation to pay twice; every shared-state guard
protects the exact state it names without bypasses or lock cycles; and every byte of signing code served to the
browser is reproducibly derived from reviewed inputs and cannot drift silently. Limits that cannot be engineered
away must be stated beside the decision they qualify.

**Verdict: do not release this commit for real-value use.** Three Check findings block release. A canonical
`wallet_sendCalls` request can be simulated as a sender other than its authoritative envelope sender; separate
legacy JSON-RPC transaction requests can be invented into one ordered sequence; and a non-atomic request is
described as definitely committing calls before a failure even though the wallet may reject it or execute it
atomically. Each can produce an actionable answer that a conforming wallet does not promise.

This is clear progress over the seventh audit. Four of its six blockers are fully cleared, including the
source-to-browser WalletConnect provenance gap. The other two were fixed for their exact regression examples
but not for the general input boundary they were meant to protect. Commit `7ce012e` also fixes the scheduled
runtime-bytecode comparison and pins the three GitHub Actions. Its dirty-tree publication fix is incomplete
because the publisher mutates HTML after performing the check.

The contract remains clean and unchanged since `3700331`; this is another round with no Solidity finding. All
241 tests pass. Live artifacts match this commit, and deployed runtime is byte-for-byte identical to the build.
The mainnet gate is intact: the page enables only chain 46630, there is no code at the intended address on
mainnet, and the testnet deployer's mainnet nonce is `0`. It should remain there while blockers exist.

## Scope and method

I reviewed `7ce012e`, using the seventh-audit remediation commit `c89fe8b` and its six published blockers as
the baseline. Scope included the rewritten Check parser and simulation boundary, delivery ledger and snapshot
binding, WalletConnect build/publication chain, publisher, both workflows, documentation claims,
`src/BulkSend.sol`, tests, and live sites. `lib/` and `src/research/` were excluded as requested.

Evidence included source-level state/concurrency traces; a source-extracted parser demonstration using the
exact function shipped in `web/check.html`; all Forge and Playwright suites; an independent WalletConnect
rebuild; live header, body, and digest checks; local-versus-chain bytecode comparison; the EIP-5792
specification; action commit verification; and checks that `check.js`, inline scripts, CSP hashes, and the
expected connector digest agree. Nothing was signed or sent.

## Previous blocker remediation

| Seventh-audit blocker | Status at `7ce012e` |
|---|---|
| B-01, a run-A lock authorized run-B writes | **Integrity bypass fixed.** `heldRunKey` records the exact key. New nesting creates an availability deadlock for different runs; see S-01. |
| B-02, several `wallet_sendCalls` envelopes were flattened | **Exact case fixed.** Canonical envelopes retain chain, sender, and atomicity. Other top-level JSON-RPC methods still lose their boundary; see B-02. |
| B-03, raw calls ignored the sender box | **Exact case fixed, invariant not fixed.** Raw calls inherit the UI sender. A call-level field can override the canonical sender; see B-01. |
| B-04, an unsimulated member earned an all-calls verdict | **Cleared.** Any entry without a simulatable destination withholds the sequence verdict and keeps indexing. |
| B-05, one snapshot's holdings weighted another | **Cleared.** Collection, chain, approximate block, holdings, and wallets travel together and provenance is shown. |
| B-06, pinned WalletConnect inputs did not reproduce the artifact | **Cleared.** An independent build produced the committed, expected, and live file; CI enforces both equalities. |

## Blocks release

### B-01 — A call-level `from` overrides the authoritative `wallet_sendCalls` sender

- **Severity/category:** High — blocks release
- **Evidence:** Demonstrated with the exact deployed parser and traced into both simulation paths
- **Location:** `web/check.html:1001-1009`, `web/check.html:1068-1075`, and
  `web/check.html:1100-1118`
- **Exact input/state:** Paste:

  ```json
  {
    "jsonrpc":"2.0",
    "id":1,
    "method":"wallet_sendCalls",
    "params":[{
      "chainId":"0xb626",
      "from":"0x1111111111111111111111111111111111111111",
      "calls":[{
        "to":"0x3333333333333333333333333333333333333333",
        "from":"0x2222222222222222222222222222222222222222",
        "data":"0x06fdde03"
      }]
    }]
  }
  ```

  The demonstrated parse keeps A in `requests[0].envelope.from` but B in
  `requests[0].calls[0].from`. Canonicalization again selects `c.from` before `env.from`, so ordered and
  individual simulation run as B.
- **Why execution differs:** The [EIP-5792 call tuple](https://eips.ethereum.org/EIPS/eip-5792) has `to`,
  `data`, `value`, and optional capability metadata, not a per-call sender. When the envelope supplies
  `from`, a wallet must send every call from it. A wallet ignoring the unknown field executes as A; a strict
  wallet rejects malformed input. Neither makes simulation as B valid.
- **User cost:** A hostile destination can return harmlessly for B while using A's balances, ownership, roles,
  or approvals on the real path. Check can show a green sequence even though the wallet's call from A takes a
  value-moving branch, costing A approved assets.
- **Reproduction:** Run the shipped `readInput` on the JSON and inspect envelope/call senders. A browser RPC
  mock then sees B in `blockStateCalls[0].calls[0].from`. The current B-03 test covers only a raw array with
  no call-level sender.
- **Fix/clear condition:** Validate canonical request shape before extraction. If the envelope has `from`, set
  that validated address on every canonical call; reject any conflicting call-level `from`. Add a regression
  asserting every simulated sender is A, or that input is refused before simulation.

### B-02 — Separate top-level JSON-RPC transactions are merged into an invented sequence

- **Severity/category:** Medium — blocks release
- **Evidence:** Demonstrated with the exact deployed parser and traced into ordered simulation
- **Location:** `web/check.html:1013-1031` and `web/check.html:1060-1118`
- **Exact input/state:** Paste:

  ```json
  [
    {"jsonrpc":"2.0","id":1,"method":"eth_sendTransaction","params":[{"from":"0x1111111111111111111111111111111111111111","to":"0x3333333333333333333333333333333333333333","data":"0x06fdde03"}]},
    {"jsonrpc":"2.0","id":2,"method":"eth_sendTransaction","params":[{"from":"0x2222222222222222222222222222222222222222","to":"0x3333333333333333333333333333333333333333","data":"0x06fdde03"}]}
  ]
  ```

  `readInput` unwraps both `params` arrays, gives both calls `envelope:null`, and merges adjacent
  envelope-less results. The demonstration returns one request with two calls, not two requests.
- **User cost:** JSON-RPC batching is a transport group, not one transaction or an ordering/atomicity
  guarantee. Transactions may be mined in another order, have intervening state changes, or use different
  senders. A user can act on a successful invented sequence that describes neither transaction.
- **Reproduction:** Evaluate `window.__check.readInput` with the array. Correct is two request objects; current
  is one request with two calls. A full regression should prove the RPC mock never receives them together.
- **Fix/clear condition:** Preserve each top-level JSON-RPC object as a boundary whenever it has `method` or
  `id`. Support only explicitly understood methods and refuse the rest. Merge only a genuine plain array of
  call objects. Add two-`eth_sendTransaction`, mixed-method, different-sender, and different-chain tests.

### B-03 — Check says earlier calls “would” happen when non-atomic execution does not promise that

- **Severity/category:** Medium — blocks release
- **Evidence:** Reasoned from displayed control flow and the final EIP-5792 specification
- **Location:** `web/check.html:1093-1098` and `web/check.html:1112-1118`
- **Exact input/state:** Paste a valid `wallet_sendCalls` request on chain `0xb626` with
  `atomicRequired:false`, at least two calls, and a second call whose ordered simulation fails. Check says:
  “The calls before it would still happen.”
- **Why unsupported:** EIP-5792 requires order, but with `atomicRequired:false` a wallet may execute
  non-atomically, may execute atomically if able, and may reject a request predicted to fail. In the latter two
  cases the earlier call does not happen.
- **User cost:** The page gives a definite result where only a risk range is known. A user can cancel, alter, or
  rely on a workflow because Check says an earlier approval, transfer, or other change will survive when the
  wallet may commit none of it.
- **Reproduction:** Use the existing ordered-simulation mock with `sequenceFailsAt:1` and
  `atomicRequired:false`; assert the output does not say any call definitely happens. The suite covers the
  same failure only with `atomicRequired:true`.
- **Fix/clear condition:** State the range: if the wallet executes non-atomically and submits through this
  point, earlier calls may already have happened; it may instead reject the request or execute atomically, in
  which case none happen. Add a regression.

## Should be fixed but does not block release by itself

### S-01 — Different active sends can deadlock while reconciling each other's runs

- **Severity/category:** Medium — should be fixed but does not block
- **Evidence:** Source-level two-tab lock trace
- **Location:** `web/index.html:1426-1513`, `web/index.html:1527-1545`, and
  `web/index.html:1792-1816`
- **Exact state:** Tabs A and B use different run keys and each holds its long-lived send lock. Pending storage
  contains a confirmed entry for each. While holding its lock, each calls `reconcilePending(false)`, which
  walks every run. A waits for B's lock while B waits for A's.
- **User cost:** This reproduction occurs before a new send, so it causes no false ledger write or payment.
  Both sends hang until a tab closes; unrelated stale pending work can block a run.
- **Reproduction:** Seed confirmed A/B pending records, open two tabs configured for A/B, pause receipt reads
  until both locks are held, then release and press Send. The current B-01 test proves only raw Web Lock
  exclusion; it never exercises application reconciliation or a two-key cycle.
- **Fix:** Reconcile globally before acquiring a send lock, or reconcile only `lockedRun` inside it while
  background reconciliation acquires one key at a time. Do not acquire one run lock while holding another
  absent a global ordering.

### S-02 — The publisher activates the new Worker before publishing its connector origin

- **Severity/category:** Medium — should be fixed but does not block
- **Evidence:** Source-level deployment-order trace; current deployment is healthy
- **Location:** `deploy/publish.sh:115-130`, `deploy/publish.sh:189-197`, and
  `deploy/local.env.example:12-16`
- **Exact state:** Change `web/wc.js` and its expected digest while `WC_BUNDLE_URL` serves old bytes. The
  script deploys a Worker containing the new digest first, then invokes `ORIGIN_PUBLISH_CMD`; that interface
  receives only the page path and target name, not connector or digest.
- **User cost:** Integrity fails closed, so altered code is not served. `/wc.js` returns 502 between steps and
  remains unavailable if origin publication fails, stranding phone-wallet connection until repaired.
- **Reproduction:** On staging leave H1 at the connector URL, build H2, and pause/fail the origin command after
  the Worker PUT. `/wc.js` returns 502 because H1 does not match H2.
- **Fix:** Publish `wc.js` to an immutable digest-addressed origin first, fetch and verify it, then activate
  the Worker. Pass connector path and digest explicitly; keep or restore the previous Worker on later failure.

### S-03 — An invalid canonical chain ID is treated as no chain restriction

- **Severity/category:** Low — should be fixed but does not block
- **Evidence:** Demonstrated in parser/control flow
- **Location:** `web/check.html:1078-1087`
- **Exact input/state:** Use `"chainId":"0xb626zz"`. `BigInt` throws, `want` becomes `null`, and the
  network-refusal branch is skipped; Check simulates on the selected network.
- **User cost:** A conforming wallet should reject malformed input, so no executable value-moving path was
  shown. Check can still give a confident current-chain answer to input whose network is unreadable.
- **Reproduction:** Submit that envelope and assert no simulation RPC is sent. Current code sends one.
- **Fix:** Require canonical hexadecimal EIP-155 form when `chainId` is present. Validate
  `atomicRequired` as a boolean rather than coercing arbitrary truthy values.

### S-04 — The dirty-tree guard permits the publisher itself to create uncommitted HTML

- **Severity/category:** Medium — should be fixed but does not block
- **Evidence:** Source-level publication trace; current files are synchronized
- **Location:** `deploy/publish.sh:44-57` and `deploy/publish.sh:62-91`
- **Exact state:** Commit an inline-script edit without updating its CSP meta hash, leaving a clean checkout.
  The new guard passes. The next step rewrites tracked HTML to repair the hash, then uploads and verifies the
  rewritten working-tree bytes.
- **User cost:** Production can contain bytes absent from the reviewed commit while live/local comparison
  passes. The six-hour monitor should eventually notice, leaving an exposure window.
- **Reproduction:** In disposable staging, commit a one-byte script change but keep the old meta hash, then
  publish. The script reports its correction but continues, deploying the now-dirty file rather than `HEAD`.
- **Fix:** Keep publishing read-only: fail on a stale hash or artifact differing from the target commit.
  `web/sync.sh` should generate changes before review/commit. Recheck cleanliness before the Worker PUT.

### S-05 — The push workflow labels a length print as deployed-bytecode equality

- **Severity/category:** Low — should be fixed but does not block
- **Evidence:** Workflow inspection; scheduled equality check independently verified
- **Location:** `.github/workflows/tests.yml:22-29` and `.github/workflows/integrity.yml:9-12,76-92`
- **Exact state:** Commit a bytecode-changing source edit without deploying. The push/PR step named “the
  deployed bytecode is what this source builds” only prints local length and stays green. The scheduled
  integrity job now correctly compares bytes, but is not triggered by the push.
- **User cost:** Ownerless deployed code does not change, but a green push can be read as immediate deployment
  equality when that assertion has not run; scheduled detection may be six hours later.
- **Reproduction:** Run the `tests.yml` step with a bytecode-changing edit. It reads neither deployment file
  nor RPC.
- **Fix:** Rename the step, or share the exact comparison and trigger it when equality is expected. The
  scheduled comparison itself is sound.

### S-06 — Some workflow inputs remain mutable despite pinned action commits

- **Severity/category:** Low — should be fixed but does not block
- **Evidence:** Supply-chain configuration review
- **Location:** `.github/workflows/tests.yml:17-19,30-36`
- **Exact state:** Action references are legitimate pinned commits, but Foundry is requested as moving
  `stable`, Node as moving major `22`, and root browser installation uses `npm install` rather than
  lockfile-enforcing `npm ci`.
- **User cost:** Workflows have only `contents:read` and no production secrets, so no route to Cloudflare or
  wallets was found. Cost is non-reproducible or falsely green/failed assurance.
- **Fix:** Pin a Foundry release/checksum, consider exact Node patch pinning, and use `npm ci`.

### S-07 — Public review-history pointers are stale and contradictory

- **Severity/category:** Low — should be fixed but does not block
- **Evidence:** Documentation inspection
- **Location:** `README.md:191-200` and `SECURITY.md:42-46`
- **Exact state:** README says five external audits, then describes six and says all six are in `docs/`, while
  seven are present. Security calls the first external audit “the last audit in full.”
  `docs/for-reviewers.md` has the accurate seven-audit list.
- **User cost:** Someone following Security can stop at the oldest report and miss six later rounds and their
  threat-model changes. The accurate reviewer guide limits the harm.
- **Fix:** Point README and Security to the reviewer guide plus seventh audit; keep the count in one place.

### S-08 — Arbitrary live HTTPS 404 responses omit HSTS and bypass the Worker hardening headers

- **Severity/category:** Low — should be fixed but does not block
- **Evidence:** Demonstrated against both live hosts; the repository Worker would produce different headers
- **Location:** Live routing for both hosts; intended repository behavior is `deploy/publish.sh:181-183`
- **Exact input/state:** Request `https://rhairdrop.gmgnrepeat.com/not-found` or
  `https://rhcheck.gmgnrepeat.com/not-found`. Both return a Cloudflare HTML 404 with no HSTS, `nosniff`,
  referrer policy, or COOP. By contrast, `https://rhcheck.gmgnrepeat.com/wc.js` reaches the Worker, returns its
  plain-text 404, and carries all four headers. Plain HTTP on every tested path does still return a same-path
  301 to HTTPS.
- **User cost:** A first authenticated visit to a nonexistent path does not prime HSTS, contradicting the
  “every response” promise and leaving that browser's later first HTTP navigation dependent on the redirect.
  Missing HSTS does not remove an already stored policy, so this is not a current page-replacement path.
- **Reproduction:** Compare `curl -sSI https://rhairdrop.gmgnrepeat.com/not-found` with
  `curl -sSI https://rhcheck.gmgnrepeat.com/wc.js`. The former has `content-type:text/html` and no hardening
  headers; the latter is the Worker's hardened plain-text 404.
- **Fix:** Route all paths on both custom domains through the Worker, or set HSTS and the common hardening
  headers at a zone rule that also covers Cloudflare-generated errors. Add root, `/wc.js`, and arbitrary-404
  checks for both hosts to the external integrity workflow.

## Inherent limits and required wording

### I-01 — Browser-local duplicate protection is not a payment registry

`localStorage` cannot coordinate another profile, device, origin, cleared cache, or restored backup. Current UI
and README disclose this. Keep wording beside Send/release: “This browser's record prevents accidental repeats
here; the chain/explorer is the cross-device record.” A global guarantee needs a shared service or on-chain
state.

### I-02 — A token supplies evidence about its own state and events

Before/after holdings and receipt events are strong evidence for conventional tokens, but hostile code can lie
in `ownerOf`/`balanceOf`, emit false events, accept a call while moving less/nothing, or let an unrelated
concurrent balance change resemble arrival. Keep: “The token reports this balance/event; an untrusted token can
lie. Verify the transaction and actual asset state.”

### I-03 — Explorer holder reads are not block-pinned snapshots

RPC block numbers surrounding pagination do not prove which block the explorer indexed. It can lag, omit pages,
or change mid-read. Prefer “the explorer's latest indexed holder list” to “current holders,” and keep the warning
that exported allocation must be reviewed even if the two RPC block numbers match.

### I-04 — Check cannot prove intent or future execution state

Simulation describes one sender and one present chain state. Time, balances, approvals, earlier transactions,
builders, and upgradeable implementations can change before execution. Verified source and familiar selectors
do not prove intent. The page generally says this well; B-01/B-02 matter because those warnings only help if
simulation first represents the request.

### I-05 — No HSTS preload leaves a first-visit downgrade window

HSTS protects after a first authenticated HTTPS response. Without preload, an initial manually typed HTTP
request on a hostile network can be intercepted before redirect/header. Preload is registrable-domain-wide and
hard to reverse, so I agree it is not a blocker. Publish HTTPS-only links; reconsider only if all current and
future subdomains can meet the commitment.

## Areas examined and found sound

- **BulkSend:** 82/82 Forge tests pass. Entry points are nonpayable; no owner, upgrade, fee, rescue, or persistent
  state exists. Transfers originate from `msg.sender`; strict mode is atomic; lenient mode never labels an
  ambiguous ERC-20 return a skip; gas/revert-data griefing is bounded; transient reentrancy protection prevents
  receipt-event injection. No Solidity issue found.
- **Delivery accounting apart from S-01:** Unreadable, short, or missing results remain unsettled; duplicate
  ERC-20/ERC-1155 recipients are grouped; reload settlement uses matching token events; BulkSend summaries and
  skipped tuples are cross-checked; each pending batch has its own key; delivered writes are reread before a
  pending record shrinks. The old wrong-lock authorization is gone.
- **All-or-nothing/list fidelity:** Strict mode cannot silently split a wallet batch or omit predicted failures.
  Quantities stay integer at token precision; bad lines require acknowledgement; duplicate occurrence keys stay
  distinct; settled order and transaction boundaries are shown/downloadable before confirmation.
- **Snapshot provenance:** Collection, chain, approximate block, wallet set, and holdings form one object.
  Collection/network changes invalidate it. Failed refresh can leave an older snapshot visible, but its old
  provenance stays displayed and failure is logged.
- **Check read-only boundary:** Check requests an account only on “Use mine.” It has no signing,
  `eth_sendTransaction`, `wallet_sendCalls`, approval, or state-writing RPC. Untrusted text stays text,
  external links use `noopener`, unreadable code/source remains unknown, and incomplete sequences withhold the
  all-calls verdict.
- **WalletConnect provenance:** Independent build produced 2,092,782 bytes and SHA-256
  `d4c35a1b2b743b9f48b781730b171942a31d1b82d992b5d2dbb082b3843064d7`, exactly matching
  `web/wc.js`, `EXPECTED-SHA256`, and live `/wc.js`. CI rebuilds and compares. Worker cache key carries
  the digest and fetched bytes are hashed before service, so drift fails closed.
- **Live identity:** Airdrop SHA-256 is `f17b4441…e301`; Check is `a775d0b2…a513`; connector is the digest
  above. All live bodies exactly match source. `web/check.js` equals the inline script after its enclosing
  newline.
- **Runtime:** Local and testnet runtime are both 8,164 bytes and equal. SHA-256 of actual bytes is
  `a7c05392fa894bcd6ce00eb2930e61f67ca85c9d7109a2b34d983aa213c66db7`.
- **Transport/CSP:** HTTP gives same-host 301 on root, `/wc.js`, and arbitrary paths. Both pages and the live
  airdrop `/wc.js` return HSTS
  (`max-age=31536000; includeSubDomains`). CSP is header plus meta, grants no script `unsafe-inline`, and
  exactly equals the meta policy plus `frame-ancestors 'none'`; its sole inline-script hash recomputes exactly.
  Ethers 6.13.4 has SRI. S-08 records the narrower error-route HSTS gap. Per the brief,
  `static.cloudflareinsights.com` is treated as deliberate and not re-reported.
- **Workflows:** Scheduled integrity now compares exact runtime bytes. All three action SHAs belong to their
  claimed official repositories. Both workflows grant only `contents:read`; neither contains a deploy step,
  production credential, or wallet key. S-05/S-06 affect assurance, not live control.
- **Accepted dependency result:** Connector contains no `axios`, `form-data`, `follow-redirects`, or
  `proxy-from-env` string/code. Unused build-graph advisories are not re-reported.
- **Mainnet gate:** `LIVE_CHAINS` contains only 46630. Deployer mainnet nonce is `0x0`; code at the intended
  mainnet address is `0x`.

## Site-security conclusion

No repository-level route was found for a GitHub reader or pull request to replace the connector, connection
target, or transactions served to users. Changed connector-origin bytes cannot substitute JavaScript because
the Worker verifies SHA-256; mismatch gives 502. Exact live files, HTTPS redirect, HSTS, header CSP, inline
hashes, ethers SRI, pinned action identities, and read-only workflow permissions are real controls.

Remaining rewiring routes are control-plane compromise (out of scope), deliberate deployment of different page
bytes, or compromise of an allowed executable dependency plus delivery path. S-04 weakens the claim that an
ordinary repository publisher only ships a commit, but is not evidence of current takeover. Because all three
Check blockers are live, keep this report private until deployed fixes exist.

## Verification record

| Check | Result |
|---|---|
| `forge test` | 82 passed, 0 failed, 0 skipped |
| `npm test` | 159 passed (83 airdrop + 76 Check), 0 failed |
| Focused parser harness | B-01 and B-02 reproduced on shipped `readInput` |
| WalletConnect independent rebuild | exact: 2,092,782 bytes, `d4c35a1…064d7` |
| Local vs deployed runtime | exact: 8,164 bytes |
| Live airdrop / Check / connector | exact source matches |
| HTTP / HSTS | same-host 301 on all tested paths; HSTS on roots and airdrop `/wc.js`; missing on arbitrary HTTPS 404s (S-08) |
| CSP inline hashes | both exact; no script `unsafe-inline` |
| Workflow action identities | three pinned SHAs verified in claimed official repositories |
| Mainnet gate | deployer nonce 0; intended address empty; UI disabled |

## Test-suite assessment

The suites are substantive, but their new tests demonstrate the difference between an example and an invariant:

1. B-01 lock test checks only that Web Locks excludes a second holder. It misses the A-waits-B/B-waits-A cycle.
2. B-02 tests use only `wallet_sendCalls`; they do not preserve general JSON-RPC request boundaries.
3. B-03 sender test uses a raw list without a per-call sender. It never tests envelope/call conflict.
4. Ordered failure covers only `atomicRequired:true`, not false's weaker guarantees.
5. B-04 correctly asserts the missing-destination warning and absence of a green all-calls verdict.
6. Snapshot tests cover provenance and collection invalidation. Network-change/failed-refresh tests would help,
   although no false relabelling path was found.
7. Connector CI now performs the missing rebuild and two digest comparisons, closing the prior gap.

Additional gaps: no publication test covers a clean-but-stale-CSP commit; no staging test covers connector
rollout failure; the push workflow's equality-named step does not compare deployment bytes; integrity checks
HSTS only on roots, missing both the connector and arbitrary-error coverage in S-08; CI does not assert
`web/check.js` equals the inline script after sync.

## Acceptance checklist for the next audit

Release blockers clear when:

- A canonical request's validated envelope sender becomes every call's effective sender, or conflicting
  non-schema fields cause refusal before simulation. The mocked RPC payload must prove it.
- Every top-level JSON-RPC request keeps its method/id boundary. Two `eth_sendTransaction` requests never
  share ordered simulation/verdict; unsupported methods are refused.
- A non-atomic request never receives a definite claim that earlier calls execute. Wording and regression cover
  atomic execution, wallet refusal, and non-atomic partial execution as possibilities.

Then rerun all 241 tests, three adversarial Check cases, WalletConnect rebuild, live body/header/digest checks,
runtime equality, and mainnet gate. Add the two-run deadlock test before calling keyed-lock remediation
operationally complete. Do not move the mainnet nonce while a blocker remains.
