# Third external review: transaction boundaries, receipts, calldata completeness and publication

Reviewed commit: `73f1aba`. Published unedited.

> **Status: every finding here is fixed, in v9 and the pages published with it.**
>
> A note on what this pass reviewed: the workspace it was given had not been updated after the second round of
> fixes, so it read `73f1aba` and correctly reported that the earlier findings were still present in what it
> could see. They were fixed in `ba738c7`. That was a setup mistake on our side, not a finding, and it does not
> affect the five new findings below, which were all genuinely open.
>
> The one worth reading first is T-H-01: a recipient's receive hook could call BulkSend again and write
> convincing events into the receipt the client reads, so a wallet that had just been paid could be recorded as
> skipped and paid a second time. It was reproduced before it was fixed.

## Third-pass addendum

This section records an independent adversarial pass over transaction boundaries, receipt interpretation,
calldata completeness and the publication path. It supplements rather than replaces the findings above.

### Remediation status at the start of this pass

There was no remediation delta to review in this checkout. `HEAD`, `origin/main` and the reviewed commit were
all still `73f1aba2dc8a79951c642cb52c1e56f25a57aa8a`; `git status --short` contained only the untracked
`AUDIT.md`. Thus every original finding remained present in the source at the time of this pass. The new
findings below are additional release blockers, not regressions attributed to an unseen fix branch.

### T-H-01 -- High -- Reentrant calls can inject genuine BulkSend events and make a paid ERC-1155 row retryable

**Status:** Reasoned from source. The existing reentrancy test establishes only that a recipient which owns
nothing cannot steal a sender's NFT; it does not test the client-visible event stream.

**Location:** `src/BulkSend.sol:115-150`, `src/BulkSend.sol:178-210`, `src/BulkSend.sol:239-278`;
`web/index.html:1006-1030`, `web/index.html:1299-1313`.

**Trigger:** Send one ERC-1155 row safely to a hostile receiver. During `onERC1155Received`, the receiver calls
a lenient `...WithGas` BulkSend entry point against a reverting token contract, using the outer row's recipient,
ID and amount. That nested call legitimately emits `Skipped` and an `Airdrop...` summary from the same
BulkSend address, then returns. The receiver accepts the original transfer, which succeeds, and the outer call
emits its own summary.

`readBatchReceipt` trusts every parseable event whose emitter is BulkSend. It does not require the `Skipped`
event's `token` to be the selected token, does not require exactly one summary with the expected event type,
token and sender, and does not require `sent + skipped == chunk.length`. For a one-row outer batch it can
therefore return `sent = 1`, `skipped = 1`, `ambiguous = false`, and an empty `delivered` list. The arithmetic
impossibility is not noticed.

**Cost:** The receiver has already received the ERC-1155 amount, but the browser drops the pending record,
does not mark the row delivered, and includes it in the skipped/retry list. A later send can pay the hostile
receiver a second time. This violates the ledger's central no-double-payment guarantee using real events, not
forged log addresses.

**Reproduction:** Add an ERC-1155 receiver which, from its hook, invokes
`airdrop1155WithGas(revertingToken, [address(this)], [outerId], [outerAmount], true, MIN_GAS)` and then returns
the correct receiver selector. Record the receipt and pass its logs plus the one outer row to
`readBatchReceipt`. Assert that the outer token balance moved, while the parser classifies that row as skipped
and non-ambiguous. The existing `Reenter` fixture at `test/RealTokens.sol:118-130` is not this test: its inner
strict call reverts and consequently leaves no nested events.

**Fix:** Make all airdrop entry points non-reentrant, and independently harden receipt parsing. Require exactly
one summary of the expected standard, after filtering on the selected token and original sender; reject any
additional BulkSend summary; validate every `Skipped.token`; and require summary counts, matched skips and
chunk length to agree before dropping pending state. Add both a Foundry receiver test and a browser receipt
test. Defense in both layers matters because older deployed contract versions remain callable.

### T-H-02 -- High -- Automatic wallet splitting silently defeats strict all-or-nothing mode

**Status:** Reasoned from source.

**Location:** `web/index.html:891-923`, `web/index.html:1219-1271`, `web/index.html:1323-1343`.

**Trigger:** Select strict mode with, for example, six NFTs and a batch size of six. `plan()` correctly permits
the run because it is one transaction, preflight and confirmation both describe one atomic transaction, and
the user agrees to that boundary. If `wallet_sendCalls` returns EIP-5792 error 5740, `sendViaWallet` changes the
batch size to three and recursively starts sending. It does not rerun `plan()`, the strict one-transaction
check, preflight, manifest generation, or confirmation.

If the first three-transfer call succeeds and the second is rejected or fails, half the list has moved even
though the user selected “All or nothing: if any wallet fails, send nothing.” The original manifest and prompt
also no longer describe the calls that were actually submitted.

**Cost:** A strict distribution can be partially executed, which may break one-of-each allocations, reveal a
drop early, or leave an economically unfair partial state that cannot be rolled back.

**Fix:** Never adaptively split a strict wallet batch. On 5740, stop before submitting anything and ask the user
to lower the batch size; `plan()` will then correctly explain that strict mode is unavailable if the list no
longer fits one transaction. In lenient mode, changing transaction boundaries still requires regenerating the
manifest and confirmation, and preflight must be rerun against the exact calls. Add a browser test in which
the first `wallet_sendCalls` returns 5740 and assert that no second request is made in strict mode.

### T-H-03 -- High -- Check silently omits calls and bytes from the material it claims to explain completely

**Status:** Dynamically reproduced in Chromium against the exported `window.__check` helpers.

**Location:** `web/check.html:494-501`, `web/check.html:514-525`, `web/check.html:668-686`,
`web/check.html:792-810` (duplicated in `web/check.js`).

There are three instances of the same unsafe completeness claim:

1. For a JSON array, `readInput` unconditionally selects `j[0]`. A wallet/JSON-RPC batch containing a benign
   first call and an unlimited approval or transfer second is displayed, decoded and simulated as only the
   benign call. The page gives no notice that more array entries existed.
2. `multicall(bytes[])`, `execute(address,uint256,bytes)` and `upgradeToAndCall(address,bytes)` leave their
   embedded calldata as hex strings. The `multicall` sentence nevertheless says “Each one is listed below,”
   and the card is titled “Everything it is asking for.” An unlimited approval nested in `multicall` does not
   receive the top-level unlimited-approval warning.
3. Ethers accepts non-canonical trailing data. Appending a 32-byte word to a normal 68-byte
   `approve(address,uint256)` call still produced the same `approve` signature and two displayed arguments;
   the resulting 100-byte call had no raw-call card or trailing-data warning. A custom implementation can
   inspect `msg.data` in assembly and attach semantics to those hidden bytes.

**Cost:** An attacker can place the dangerous operation outside the only element or bytes the user is shown.
Simulation does not rescue the array case because the page simulates only element zero, and event-only
movement inference does not reliably expose custom behavior for the nested/trailing cases (see H-03).

**Reproduction:** In Chromium, evaluating
`readInput(JSON.stringify([{to:A,data:'0x12345678'},{to:B,data:approval}]))` returned `A` and `0x12345678` only.
`parseData(approval + 32Bytes)` returned the same `approve(address,uint256)` decoding as `parseData(approval)`.
Encoding the approval inside `multicall(bytes[])` returned a top-level multicall whose sole rendered argument
was the undecoded approval hex.

**Fix:** Treat a JSON batch as a batch and analyze every element, or reject multi-element input prominently.
Recursively decode well-known nested-call forms with depth and size limits, preserve the target/value context
of each inner call, and apply warnings to every call. Re-encode decoded arguments and compare the exact result
with the input; display and warn on non-canonical or trailing bytes. Always provide the full raw calldata even
when a friendly decoding is available, and remove “everything” claims wherever completeness is not proved.

### T-H-04 -- High -- The production publisher serves mutable remote signing code under the trusted origin

**Status:** Reasoned from the deployment script. The live `/wc.js` matched the checked-in file at the earlier
point-in-time hash check; this finding is about what the publication mechanism guarantees after that check.

**Location:** `web/index.html:296-319`, `deploy/local.env.example:12-13`, `deploy/publish.sh:46-59`,
`deploy/publish.sh:79-89`.

**Trigger:** Publish the airdrop Worker with `WC_BUNDLE_URL` configured, then let the edge cache expire. A
request for same-origin `/wc.js` fetches whatever bytes the URL serves at that moment and caches them for one
day. The checked-in `web/wc.js` is never read, embedded, uploaded or hashed by `publish.sh`. The browser imports
the response dynamically without a pinned digest. This contradicts the nearby claim that the signing page
does not take code from somewhere the project does not control; same-origin proxying changes the URL seen by
the browser, not the upstream trust boundary.

**Cost:** Compromise, replacement, misconfiguration or ordinary drift at `WC_BUNDLE_URL` changes executable
code on the wallet page without a repository change or redeploy. That code runs in the trusted page origin and
can change displayed recipients and the transaction calls sent to a wallet. A wallet confirmation remains a
last line of defense, but it is precisely the unpinned page code that constructs the calldata the user is being
asked to trust.

The repository also contains only a large minified `web/wc.js`; there is no dependency manifest/build recipe
that reproduces it. Therefore the statement that it is “bundled from source” cannot be independently verified
from this repository.

**Fix:** Publish the exact checked-in bundle bytes as a Worker asset or embed them in the generated Worker.
Fail deployment unless their SHA-256 equals a committed expected digest, and verify the deployed response body
rather than only HTTP 200. If rebuilding is supported, check in the minimal source entry point, locked
dependencies and deterministic build command, then compare its output to the shipped file.

### T-M-01 -- Medium -- Preflight does not simulate the transaction sequence that will actually execute

**Status:** Reasoned from source. The total balance/allowance checks fix simple aggregate shortfalls but not
state-dependent token or receiver behavior.

**Location:** `web/index.html:1089-1162`, `web/index.html:1268-1317`, `web/index.html:1323-1367`.

**Trigger A:** On the wallet path, every transfer is simulated in a separate `eth_call` against the same
unchanged chain state, then several transfers are submitted atomically in one `wallet_sendCalls`. A receiver or
token that accepts the first call but rejects later calls in the same transaction makes each isolated preview
pass while the real atomic batch reverts. In lenient UI mode, good recipients sharing that wallet transaction
with the state-dependent failure are not “kept going” to; none of that transaction lands.

**Trigger B:** On the BulkSend path, each chunk's `staticCall` also starts from the same pre-run state. A token
with a per-block quota, cooldown, transfer counter, changing fee, or other cumulative rule can let every chunk
preview pass independently while a later real chunk skips or reverts after earlier chunks changed state.

**Cost:** The test-run count and “exactly what is sent” comments can be false, transaction-level lenient
behavior can be materially narrower than advertised, and users can pay gas for predictable later failures.
Cross-transaction previews can never guarantee state will remain unchanged between signatures.

**Fix:** Where the wallet supports it, simulate the complete atomic call bundle rather than isolated calls.
For multiple transactions, clearly bound the preview to current state, recheck immediately before every chunk,
and stop/reconfirm when an earlier transaction changes assumptions. The confirmation should distinguish
contract-level per-recipient skipping from wallet-transaction atomicity. Add stateful token and receiver tests;
aggregate balance tests alone do not cover this class.

### Third-pass test gaps

- No browser test supplies multiple JSON-RPC request objects, embedded multicall calldata, or valid ABI
  calldata with trailing bytes to Check.
- No browser receipt test includes multiple genuine BulkSend summaries or a `Skipped` event for a different
  token, nor does one assert `sent + skipped == input length`.
- No wallet test returns 5740 under strict mode and asserts that adaptive retry submits zero calls.
- The contract reentrancy test checks asset safety only; it does not model a receiver deliberately polluting the
  event stream consumed by the official client.
- No end-to-end publication test proves that deployed `/wc.js` came from checked-in bytes or fails on a digest
  mismatch.
