# Independent release audit — round 15

## Release bar and verdict

For a public real-money release, the value-moving page must bind the bytes and recipients sent to the exact input the user most recently reviewed, preserve quantities and row identity through every parser and transformation, and stop rather than guess when simulation or delivery evidence is incomplete. The read-only page must simulate the sender and request that were actually pasted and withhold favorable conclusions whenever a material field is unreadable or substituted. Authority must remain limited to the caller's approvals and signed transaction. Published assets and deployed bytecode must be reproducibly identical to the reviewed artifacts.

**Audit target:** `9426c2c6442ad9d5ca269053cfd21022d839eb80` (`fix round fourteen release blockers`). I verified that this was the exact `HEAD` before review. `git status --short --untracked-files=all` was empty at the start and end of the audit.

The prompt describes an older repository state at `790c9b5`; the commissioning instruction explicitly named `9426c2c6442ad9d5ca269053cfd21022d839eb80`, so this report audits the latter.

**Verdict: not ready for mainnet or a public real-money release.** Five findings block release. Two can cause the airdrop page to send a different recipient plan from the visible source data, one lets Check give a favorable answer for a different sender, one treats absent ordered-simulation evidence as success, and the production pages do not match the reviewed files. All five must be fixed and directly regression-tested; both sites must then be published from the reviewed commit and independently hash-checked before release.

## Findings that block release

### B-01 — Editing the recipient box after parsing leaves the old plan armed

**Category/severity:** blocks release; critical recipient-integrity failure. Demonstrated in a local browser with mocked RPC and wallet responses; no transaction was signed or broadcast.

**Where:** `web/index.html:208`, `web/index.html:784-813`, `web/index.html:1039-1049`, `web/index.html:1303-1309`, `web/index.html:2815-2819`, and `web/index.html:3013-3075`.

The page stores the parsed plan in the global `rows`. Token, standard, and network changes invalidate it, but the recipient textarea has no `input` or `change` listener. `finishParse` is the normal writer of `rows`. Both “Test run” and Send consume `workingList()`, which consumes those stored rows, not the current textarea. Consequently, a normal edit after “Check list” changes what the user sees but neither invalidates nor reparses the active plan.

**Exact trigger:** connect an ERC-721 wallet and select a collection; paste and check:

```text
0x0000000000000000000000000000000000000111,1
0x0000000000000000000000000000000000000222,2
```

Then replace the textarea contents, without pressing “Check list” again, with:

```text
0x0000000000000000000000000000000000000999,9
```

My deterministic Playwright run observed this after the edit:

```text
visible textarea: 0x…0999,9
parse summary:    2 recipients / 2 distinct wallets
plan:             2 recipients in 1 transaction
Send disabled:    false
```

The send path then derives `base` from `workingList()` and calls `preflight(false, base.list)` at lines 3069-3075. Its confirmation and eventual contract call are constructed from that old list. A final confirmation displays abbreviated old rows, but that does not make it safe for the primary input control to show a different list while Send remains armed.

**Cost to the user:** the old recipients can receive NFTs or tokens while the newly visible recipients receive nothing. Those transfers are irreversible and can strand assets or pay the wrong people.

**Reproduction:** the sequence above is sufficient; compare `#list`, `#parseOut`, `#plan`, `#send.disabled`, and the rows encoded by the subsequent preflight. This is absent from the 325-test client suite; its network-change invalidation test does not exercise direct textarea edits.

**Required fix to clear:** on every user-originated textarea `input`, synchronously invalidate `rows`, duplicate-delivery/held-row derived state, parse summaries, and manifests and disable Test run/Send until the current bytes have been parsed. A stronger design attaches a digest of the exact textarea contents to the parsed rows and rechecks it at the start of preflight and again while holding the send lock. Add a regression that parses A, edits the box to B, and proves neither simulation nor wallet/contract request can use A or B until B is explicitly parsed.

### B-02 — “Assign my token ids” ignores a named quantity column

**Category/severity:** blocks release; high, silent recipient underpayment. Demonstrated in a local browser with mocked holdings and independently confirmed from source.

**Where:** `web/index.html:2017-2037` and `web/index.html:2055-2084`; compare the canonical named-column parser at `web/index.html:1025-1037` and `web/index.html:1061-1258`.

Assign calls `boxColumns()` and uses the named address column, but derives quantity only by searching cells after the address for an `xN` token. It never reads `col.qty`. If no `xN` exists it silently substitutes the global “How many each” value.

**Exact trigger:** connect an ERC-721 wallet that owns at least five indexed IDs, leave “How many each” at 1, paste this directly, and press Assign without first transforming the box through another control:

```csv
address,quantity
0x0000000000000000000000000000000000000111,3
0x0000000000000000000000000000000000000222,2
```

My deterministic run asked the holdings reader for only two IDs and rewrote the list to two lines, one ID per wallet. The log said `Assigned 2 lines`; the subsequent canonical parser accepted the rewritten list without warning. Random assignment changes which IDs appear, not the fixed two-line underallocation.

**Cost to the user:** three intended NFT deliveries disappear before signing. Recipients are silently underpaid and the remaining NFTs stay with the sender despite the source file requesting five transfers.

**Reproduction:** use a mocked enumerable NFT with five owned IDs, invoke Assign on the CSV above, and assert both the requested holdings count and rewritten row count. Existing tests cover headed address-only input and recent Apply Weight/Shuffle fixes but not a headed quantity file entering Assign directly.

**Required fix to clear:** Assign must obtain quantities from the same semantic row reader as `parseList`/`deliveriesOn`, including named `quantity`/`amount` columns and quoted CSV. If the operation does not support a named shape, refuse it without altering the list. Add direct-entry tests for named and bare CSV, quoted metadata, `xN`, and invalid/fractional quantities, and require the transformed output to round-trip through the canonical parser with identical wallet/quantity semantics.

### B-03 — Check substitutes the UI sender for a single transaction's declared sender

**Category/severity:** blocks release; critical false safety verdict. Demonstrated in a local browser by capturing the simulation request.

**Where:** `web/check.js:1087-1155`, `web/check.js:1203-1207`, `web/check.js:1264-1305`, and `web/check.js:1502-1527`.

`readTransaction` correctly records the transaction's valid `from` as both the call sender and `declaredFrom`. The batch renderer also correctly gives the request sender priority and warns about differences. However, `readJsonRequests` collapses a single clean transaction into `kind: 'call'`. The single-call renderer then invokes:

```js
showCall(..., from || parsedInput.from, ...)
```

where `from` is the separate UI sender field. The UI value therefore overrides the transaction's own `from`. The shortcut condition also does not exclude `senderUnreadable`, so an invalid declared sender can be discarded and replaced by the UI sender without tainting the verdict.

**Exact trigger:** put `0x0000000000000000000000000000000000002222` in Check's sender box and paste:

```json
{"jsonrpc":"2.0","id":1,"method":"eth_sendTransaction","params":[{"from":"0x0000000000000000000000000000000000001111","to":"0x0000000000000000000000000000000000000721","data":"0x06fdde03"}]}
```

With deterministic RPC responses, Check sent `0x…2222` as the `from` in `eth_simulateV1`, displayed that the call would succeed, and showed no sender mismatch or unreadable-sender warning. The pasted transaction names `0x…1111`.

**Cost to the user:** `msg.sender` commonly controls authorization, balances, allowances, pricing, and branches. A transaction can succeed harmlessly for the substituted sender while failing or performing a privileged/value-moving action for the actual sender. The user receives a favorable answer about a transaction other than the one pasted and may sign or approve based on it.

**Reproduction:** intercept Check's RPC request for the JSON above and assert the simulated `from`; also assert the output has no mismatch warning. Repeat with a non-address `from` to show the unreadable declaration disappears through the shortcut.

**Required fix to clear:** a valid request-level sender must outrank the UI fallback in every renderer. Preserve `declaredFrom` and `senderUnreadable` through the single-call representation, show the same mismatch warning as the batch path, and withhold a transaction-level verdict for an unreadable explicit sender. Prefer removing the lossy shortcut for JSON-RPC transaction envelopes. Add single-request regressions alongside the existing multi-request tests.

### B-04 — Empty or short ordered-simulation results are announced as complete success

**Category/severity:** blocks release; high, false preflight statement and avoidable gas loss. Demonstrated with a deterministic RPC response and confirmed from source.

**Where:** `web/index.html:2873-2877`, `web/index.html:2901-2948`, and `web/index.html:3083-3089`.

For the wallet-batch path, the page asks `eth_simulateV1` to execute each atomic chunk in order. It then defaults a missing result to `[]` and only searches returned members for a non-success status. It never requires `calls.length === chunk.length` or validates every response member. Empty, short, null, or extra results therefore reach the log `Run in order as one transaction per batch: every transfer holds.` An exception would set `orderedCheckFailed` and require a specific “weaker check” confirmation before Send; a malformed successful response bypasses that protection.

**Exact trigger:** use an atomic-capable wallet with two ERC-721 rows; have the RPC answer the ordered request with:

```json
[{"calls":[]}]
```

and let both subsequent isolated `eth_call`s succeed. My run displayed:

```text
Run in order as one transaction per batch: every transfer holds.
Test run finished: 2 of 2 would be delivered.
```

**Cost to the user:** for a stateful token or receiver where each transfer succeeds alone but the second fails after the first in the same transaction (for example, a one-transfer-per-transaction rule or receiver cooldown), the real wallet batch reverts atomically. No recipient is paid and the sender loses transaction gas after being told the exact ordered check passed.

**Reproduction:** return zero or one result for a two-call chunk, then make isolated calls succeed. The same test should cover absent `calls`, null entries, missing/invalid status, and extra entries. The Check page's ordered simulator already performs a result-count check (`web/check.js:690-696`), demonstrating the expected validation shape.

**Required fix to clear:** require exactly one well-formed response for every requested call, in order, with a recognized success status. Treat any cardinality or shape mismatch as ordered simulation unavailable, set `orderedCheckFailed`, state that only isolated checks ran, and require the existing explicit weaker-check confirmation. Add zero/short/null/extra-result regressions.

### B-05 — Neither deployed HTML page matches the reviewed artifact

**Category/severity:** blocks release; high release-integrity failure. Demonstrated with read-only HTTPS fetches and exact hashes.

**Where:** deployed `https://rhairdrop.gmgnrepeat.com/` and `https://rhcheck.gmgnrepeat.com/`; repository claims at `docs/for-reviewers.md:14-19` and `docs/status.md:100-108`.

Read-only fetches produced:

| Artifact | Live SHA-256 | Reviewed SHA-256 | Historical match |
| --- | --- | --- | --- |
| airdrop HTML | `7d557aa114cae2c357e79fe1721ba7c6634eff6a5aa75d0c14f5143e91062238` | `f3098ea0524214d05e4958134275829e46ea5b104ac5ffdb5fc38983b0792e96` | `790c9b55…` |
| Check HTML | `6fd92f7b7fe97ee13543f0536630c53197c5324dbc464b26dd31961a44df03b3` | `478a0a5d52703d1837b3eac4acd984c52ca5888cc52e9c8e83ec55a9e553c13c` | `e2e204aa…` |

The live airdrop page's staleness is partially disclosed. The live Check mismatch is not: `docs/for-reviewers.md` says Check is currently byte-identical, and `docs/status.md` marks both deployed pages matching as complete. The live Check version also predates the current fix for mixed top-level JSON request tainting, so a known false-verdict behavior remains public.

The deployed contract is not affected: its full runtime bytecode exactly matched the locally built 9,752-byte runtime. The live `/wc.js` also matched the reviewed bundle.

**Cost to the user:** users are not running the code this audit reviewed. In particular, users of the stale Check page can act on a false whole-request verdict already fixed in the repository. A clean source review cannot support a mainnet release of different bytes.

**Reproduction:** fetch each HTTPS root without content transformation, hash it, hash the corresponding `web/*.html`, and compare. Historical tree hashes identify the versions above. The mismatch also contradicts the cited status claims.

**Required fix to clear:** first fix and review B-01 through B-04, then publish both pages from one explicitly identified reviewed commit. Verify externally fetched bytes against that commit, verify the response-header CSP hashes authorize those exact inline scripts, and correct the status/reviewer documentation. Make the deployment-hash check a release gate, not a historical checkbox.

## Should be fixed but does not block release

### S-01 — Paste guards forward uncontrolled work and copy unbounded returndata

**Category/severity:** should fix; medium denial-of-service/gas-grief risk. Reasoned from EVM behavior and source; I did not spend gas against a hostile deployment.

**Where:** `src/BulkSend.sol:396-407`, `src/BulkSend.sol:427-430`, and `src/BulkSend.sol:451-466`.

The high-level `staticcall` expressions forward essentially all available gas subject to EIP-150 and materialize arbitrary returndata as dynamic `bytes`. A hostile token can make `supportsInterface`, `isApprovedForAll`, or `ownerOf` consume gas or return a very large buffer. These checks run before transfers; `_mustNotBeNft` runs all applicable probes for every ERC-20 batch.

**Trigger:** paste a contract whose probed fallback deliberately burns gas or returns a returndata bomb, approve it if necessary, and submit a batch.

**Cost:** the batch reverts before moving value, so this does not create a false delivered/skipped result. The sender can nevertheless lose most of the transaction gas; the comment's “about 10,000 gas” is not a bound against adversarial code.

**Suggested fix:** use fixed-size assembly `staticcall`s with explicit gas caps, read only the expected word, and inspect `returndatasize` without copying arbitrary data. Treat cap exhaustion or noncanonical shape as “did not answer.” Add burn-gas and large-returndata fixtures for all three selectors and measure the caller's bounded worst case.

### S-02 — Probe fingerprints bind output wording, not the probe implementation

**Category/severity:** should fix; medium evidence-integrity weakness. Demonstrated by source inspection. This is not a claim that current probes are fabricated; it is a gap in what the gate proves.

**Where:** `verify.sh:58-66` and `verify.sh:98-129`.

The two ordinary browser suite files are source-hashed, but reviewer web probes are fingerprinted only from status/assertion-name output. Solidity probe fingerprints similarly contain only sorted PASS/FAIL plus test names. A probe body can be replaced by a constant outcome while keeping the same names and baseline fingerprint. Separately, the Forge aggregate treats any failing test whose function name contains `test_probe_` as an expected probe failure, regardless of source file.

**Trigger:** weaken a probe implementation while preserving its emitted names and status, or name an ordinary failing Solidity test `test_probe_*`; the relevant fingerprint/filter does not distinguish it.

**Cost:** no direct runtime loss, but CI can continue presenting closed-finding evidence after the executable evidence was weakened. This matters because four release defects in this report were not caught by the otherwise broad green browser suites.

**Suggested fix:** baseline the complete source hash and discovered file inventory of every probe, as is already done for the two ordinary browser suites. Scope expected Forge failures by explicit probe file and exact test inventory rather than a function-name substring. Require intentional reviewed baseline changes when probe source changes.

## Inherent limits and what the product should say

### L-01 — Token-standard detection cannot prove an adversarial contract's semantics

The selector guards are useful mistake barriers, not proof that an address implements the selected standard. A legitimate ERC-20 with a permissive one-word fallback can be conservatively refused by the operator/165 probes. Conversely, a nonconforming NFT with no ERC-165/operator answer and dead probed IDs can pass the residual heuristic. Hybrids are intentionally refused. The page should continue to say that nonstandard, hybrid, and permissive-fallback contracts may be unsupported and that passing detection is not certification of token behavior.

The `_mustBeNft` asymmetry is reasonable: adding `isApprovedForAll` would also admit ERC-1155. A conventional ERC-1155 pasted into the ERC-721 form is refused by the 721 interface/`ownerOf` evidence before either strict or lenient transfer loop; the tested standard case does not spend an edition as an NFT.

### L-02 — Simulation and post-transfer reads are only as honest as the RPC and token

A malicious token can lie in `ownerOf`, balances, events, or view calls, and one RPC can censor or fabricate state. `unheldIds` is correctly advisory and the per-row execution remains the real gate, but a lying `ownerOf` or reorg can make its warning inaccurate. The product should say that simulation predicts execution against one node and block state, and that token-reported ownership/balances are evidence from that contract, not independent proof. Where practical, compare transaction receipts and multiple independent reads after value moves.

### L-03 — Browser-local duplicate protection cannot cover another device or erased storage

The pre-wallet pending record, per-run Web Lock, receipt reconciliation, and conservative handling of unknown wallet errors are sound within one browser profile. They cannot coordinate a different device/profile, cleared site data, or private storage. A hashless wallet request may remain unknowable until the wallet exposes status; manual release can then re-enable a double payment. The page should keep the current strong warning: do not release held rows until wallet activity and the chain have been checked, and understand that “Forget” can pay again.

### L-04 — Lenient receiver gas allowance is a policy choice

The gas-capped lenient paths can skip a legitimate receiver whose hook needs more gas; strict mode forwards the transaction's available gas and remains atomic. The page exposes the allowance and contract bounds. It should continue to say that a skip can mean “could not execute within the chosen allowance,” not that the recipient is intrinsically incapable of receiving.

### L-05 — Assets sent directly to BulkSend are unrecoverable by design

The contract has no owner, upgrade path, rescue function, or mutable authority. That is a strong authority property, but tokens transferred directly to the contract and forced ETH cannot be recovered. The UI and documentation should keep this explicit and distinguish approval to pull from a wallet from transferring assets into the contract itself.

## Areas examined and found sound

- **Contract authority and transfer accounting:** `BulkSend` has no owner, upgrade, mutable storage authority, arbitrary-call endpoint, or rescue path. Transfer source is `msg.sender`. Strict paths revert the whole transaction on any failure. Lenient paths count a row as skipped only on an unambiguous failed external call; ambiguous ERC-20 return values revert the batch. The deliberate `false` decision remains the conservative one because the included `PaysThenLies20` fixture proves that “returned false” does not establish that no value moved.
- **Contract standard guards:** on the read-only mainnet fork, all 20 sampled NFT collections were accepted by the NFT guard and refused by the ERC-20 guard; all 20 sampled ERC-20s were accepted. The residual heuristic limits are described above rather than misclassified as proof.
- **Randomized contract behavior:** both invariant tests completed 96 runs/2,304 calls with zero handler reverts. The new direct ERC-20 approval-withdrawal invariant path executed. The full non-probe Solidity suite passed.
- **Pending-send lifecycle:** records are written before wallet invocation, definite rejection removes them, unknown outcomes stay held, a returned hash updates the same record, receipt identity/summary checks are conservative, and duplicate protection uses per-run browser locks. Multiple clicks and multiple-tab cases have direct passing tests.
- **All-or-nothing and lenient contract paths:** strict atomicity and lenient continuation behavior are covered by example, invariant, receipt, false-return, and malicious-token fixtures. I found no path that records an ambiguous contract return as skipped or delivered.
- **Reader transformations other than B-01/B-02:** the current Shuffle and Apply Weight changes preserve named columns and quoted metadata in the exercised shapes, and their output is reparsed. `serializeRow` preserves delimiter-bearing cells. The newly fixed round-fourteen direct cases passed, but those tests do not close the uncovered direct-Assign and post-parse-edit states above.
- **Cost quote binding:** measured-gas cache keys include chain, token, standard, safe-transfer choice, account, and representative row. Gas-price reads are chain-specific; fallback is labeled as a fallback rather than a ceiling. I found no wrong-token or wrong-chain reuse in the reviewed paths.
- **Check's remaining request reader:** multi-request rendering preserves source order, sender precedence, invalid-member taint, chain ID, capabilities, and refused top-level entries. It checks ordered-simulation cardinality. The single-request shortcut is the exception reported as B-03.
- **Read-only nature of Check:** no path signs or broadcasts. Wallet access is used only to obtain an address when the user requests it; contract and transaction analysis uses read-only RPC methods.
- **Error wording:** all 15 current contract errors are mapped on both pages, and preflight verifies the maps.
- **CSP and transport:** both HTTP hosts permanently redirect to HTTPS. HTTPS roots, `/wc.js`, and examined error/redirect responses carry HSTS and expected hardening. Response and meta CSPs omit `unsafe-inline`, pin the single inline script hash, and include `frame-ancestors 'none'`. The 21 negative CSP-gate cases passed. Not using HSTS preload is a defensible operational choice and not a finding.
- **WalletConnect supply chain:** rebuilding `web/wc-build/entry.js` produced the exact shipped `web/wc.js` digest `d4c35a1b2b743b9f48b781730b171942a31d1b82d992b5d2dbb082b3843064d7`, which matches `EXPECTED-SHA256`. The live bundle has the same digest. The advised Axios-family packages are build-graph-only: none of `axios`, `form-data`, `follow-redirects`, or `proxy-from-env` occurs in the shipped bundle.
- **Deployed contract:** read-only `cast code` returned exactly the local `deployedBytecode.object` for `0xf2eD6359F5deE0334d68cd21d306D9D3E7a49232`: 9,752 bytes, SHA-256 `2df1c04ff913e0aa18db793be5e18fb085c47d5f812a5471f3b49e074f382f87`.
- **Workflows:** both workflows use read-only repository permissions and pinned actions. Untrusted pull-request code is not given deployment credentials. The integrity job's issue-writing ability runs in trusted scheduled/manual context. I found no workflow path to signing, deployment, or token movement.

## Verification performed

All execution was local/read-only or a gasless RPC/fork read. I did not run any `live-send*` script, sign a transaction, broadcast, deploy, spend gas, or move tokens.

- `./preflight.sh`: passed all checks.
- `forge test`: 144 tests total, **135 passed and 9 failed**. All nine failures were the expected reviewer-probe failures; every non-probe suite passed.
- `forge test --match-path 'test/fork/MainnetGuards.t.sol'` as part of the full run: 4 passed; the 20/20 NFT and 20/20 token sample guards agreed with their intended forms.
- `node test/web/client.test.mjs`: **325 passed, 0 failed**.
- `node test/web/check.test.mjs`: **125 passed, 0 failed**.
- `./test/csp-gate.test.sh`: **21 passed, 0 failed**.
- `./verify.sh`: passed. It matched every discovered historical probe count and output fingerprint to `test/findings-baseline.json` and reported that no closed finding reopened. S-02 explains the narrower claim those output fingerprints actually support.
- Rebuilt WalletConnect bundle with the repository's esbuild command and compared exact SHA-256: match.
- Root production dependency audit: 0 vulnerabilities. WalletConnect's transitive Axios-family advisories were checked for shipped-code reachability and were absent, as scoped by the prompt.
- Read-only deployed contract bytecode, page/bundle hashes, redirects, HSTS, and CSP headers were checked independently.
- Focused Playwright reproductions demonstrated B-01 through B-04 using mocked wallet/RPC answers and no chain write.

## Limits of this audit

I did not inspect vendored `lib/`, unused `src/research/`, private keys, Cloudflare/registrar control planes, deploy-token scope, DNSSEC, CAA, or the Reown allowlist, as directed. I did not test a real browser extension or hardware wallet. I did not execute the live scripts because each signs or broadcasts; the commissioning instruction for this audit expressly prohibited that even on testnet. Historical live-send claims were therefore reviewed as claims and tests, not independently repeated.
