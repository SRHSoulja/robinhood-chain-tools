# Independent correctness, safety, and site-security audit

> **Status: every blocking finding in this report is fixed.** Published unedited. Seventh external review, and
> the first to cover hosting and supply chain alongside the code.
>
> The one worth reading is B-06. The reviewer followed this repository's own build instructions, rebuilt the
> WalletConnect bundle, and got a different file than the one being shipped: 2,092,782 bytes against 2,092,684.
> The digest chain from repository to browser was closed, but the link from *source* to repository was not, so
> nobody could show that the 2 MB script permitted to open wallet sessions was built only from the pinned
> inputs. The bundle has been replaced with the reproducible one, its expected digest updated deliberately,
> both were checked to load and export the same interface, and CI now rebuilds on every push and fails if that
> stops matching.
>
> B-01 is the other one worth naming: the lock introduced in the sixth round recorded *that* a lock was held
> rather than *which*, so a send holding run A's lock could write run B's ledger without ever taking B's lock.
> A fix from one round becoming the finding of the next has now happened twice in this project.

---

Reviewed commit: `021d8623f5126b46c7f3b39afc9aaeaada22c397`

Date: 2026-09-07

## Release bar and verdict

For a public wallet-connected tool handling real value, release-ready means that the transaction presented for signature is derived from exactly the network, sender, list, quantities, ordering, and execution model the user approved; uncertain payment state always remains held; every ledger mutation is serialized under the correct run; Check never substitutes evidence from another sender, chain, or request; and the production origin serves only reviewed signing code over authenticated transport. Limits that cannot be removed must be visible where a user would otherwise rely on them.

**Verdict: do not ship this commit for real-value use.** Six findings block release: the airdrop ledger can bypass the wrong run's lock; Check can merge separate JSON-RPC requests, simulate a batch as the wrong sender, and announce that every call succeeds after omitting a call; snapshot weighting can silently reuse balances from an earlier holder read; and the documented pinned WalletConnect build does not reproduce the shipped signing bundle.

This round nevertheless represents substantial progress. All 82 contract tests and all 149 browser tests pass. The deployed contract is an exact byte-for-byte runtime match. The live pages and WalletConnect bundle exactly match the repository. Plain HTTP now redirects, HSTS is present on both pages and `/wc.js`, and the live response CSP correctly names the sole inline script without granting `unsafe-inline` to scripts. The prior write-failure, same-run lock, receipt-accounting, wrong-chain single-envelope, ordered-simulation, and preflight-disclosure fixes are present and work in the cases their tests cover.

## Scope and method

I reviewed the checked-out commit and used `84f0314` as the previous-audit remediation baseline. Scope included the delivery ledger and snapshot allocation in `web/index.html`, parsing and simulation in `web/check.html`, `src/BulkSend.sol`, publishing, the two GitHub workflows, documentation claims, live hosts, and the tests. `lib/` and `src/research/` were excluded as requested.

Evidence consisted of source-level state and concurrency traces, a headless-Chromium parser demonstration, inspection of the assertions rather than only their totals, live HTTP/header/body checks, local-versus-chain runtime comparison, explorer verification, CSP/SRI digest calculation, dependency audit, and a limited secret-pattern scan of tracked source. No wallet was connected, nothing was signed, and no transaction was sent.

## Blocks release

### B-01 — A global “lock held” flag bypasses the lock for other runs

- **Severity:** High
- **Evidence:** Source-level concurrency trace
- **Location:** `web/index.html:1399-1485`, `web/index.html:1496-1519`, and `web/index.html:1756-1782`
- **Trigger/state:** Tab A starts run A and acquires Web Lock A. `runSend` sets the page-global `holdingRunLock = true`, then calls `reconcilePending(false)`. Reconciliation processes *all* pending records, including one for run B. When it calls `commitDelivered(B, ...)`, `withRunLock` sees only the global boolean and runs without acquiring lock B. Tab B can legitimately hold lock B and update B's delivered ledger at the same time.
- **User cost:** The B-ledger operations are read/merge/write sequences in `localStorage`. Cross-tab interleaving can let one write overwrite the other, after which each tab removes its own per-batch pending record. An already-paid B row can end up in neither the delivered ledger nor pending storage and be paid again. Cost is the duplicate token/NFT and gas.
- **Reproduction:** Put unresolved pending records for runs A and B in the origin. Begin run A in one tab and pause its B-ledger write after the read. In a second tab, hold B's lock and commit a different B row. Resume A. A is inside A's lock but bypasses B's; one of the two B rows can disappear while both pending entries are removed.
- **Fix/clear condition:** Replace the ambient boolean with the exact held key or an explicit lock capability. Bypass acquisition only when `heldRunKey === key`; otherwise acquire `bulksend:${key}`. Add a deterministic test that holds A while reconciliation reaches B and concurrently mutates B under B's real lock. This finding clears when that test proves both B rows remain and no pending row is released before its ledger write is durable.

### B-02 — Separate JSON-RPC requests are flattened under the last request's chain and atomicity

- **Severity:** High
- **Evidence:** Demonstrated through `window.__check.readInput` in headless Chromium
- **Location:** `web/check.html:989-1016` and `web/check.html:1044-1079`
- **Trigger/input:** Paste a JSON-RPC array containing two `wallet_sendCalls` requests. The first has `chainId: "0x1237"` (4663/mainnet) and `atomicRequired: true`; the second has `chainId: "0xb626"` (46630/testnet) and `atomicRequired: false`. Give each one a call. `readInput` appends both call arrays but overwrites its single `envelope` variable, returning both calls with only the second envelope's metadata.
- **User cost:** With Check set to testnet, a mainnet call from the first request is inspected and simulated at the same address on testnet. Independent requests are also described as one batch with the last request's atomicity and sender. A user can act on reassurance about a different contract and execution model.
- **Minimal input:** Two requests shaped as `{ "method":"wallet_sendCalls", "params":[{ "chainId":"0x1237", "from":"0x1111…1111", "atomicRequired":true, "calls":[…] }] }` and the same shape with chain `0xb626`, sender `0x2222…2222`, and `atomicRequired:false`. The demonstrated parse retained both calls but returned only the latter envelope.
- **Fix/clear condition:** Preserve JSON-RPC request boundaries and their chain, sender, and atomicity. Render and simulate each request separately. Reject multiple envelopes if the UI cannot do that safely; never flatten them. Add differing-chain, differing-sender, and differing-atomicity batch tests that prove no call receives another request's metadata.

### B-03 — Check ignores the sender box during ordered batch simulation

- **Severity:** High
- **Evidence:** Source-level data-flow trace
- **Location:** `web/check.html:706-724`, `web/check.html:1031-1034`, and `web/check.html:1069-1117`
- **Trigger/input:** Paste a raw JSON array with at least two ordinary calls whose entries do not contain `from`, then put the real wallet in “Whose transaction is it”. `simulateInOrder(parsedInput.calls)` runs first; `asCall` substitutes the zero address for every missing `c.from`. The later card code computes `sender = from || c.from`, but reuses the already-completed zero-address result at `ordered[i]`. It also suppresses the “Nobody was named as the sender” warning because the UI sender exists.
- **User cost:** Sender-sensitive behavior is evaluated for `0x0000…0000` and presented as the result for the named wallet. A hostile contract can return harmlessly when `msg.sender == address(0)` but transfer approved assets or take another branch for the actual wallet. Check can then show a successful, movement-free simulation that is not the transaction the user would send.
- **Reproduction:** Use a two-call raw array and a test contract whose first call returns without effects for the zero address but calls `token.transferFrom(msg.sender, attacker, …)` for other senders. Put a funded/approved victim in the sender box. Assert that the mock `eth_simulateV1` receives the victim for both calls and that the rendered movements come from those results; the current code sends zero instead.
- **Fix/clear condition:** Construct one canonical call list before simulation, applying an explicit and documented sender precedence. For canonical `wallet_sendCalls`, its envelope sender should be authoritative and a conflicting UI sender should be rejected or clearly treated only as the viewer. For raw calls, apply the sender box to every entry lacking `from`. Use that same list for ordered results, per-call warnings, and movement direction. Add assertions on the actual RPC request's `from` fields.

### B-04 — “Every call succeeds” can exclude a contract-creation/no-destination call

- **Severity:** Medium
- **Evidence:** Source-level execution trace; the existing test confirms display only, not the verdict
- **Location:** `web/check.html:1069-1103` and `test/web/check.test.mjs:428-434`
- **Trigger/input:** Paste `[ {"to":"0x…","data":"0x06fdde03"}, {"input":"0x60806040","value":"0x0"} ]`. Before ordered simulation, Check filters out every entry without a valid `to`. If the first call succeeds, it adds the green headline “Run in order, every call succeeds.” Only later does it add a red card saying the second call has no readable destination.
- **User cost:** The strongest batch-level statement is false: one member was never simulated. A user scanning the headline can act on an all-clear even though a contract creation, malformed destination, or otherwise unsupported entry remains unevaluated. The lower red card reduces likelihood but does not make the green statement true.
- **Reproduction:** Extend the existing H-05 test to assert that this exact input never contains “every call succeeds” and that no compacted ordered result is assigned to a later original index. The current assertion checks only that “2 calls” and “no destination” appear.
- **Fix/clear condition:** If any request entry cannot be included in the ordered simulation, do not issue an all-calls verdict. Either simulate contract creation faithfully or label the entire sequence incomplete. Preserve original indices rather than indexing a filtered result array with unfiltered positions.

### B-05 — Snapshot weighting can silently reuse an earlier collection's holdings

- **Severity:** Medium
- **Evidence:** Source-level UI/state trace
- **Location:** `web/index.html:192`, `web/index.html:431-446`, `web/index.html:813-877`, and `web/index.html:908-940`
- **Trigger/state:** Read collection A's holders, change the snapshot address to B, then let B's refresh fail or cancel it; alternatively, replace the list for another eligibility source. The global `snapHoldings` map and visible weighting row are not cleared and carry no displayed chain, collection, block, or source-list identity. “One for each one it holds” still applies A's balances to matching addresses.
- **User cost:** The confirmation claims an allocation based on what each wallet holds, but its quantities can be from an unrelated collection or earlier source. With the current cap, a matching recipient can receive as many as 999 units above an intended one-unit allocation. The rewritten list and total are visible, which limits severity, but the provenance statement the operator is relying on is false.
- **Reproduction:** Read A where X holds 300 and Y holds 1. Change `#snapAddr` to B, make the B explorer request fail, and then choose proportional weighting with cap 1,000. X is rewritten as `x300` despite the page having no B holdings evidence.
- **Fix/clear condition:** Replace the map with a snapshot object containing chain ID, collection, observed RPC range, holdings, and the source holder set. Show that identity beside the weighting control and in confirmation. Clear/hide it on network changes, snapshot-address edits, and failed/cancelled refreshes; refuse proportional weighting unless the current operation explicitly uses the bound snapshot. Add stale-address, stale-network, failed-refresh, and replaced-list tests.

### B-06 — The pinned WalletConnect build does not reproduce the shipped signing bundle

- **Severity:** Medium
- **Evidence:** Demonstrated by an in-memory rebuild; no repository artifact was overwritten
- **Location:** `web/wc-build/package.json`, `web/wc-build/package-lock.json`, `web/wc-build/README.md`, `web/wc-build/EXPECTED-SHA256`, and `web/wc.js`
- **Trigger/state:** Follow the documented build inputs with the installed locked dependencies: bundle `entry.js` using esbuild 0.25.10, `--bundle --format=esm --minify --platform=browser --target=es2020`. The result is 2,092,782 bytes with SHA-256 `d4c35a1b2b743b9f48b781730b171942a31d1b82d992b5d2dbb082b3843064d7`. The committed/live/expected file is 2,092,684 bytes with SHA-256 `050632a7350b82f6c490631bfd4b167176eac36da3d38ec3cc7c6465e9a9c6b8`. The first divergence is in esbuild's generated module helpers, consistent with a different build tool/output, but that does not establish the shipped file's provenance.
- **User cost:** The Worker-to-repository digest chain is closed, but the source-to-artifact link is not. A reviewer cannot currently establish that the 2 MB script allowed to create WalletConnect sessions consists only of the pinned source and dependencies. This does not prove the shipped bundle is malicious; it means the central anti-rewiring assurance is incomplete.
- **Reproduction:** Run the documented esbuild options with `write:false` (or in a disposable checkout), hash the result, and compare it with both `../wc.js` and `EXPECTED-SHA256`. The hashes above differ consistently.
- **Fix/clear condition:** Determine and document the exact original toolchain or regenerate `web/wc.js` from the committed lockfile/tool version, review the resulting change, and update `EXPECTED-SHA256` deliberately. Add CI that rebuilds in a pinned environment and fails unless the bytes equal both the committed artifact and expected digest. Then deploy and recheck the live digest.

## Should be fixed but does not block this release by itself

### S-01 — The send lock leaks when the storage probe fails

- **Severity:** Medium
- **Evidence:** Source-level control-flow trace
- **Location:** `web/index.html:1756-1779` and `web/index.html:1924`
- **Trigger/state:** `runSend` acquires the run's Web Lock and sets `holdingRunLock = true`, then calls `storageWorks()` *before* entering the `try/finally`. If storage is unavailable, it returns at line 1777; neither `releaseLock()` nor the flag reset runs.
- **User cost:** Nothing is sent, so this fails safely for funds. The tab nevertheless holds the run lock indefinitely and subsequent sends report that another tab is sending until reload/close.
- **Reproduction:** Use the existing storage-refusal test, then restore storage and press Send again in the same page. Assert that the second attempt can acquire the lock; current control flow cannot.
- **Fix:** Put every post-acquisition path inside the `try/finally`, or release/reset explicitly before this return.

### S-02 — Publishing can silently deploy HTML that was never committed

- **Severity:** Medium
- **Evidence:** Source-level deployment trace
- **Location:** `deploy/publish.sh:44-74` and `deploy/publish.sh:185-207`
- **Trigger/state:** Change the inline script while leaving the committed CSP meta hash stale, then publish. The script edits the tracked HTML in place to install the new hash and continues uploading. Post-publish verification compares production with that mutated working-tree file, so it passes even though production no longer matches `HEAD`.
- **User cost:** The current live files do match the reviewed commit, so there is no present drift. On a future publish, however, an accidental or unreviewed working-tree script can become production and appear verified locally. The six-hour external monitor should later catch the repository/live mismatch, leaving an exposure window.
- **Reproduction:** In a disposable checkout, change one inline-script byte without updating the meta CSP, run the publisher with a staging Worker, and inspect `git diff` plus the deployed body. The publisher repairs, uploads, and verifies the dirty source.
- **Fix:** Make publishing fail if the committed hash and script disagree or if the selected source differs from `HEAD`. Provide a separate explicit generator/update command whose result is committed and reviewed before deployment. Verification should compare production to bytes read from the target commit, not to a file the publisher just rewrote.

### S-03 — The workflow named as a bytecode equality check only checks for some code

- **Severity:** Medium
- **Evidence:** Source-level workflow inspection; manual equality check performed separately
- **Location:** `.github/workflows/tests.yml:20-27` and `.github/workflows/integrity.yml:74-83`
- **Trigger/state:** Commit a source change that produces different runtime bytecode without redeploying. The test workflow merely prints the built length. The integrity workflow passes for any on-chain result longer than roughly 49 bytes. Both remain green even though the source/deployment equality promise is false.
- **User cost:** This cannot change the already deployed, ownerless contract, and the runtime matches now. It can give reviewers a false green signal after a source or deployment-record change.
- **Reproduction:** Make a bytecode-changing source edit in a branch while keeping `deployments.testnet.json`; run the workflow scripts. Neither compares the two byte strings.
- **Fix:** Build with the pinned compiler/settings, fetch `eth_getCode`, compare exact normalized runtime bytes, and fail on any difference. Rename the test step if it remains only a build-size diagnostic.

### S-04 — Workflow executables are selected through mutable tags/tool versions

- **Severity:** Low
- **Evidence:** Supply-chain configuration review
- **Location:** `.github/workflows/integrity.yml:19` and `.github/workflows/tests.yml:14-17,28-34`
- **Trigger/state:** The workflows execute `actions/checkout@v4`, `actions/setup-node@v4`, `foundry-rs/foundry-toolchain@v1`, and `stable` Foundry rather than immutable revisions. If an upstream tag or release channel is compromised or retargeted, different code runs under the same repository commit.
- **User cost:** Both jobs explicitly have read-only repository permission and no production secrets, so I found no direct route from either workflow to Cloudflare or a wallet. The credible cost is falsified test/monitor results and loss of reproducibility, not direct deployment compromise.
- **Reproduction:** Resolve the tags/tool channel on two different dates; the repository itself does not constrain the resolved commit/binary to remain equal.
- **Fix:** Pin actions to full commit SHAs, pin a tested Foundry release, use `npm ci`, and use dependency-review/update automation to make changes explicit.

### S-05 — CSP retains an unnecessary third-party script trust edge

- **Severity:** Low
- **Evidence:** Live/source CSP and HTML inspection
- **Location:** `web/index.html:6,143`, `web/check.html:6,89`, and `SECURITY.md:17-21`
- **Trigger/state:** Both policies allow `https://static.cloudflareinsights.com`, but neither reviewed/live HTML body currently loads an Insights script—the live bodies are byte-identical to source. If a beacon is injected later, that host becomes executable code inside the wallet origin without SRI.
- **User cost:** Permission alone executes nothing today. It weakens the value of the otherwise narrow hash-based CSP and adds an avoidable external party to the wallet-signing trust boundary.
- **Reproduction:** Confirm that `static.cloudflareinsights.com` occurs in `script-src` but no script element references it. The ethers CDN is different: it is actually referenced and its downloaded bytes match the page's SHA-384 SRI value.
- **Fix:** Disable browser analytics on these origins and remove the source. If analytics is retained, document it as executable signing-page code and pin/self-host it where feasible.

### S-06 — The WalletConnect build graph contains currently flagged axios releases

- **Severity:** Low
- **Evidence:** `npm audit --omit=dev` in `web/wc-build`
- **Location:** `web/wc-build/package-lock.json` (`@coinbase/cdp-sdk@1.55.0` → `axios@1.16.0`)
- **Trigger/state:** Rebuilding the same dependency graph includes an axios release covered by current prototype-pollution, recursion/DoS, proxy, and body-limit advisories. npm reports one high and one moderate affected package grouping, with a fix available.
- **User cost:** I did not demonstrate that the WalletConnect browser path exposes any advisory trigger; several affected paths concern Node adapters. This is therefore not evidence that the live connector can be exploited. Leaving known advisories in a wallet bundle still makes future reachability and incident triage unnecessarily uncertain.
- **Reproduction:** Run `npm audit --omit=dev --json` in `web/wc-build`; root `npm audit --omit=dev` is clean. Relevant advisory records include [GHSA-gcfj-64vw-6mp9](https://github.com/advisories/GHSA-gcfj-64vw-6mp9) and [GHSA-mmx7-hfxf-jppx](https://github.com/advisories/GHSA-mmx7-hfxf-jppx).
- **Fix:** Update/override the dependency to a fixed release, rebuild `web/wc.js`, test all wallet paths, then deliberately update `EXPECTED-SHA256` and deploy the reviewed bundle.

## Inherent limits and required wording

### I-01 — Browser-local duplicate protection is not a payment registry

`localStorage` cannot coordinate another browser profile, device, origin, cleared cache, or restored backup. The present UI and README already say this clearly. Keep that disclosure beside Send and the held-row release path: “This browser's record can prevent accidental repeats here; the chain/explorer is the cross-device record.” No engineering change can turn browser-local state into a global ledger without adding a trusted shared service or on-chain state.

### I-02 — Token state and events are evidence supplied by the token, not independent proof

The live path's before/after holdings check is strong for conventional tokens, and reload correctly requires matching receipt events. A hostile token can lie in `ownerOf`/`balanceOf`, emit false events, accept a call while moving less/nothing, or make an unrelated concurrent balance change look like this batch's delta. The page already discloses most of this. The most precise wording is: “The token reports this balance/event; it can lie, and a balance change alone cannot prove which transfer caused it. Verify the transaction when the asset is untrusted.”

### I-03 — Explorer holder reads are not block-pinned snapshots

The RPC block numbers before and after the read show whether the chain head moved; they do not prove which block the explorer indexed. An explorer can lag, omit pages, or change while pagination is in progress. Replace “current holders”/“live reading” with “the explorer's latest indexed holder list,” and say it may already be stale or incomplete even if the two RPC block numbers are equal. Export/review the allocation before sending.

### I-04 — Check cannot establish intent or future behavior

Simulation describes one sender and one current chain state; miners/builders, prior calls, time, balances, approvals, and upgradeable implementations can change before execution. Verified source and selector names do not prove honest behavior. The current page is unusually good at stating these limits; preserve them, and ensure the sender/chain/request-boundary fixes above keep each warning attached to the evidence it actually qualifies.

## Areas examined and found sound

- **BulkSend contract:** 82/82 Forge tests pass. The entry points are nonpayable, ownerless, non-upgradeable, and have no rescue/admin/fee path. Transfers originate from `msg.sender`; strict mode reverts atomically; lenient mode treats ambiguous ERC-20 return data as failure rather than a skip; the per-recipient stipend and revert-data copy are bounded; transient reentrancy protection is present. I found no new Solidity blocker.
- **Arrival and recovery outside B-01:** Failed/unreadable holdings remain unknown; fee/short transfers are held; duplicate ERC-20/ERC-1155 destinations are grouped; reload confirmation matches token, recipient, id/amount, and receipt; BulkSend summary/skipped events are cross-checked; pending batches use per-PID keys; a delivered write is read back before pending storage is reduced. These are meaningful fixes over the prior rounds.
- **All-or-nothing and list fidelity:** Strict mode refuses multi-transaction splitting and refuses silent wallet-batch resizing. Integer parsing rejects fractional/ambiguous quantities, ordering is disclosed and exported, and final transaction boundaries are shown before confirmation.
- **Check read-only boundary:** Check requests an account only when “Use mine” is pressed. I found no signing or transaction-send method. Untrusted names/errors are inserted as text nodes, external links use `noopener`, unreadable code/source remains unknown, and nested-call limits are disclosed.
- **Current deployment identity:** `0x91949D7328387A3613b29E56f6979Ae893ccd23C` has 8,164 bytes of runtime code. Local and on-chain runtime SHA-256 are both `6f469f431974cd8a89bc6ec43b79b0f9f93e475d7f1e6d0b84f84a4756687083`. The explorer reports full verification with the expected Solidity source/settings.
- **Live artifact identity:** Airdrop HTML SHA-256 is `9fd2e8c918c8d3c5a0baa44d8117f4c37a8e9ce887481c4a64b39ca876cb1bbb`; Check is `375c719bb414aa5b87288fc31bee3a97198ef3cad14d0925304a41e0f910bfd8`; `/wc.js` is `050632a7350b82f6c490631bfd4b167176eac36da3d38ec3cc7c6465e9a9c6b8`. Each live body equals its repository file, and the connector digest equals `web/wc-build/EXPECTED-SHA256`.
- **WalletConnect artifact publication chain:** With `WC_BUNDLE_URL` configured, publishing hashes `web/wc.js`, refuses a mismatch with `EXPECTED-SHA256`, bakes that digest into the Worker, and hashes upstream response bytes before serving them. The live endpoint returns the repository artifact. With no bundle URL it fails closed by returning no connector. This is artifact-level integrity only; B-06 is the missing source-to-artifact link.
- **Transport and browser policy:** Both HTTP origins return 301 to the same HTTPS host. Both pages and `/wc.js` send `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `nosniff`, a referrer policy, and COOP. Page responses send CSP as a header and meta policy; the calculated inline SHA-256 values match, scripts do not receive `unsafe-inline`, framing/forms/objects/base changes are denied, and downloaded ethers 6.13.4 matches its SHA-384 SRI. Not preloading leaves the well-known first-ever-HTTP-visit downgrade window; the documentation accurately says HSTS protects a browser after it has seen the site. I do not make the deliberate no-preload choice a blocker: the preload service requires the registrable apex and every subdomain, is difficult to reverse, and currently advises that preload remain opt-in. Use only HTTPS links and reconsider apex preload if the entire domain can support that permanent commitment. See [HSTS preload guidance](https://hstspreload.org/) and [MDN's first-visit explanation](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Transport_Layer_Security).
- **Open-source exposure:** Publishing source does not give an attacker authority to alter the live Worker, DNS, wallet, or immutable contract. I found no literal private key, GitHub token, or PEM private key in tracked project source; `deploy/local.env` is ignored. The maintainer email is intentionally public and is not a finding. Account controls and token scope remain operator facts expressly excluded from this round.
- **Workflow privilege:** Both workflows declare only `contents: read` and contain no deploy credential or production mutation step. A pull request can execute test code on an ephemeral runner, but I found no repository-configured route from that runner into the live site. S-03/S-04 concern false assurance and reproducibility, not a demonstrated production foothold.

## Verification record

| Check | Result |
|---|---|
| `forge test` | 82 passed, 0 failed, 0 skipped |
| `npm test` | 149 passed (79 airdrop + 70 Check), 0 failed |
| `git diff --check` | clean |
| Local vs deployed runtime | exact match, 8,164 bytes |
| Explorer source verification | fully verified; bytecode not marked changed |
| Live airdrop / Check / connector vs source | all exact SHA-256 matches |
| WalletConnect rebuild vs committed artifact | **mismatch**: `d4c35a…` rebuilt vs `050632…` committed |
| HTTP redirect | 301 to same-host HTTPS on both origins |
| HSTS | present on both pages and `/wc.js` |
| CSP inline hashes | both exactly match the inline script bytes |
| ethers CDN SRI | downloaded SHA-384 exactly matches both pages |
| Root production dependency audit | 0 vulnerabilities |
| WalletConnect build dependency audit | 1 high + 1 moderate affected grouping; see S-06 |

## Test-suite assessment

The suites are substantive and catch many earlier regressions, but their green result is weaker than the release promises in six precise places:

1. The two-tab test covers the same run only; it never holds A while reconciliation writes B.
2. The canonical-request test covers one JSON-RPC envelope only.
3. Ordered-batch tests do not assert the sender actually placed in `eth_simulateV1` for raw arrays or conflicts.
4. The no-destination test asserts that the row is displayed but does not reject the contradictory green batch verdict or verify index mapping.
5. Snapshot tests cover one successful read/application only; they do not change address/network/list or fail a refresh.
6. No test rebuilds `web/wc.js` and compares it with both the committed artifact and `EXPECTED-SHA256`.

The storage-refusal test also stops after proving nothing was sent, so it misses the leaked lock. The workflow tests never exercise a stale CSP hash in a disposable checkout, the Worker connector mismatch path, or actual local/on-chain runtime equality.

## Acceptance checklist for the next audit

Release blockers clear only when all of the following are directly testable:

- A run-A lock cannot authorize any run-B ledger or pending mutation, and an adversarial two-tab interleaving preserves both records.
- Multiple JSON-RPC request envelopes are separated or rejected; no chain, sender, or atomicity metadata crosses a request boundary.
- Every ordered simulation uses the same effective sender shown to the user and used by its warnings/movement rendering.
- A sequence with any unsimulated entry cannot receive an “every call succeeds” verdict, and ordered result indices remain tied to original calls.
- Proportional weights are bound to and display their chain/collection/source; stale or failed refresh state cannot be applied.
- A pinned clean build reproduces `web/wc.js` byte for byte, CI enforces it, and the rebuilt digest is the one served live.

After those changes, rerun both suites, the live artifact/runtime comparisons, and the site-header/digest checks. The nonblocking items should be resolved before treating GitHub's green checks and the publish script as continuous provenance controls rather than useful monitoring aids.
