# Correctness and safety review

> **Status: every finding in this report is fixed, in v8 and in the pages published alongside it.** Published
> unedited. This is the second external review; the first is in
> [audit-2026-09-06-external.md](audit-2026-09-06-external.md). The reviewer was given the repository and no
> other context, and was asked where each promise the software makes stops being true.
>
> The two findings worth reading first are H-02 and H-03, which are both the same mistake: a page whose job is
> telling people what is safe printed conclusions its evidence did not support. It said a contract could not
> mint, pause, block or be replaced on the strength of **function names**, and it said "no tokens and no ETH
> move" whenever no event it recognised was emitted. Both now report what was actually checked and say what
> that does not cover.
>
> One correction to the report: the reviewer could not run the Forge suite because `forge` was not on its
> PATH, so its statement that chain runtime matches the local artifact is not the same as a fresh build from
> source. That check is in [for-reviewers.md](for-reviewers.md) and passes.

---
Reviewed commit: `73f1aba2dc8a79951c642cb52c1e56f25a57aa8a`  
Review date: 2026-09-06  
Scope: the files requested in `PROMPT.md`; `lib/` and `src/research/` were excluded.

## Verdict

**No: this is not ready for real money.** The deployed testnet files match the repository today and the
ownerless contract has a small, understandable authority surface, but the product still has paths that can
strand an NFT, pay a row twice, permanently suppress an unpaid row, and give the Check user a green conclusion
that is not supported by the evidence it collected.

Before a mainnet release I would, in this order:

1. reject the BulkSend address in the client regardless of delivery path;
2. remove the Check page's claims about absent powers and actual movements, or replace them with evidence that
   proves those claims;
3. make the cross-tab and pending ledgers fail closed, with a recoverable state for wallet batches that do not
   yet have a transaction hash;
4. preserve empty CSV fields and refuse assignment when the complete requested allocation cannot be made; and
5. narrow/document the token-behaviour assumptions under which a successful call counts as delivery.

No live transaction was sent.

## Findings

### H-01 -- High -- The client can send an ERC-721 directly into ownerless BulkSend and strand it

**Status:** Reasoned from source. This is a reachable configuration regression of the earlier review's H-07.

**Location:** `web/index.html:185-202`, `web/index.html:506-625`, `web/index.html:1125-1146`,
`web/index.html:1323-1361`; contract-side protection at `src/BulkSend.sol:125`.

**Trigger:** Connect a wallet that advertises EIP-5792 atomic batching; select ERC-721; uncheck **Refuse to send
to a contract that cannot hold NFTs**; and include
`0xC6AE3189eDAE544Ed60ADf5Ec057E338ce224F74` as a recipient. The parser rejects the zero address but has no
equivalent check for `cfg().bulk`. Because this is an NFT and the wallet can batch, `deliveryPath()` chooses
`wallet`. Both preflight and submission therefore call the token's unsafe `transferFrom` directly; they never
call `BulkSend.airdrop721`, so `SelfRecipient` is unreachable.

**Cost:** The NFT becomes owned by BulkSend. BulkSend is ownerless and exposes no transfer or rescue path, so
the NFT is permanently stranded. The footer's statement that BulkSend holds nothing is then false.

**Reproduction:** In the browser mock, enable `walletBatch`, use the BulkSend constant as the only row, uncheck
`#safe`, and send. Assert that `window.__sent[0].calls[0].to` is the NFT contract and that its calldata decodes
as `transferFrom(sender, BulkSend, id)`. On a standard ERC-721 that call succeeds.

**Fix:** Reject the configured BulkSend address during parsing for every standard and every delivery path.
Keep the contract's `SelfRecipient` check as defense in depth, and add the wallet-path browser test above.

### H-02 -- High -- Check infers dangerous capabilities from function names, then asserts their absence

**Status:** Reasoned from source.

**Location:** `web/check.html:339-375`, `web/check.html:400-438`, `web/check.html:699-735` (the same code is
duplicated in `web/check.js:249-285`, `web/check.js:310-348` and `web/check.js:609-645`).

**Trigger:** Verify a contract whose privileged function is named something outside `POWERS`, for example
`rebalance(address victim, uint256 amount)`, and have that function confiscate balances, mint, or set a tax.
Alternatively, use a custom proxy with `setLogic(address)` and a fallback `delegatecall`, stored outside the
few EIP-1967 slots the page checks. The ABI faithfully lists the names but says nothing about their bodies.
`powersOf` finds no matching name, so the page renders a green sentence: “Nothing in the published source lets
anyone mint, pause, block, retax or replace this contract.” A partially matched verification gets the same
conclusion. If an unrelated `owner()` returns zero, the page can additionally say that owner-only powers can no
longer be used, even when access is role-based or custom.

There is also a concrete proxy variant: when both proxy and implementation have an explorer ABI, line 374
keeps the proxy ABI because `out.abi` is already truthy and merely stores the implementation ABI in the unused
`out.implAbi`. Capability scanning and calldata decoding then inspect the forwarder's ABI rather than the code
that actually runs. An empty proxy ABI is still a truthy array, so a minimal proxy can be shown with the same
green negative claim while its implementation exposes a recognized mint or seizure function.

**Cost:** A non-technical user can treat an arbitrary back door or upgrade mechanism as absent and buy,
approve, or sign on that basis. That can lead to confiscated or devalued tokens or approval abuse.

**Reproduction:** Mock the explorer response as verified with an ABI containing only `rebalance(address,uint256)`
and harmless view methods. Ask Check for the address and observe the green “Nothing ... lets anyone ...” claim.
The function body is not needed to make the evidentiary defect visible; its semantics never enter the page.

**Fix:** Never infer semantic absence from ABI names or PUSH4 constants. For verified contracts, link to the
source and say only which *names* matched a heuristic. For unverified contracts, call selector scanning a small
set of hints, not a capability inventory. Remove the green negative claim and the `owner() == 0` conclusion
unless access-control semantics have actually been established. Partial verification must be treated as
incomplete evidence. For a recognized proxy, decode and scan the implementation ABI (and resolve a beacon's
implementation rather than treating the beacon contract itself as the implementation).

### H-03 -- High -- Check treats event logs as proof of movement

**Status:** Reasoned from source.

**Location:** `web/check.html:532-577`, `web/check.html:620-667`, `web/check.html:749-797`.

**Trigger A (false delivery):** A contract emits
`Transfer(Alice, Bob, 100)` or `Approval(Alice, Attacker, max)` but does not change the corresponding state.
The simulation succeeds. `movements()` recognizes only the topic and shape, and Check says the tokens “go” or
the approval is granted.

**Trigger B (hidden movement):** A non-conforming token changes balances or allowances without emitting the
standard event, or an arbitrary contract changes economically important state with an event outside the small
allowlist. The simulation or mined transaction can succeed, yet Check says “No tokens and no ETH move.”

**Trigger C (malformed standard lookalike):** A contract emits the ERC-20 `Transfer` topic with a third indexed
argument. Topic count makes Check call it an NFT even though event semantics are controlled by the emitter.

`traceTransfers` supplies evidence for native ETH transfers; it does not turn user-emitted token logs into
verified state deltas.

**Cost:** The page can hide a drain or display a fabricated payment/approval. A user can sign a harmful call,
accept a fake payment as real, or retry a real but logless payment.

**Reproduction:** The existing browser mock already controls `eth_simulateV1.logs`. Return a successful
simulation containing a well-formed fake `Transfer` and no corresponding state change; the page renders it as
movement. Return no logs for a mocked state-changing call; it renders the categorical no-movement sentence.

**Fix:** Label this section “Standard events the contract emitted” and explicitly say events are claims, not
balance proofs. Do not render an empty event set as proof that nothing moved. For known token operations, compare
pre/post simulated state where the RPC supports it, while still explaining that an adversarial token can lie in
view methods too. A general-purpose page should present call traces and state diffs, not infer state solely from
logs.

### H-04 -- High -- Same-browser double-send protection fails open when locking or storage fails

**Status:** Reasoned from source.

**Location:** `web/index.html:661-685`, `web/index.html:1048-1069`, `web/index.html:1194-1206`,
`web/index.html:1277-1282`, `web/index.html:1311-1312`, `web/index.html:1345-1349`.

**Trigger A:** Use two tabs in a browser where `navigator.locks` is absent. Both calls skip the lock block,
read the same empty delivered/pending state, and submit the same list. If `navigator.locks.request` exists but
rejects, line 1203 explicitly resolves `true`, with the same result.

**Trigger B:** Make `localStorage.setItem` throw (quota, disabled storage, browser policy, or storage failure).
`savePending` swallows the exception. The transaction has already been submitted before `addPending` runs.
Close or crash the tab before the receipt is recorded, reopen it, and the rows are fresh.

**Trigger C:** Let the pending entry be saved and the transaction confirm, then make only the delivered-record
write fail (for example, that per-run value has hit quota while the small pending list is still writable).
`markDelivered`/`writeDeliveredFor` catch the failure, after which the caller drops the pending entry anyway.
The only durable holdback is gone and the row is fresh on reload. The send loop also continues after the
warning, enlarging the unrecorded set.

**Cost:** Every row can be paid twice. The footer discloses other browsers, devices, private windows and cleared
caches, but not the lack/failure of the advertised same-browser cross-tab lock or an unrecorded storage write.

**Reproduction:** In the browser test initialization, delete `navigator.locks`, open two pages sharing one
browser context, configure the same account/token/list, and release both confirmation dialogs together. Both
pages call `wallet_sendCalls`/`eth_sendTransaction`. Separately, override `Storage.prototype.setItem` to throw,
submit a batch, close before the receipt, and reopen.

**Fix:** Refuse to send when an exclusive lock cannot be acquired; provide a tested fallback lease with an
expiry and fencing token if unsupported browsers must work. Before asking the wallet, perform and verify a
durable write probe and create an explicit `submitting` reservation for the rows. Every ledger write that
protects funds must return a checked result. Never drop pending state until the delivered state has been read
back successfully, and stop the run on the first persistence failure.

### H-05 -- High -- Empty CSV fields are removed, so a quantity can silently become a token ID

**Status:** Reasoned from source.

**Location:** `web/index.html:469-483`, `web/index.html:506-579`.

**Trigger:** Select ERC-721 and import this valid CSV:

```csv
address,tokenId,quantity
0x0000000000000000000000000000000000000014,,10
```

`splitRow()` ends with `cells.filter(x => x !== '')`, so the data row becomes `[address, "10"]` while the
header indexes remain `tokenId=1, quantity=2`. The named ERC-721 branch therefore parses token ID 10 and never
enters the “quantity without IDs” assignment flow.

**Cost:** NFT #10 can be sent to the wallet while the intended request for ten not-yet-assigned NFTs is reduced
to one transfer. This is both a wrong asset and nine dropped allocations, with no problem line or acknowledgement.

**Reproduction:** Paste the CSV above, press **Check list**, and observe one valid recipient with ID 10 rather
than a request to assign ten NFTs.

**Fix:** Preserve empty fields and their positions. Validate rows against the named schema, reject an empty ID
when an ID column is present, and require the user to choose explicitly whether a file with blank IDs plus
quantities means assignment.

### H-06 -- High -- BulkSend equates a successful external call with delivery

**Status:** Reasoned from source. This is a trust boundary in the promise, plus one concrete malformed-return bug.

**Location:** `src/BulkSend.sol:122-150`, `src/BulkSend.sol:188-210`, `src/BulkSend.sol:243-275`;
the permissive client token lookup is at `web/index.html:427-456`.

**Trigger A:** Point ERC-721 or ERC-1155 mode at a contract with a permissive fallback, or transfer functions
that return normally but do not change ownership/balances. `_mustBeContract` passes and the low-level/high-level
call succeeds, so BulkSend emits `sent = n` although nobody was paid. The client will accept such a contract in
721/1155 mode even when standard detection returns no result.

**Trigger B:** An ERC-20 `transferFrom` returns the ABI word `1` without moving value. BulkSend records delivery.
A fee-on-transfer token can also return `true` while paying less than the parsed amount; the page warns about
the fee but still permanently records the row as delivered.

**Trigger C:** Return 64 bytes whose first word is `1`. The NatSpec says anything other than exactly `true` or
nothing is ambiguous, but `ret.length >= 32` accepts trailing malformed data.

**Cost:** Recipients are underpaid or unpaid and the delivery ledger suppresses them on reload. A sender may
act on a false completion report. With a fee token, the shortfall is the transfer fee on every row.

**Reproduction:** Add a fixture whose `transferFrom`/`safeTransferFrom` fallback returns success without state
changes, call each airdrop entry point, and assert that current counters say sent while balances/ownership did
not change. For the concrete return-data issue, return `abi.encode(uint256(1), uint256(2))` from ERC-20
`transferFrom`; current code accepts it.

**Fix:** At minimum require ERC-20 return data to be exactly zero bytes or exactly one 32-byte word equal to
one. More importantly, state the supported-token assumption prominently or enforce postconditions using
ownership/balance deltas. Exact-amount delivery is incompatible with fee-on-transfer tokens unless the product
either rejects them or measures and reports the net recipient amount. No on-chain check can make an arbitrary
hostile token contract truthful, so the user promise must name that boundary.

### M-01 -- Medium -- Concurrent Check requests can leave results for a different input or network on screen

**Status:** Reasoned from source.

**Location:** `web/check.html:749-758`, `web/check.html:821-848`, `web/check.html:852-858`.

**Trigger:** Start a lookup whose explorer calls are slow, change the textarea or network, and press
Ctrl/Cmd+Enter or an example button while the first lookup is still running. The Go button is disabled but
`go()` itself has no in-flight guard, request generation, or captured chain configuration; the network selector
and example buttons remain enabled. Whichever asynchronous request finishes last overwrites `#out`. A single
request can also capture an RPC provider for the old chain while later `cfg()` and `explorerJson()` calls use
the newly selected chain.

**Cost:** The textarea/network can show the dangerous call while the result card describes an earlier benign
call, or the card can mix bytecode from one chain with ABI/simulation data and links from another. A user can
approve the wrong transaction based on that answer.

**Reproduction:** Delay explorer responses for address A, start its lookup, replace the input with B and invoke
Ctrl+Enter, let B finish, then release A. The final output describes A while the box contains B. Switching the
network during `readAddress` produces the cross-chain variant.

**Fix:** Capture an immutable `{chainId, rpc, explorer, input}` at the start, attach a monotonically increasing
request ID, and discard all writes from stale requests. Disable all input/network/example controls during a
lookup or explicitly cancel the prior request.

### M-02 -- Medium -- Some crashed/replaced wallet batches can never be reconciled

**Status:** Reasoned from source.

**Location:** `web/index.html:680-696`, `web/index.html:1034-1053`, `web/index.html:1288-1297`,
`web/index.html:1345-1358`.

**Trigger A:** `wallet_sendCalls` returns a calls ID, the pending entry is saved with `hash: null`, and the tab
closes before `waitForCalls()` returns a receipt hash. On reload, `reconcilePending()` only calls
`getTransactionReceipt(e.hash)`; it never uses the saved `callsId`. The row stays held forever whether the
wallet batch succeeded, failed, or was never executed.

**Trigger B:** A conventional transaction is replaced with a different/cancel transaction. The in-session path
correctly refuses to guess but leaves only the original hash in pending storage. That hash will never receive a
receipt, so reload cannot establish that the unpaid rows are safe to retry.

**Cost:** Unpaid recipients can be stranded from the tool indefinitely. Clearing storage releases them, but if
the unknown batch actually succeeded that workaround pays them twice. This does not meet the stated crash,
closed-tab, and replacement coverage.

**Reproduction:** Seed `bulksend:pending` with `via: "wallet"`, a valid `callsId`, `hash: null`, and one row; load
the matching run. It is held back forever because no chain query can resolve a null hash. The replacement case
is the same with an original hash whose receipt remains null.

**Fix:** Reconnect to the originating wallet and resume `wallet_getCallsStatus(callsId)` before attempting
hash-based reconciliation. Persist every replacement hash/nonce and inspect the sender+nonce transaction when
available. Add an explicit “resolve pending batch” UI that shows the evidence and can release rows only after
proving failure/cancellation; never make clearing all site data the recovery mechanism.

### M-03 -- Medium -- The delivered ledger silently forgets old rows

**Status:** Reasoned from source.

**Location:** `web/index.html:661-665`, `web/index.html:683-685`, `web/index.html:1064-1069`.

**Trigger:** Complete a lenient run of 20,001 unique rows, reload the same list, and send again. Every delivered
write uses `.slice(-20000)`, so the first row is no longer remembered and is treated as fresh. Pending storage
similarly keeps only the last 100 entries, without checking whether discarded entries were resolved.

**Cost:** Evicted delivered rows can be paid twice. Evicted pending rows can also be paid twice after an
interrupted collection of many unresolved runs. Neither limit is disclosed in the footer.

**Reproduction:** Preload the current run key with 20,001 row keys through the same write logic and then inspect
`workingList()` for the complete manifest; the first key is included. An end-to-end version is 20,001 ERC-20
or NFT rows across the allowed lenient batches, followed by reload.

**Fix:** Do not silently evict safety records. Store a campaign manifest and per-row state in IndexedDB, or
refuse further sending before capacity is exceeded and require a reviewed export/archive. Pending entries may
be deleted only after reconciliation, never because of list length.

### M-04 -- Medium -- Assignment overwrites a requested allocation with a partial one

**Status:** Reasoned from source.

**Location:** `web/index.html:797-841`, `web/index.html:843-861`.

**Trigger:** Ask for more ERC-721s than `myTokenIds()` returns, for example two wallets with `x2` while the
wallet owns three NFTs. The assignment loop stops when the pool ends, overwrites the textarea with only three
rows, and then parses that smaller list. A warning is appended to the bottom log, but the destructive rewrite
continues and no acknowledgement is required. An explorer pagination/API shortfall is also reported as if the
wallet truly held only the returned IDs.

**Cost:** One or more intended recipients are underpaid or dropped; with random assignment the affected wallet
is unpredictable. The later confirmation accurately describes the already-shrunken list, not the allocation
the user asked the Assign action to create.

**Reproduction:** Provide two bare wallet rows with `x2`, mock three owned IDs, click Assign, and observe a
three-line textarea that is immediately accepted for sending.

**Fix:** Fetch and validate the complete required inventory first. If fewer than requested are proven owned,
leave the textarea unchanged and fail closed. If partial assignment is a desired feature, show the proposed
omissions beside the control and require a second explicit confirmation before replacing the list.

### M-05 -- Medium -- A pending transaction is described as moving nothing

**Status:** Reasoned from source.

**Location:** `web/check.html:620-667`.

**Trigger:** Paste the hash of a transaction returned by `eth_getTransactionByHash` before it has a receipt.
The status pill says “not mined yet”, but `moves` is an empty array and the adjacent **What moved** card says
“No tokens and no ETH move.” The transaction may be mined a moment later and execute every requested movement.

**Cost:** A user can interpret the categorical movement statement as cancellation/non-execution and submit a
replacement or duplicate payment.

**Reproduction:** Mock a valid transaction and a null receipt. The existing transaction rendering path produces
both “not mined yet” and “No tokens and no ETH move.”

**Fix:** For pending transactions say “No receipt exists yet, so movements are unknown.” Optionally simulate
the pending call in a separately labelled **What it would do now** section.

### L-01 -- Low -- The publish script verifies availability, not deployed content

**Status:** Reasoned from source; current live content was checked separately and does match.

**Location:** `deploy/publish.sh:94-110`.

**Trigger:** Configure `URL_AIRDROP` or `URL_CHECK` to a custom domain still attached to an old/different worker,
or receive a successful HTTP 200 from a stale edge/origin. The script prints the URL and status and exits
successfully without comparing the response body to `$SRC`. The optional origin command is also not verified
for content.

**Cost:** A release operator can believe the published page matches the reviewed file when users are receiving
older or different code.

**Reproduction:** Point `VERIFY` at any HTTP-200 page and run the publish step with valid credentials; the final
check accepts it regardless of body.

**Fix:** Fetch the body and compare its cryptographic digest or bytes to `$SRC`; verify `/wc.js` as well for the
airdrop deployment. Fail on mismatch. Print both digests in release output.

## Promise boundaries and deliberate design decisions

- **Approval/authority:** For a normal token contract, the deployed BulkSend runtime has no owner, stateful
  configuration, fee, pause, upgrade, arbitrary-call entry point, receive function, or rescue role. Every
  requested transfer fixes `from = msg.sender`. An unrelated caller therefore cannot spend another user's
  approval to BulkSend. This stops being a meaningful guarantee when the selected “token” contract itself is
  hostile or non-conforming; BulkSend cannot make arbitrary external code honor token semantics.
- **Strict mode:** At the contract level, a revert unwinds the entire transaction. The client now prevents
  strict mode from spanning multiple transactions, and the wallet path asks for `atomicRequired: true`. The
  promise still depends on the wallet honestly implementing its advertised EIP-5792 atomic capability.
- **Lenient mode:** The bounded stipend is a defensible liveness tradeoff, but “cannot receive” is not literally
  what it proves. An honest receiver whose hook needs more than the chosen/default stipend is skipped even
  though strict mode or a larger stipend would deliver. The contract NatSpec and gas control disclose this;
  the preflight sentence at `web/index.html:1159` (“the token itself refuses”) should instead say “did not
  complete within this transaction's selected gas allowance.”
- **Ordering:** NFT/ERC-1155 rows are reordered by ascending token ID, but recipient-to-ID/amount pairing is
  preserved, transaction boundaries are shown before confirmation, and the downloadable manifest records the
  final order. I found no allocation change caused by this ordering itself.
- **Local storage:** Calling it a convenience is appropriate for cross-device/private-window/cleared-cache
  limits, but it does not excuse undisclosed same-browser failures that the page specifically claims to cover.
- **Ownerless/no rescue:** Keeping BulkSend ownerless is the right design. H-01 should be fixed in the client;
  adding a rescue administrator would enlarge trust and would not prevent arbitrary direct token transfers to
  the address anyway.

## Areas examined and found sound

- The current contract uses `msg.sender` as `from` in all ERC-721, ERC-1155 and ERC-20 calls. I found no path
  for the deployer or another caller to substitute a victim as `from`, change configuration, upgrade the
  contract, withdraw user assets, charge a fee, or receive ordinary ETH.
- Strict contract calls revert atomically. Client strict mode is disabled when the final list would require
  more than one transaction, and a failed wallet preflight is not silently filtered in strict mode.
- The earlier ambiguous ERC-20 fix is present: false, short and non-one return values revert the whole batch,
  undoing any state change. H-06 describes the remaining external-honesty boundary and trailing-data case.
- Zero recipients, zero ERC-20/ERC-1155 amounts, empty batches, length mismatches, EOA token addresses,
  EIP-7702 delegation designators used as token addresses, and BulkSend self-recipients through BulkSend's own
  entry points are rejected. Revert data is capped only on lenient calls; strict ERC-20 errors are bubbled in
  full.
- Skipped receipt reconciliation now matches recipient, ID and amount and consumes occurrences individually.
  Identical parsed rows receive occurrence-numbered keys. Successful identical transaction replacements are
  accepted only when destination and calldata match.
- ERC-20 is forced through BulkSend even when the wallet supports raw batching. Network changes clear parsed
  token state. Strict mode is one-transaction-only. These earlier-audit fixes are reachable in the running
  configuration.
- Amount parsing uses `BigInt`/`ethers.parseUnits` and rejects zero, negative, fractional NFT quantities and
  excess ERC-20 precision; I found no floating-point rounding in the accepted ordinary paths. Quoted commas are
  kept within a CSV field. H-05 is the remaining positional CSV defect.
- Check makes no signing or transaction-sending wallet request. Its only wallet method is
  `eth_requestAccounts`; RPC/explorer/price requests are read-only. Untrusted names, symbols, errors and event
  values are inserted as text rather than HTML, and external links use `noopener`.
- Check distinguishes explorer-unreachable from explorer-confirmed-unverified, warns for recognized unlimited
  approvals and collection-wide approvals, flags the proxy forms it recognizes, and decodes failure data
  conservatively when it cannot name a custom error.

## Deployment and verification evidence

- `https://rhairdrop.gmgnrepeat.com/` SHA-256 was
  `b36828b235f7d0ca145dbdece2b4e78edd202dc0a96a07a8c13cbe0369ad0297`, exactly matching `web/index.html`.
- `https://rhcheck.gmgnrepeat.com/` SHA-256 was
  `01a36d2563177c17ce032b542b8c0515232e7a42ed121a80c94831e6f8cfca30`, exactly matching `web/check.html`.
- Live `/wc.js` SHA-256 was
  `050632a7350b82f6c490631bfd4b167176eac36da3d38ec3cc7c6465e9a9c6b8`, exactly matching `web/wc.js`.
- The script extracted from `web/check.html` is byte-identical to `web/check.js`.
- Runtime code read with `eth_getCode` at
  `0xC6AE3189eDAE544Ed60ADf5Ec057E338ce224F74` hashed to
  `66be035c43f2d5801a23fa4f9e73487f10decb4117896f2f5a14f123eb6ffad3`, exactly matching the current
  `out/BulkSend.sol/BulkSend.json` deployed bytecode.
- I could not regenerate the artifact or run Forge because `forge` and `cast` were not available on this
  shell's `PATH`. Therefore the last item proves **chain runtime = current local artifact**, not independently
  **chain runtime = a fresh build from current source**. The artifact metadata says Solidity
  `0.8.36+commit.8a079791`, Cancun, optimizer enabled with 10,000 runs, matching `foundry.toml`.

## Test-suite assessment

`npm test` completed successfully: 37 airdrop-page checks and 33 Check-page checks.

The browser tests are deterministic and useful, but the green count is materially narrower than the promises:

- Check tests feed honest event semantics and ABI names. They do not cover fabricated/logless movements,
  harmlessly named privileged functions, partial verification conclusions, pending transactions, overlapping
  lookups, or network changes during a lookup.
- Client tests do not cover the BulkSend recipient on the direct wallet path, Web Locks absence/rejection,
  storage write failure, the 20,000/100 record caps, a hashless wallet pending record, blank named CSV cells, or
  insufficient inventory during assignment.
- The cross-tab test is currently only a same-page multiple-click test; it does not open two tabs/contexts and
  exercise the lock.
- The pending tests seed records that already have transaction hashes. They therefore do not exercise the
  wallet crash window that stores only `callsId`.
- Contract balance/ownership assertions are generally strong, including the regression test that proves an
  ambiguous ERC-20 return rolls back a transfer that already happened. The non-token test uses a contract whose
  missing function reverts; it does not cover a permissive fallback/no-op function that returns success. The
  suite also does not cover a 64-byte return beginning with word `1`.

I did not run the 75 Forge tests for the PATH reason above; this report does not silently treat the repository's
statement that they pass as an executed check.
