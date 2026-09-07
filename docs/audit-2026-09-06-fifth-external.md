# Follow-up correctness and safety review

> **Status: every finding in this report is fixed.** Published unedited. Fifth external review, run against a
> current checkout with the contract suite executable.
>
> The findings were about the arrival check added in response to the fourth review, which is the useful part of
> the result: a mechanism built to stop false "delivered" records became a new source of them, because a read
> that failed was rendered as a row that arrived. It has four outcomes now (arrived, short, missing, unknown)
> and only the first is ever written to the ledger. Anything else keeps the batch on the pending list, which
> holds those rows rather than releasing them, because a single negative read from a node one block behind is
> not proof that a mined transfer did nothing. A "Review held rows" action gives the operator a way out that is
> not "clear the whole ledger".
>
> Balances are now grouped by destination, because a balance belongs to an address and not to a row: two rows
> paying one wallet share one delta and are judged together.

---

Reviewed commit: `d33c52faf34c96ce77e67495d9b5bd2907a251ca`

Date: 2026-09-06 (America/Denver)

## Verdict

No: the web application is not ready to handle real-money distributions. The deployed `BulkSend` runtime is
the bytecode built from this checkout, and the contract's caller binding, strict rollback, bounded lenient
calls, return-data handling, and reentrancy protection remain sound. The release blockers are in the browser
accounting and in Check's parsing of the wallet format it claims to explain.

The remediation fixed the prior EIP-5792 status-600 error, replacement-calldata check, cross-run pending-record
overwrite, single-call code-read error, nested-call cutoff, ordinary proxy ABI carryover, and missing lockfile.
It did not close H-06. The new post-transfer check is bypassed after a reload, fails open when its reads fail,
records short payments, releases rows after potentially stale negative reads, and misattributes aggregate
balance changes when a recipient occurs more than once. Check also drops the actual `calls` array from canonical
`wallet_sendCalls` JSON.

I would fix H-01 through H-05 before enabling mainnet. In particular, an unknown or negative postcondition must
remain an unresolved pending state rather than becoming either "delivered" or immediately retryable.

## Findings

### H-01 — High — Reload recovery bypasses the new arrival check and records no-op transfers as delivered

**Status:** Demonstrated by direct source-path analysis. This is an incomplete remediation of the prior H-06.

**Location:** `web/index.html:1120-1169`, `web/index.html:1219-1290`, and
`web/index.html:1627-1629` / `web/index.html:1715-1717`.

**Trigger:** Send through either path and close the tab after the pending entry is written but before the live
post-transfer check finishes. On the next visit, return a successful receipt. For a wallet batch,
`reconcilePending` writes every row directly into the delivered ledger at lines 1279-1283. For a BulkSend batch,
it trusts `readBatchReceipt(...).delivered` and writes those rows at lines 1286-1290. Neither branch calls
`confirmArrival`.

A nonconforming ERC-721/1155 contract can return successfully without changing ownership/balances, and an ERC-20
can return true or nothing while moving nothing. The transaction and BulkSend summary both succeed because they
prove only that the token call did not revert. The uninterrupted path would now notice some such cases; closing
or crashing the tab restores the old false-delivery result.

**Cost:** Unpaid recipients are permanently written as delivered and suppressed on later runs. The UI reports a
successful catch-up even though the intended asset never moved.

**Reproduction:** Seed one `bulksend:pending:<pid>` record for a successful no-op token transaction and provide a
status-1 receipt. For the wallet path use `via: "wallet"`; for the contract path use `via: "bulk"` and a valid
same-token/same-sender BulkSend summary. Reload or call reconciliation. Assert that ownership/balance is checked
before the delivered key is written. The current code writes the key without issuing that read.

**Fix:** Persist the pre-send ownership/balance evidence needed for recovery in each pending entry. Re-run the
same postcondition during reconciliation and retain the pending record whenever the result is unknown, short, or
negative. For ERC-20/1155, snapshot by recipient and token id (where applicable), not by row. Add crash/reload
tests for no-op, fee-on-transfer, read failure, and repeated recipients on both delivery paths.

### H-02 — High — Failed reads and short payments are still counted and ledgered as arrived

**Status:** Demonstrated by source analysis; the public text states the opposite behavior.

**Location:** `web/index.html:122`, `web/index.html:1126-1169`, `web/index.html:1660-1680`, and
`web/index.html:1739-1754`.

**Trigger A (unreadable):** Make `ownerOf` or either balance read time out/revert after a successful receipt.
`confirmArrival` pushes that row into `arrived` at lines 1152 and 1161. Its outer catch returns every row as
arrived with `checked: false` at line 1168. Neither caller examines `checked`.

**Trigger B (short):** Use a fee-on-transfer ERC-20/1155 that increases the recipient balance by any positive
amount smaller than requested. Line 1164 adds the row to both `short` and `arrived`; callers warn and then write
it into the delivered ledger. This directly contradicts the page's statement that a token taking a cut is
"reported rather than counted."

**Trigger C (reporting):** On the BulkSend path, `sent += r.sent` occurs before the postcondition. Even when every
row is classified missing and none is ledgered, the terminal line still says `Finished. N delivered`.

**Cost:** A transient RPC failure or a partially paid transfer becomes a permanent completed ledger entry. The
recipient remains unpaid or underpaid, later runs suppress the row, and the summary can report deliveries that
the detailed line just said did not arrive.

**Fix:** Make the result three-valued: exactly arrived, definitely short/missing, and unknown. Only exact arrival
may enter the delivered ledger. Keep unknown rows pending. Keep short rows in a distinct unresolved/short state
and require an explicit operator decision before retrying them. Count final results from the postcondition, not
from the token-call summary. Tests should assert ledger contents and final totals for every branch, including a
rejected RPC request.

### H-03 — High — A stale negative post-transfer read makes a successful payment immediately retryable

**Status:** Reasoned from the two-provider flow and the unconditional pending deletion.

**Location:** `web/index.html:1141-1169`, `web/index.html:1638-1658`, `web/index.html:1671-1677`, and
`web/index.html:1741-1748`.

**Trigger:** The receipt is obtained through the wallet's `BrowserProvider`, then the postcondition is read from
a new provider using the public configured RPC. If that RPC is a block behind, `ownerOf` or `balanceOf` can
legitimately return the pre-transaction state. The row is classified `missing`. Both send paths nevertheless
delete the pending record after the check, so the row is neither delivered nor held. A user who follows the
message and sends again can pay the recipient twice once the RPC catches up.

The same race exists with reorgs and with an unrelated balance decrease between the before/after reads. A single
negative read is not positive proof that a mined transfer did nothing.

**Cost:** Duplicate ERC-721/1155/ERC-20 payments with conforming tokens; for NFTs, a retry may fail or send a
different planned row, while fungible-token retries transfer value twice.

**Fix:** Do not delete a pending entry merely because the first postcondition is negative. Wait for a configured
confirmation depth and query a consistent block/provider, then recheck. If the result remains negative, present
it as unresolved and require explicit review before releasing it for retry. Test a receipt provider one block
ahead of the configured RPC.

### H-04 — High — Repeated recipients reuse one aggregate balance delta for every row

**Status:** Demonstrated algebraically from the map keys and balance calls.

**Location:** occurrence keys at `web/index.html:660-664`; balance snapshots at
`web/index.html:1126-1137`; classification at `web/index.html:1157-1165`.

**Trigger:** Put the same ERC-20 recipient in two rows for 10 units each. `holdingsOf` makes the same
`balanceOf(recipient)` query twice and stores the identical result under `#1` and `#2`. If one transfer moves 10
and the other is a successful no-op, the post-batch balance delta is 10. `confirmArrival` computes that same
aggregate delta for both row keys, so both rows satisfy `got >= 10` and both are ledgered. A 50%-fee token has
the same result: a total increase of 10 is mistaken for 10 received by each row.

ERC-1155 has the same issue when recipient and token id repeat. ERC-721 is not affected because ownership is
checked per unique id.

**Cost:** The browser reports and records two full payments when only one row's amount arrived, permanently
suppressing the unpaid occurrence. The page expressly supports duplicate occurrences, making this an ordinary
input rather than a contrived malformed list.

**Fix:** Group balance postconditions by `(recipient)` for ERC-20 and `(recipient,id)` for ERC-1155, sum the
requested amounts for the group, and compare one before/after delta with that sum. If the aggregate is short,
no individual row can be safely attributed from balances alone; keep the whole group unresolved. Add two-row
tests for full, one-no-op, and fee-on-transfer outcomes.

### H-05 — High — Check discards every nested call in canonical `wallet_sendCalls` JSON

**Status:** Dynamically reproduced in Chromium against `window.__check.readInput`; confirmed against the final
[EIP-5792 request shape](https://eips.ethereum.org/EIPS/eip-5792#wallet_sendcalls).

**Location:** `web/check.html:958-976` (identical logic in `web/check.js`).

**Trigger:** Paste the JSON-RPC object a wallet/dapp shows:

```json
{
  "method": "wallet_sendCalls",
  "params": [{
    "version": "2.0.0",
    "chainId": "0xb626",
    "from": "0x1111111111111111111111111111111111111111",
    "calls": [
      {"to": "0x1111111111111111111111111111111111111111", "data": "0x06fdde03"},
      {"to": "0x2222222222222222222222222222222222222222", "data": "0x095ea7b30000000000000000000000003333333333333333333333333333333333333333ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}
    ]
  }]
}
```

The parser chooses the outer `params` array and maps its only object as though that object were a call. The
Chromium reproduction returned exactly:

```json
{"kind":"batch","calls":[{"to":null,"data":"0x","from":"0x1111111111111111111111111111111111111111"}]}
```

The two real calls—including an unlimited approval in the second position—never reach rendering. This is the
standard EIP-5792 shape: `params[0]` contains the `calls` array.

**Cost:** Check tells the user it is reading a one-entry destinationless request while hiding every transaction
the wallet is actually asking them to sign. A malicious approval or transfer can therefore pass completely
unmentioned through the format most relevant to the airdrop page's own wallet-batch path.

**Fix:** Normalize known envelopes before normalizing calls: for `wallet_sendCalls`, unwrap
`params[0].calls` and inherit outer `from`, `chainId`, and atomicity metadata. Preserve unknown envelope fields
as visible warnings rather than dropping them. Add the canonical EIP example and an unlimited approval as an
end-to-end test, not only a bare JSON array.

### M-01 — Medium — Check's batch renderer omits the single-call safety context

**Status:** Reasoned from the duplicated rendering branches.

**Location:** full single-call warnings at `web/check.html:892-948`; reduced batch branch at
`web/check.html:1005-1040`.

**Trigger:** Paste a bare JSON array whose call destination suffers an `eth_getCode` failure, is an upgradeable
proxy, or has no verified implementation. The single-call path prominently reports `codeUnreadable`, proxy
replacement risk, unverified code, explorer failure, simulation errors, and implementation uncertainty. The
batch path calls `readAddress` but renders none of those properties and catches a total read failure as `null`.
It only shows the conventional sentence, simulation success/failure when available, approval-specific warnings,
trailing bytes, and recognized inner calls.

**Cost:** The prior H-04 is fixed for a one-call JSON object but remains incomplete for arrays. Two byte-identical
calls receive materially different risk disclosure depending only on whether they were wrapped in a batch.

**Fix:** Use one call-card renderer for top-level single calls, batch elements, and inner calls. It should always
surface unreadable code, proxy/implementation state, verification uncertainty, simulation failure/error, raw
bytes, and the interpretation-source caption. Add parity tests across all three contexts.

### M-02 — Medium — An unreadable beacon is treated as the implementation

**Status:** Reasoned from the proxy-following state transitions.

**Location:** `web/check.html:382-407`.

**Trigger:** Read an EIP-1967 beacon proxy when the beacon address is known but calling
`beacon.implementation()` fails. The code sets `beaconUnread`, leaves `out.proxy.target` pointing to the beacon,
then continues as though that target were the implementation: it fetches the beacon's explorer ABI, sets
`proxy.verified` from the beacon, and reads the beacon bytecode. Calldata and the powers section can consequently
be interpreted against the beacon contract rather than the application code actually reached by the proxy.

**Cost:** Check can label the code as source-published and display the wrong ABI/power set while the real
implementation remains unknown. Selector collisions can also produce a confidently worded but unrelated call
description.

**Fix:** If the beacon will not reveal a nonzero implementation, stop proxy following. Clear the callable ABI,
mark the implementation and its verification/code as unknown, and do not scan the beacon as application code.
Test a verified beacon whose `implementation()` call fails.

### L-01 — Low — All-chain EIP-5792 capabilities under `0x0` are ignored

**Status:** Confirmed against the final EIP-5792 capability rules.

**Location:** `web/index.html:372-381`.

[EIP-5792](https://eips.ethereum.org/EIPS/eip-5792#wallet_getcapabilities) says capabilities supported on all
chains should be returned once under the special chain key `0x0`.
`detectWalletBatch` searches only for the selected hex/decimal chain id. A conforming wallet that reports
`atomic: {status: "supported"}` only under `0x0` is therefore treated as unable to batch.

**Cost:** The page falls back to BulkSend, asks for an approval, and cannot serve collections whose transfer
validator allows the wallet but not BulkSend. This is a feature/compatibility failure rather than a direct loss
of funds.

**Fix:** Merge/fallback to the `0x0` capability entry while allowing an explicit chain entry to override it.
Test supported, ready, unsupported, and override combinations.

### L-02 — Low — Live status 500 is reported as unknown until a reload

**Status:** Reasoned from the shared status decoder and its caller.

**Location:** `web/index.html:1727-1737` and `web/index.html:1764-1778`.

`readCallsStatus` correctly returns `reverted` for EIP-5792 status 500. `sendViaWallet` only releases a pending
entry for state `failed`; `reverted` falls into the generic non-confirmed branch, is described as the wallet
having stopped reporting, and remains held. Reload reconciliation does recognize and release it.

**Cost:** A fully reverted batch is temporarily stuck and the message is false, but the behavior fails safe.

**Fix:** Handle `reverted` alongside `failed` in the live path with its distinct accurate message and delete the
pending record there.

## Prior-finding remediation matrix

| Prior finding | Follow-up result |
|---|---|
| H-01: status 600 released rows | Fixed. One `readCallsStatus` function is shared; 600 remains partial and held. |
| H-02: different replacement accepted | Fixed for BulkSend. Original call fields are persisted and replacement `to`, `data`, and `from` must match. |
| H-03: cross-run pending-array overwrite | Fixed. Each pending batch has its own localStorage key and legacy entries are migrated individually. |
| H-04: failed `getCode` became no-code | Fixed for address and single-call views; incomplete in the separate batch renderer (M-01). |
| H-05: nested/input-only calls silently dropped | Fixed for bare arrays: the cutoff is explicit, inner trailing bytes/raw data are shown, and destinationless entries remain visible. Canonical `wallet_sendCalls` envelopes still fail (H-05 above). |
| H-06: accepted call counted as payment | Not fixed across reachable configurations; see H-01 through H-04. |
| M-01: ABI names presented as behavior | Fixed. The interpretation is labelled as convention immediately below the sentence. |
| M-02: proxy ABI carried into unknown implementation | Fixed for ordinary implementation proxies; unreadable beacons still take the wrong path (M-02 above). |
| L-01: `npm ci` impossible | Fixed. `web/wc-build/package-lock.json` is present and `npm ci` succeeds. |

## Areas examined and found sound

- `BulkSend` remains ownerless, non-upgradeable, non-payable, and caller-bound: every transfer names
  `msg.sender`; approvals cannot be used by a stranger through the contract.
- Strict mode bubbles token failures and rolls back the whole batch. Lenient mode caps forwarded gas and copied
  revert data, reserves gas to record outcomes, refuses zero/self recipients, and rejects ambiguous ERC-20
  return data by reverting.
- The transient reentrancy guard prevents a receiver from injecting convincing BulkSend events into the same
  receipt. Receipt parsing additionally requires the configured BulkSend, token, sender, one correct summary,
  consistent counts, and full-tuple single-use skip matches.
- The new per-entry pending storage removes the earlier cross-run whole-array lost-update shape. The run ledger
  is capped without silent eviction, is scoped by chain/account/token/standard, and occurrence keys preserve
  repeated input lines.
- Check inserts untrusted chain/explorer strings as text, uses `noopener`, loads ethers with SRI, and performs no
  signing or sending request. Its single-call code-read state, nested-depth warning, raw nested calldata, ABI
  interpretation qualifier, and ordinary implementation-proxy ABI reset are materially improved.
- `deploy/publish.sh` inlines reviewed HTML, pins `/wc.js` by the repository's expected SHA-256, adds clickjacking
  protection, syntax-checks the worker, and compares deployed bytes after publishing.

## Deployment and correspondence evidence

- `forge test` built from the pinned Solidity configuration. Runtime returned by testnet RPC for
  `0x91949D7328387A3613b29E56f6979Ae893ccd23C` exactly matches
  `out/BulkSend.sol/BulkSend.json` (8,164 bytes). The explorer reports fully verified `BulkSend`, Solidity
  `0.8.36`, optimizer enabled, Cancun; its source differs from `src/BulkSend.sol` only by one final blank line.
- `https://rhairdrop.gmgnrepeat.com/` is byte-identical to `web/index.html` at this review point. SHA-256:
  `95fec22393cf5f2a33e047b1b28198f8a8ed1d1e7f5c0190ccfeedc1dc3547e8`.
- `https://rhcheck.gmgnrepeat.com/` is byte-identical to `web/check.html`. SHA-256:
  `b3ad9f19d9e9d3993b64819448faeb90a5f1e70da02ba84cd1e88be8de27f74d`.
- Live `/wc.js`, committed `web/wc.js`, and `EXPECTED-SHA256` all identify
  `050632a7350b82f6c490631bfd4b167176eac36da3d38ec3cc7c6465e9a9c6b8`.
- The script extracted from `web/check.html` is byte-identical to `web/check.js`.

These are point-in-time correspondence checks, not guarantees about future mutable hosting or RPC responses.

## Test and dependency assessment

- Plain `forge test`: **82 passed, 0 failed**.
- `npm test`: **129 passed, 0 failed** — 68 airdrop assertions and 61 Check assertions.
- Root `npm audit`: no known vulnerabilities.
- `web/wc-build`: `npm ci` succeeds. Its installed dependency tree reports one high and one moderate advisory,
  both through Axios under `@coinbase/cdp-sdk`; searches of the committed minified bundle found none of the
  affected Axios/CDP code, consistent with it being tree-shaken out. This was not elevated to a shipped finding,
  but the build dependency should still be updated when upstream permits.
- A fresh WalletConnect build hashed differently from the committed bundle. The README explicitly disclaims
  byte reproducibility, and the publisher correctly rejects anything that differs from `EXPECTED-SHA256`; the
  committed file was restored after the check.

The green tests validate many prior fixes but omit the decisive branches above: arrival-read failures, short
payments, repeated recipient balance groups, stale post-receipt RPC state, post-crash arrival validation,
canonical `wallet_sendCalls` envelopes, batch/single warning parity, unreadable beacons, `0x0` capabilities, and
live status 500 handling.

## Readiness conclusion

The contract is suitable for continued testnet rehearsal with conforming tokens. The current web application
should not be enabled for real-money use: it can still suppress unpaid rows, release paid rows for duplicate
payment, and hide the calls in a standard wallet batch from its pre-signing explanation. Fix the five High
findings and add their stateful browser reproductions before another readiness decision.
