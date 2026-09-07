# Independent correctness and safety audit

> **Status: every finding in this report is fixed.** Published unedited. Sixth external review, and the first
> asked to state a release bar and to sort findings into blocks-release, should-fix, and inherent-limit. That
> sorting is why this one was the most useful of the six.
>
> The two release blockers about the ledger had one root cause: recovery and Review changed what a run had
> delivered without holding that run's lock, and could delete the pending record even when the delivered write
> had failed. There is now a single locked commit step that re-reads, merges, writes, reads back, and only
> then shrinks or drops the pending record. Nothing else touches the ledger.
>
> I-01 is not fixed and cannot be: a token can emit events it did not honour and return whatever it likes from
> its own read methods. What changed is that the page now says which kind of evidence it used, every time, and
> links the transaction.

---

Reviewed commit: `84f0314f19f1992a424c7f4879bc72379661b582`

Date: 2026-09-06

## Release bar

**Do not ship this commit as the supported public release yet.**

The fifth-audit changes materially improve arrival handling: unreadable and short balance results are no longer treated as delivered, repeated fungible recipients are aggregated, receipt reconciliation retains unresolved rows, canonical `wallet_sendCalls` envelopes are recognized, beacon lookup failure clears stale proxy state, and batch Check results now carry most of the single-call warnings. The plain test suites pass, but four remaining paths can still produce a false safety conclusion or lose the only durable record that prevents a duplicate transfer.

Release classification:

- **Blocks release:** B-01 through B-04.
- **Should fix, but does not independently block release:** S-01 and S-02.
- **Inherent browser/untrusted-contract limit:** I-01. This needs precise disclosure rather than a claim that it can be eliminated.

## Scope and method

I reviewed the current commit and its delivery-ledger changes relative to the preceding audit commit, then traced the airdrop state machine, Check parsing/simulation paths, Solidity contract, deployment machinery, and relevant tests. I excluded `lib/` and `src/research/` as directed. Evidence consisted of source-level control-flow and storage analysis, adversarial interleavings, a headless-Chromium parser reproduction, the plain Forge/browser suites, read-only live-host byte comparisons, a read-only RPC runtime comparison, and explorer metadata. No wallet was connected, nothing was signed, and no transaction was sent.

## Findings

### B-01 — Review can delete pending rows after the delivered-ledger write failed

- **Severity:** High
- **Classification:** Blocks release
- **Evidence method:** Direct source tracing and a deterministic storage-failure scenario
- **Location:** `web/index.html:991-1015` (Review handler) and `web/index.html:1435-1445` (`writeDeliveredFor`)
- **Trigger:** Open Review for a pending run, let the arrival check classify one or more rows as arrived, and make the delivered-ledger `localStorage.setItem` fail or be mutated before its readback. Quota exhaustion, browser storage rejection, or hostile/same-origin interference is enough. If all rows are classified arrived, Review drops the pending entry immediately; if only some arrived, approving release of the rest also drops it.
- **Consequence/cost:** The row can exist in neither the delivered ledger nor the pending journal. The next run can send it again. Cost is the duplicated token amount/NFT plus gas; the UI may also have logged that the arrival was confirmed even though durable duplicate protection was not recorded.
- **Minimal reproduction:**
  1. Seed a pending entry whose NFT is already owned by the intended recipient.
  2. Fill the origin's storage quota after that pending entry exists, so expanding the corresponding delivered-ledger key fails.
  3. Open Review.
  4. Observe that `writeDeliveredFor` returns false but the return value is ignored and the pending key is deleted.
  5. Reload the same distribution and observe that the row is eligible again.
- **Fix:** Treat the delivered write and verified readback as a prerequisite for deleting or shrinking pending state. If it fails, keep every affected row pending, show a blocking error, and do not offer release for those rows in that pass. Add a browser test that forces `setItem` failure and another that mutates the value between write and readback.

### B-02 — Recovery and Review mutate the delivered ledger outside the per-run lock

- **Severity:** High
- **Classification:** Blocks release
- **Evidence method:** Cross-path concurrency analysis of the read-modify-write storage helpers and Web Lock coverage
- **Location:** `web/index.html:1660-1676` (`runSend` lock), `web/index.html:367` and `web/index.html:2019` (unlocked reconciliation callers), `web/index.html:991-1022` (unlocked Review), `web/index.html:1344-1430` (`reconcilePending`), and `web/index.html:1435-1445` (`writeDeliveredFor`)
- **Trigger:** Two tabs, or one tab's automatic reconciliation overlapping another tab's send/review, update the same run ledger. Only `runSend` holds `bulksend:<runKey>`; recovery and Review do not. Each helper reads the old set, writes its own union, and verifies only its own immediate result.
- **Consequence/cost:** A lost update can remove a legitimately delivered row from the final ledger while both operations report success and delete their pending entries. A later run can duplicate that row. Cost is the duplicated token amount/NFT plus gas.
- **Minimal reproduction:**
  1. Start with an empty delivered set for run R and two pending entries A and B for R.
  2. Pause two tabs after both have read the empty set.
  3. Let Review write B and pass its readback; then let reconciliation/send write A from its stale snapshot and pass its readback.
  4. Let both paths delete their pending keys.
  5. The final delivered set contains only A; B is eligible for a future resend.
- **Fix:** Put every mutation of a run's delivered ledger and corresponding pending deletion under the same per-run Web Lock. Inside the lock, re-read both records, merge, write, verify, and only then delete or shrink pending. If Web Locks are unavailable, fail closed or use a storage transaction/lease protocol with ownership and expiry; a plain last-write-wins `localStorage` union is insufficient. Add deterministic interleaving tests for send/reconcile, send/review, and review/review.

### B-03 — Check discards a canonical request's chain ID

- **Severity:** High
- **Classification:** Blocks release
- **Evidence method:** Chromium execution of `readInput` with a canonical EIP-5792 request, followed by source tracing
- **Location:** `web/check.html:979-999`, `readInput` / `unwrap` handling of `wallet_sendCalls`
- **Trigger:** Paste a canonical request whose envelope has `chainId` and `atomicRequired`, while Check's network selector is set to a different network. The unwrapped calls retain only `to`, `data`, `from`, and `value`.
- **Consequence/cost:** Check can inspect code, ABI, proxy state, balances, and simulations on the wrong chain and present a reassuring answer about a different contract. A benign or empty testnet address can mask a dangerous mainnet target at the same address. The request's atomicity requirement is also hidden from the analysis.
- **Minimal reproduction:** Evaluate `readInput` with:

  ```json
  {
    "method": "wallet_sendCalls",
    "params": [{
      "version": "2.0.0",
      "chainId": "0x1237",
      "from": "0x1111111111111111111111111111111111111111",
      "atomicRequired": true,
      "calls": [{
        "to": "0x1111111111111111111111111111111111111111",
        "data": "0x06fdde03"
      }]
    }]
  }
  ```

  The parsed result is a call containing the address, calldata, and sender but no chain or atomicity metadata. Leaving the selector on testnet therefore checks the wrong chain without a mismatch warning.
- **Fix:** Preserve and display envelope metadata. Reject analysis until the selected chain exactly matches the request's normalized `chainId`, or switch only after explicit user confirmation. Carry `atomicRequired` into the report and test both matching and mismatching decimal/hex chain IDs.

### B-04 — Check simulates batch calls independently, not in their specified order

- **Severity:** High
- **Classification:** Blocks release
- **Evidence method:** Source tracing against the [EIP-5792 ordered-call requirement](https://eips.ethereum.org/EIPS/eip-5792) and a state-dependent counterexample
- **Location:** `web/check.html:701-718` (`simulate`) and `web/check.html:1027-1069` (batch branch in `go`)
- **Trigger:** Paste a multi-call `wallet_sendCalls` request in which an earlier call changes state used by a later call. Check invokes `eth_simulateV1` separately for each call against the same starting state.
- **Consequence/cost:** Every isolated call can appear to succeed while the real ordered batch reverts or has materially different effects. With `atomicRequired: true`, one later failure can revert the whole batch; with non-atomic execution, the displayed logs/effects can still be wrong. This defeats the tool's main safety purpose for batches.
- **Minimal reproduction:** Use two calls for the same NFT: call 1 transfers it from the current owner to Alice, and call 2 transfers it from that current owner to Bob. Against the initial state, both isolated simulations can succeed. Executed in order, call 2 fails because ownership changed; an atomic batch reverts both.
- **Fix:** Submit the full ordered calls array in one `eth_simulateV1` request and map the returned results back to their indices. Preserve the request's atomicity metadata and clearly distinguish atomic from non-atomic outcomes. If ordered simulation is unavailable, do not label isolated results as a batch verdict; show an explicit limitation and fail closed for the safety summary. Add a mocked state-dependent ordered-batch test.

### S-01 — Airdrop silently falls back to weaker isolated preflight during sending

- **Severity:** Medium
- **Classification:** Should fix, but does not independently block release
- **Evidence method:** Source tracing of `preflight(verbose)` and the automatic send path
- **Location:** `web/index.html:1564-1604` (wallet preflight) and `web/index.html:1684-1690` (automatic send preflight)
- **Trigger:** `eth_simulateV1` is unsupported or errors. The automatic send path calls `preflight(false)`, suppresses the ordered-simulation warning, and continues using isolated `eth_call` checks.
- **Consequence/cost:** A state-dependent failure can be missed. An atomic wallet batch may then revert, wasting gas and preventing otherwise valid rows from being sent. The behavior is conservative with respect to partial token loss, so this is below the release-blocking duplicate-transfer findings.
- **Minimal reproduction:** Mock ordered simulation to reject, make each isolated call succeed against the initial state, and make the second call fail after the first call's state change. Start Send and observe no visible downgrade warning before submission.
- **Fix:** Surface the downgrade during the actual send flow and require an explicit decision before continuing, or fail closed for atomic batches. Add a browser test covering unavailable ordered simulation with isolated-success/ordered-failure behavior.

### S-02 — Batch Check suppresses simulation errors and can misreport inherited sender context

- **Severity:** Medium
- **Classification:** Should fix, but does not independently block release
- **Evidence method:** Batch/single rendering comparison and source tracing
- **Location:** `web/check.html:900-930` (`callWarnings`) and `web/check.html:1027-1069` (batch loop)
- **Trigger:** A batch call's simulation throws, or a canonical request supplies `from` on the outer envelope while the separate sender input is blank.
- **Consequence/cost:** The batch row can omit the fact that simulation failed. It can also show “Nobody named as sender” even though the canonical envelope did name one, because warning generation uses the sender input rather than the call's inherited `from`. These are misleading omissions/false warnings, but they are conservative rather than an authorization bypass.
- **Minimal reproduction:** Mock `eth_simulateV1` to reject for one batch call and inspect its row; no explicit simulation-failure badge appears. Separately paste an outer-`from` canonical request with a blank sender field and observe the missing-sender warning.
- **Fix:** Carry a structured simulation error into each result and render it with the same prominence as the single-call path. Pass `from || c.from` (with a clearly defined precedence rule) into warning generation. Add parity tests for both cases.

### I-01 — A hostile token can make both events and read methods lie

- **Severity:** High impact, not fully eliminable in a static browser tool
- **Classification:** Inherent browser/untrusted-contract limit
- **Evidence method:** Adversarial contract-model analysis
- **Location:** `web/index.html:1196-1232` (post-state reads), `web/index.html:1253-1295` (receipt-event evidence), and `web/index.html:1411-1424` (reconciliation wording)
- **Trigger:** A token deliberately emits plausible `Transfer`/`TransferSingle` events without implementing the corresponding state change, or returns fabricated values from `balanceOf`/`ownerOf`.
- **Consequence/cost:** The browser can record an unpaid row as delivered, suppressing a needed retry, or present a paid row as unconfirmed, leaving the operator to make a manual release decision from untrustworthy evidence. Releasing the latter can duplicate a real payment. No client-only combination of those same untrusted signals proves economic ownership.
- **Minimal reproduction:** Deploy a token whose transfer entry point emits a matching event but leaves storage unchanged, and whose read method returns attacker-selected data. Reconcile the receipt or run the arrival check.
- **Mitigation:** Keep this explicitly disclosed as a trust boundary. Change “confirmed at their destination” for event-only recovery to “the token emitted a matching event in this transaction,” show whether confirmation came from an event or a later read, and link the explorer transaction. For stronger assurance, require known token implementations/indexers or independent post-state evidence, while acknowledging that an adversarial token can still defeat its own interface semantics.

## Remediation ledger

The newest commit correctly addresses the previously reported mechanics below:

- Unreadable balance/owner calls and short ABI responses now become **unknown**, not delivered.
- Fungible arrival checks aggregate required deltas for duplicate recipient rows.
- Unsettled receipt/reload recovery retains unresolved rows rather than treating receipt success as delivery.
- Receipt reconciliation matches standard token transfer events to rows.
- Canonical `wallet_sendCalls` envelopes are unwrapped.
- Failed beacon implementation lookup clears stale target/ABI state.
- Batch Check rows now include proxy/read/raw-data warning categories.
- Capability detection accepts a legitimate all-chain `0x0` response.
- HTTP 500 explorer responses no longer masquerade as verified source.

Those fixes are not sufficient for release because B-01/B-02 can still erase duplicate-prevention state, and B-03/B-04 can still make Check answer a materially different question from the pasted request.

## Areas reviewed and currently sound

- The Solidity batcher remains non-payable, non-upgradeable, and has no owner/admin withdrawal path.
- Transfers are sourced from `msg.sender`; strict entry points roll back on any row failure.
- Lenient entry points bound forwarded gas and copied revert data, expose per-row failures, and use transient reentrancy protection.
- Ambiguous ERC-20 return values fail closed.
- NFT/token-type mismatch paths are covered by contract tests.
- Browser rendering uses text nodes for untrusted content and third-party assets retain integrity attributes.
- The airdrop send path holds a per-run Web Lock and re-checks the ledger after acquiring it.
- Strict multi-transaction sending remains disabled; wallet batches request atomic execution.
- Nothing in the audited UI signs or broadcasts automatically; submission still requires the connected wallet.

## Verification

- `forge test`: **82 passed, 0 failed**.
- `npm test`: **140 passed, 0 failed** (74 airdrop tests and 66 Check tests).
- Live `https://rhairdrop.gmgnrepeat.com/` is byte-for-byte identical to `web/index.html` at SHA-256 `e943b9bcab3a1e1c95cae26b01348cbd0fe0542987adfb203e5535b114a1cb69`.
- Live `https://rhcheck.gmgnrepeat.com/` is byte-for-byte identical to `web/check.html` at SHA-256 `c6bfd3729a39fc48f2f9e7297b68665b177e6ddcac27eb1ca4d61eb568b2fcf6`.
- Live `https://rhairdrop.gmgnrepeat.com/wc.js` is byte-for-byte identical to `web/wc.js`. Its SHA-256, `050632a7350b82f6c490631bfd4b167176eac36da3d38ec3cc7c6465e9a9c6b8`, also exactly matches `web/wc-build/EXPECTED-SHA256`.
- Testnet runtime at `0x91949D7328387A3613b29E56f6979Ae893ccd23C` is byte-for-byte identical to the local `BulkSend` deployed bytecode: **8,164 bytes**.
- The testnet explorer reports `BulkSend` as fully verified, not partially verified, from `src/BulkSend.sol`, compiled with Solidity `0.8.36`, optimizer 10,000 runs, Cancun EVM.

These deployment checks are point-in-time correspondence checks. The live host, RPC response, and explorer metadata can change after this report.

## Test-suite assessment

The suite has good coverage of ordinary transfer behavior and the fifth-audit regressions, but the release blockers sit at cross-path boundaries not exercised today:

- no forced storage-write/readback failure in Review;
- no deterministic interleaving of Review or reconciliation with another ledger writer;
- no wrong-chain canonical request test;
- no state-dependent ordered-batch Check test.

The suite should assert durable postconditions, not only log text: after every recovery/review outcome, each row must be in exactly one safe state—durably delivered or still pending—unless the user explicitly releases it after fully visible evidence.
