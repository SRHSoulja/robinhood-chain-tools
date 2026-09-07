# Correctness and safety review

> **Status: every finding in this report is fixed.** Published unedited. This is the fourth external review,
> the first to run against a current checkout with the contract suite executable.
>
> Its own summary is worth keeping: the contract's caller binding, immutability, reentrancy protection and
> strict atomicity were examined and found sound. Everything it found was in the delivery ledger's recovery
> paths and in what the Check page claims to know.
>
> The three that mattered most, and what they became:
> H-01, an EIP-5792 status of 600 (reverted in part, so some of it may be on chain) was read as 400 (nothing
> happened), because there were two status decoders and only one of them was right. There is one now, and
> anything not positively proved holds its rows.
> H-02, a replacement transaction was followed on the strength of its destination alone; it now has to match
> the original calldata, fetched from the chain, or the record stays unresolved.
> H-06, "delivered" meant "the token accepted the call". The page now asks the chain whether the recipients
> actually hold what was sent, and records only those.

---

Reviewed commit: `3700331c8821564dbce806cb3d12fe2057f430fb`

Date: 2026-09-06 (America/Denver)

## Verdict

No: this is not ready for real money. The contract itself is unusually small and careful, and its strict-mode
atomicity and caller-binding properties held up. The release blocker is the client ledger. I found three
independent recovery paths that can either make a partly paid batch retryable or permanently record unpaid rows
as delivered. I also found two places where Check can give a materially safer answer than its evidence earns.

I would first fix findings H-01 through H-03 and add crash/reload tests for every EIP-5792 terminal status and
replacement shape. Then fix H-04 and H-05 before presenting Check as a pre-signing safety tool. H-06 is an
existing trust boundary, not a newly introduced contract exploit, but the unconditional delivery promises must
be narrowed or backed by independently checked postconditions.

## Findings

### H-01 — High — Reload recovery treats an EIP-5792 partial failure as if nothing moved

**Status:** Demonstrated by direct source-path analysis; the status meaning was checked against EIP-5792.

**Location:** `web/index.html:1132-1138`, contrasted with the correct ordering at
`web/index.html:1622-1639`.

**Trigger:** Use the wallet-batch path, submit at least two calls, and close or crash the tab after the pending
entry is saved with `callsId` but before `waitForCalls` finishes. On the next visit, connect the same wallet and
have `wallet_getCallsStatus(callsId)` return numeric status `600`. This status means that the batch reverted
partly and some batch-call changes may be on-chain. The recovery path instead executes `if (code >= 400)`, logs
that nothing moved, deletes the pending record, and makes every row eligible again. The live wait path gets this
right by testing `code >= 600` before `code >= 400`.

**Cost:** Any recipient whose call landed before the partial failure can be paid twice on the next send. The UI
also gives the specifically wrong statement that nothing moved.

**Reproduction:** Seed `bulksend:pending` with a hashless `via: "wallet"` entry containing two rows, mock
`wallet_getCallsStatus` as `{status: 600, receipts: [one successful receipt, one failed receipt]}`, connect the
same account/network, and press Send with the same list. Assert that the page does not remove the pending entry
and does not submit either row. The current code removes it at line 1137. The standard's status table is at
<https://eips.ethereum.org/EIPS/eip-5792#wallet_getcallsstatus>.

**Fix:** Share one status decoder between live waiting and reconciliation. Treat 600 and all unknown statuses as
possibly moved: retain the pending record and hold every row back until the page can prove the outcome per call.
Only 400 (off-chain failure) and 500 (complete on-chain revert) justify making all rows retryable. Add tests for
100, 200, 400, 500, 600, unknown numeric codes, string statuses, missing receipts, and mixed receipts after a
reload.

### H-02 — High — A different replacement call can mark the original recipients delivered

**Status:** Reasoned from source.

**Location:** `web/index.html:1141-1175`, `web/index.html:1522-1534`, and receipt classification at
`web/index.html:1077-1121`.

**Trigger:** Submit a BulkSend transaction for one ERC-721 row `(Alice, id 1)`, then replace it in the wallet
with a different successful transaction to the same BulkSend address and same token, such as `(Bob, id 2)`.
The replacement has one successful transfer and therefore emits the same valid
`Airdrop721(token, sender, 1, 0)` summary. The live path recognizes that the calldata differs, stores
`replacedBy`, says it cannot account for the batch, and stops. After reload, reconciliation checks only that the
replacement receipt's `to` is BulkSend. It never fetches or compares the replacement transaction calldata.
Because successful rows have no per-recipient BulkSend event, `readBatchReceipt` accepts the one-row summary and
returns the original pending chunk—Alice/id 1—as delivered.

**Cost:** Bob/id 2 moved, Alice/id 1 did not, yet Alice/id 1 is written into the delivered ledger and suppressed
on every later reload. The intended recipient is left unpaid/stranded and the page reports a false completion.
With a different replacement shape, the wrong recipient/ID/amount set can be suppressed.

**Reproduction:** Seed a `via: "bulk"` pending entry with `hash` for the original call, `replacedBy` for a
different call, and rows containing Alice/id 1. Return no receipt for `hash`; return a status-1 receipt for
`replacedBy`, addressed to the configured BulkSend, containing only a valid same-token/same-sender
`Airdrop721(..., 1, 0)` summary. Run reconciliation and inspect the original run's delivered key: the current
code writes Alice/id 1.

**Fix:** Persist the exact original `to`, `data`, `value`, sender and chain before waiting. For any replacement,
fetch the transaction body and require all those fields to match before reading its receipt. A receipt alone
cannot prove successful ERC-721/1155 destinations because BulkSend emits row details only for skips. If exact
calldata cannot be proved, keep the record unresolved; do not mark or release any row. Also persist the new hash
for identical replacements before processing the receipt so a crash after replacement discovery remains
recoverable.

### H-03 — High — Different runs can overwrite each other's global pending records

**Status:** Reasoned from source and the browser storage concurrency model.

**Location:** `web/index.html:684-758`, `web/index.html:1408-1421`, `web/index.html:1507-1514`, and
`web/index.html:1593-1599`.

**Trigger:** Open two tabs in the same browser profile and send concurrently from different run scopes—for
example, the same account sending token A in one tab and token B in the other. Their lock names include the run
key, so both locks are granted. All runs nevertheless share the single `bulksend:pending` localStorage array.
`addPending` is an unlocked read-modify-write. If both tabs read the old array before either write becomes
visible, one writes `[A]` and the other writes `[B]`; the last write discards the other live transaction. Worse,
`savePending` validates only the array length, so both one-element writers can return success even if the other
entry is now on disk. `dropPending` and the code that adds hashes/replacement metadata have the same lost-update
shape.

**Cost:** A real submitted batch loses the only pending record that was meant to survive a crash or tab close.
If that tab closes before its delivered ledger is written, reloading the original list can submit and pay the
same rows again.

**Reproduction:** In one browser context, open two pages with different token addresses (or different sending
accounts), pause both immediately after their `loadPending()` calls, then let both `addPending` calls finish.
Assert that storage contains both PIDs and each tab verifies its own PID. The current length-only check permits a
one-entry result. A lower-level deterministic reproduction is two concurrent read/append/set sequences against
the initially empty `bulksend:pending` key.

**Fix:** Use one origin-wide Web Lock for every mutation of the shared pending collection, including add,
metadata update and delete, and verify the caller's PID/content rather than only length. Simpler and safer:
store each pending object under its own key (`bulksend:pending:<pid>`) and maintain no shared read-modify-write
index; enumerate via a separately locked index or IndexedDB transaction. Add a two-tab test whose runs differ,
not only the current same-run lock test.

### H-04 — High — A failed code read is reported as proof that an address has no contract

**Status:** Reasoned from source.

**Location:** `web/check.html:322-337` and `web/check.html:845-869` (the same code is mirrored in
`web/check.js:232-247` and `web/check.js:755-779`).

**Trigger:** Ask Check about a real contract while `eth_getCode` errors or times out, but later RPC requests or
`eth_simulateV1` still answer. `readAddress` converts every code-read failure to literal `0x`, sets
`isContract = false`, and returns before consulting the explorer. Address mode calls it “an ordinary wallet,
with no code.” Call mode adds the stronger warning: “There is no contract at that address” and “A call to an
address with no code does nothing at all.”

**Cost:** A transient or selective RPC failure becomes a false all-clear about a live contract. A user can sign
a call believing it does nothing when it actually executes arbitrary code, including an approval or asset
transfer. This violates the rule that missing evidence must remain unknown.

**Reproduction:** Extend `test/web/check.test.mjs` so `eth_getCode` returns a JSON-RPC error for `NASTY` while
`eth_simulateV1` returns status 1. Ask for `NASTY`, then ask for a call to it. Assert that neither “ordinary
wallet” nor “There is no contract” appears and that an explicit “could not read code” warning does. Both wrong
claims appear today.

**Fix:** Preserve three states: code present, confirmed `0x`, and read failed. On failure, stop semantic analysis
or render an unmissable unknown/error result. Apply the same rule to implementation bytecode reads. Never use a
network exception as evidence of absence.

### H-05 — High — Check still silently omits calls and bytes from a request

**Status:** Reasoned from source; this is an incomplete remediation of earlier finding T-H-03.

**Location:** `web/check.html:529-586`, `web/check.html:873-904`, and `web/check.html:910-927` (mirrored in
`web/check.js:439-496`, `web/check.js:783-814`, and `web/check.js:820-837`).

**Trigger A:** Nest `multicall(bytes[])` five levels deep and put `approve(spender, MaxUint256)` or
`setApprovalForAll(spender, true)` at the bottom. `renderInner` returns `null` once `depth > 3` without saying
that anything was omitted. The page still says the carried calls “are listed below, decoded the same way.”

**Trigger B:** Put a canonical-looking inner call plus 32 trailing bytes inside `multicall`, `execute`, or
`upgradeToAndCall`. `parseData` calculates `p.extra`, but `renderInner` never displays it. The top-level raw call
contains the bytes only as an ABI-encoded blob and the top-level `parsed.extra` is zero, so the prominent
trailing-data warning never fires for the inner call.

**Trigger C:** Paste a JSON array with a benign first call and a second wallet call represented as
`{input: dangerousCalldata, value: ...}` with no `to` or `data` property (for example, a contract-creation
request). `readInput` knows how to map `input` to `data`, but filters on `(o.to || o.data)` before doing so. It
silently drops the second entry and, because only one entry remains, presents the request as a single benign
call with no batch warning.

**Cost:** A user can approve an unlimited allowance/collection or sign custom assembly semantics carried in
bytes that Check silently omits from its friendly explanation. The raw outer hex is technically present, but
that is not an adequate disclosure to the non-technical audience this page targets.

**Reproduction:** Add a Check test which recursively ABI-encodes five multicalls around an unlimited approval;
assert the approval and an explicit depth-limit warning are both visible. Add another with
`multicall([approve(spender, 5) || bytes32(999)])`; assert “32 bytes not accounted for” appears inside the nested
card. Finally pass `[{to: A, data: benign}, {input: initcode, value: "0x..."}]` to `readInput` and assert the
result remains a two-call batch or is rejected as incomplete; today it returns only the call to A.

**Fix:** At the cutoff, render a red “nested calls omitted” result with count/target/raw bytes and refuse any
safety summary. Give every nested call the same raw-call, canonical-length, trailing-byte and warning pipeline
as a top-level call. Never filter request entries silently: preserve each original element and render/reject any
whose complete call shape cannot be understood. Add total-call/byte limits for availability, but make every
limit fail visibly closed.

### H-06 — High — A successful token call is still recorded as delivery without proof of payment

**Status:** Demonstrated by the repository's own tests; this is a disclosed external-contract trust boundary,
but it means the prior H-06 is not fixed as an unconditional promise.

**Location:** `src/BulkSend.sol:145-180`, `src/BulkSend.sol:208-240`, `src/BulkSend.sol:270-311`,
`web/index.html:1077-1121`, and `test/BulkSendReal.t.sol:783-801`.

**Trigger:** Select a contract whose ERC-721/ERC-1155 transfer entry point or permissive fallback returns
normally without moving ownership/balance, or an ERC-20 whose `transferFrom` returns exactly `true` while
moving nothing. BulkSend increments `sent`; the receipt has a consistent summary and no skip; the page writes
every input row into the delivered ledger. A fee-on-transfer ERC-20 similarly underpays while the full parsed
amount is marked delivered. The suite deliberately demonstrates both the no-op and 2% fee cases.

**Cost:** A recipient is unpaid or underpaid, but is recorded as delivered and omitted on reload. The sender's
asset may remain in place in the no-op case; the operational loss is a stranded distribution and a false answer
the sender can act on. In the fee case, the recipient loses the fee shortfall on every row.

**Reproduction:** Run `forge test`; `test_aContractThatAcceptsAndMovesNothingIsCountedAsSent` and
`test_feeOnTransferDeliversLessThanTheAmountCounted` pass while proving the boundary. The former should be a
failing product-level assertion if “delivered” means paid.

**Fix:** Either narrow every UI/README promise and ledger label to “call accepted by the selected token” or add
postcondition evidence. For ERC-721, compare `ownerOf(id)` to the intended recipient; for ERC-1155/ERC-20,
measure recipient balance deltas and explicitly support or reject fee/rebase/reflection behavior. An arbitrary
hostile token can lie through its read methods too, so no generic implementation can offer unconditional proof;
that limitation must be adjacent to every completion report, not only in developer-facing prose.

### M-01 — Medium — ABI names and self-reported interfaces are presented as contract behavior

**Status:** Reasoned from source.

**Location:** `web/check.html:392-412`, `web/check.html:457-524`, and `web/check.html:845-906`.

**Trigger:** A verified ERC-721-looking contract returns true from `supportsInterface(0x80ac58cd)` but
implements `approve(spender, 1)` as collection-wide approval (or any other behavior) without emitting a
standard event. Check uses the self-reported standard and ABI argument layout to say that the call merely lets
the spender move NFT #1. It labels the call “decoded from the contract's published source,” although it reads
only the ABI, not the function body. The contract card much farther down correctly says names do not prove
behavior, but the lead sentence is unconditional and can reasonably be read as the answer.

**Cost:** A user can sign what Check describes as authority over one NFT while granting authority over an
entire collection, allowing later theft. The same issue applies to every imperative sentence in
`describeCall`: `transfer`, `withdraw`, `mint`, and similar names do not constrain arbitrary EVM behavior.

**Reproduction:** Mock a verified ABI containing `approve(address,uint256)`, make ERC-165 return true for
ERC-721, make simulation succeed with no logs, and paste `approve(spender, 1)`. The page's lead says only NFT #1
is exposed; nothing near that answer says the sentence is a convention-based guess.

**Fix:** Label these sentences as conventional interpretations (“ABI decodes as …; this does not prove what
the implementation does”) and put that limitation before the sentence/status, not in a later contract card.
Do not say “decoded from source” when only an explorer ABI was consumed. Reserve behavioral claims for observed
state deltas/traces, and still describe those as one simulation at one state.

### M-02 — Medium — An unverified proxy implementation can inherit the forwarder's ABI label

**Status:** Reasoned from source.

**Location:** `web/check.html:353-389` and `web/check.html:547-550`.

**Trigger:** The explorer returns a verified proxy/forwarder with an ABI, but its current implementation is
unverified or has no ABI. `readAddress` assigns the forwarder's ABI to `out.abi`, follows the proxy, and replaces
that ABI only if the implementation response contains a non-empty ABI. Otherwise the forwarder's ABI remains.
Calldata is then decoded against code that does not run it, with the pill “decoded from the contract's published
source.”

**Cost:** Check can give the wrong function name and argument meaning for an upgradeable target. The separate
proxy/no-implementation-source warnings reduce, but do not remove, the risk that a user acts on the confident
lead decoding.

**Reproduction:** In the Check harness, return a verified proxy ABI containing a known selector and an
unverified implementation with different bytecode semantics and no ABI. Paste that selector. Assert the page
does not claim the call was decoded from published source; it currently does.

**Fix:** Clear `out.abi` when a proxy is identified, then populate it only from the implementation actually
followed. Keep the proxy ABI separately for proxy-admin functions if needed. If implementation lookup fails or
is unverified, fall back to explicitly incomplete selector/convention decoding.

### L-01 — Low — The documented WalletConnect rebuild command cannot run from the repository

**Status:** Demonstrated.

**Location:** `web/wc-build/README.md:6-9` and `web/wc-build/package.json:1-16`.

**Trigger:** From `web/wc-build`, run the documented `npm ci`. There is no checked-in `package-lock.json` or
`npm-shrinkwrap.json`, so npm exits with `EUSAGE` before installing anything. The README's claim that “the
lockfile pins every transitive dependency” is false. Exact top-level versions do not pin transitive packages.

**Cost:** This does not change the currently served connector: its live digest matches the checked-in bundle.
It does prevent a reviewer from rebuilding or auditing the 2 MB signing bundle from locked inputs and weakens
the claimed source provenance for future releases.

**Reproduction:** `cd web/wc-build && npm ci --ignore-scripts --dry-run` fails because no lockfile exists.

**Fix:** Generate and commit `web/wc-build/package-lock.json`, make the documented clean build succeed, and add
a CI check that rebuilds (or at least installs from) the lock and compares the reviewed expected digest. Have
`deploy/publish.sh` compare `web/wc.js` against `web/wc-build/EXPECTED-SHA256` as well as pinning whatever file
happens to be present at publish time.

## Promise boundaries and design decisions

- **Approval and immutability:** For a conforming selected token, BulkSend fixes every transfer's `from` to
  `msg.sender`; there is no owner, upgrade hook, arbitrary target call, fee, pause or persistent configuration.
  An unrelated caller cannot spend another user's approval through BulkSend. This promise held.
- **Strict mode:** A strict BulkSend call is atomic, and the page refuses strict lists requiring more than one
  transaction. The wallet path asks for `atomicRequired: true`; its promise necessarily depends on the wallet
  honoring the capability it advertised. I found no source path that intentionally splits strict mode after
  confirmation.
- **Lenient mode:** “Could not receive” is not what the stipend proves. An honest receiver needing 450,000 gas
  is skipped by the 400,000 default and succeeds with a larger stipend or strict mode. The contract NatSpec and
  gas control disclose this, and the suite's heavy-receiver test demonstrates it. I would rename the mode text
  from “If a wallet cannot receive” to “If a transfer fails or exceeds this gas limit.”
- **Local storage:** The page is honest about different devices, private windows and cleared storage. That
  disclaimer does not cover H-01 through H-03, which occur in the same supported browser/profile that the page
  specifically says it protects.
- **Ordering and parsing:** Accepted NFT/ERC-1155 rows are sorted by ID, but recipient/ID/amount pairing is
  preserved and the changed transaction order is disclosed before confirmation. Invalid/problem rows may be
  omitted only after an explicit acknowledgement. I found no silent amount rounding, rescaling, pairing change,
  or accepted-row drop in the parser paths reviewed.
- **Ownerless/no rescue:** Refusing BulkSend, the zero address and the token contract as UI recipients is the
  right mitigation. Adding a privileged rescue role would weaken the stronger no-owner/no-upgrade property and
  still could not intercept arbitrary direct token transfers.

## Areas examined and found sound

- All six public airdrop entry points are non-reentrant. The transient lock prevents a receive hook from
  injecting genuine nested BulkSend events, and back-to-back non-nested calls still work.
- ERC-20 return handling distinguishes a revert from success and treats false, short, non-one and trailing
  return data as ambiguous, reverting the whole transaction rather than reporting a possible payment as a
  skip. The balance assertions around these cases are strong.
- Length mismatch, empty batches, zero recipients, zero ERC-20/ERC-1155 amounts, EOA and EIP-7702 token
  addresses, and self-recipient rows are rejected. Lenient revert data is capped; strict revert data is
  preserved.
- Receipt parsing now filters on BulkSend address, selected token, sender and expected summary type; requires
  exactly one summary and `sent + skipped == chunk.length`; and matches skipped rows on recipient plus ID/amount
  with single-use occurrences. The prior reentrant-event pollution issue is fixed in both layers.
- The CSV paths preserve empty interior fields, honor recognized named columns, reject excess precision and
  non-whole NFT/ERC-1155 amounts, retain duplicate payment occurrences, and clear parsed token-dependent state
  on network/type/address changes.
- Check makes no signing or sending request. Its only injected-wallet method is `eth_requestAccounts`; chain,
  explorer and price calls are read-only. Untrusted strings are inserted as text, links use `noopener`, and the
  ethers CDN script has SRI.
- Check now keeps multi-element JSON batches, warns on top-level trailing bytes, recursively handles its three
  recognized carrier functions within its limit, labels logs as announcements rather than proof, and prevents
  stale asynchronous results from replacing a newer lookup.
- `deploy/publish.sh` inlines the exact HTML, pins the remotely fetched WalletConnect bundle by SHA-256, and
  verifies deployed response bodies rather than only HTTP status. The implementation addresses and page
  configuration all point at the current v9 deployment.

## Deployment and correspondence evidence

- `forge build` completed from the reviewed source. The freshly built
  `out/BulkSend.sol/BulkSend.json` `deployedBytecode.object` is byte-for-byte identical to runtime code returned
  by testnet RPC for `0x91949D7328387A3613b29E56f6979Ae893ccd23C` (8,164 bytes each).
- `curl https://rhairdrop.gmgnrepeat.com/ | cmp - web/index.html` succeeded. Repository/live SHA-256:
  `887570bdba515da0b7f1b956078a20bce2a7dd56b5abd732aa168f3b48a3d166`.
- `curl https://rhcheck.gmgnrepeat.com/ | cmp - web/check.html` succeeded. Repository/live SHA-256:
  `d2512dbde580dfd2ed0db82d42a703d90e9a033fafabe42c213d5f924410210a`.
- Live `https://rhairdrop.gmgnrepeat.com/wc.js` and `web/wc.js` both hash to
  `050632a7350b82f6c490631bfd4b167176eac36da3d38ec3cc7c6465e9a9c6b8`.
- The inline script extracted from `web/check.html` is byte-identical to `web/check.js`.

These are point-in-time checks. They establish current correspondence; they do not make mutable hosting or RPC
responses immutable.

## Test-suite assessment

`forge test` passed: 82 tests. `npm test` passed: 62 airdrop-page assertions and 52 Check-page assertions (114
total). I used plain Forge output as requested.

The contract tests generally verify resulting balances/ownership rather than counters alone. In particular,
they prove atomic rollback for ambiguous ERC-20 returns, supply conservation for conforming tokens, the
reentrancy-event fix, bounded gas behavior, and the deliberate no-op/fee-token boundary in H-06.

The browser tests are deterministic and useful, but their green count is narrower than the user promises:

- The same-list two-tab test proves the per-run lock works; it does not run different run keys against the
  shared pending array (H-03).
- Hashless wallet recovery tests only status 200. They do not exercise 400/500/600/unknown terminal states
  after a crash (H-01).
- Replacement coverage tests the live `TRANSACTION_REPLACED` branch, not reload reconciliation of a different
  replacement to the same BulkSend contract (H-02).
- Check tests make `eth_getCode` reliably answer. Explorer failure is tested as three-valued, but the more
  authoritative code read is not (H-04).
- Batch-input tests use `to`/`data` on every element, and nested-call tests cover one level with canonical
  calldata. They do not exercise silently filtered `input`-only entries, reach the depth cutoff, or append
  trailing bytes to an inner call (H-05).
- ABI tests check decoding and name-based caveats but do not assert that the lead sentence itself is qualified
  when ABI names or ERC-165 answers lie (M-01), nor the verified-proxy/unverified-implementation ABI carryover
  (M-02).

The earlier reviews' concrete fixes for ambiguous ERC-20 results, CSV columns, occurrence keys, strict-mode
splitting, event pollution, top-level calldata completeness, publisher digest pinning and sequential wallet
simulation are present and reachable. The blanket statement that every earlier finding is fixed is too broad:
the no-op/fee-token portion of the second review's H-06 remains as a documented limitation, and the replacement
and pending-ledger fixes still have the recovery failures above.
