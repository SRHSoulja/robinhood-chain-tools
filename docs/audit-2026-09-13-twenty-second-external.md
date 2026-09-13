> Editor's note (maintainer): this is the reviewer's report exactly as delivered, copied from
> [`audit/2026-09-13/REPORT.md`](../audit/2026-09-13/REPORT.md), beside which its reproduction artifacts and its
> relative links live. The test it added is adopted at `test/FloorAudit.t.sol`; the final verification bundle from
> the same run is under [`docs/verification-2026-09-13/`](verification-2026-09-13/).

# BulkSend security and practical gas-floor audit — 2026-09-13

## A. Executive verdict

**The router has a production-quality design, with no mainnet-blocking authorization or asset-routing defect found in this pass. Gas efficiency is good and already close to a practical safe-loop floor.** Its useful safety policies explain most of the remaining difference, particularly for small batches and lenient execution. Shape specialization does not justify a new deployment or execution planner on the evidence below. This is a bounded source review and local benchmark, not a certification of arbitrary tokens, wallets, RPC services or the live deployment. Production files, dependencies, deployment configuration, frontend and existing documentation were not changed.

## Architecture and provenance

- Initial git status was clean. Reviewed repository HEAD: `3cba293ed26229b2a29cff7e3a3d797e4c9d1647`.
- **Production:** [`src/BulkSend.sol`](../../src/BulkSend.sol), including three small token interfaces. Six distribution entry points: ERC-20, ERC-721 and ERC-1155, each with default and custom lenient stipend variants. All pull directly from `msg.sender`; none accepts a user-specified source wallet. No owner, fees, persistent accounting, proxy, upgrade, withdrawal or ETH distribution.
- **Modes:** strict reverts the entire transaction on failure; lenient skips reverted transfer calls, caps each call's gas and caps retained return data at 128 bytes. Ambiguous successful return values and structural/safety failures still revert the entire transaction. ERC-721 alone offers safe/unsafe transfer selection. Custom stipend is lenient-only, 100,000–5,000,000; default 400,000.
- **Frontend:** [`web/index.html`](../../web/index.html), human-readable embedded ABI, ethers integration, exact ERC-20 approvals, NFT operator approvals, receipt matching and post-transfer holdings checks. `deliveryPath()` routes ERC-20 through BulkSend even when the wallet supports batching; NFT paths may use atomic `wallet_sendCalls`. `orderForDelivery()` sorts whole NFT rows, preserving recipient/ID relationships. Wallet batching and contract leniency are different failure models. The separate Check page reads assets/contracts; WalletConnect is bundled from `web/wc-build`.
- **ABI/build:** Foundry generates artifacts; the frontend ABI is maintained inline, not automatically generated. `preflight.sh` builds the current error ABI and checks both pages' error coverage. `web/sync.sh` synchronizes Check JavaScript and CSP hashes, not contract ABI functions.
- **Deployment:** `script/Deploy.s.sol` separates testnet/mainnet chain guards; `script/Rehearsal.s.sol` supplies fixtures. Manifest mainnet chain 4663 address: `0x904412cfe982f33385f486aaff8c8a4a6f4b5fbf`. Testnet chain 46630 address: `0xf2ed6359f5dee0334d68cd21d306d9d3e7a49232`. Current source SHA-256 and compiled runtime hash match `deployments.mainnet.json`; runtime is 9,752 bytes. This pass did **not** independently fetch live chain bytecode.
- **Toolchain actually used:** Solidity `0.8.36` (source pragma `^0.8.24`), Cancun, optimizer 10,000 runs, legacy codegen, `via_ir=false`. Local Forge/Anvil 1.8.1, Node 24.14.1. CI pins Foundry 1.4.1 and Node 22.20.0, so local execution is not an exact CI tool-version reproduction. Vendored token package manifests identify OpenZeppelin 5.1.0 and ERC721A 4.3.0. Production imports neither library; benchmark fixtures do.
- **Tests/CI:** `BulkSend.t.sol`, `BulkSendReal.t.sol`, `Invariants.t.sol`, `Reentrancy.t.sol`, `IdAmountProbe.t.sol`, historical `Audit*.t.sol`, and live-state `test/fork/MainnetGuards.t.sol`; browser/worker/readers and shell gates under `test/`. `.github/workflows/tests.yml` invokes `verify.sh`, compares deployed runtime and checks connector reproducibility; `integrity.yml` monitors served artifacts. Historical probes intentionally include failures and are fingerprinted against `test/findings-baseline.json`.
- **Prior gas evidence:** `.gas-snapshot`, gas tests inside ordinary and audit suites, `docs/gas-and-batches.md`, testnet receipts and prior audit reports. Test-function snapshots include setup work; `gasleft()` measurements following mint/approval can have warm or dirty storage. Historical remote estimates additionally include chain-specific behavior and lenient headroom. None is automatically an interchangeable receipt-gas floor measurement.
- `src/research/{Batch7702,SelfBatch}.sol` are research helpers, not production dependencies or frontend-selected deployed contracts.

## B. Security and correctness

**No critical, high or medium exploit was demonstrated.** The following are real limitations, distinguished from exploitable defects.

| Severity | Finding / exact location | Evidence and failure scenario | Minimal fix / gas effect |
| --- | --- | --- | --- |
| Informational, already documented | Direct deposits can be irrecoverable; `BulkSend` has no rescue surface | New `testDirectDepositsCanBeStuckDespiteNormalPathBeingNoncustodial`: direct ERC-20 transfer, unsafe ERC-721 deposit and forced ETH leave assets at BulkSend. `SelfRecipient` protects routed transfers only. | No contract change recommended. `SECURITY.md` already warns that deposits are lost. Adding rescue authority introduces a new trust policy; not a gas optimization. |
| Low availability limitation | `_mustBeNft`, `_mustNotBeNft`, `_answersOwnerOf` use uncapped staticcalls and dynamic returndata | New `testLenientDoesNotBoundMaliciousClassificationCalls`: gas-burning fallback exhausts a bounded transaction before transfer iteration. A return bomb can similarly exhaust caller memory/gas. Requires selecting the hostile token; affects that caller's transaction, not other batches or approvals. | No blanket stipend cap recommended: it can reject expensive legitimate ownership probes. Treat the lenient guarantee as transfer-loop containment. A separately reviewed bounded classification policy is possible only if hostile-token support becomes a product requirement; normal-path savings unproven. |
| Informational, compatibility boundary | `_airdrop20` and NFT call-success counters do not prove economic delivery | Existing no-op, fee-on-transfer and impersonator fixtures show successful calls without exact requested receipts. A token can also lie in `balanceOf`, `ownerOf` or events. Classification is heuristic and can refuse hybrids/custom ERC-20 extensions. | Preserve post-transfer checks and held-row handling. No generic balance-check addition can authenticate an adversarial token. No production fix or gas saving claimed. |
| Informational, deliberate mode | `_airdrop721(... safe=false ...)` can send NFTs to contracts unable to recover them | Existing deaf/wrong-magic/rejecting receiver tests distinguish unsafe transfers from safe callbacks. | Keep safe default and explicit user choice. Replacing safe transfers to save gas weakens recipient protection. |

### Why the important properties hold

**Authorization and approvals.** Every transfer uses the original call's `msg.sender` as `from`; a third party cannot spend someone else's allowance merely by knowing the router address. Tests cover stranger calls across all standards and revoked approvals. The router never approves another spender, delegatecalls token code, or accepts arbitrary call data. NFT single-ID approvals work on chain even though the frontend normally requests operator approval. Exact ERC-20 approval/reset behavior is in the frontend. Concurrent owner transactions can consume balances/allowance between simulation and execution; token enforcement and atomic rollback remain authoritative. There is no public pull function with a freely chosen victim source.

**Reentrancy and external calls.** All six distribution entry points share the transient guard. A nested callback cannot inject router summary/skip events, steal another sender's assets, or bypass the lock through another standard. A receiver may catch the rejection and still accept its original transfer; otherwise the transfer reverts or is skipped. Back-to-back non-nested batches work. The three lock opcodes alone cost roughly 300 gas per successful batch, plus surrounding instructions: cheap fixed protection. Transient state rolls back with a revert and resets between transactions. See [EIP-1153](https://eips.ethereum.org/EIPS/eip-1153).

**Return values and failure atomicity.** ERC-20 accepts exactly empty data or one 32-byte word equal to one. False, malformed or extra data after a successful call reverts the entire batch, including earlier transfers. This conservatively handles a token that pays then returns false. A reverted token call has already rolled back its own effects and is safe to skip. Strict ERC-20 retains full revert data; lenient copies at most 128 bytes. Truncation cannot turn an oversized answer into accepted ERC-20 success because 128 is still neither zero nor 32. NFT void-return validation rejects nonempty successful answers. Existing nested-call tests verify the checked `returndatasize` belongs to the transfer call. False is a valid ERC-20 failure signal; treating it as batch-fatal is deliberate, not full skip-on-false compatibility. See [ERC-20](https://eips.ethereum.org/EIPS/eip-20).

**Callbacks.** ERC-721 safe transfers and ERC-1155 transfers delegate receiver acceptance to the token. Honest implementations revert wrong magic values or rejecting hooks; lenient execution then skips the reverted transfer. These claims depend on an honest token implementation. The standards require recipient handling for contract recipients; gas measured for EOAs below must not be extrapolated to arbitrary receiver hooks. See [ERC-721](https://eips.ethereum.org/EIPS/eip-721) and [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155).

**Input and index safety.** Equal array lengths and nonempty batches are checked before indexing. Solidity's ABI decoder rejects malformed offsets/lengths. Arrays stay in calldata. Each index addresses the same recipient/ID/amount row. The only unchecked production arithmetic is bounded loop advancement; no achievable calldata length approaches uint256 overflow. Zero recipients revert in strict mode and are skipped in lenient mode; zero ERC-20/1155 amounts and router-self recipients revert in both modes, even late in a batch. The new late-self test proves earlier lenient successes roll back too.

**Duplicates and self recipients.** Repeated ERC-20 recipients and repeated ERC-1155 recipient/ID pairs accumulate amounts, not deduplicate them. Repeated NFT IDs usually fail after the first transfer: strict rolls everything back; lenient skips the later attempt. Sending to the caller is allowed and can count as a successful call without net economic movement. A receiver can also forward an NFT during its callback. Neither successful-call counters nor final ownership alone universally establish the history of a payment. The frontend is more restrictive than the contract; direct integrators must not assume its duplicate filters or sorting are enforced on chain.

**Events and client accounting.** Summary events count successful calls, not units. Skip events include recipient, ID and amount but no row index. The frontend filters emitter/token/sender/summary and matches each duplicate row at most once. Byte-identical skipped rows are economically identical, although their spreadsheet occurrence is not identifiable. Reentrant event pollution is blocked. `confirmArrival` treats short/missing/unknown receipts conservatively and holds them back; external balance changes or forwarding can make such checks inconclusive. No double-payment exploit from these limits was reproduced in this pass.

**Batch limits, gas griefing and ETH.** There is no universal on-chain recipient cap. Too-large strict batches run out of gas and roll back; too-small lenient gas limits trigger `OutOfGasForBatch` or ultimately revert. The guard checks available EIP-150-adjusted gas against stipend plus a 40,000 reserve. It does not promise that any number of gas-burning recipients will fit a fixed transaction budget. Expensive honest receivers can require a larger stipend or strict retry. Entry points are nonpayable, no receive/fallback exists, and a new test rejects attached ETH without moving tokens. Forced ETH is the documented exception to “holds nothing.”

## C. Controlled gas benchmark

**Method.** Actual receipts from a localhost Anvil Cancun chain, not gas estimates. Each scenario starts from an EVM snapshot after deployment/mint/approval, and each alternative reverts to the same state. Transfers are separate fresh transactions: no setup-warmed accounts or dirty storage. Distinct deterministic full-width EOA recipients start with zero holdings. Sender balances and finite ERC-20 allowances retain nonzero remainders, avoiding storage-clear refunds; approvals themselves are excluded equally. All measured calls succeeded and every recipient was checked. Sizes: 1, 10, 50, 100, 300.

A uses amounts `(i+1)*1e18`; B uses `1e18`; C IDs `1..n`; D IDs `1,4,7,...`; E ID 1 and amount 2; F cycles 16 IDs and amounts 1..7. These are the repository's OZ20/OZ721/OZ1155 fixtures. F does not model a different cold sender balance for *every* row: new unique IDs would add token storage work. NFT balances/approvals/ownership layout and receiver types are held equal within each comparison.

The minimal reference keeps caller binding, code check, nonempty/length checks, zero/self/zero-amount checks, reentrancy protection and return validation. It omits token-type classification, product summary events, counters and lenient policy. It is a **practical reference, not a mathematical opcode lower bound**. Revert diagnostics differ on reference ERC-20 failures. Lenient-vs-reference overhead therefore includes a useful feature that the strict-only reference does not offer. Specialized experiments retain classification and summary/return/recipient checks, but support strict mode only; they are compared to strict production, never credited with savings for discarding leniency.

These numbers include the ordinary 21,000 transaction base and 4/16-byte calldata charges. They exclude Nitro's L1 data surcharge, live fee levels, wallet/AA validation overhead and deployment cost. A Cancun local chain is useful for controlled execution comparison, **not a current Robinhood fee quote**. The 90M transaction limit is only a generous local test budget; unused gas is not charged and this does not establish a production batch cap.

**100 recipients, gas actually spent:**

| Shape | Reference | Current strict | Strict / recipient | Strict overhead vs reference | Current lenient | Lenient overhead vs reference |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A: ERC-20 variable | 2,793,915 | 2,817,477 | 28,175 | 0.84% | 2,848,289 | 1.95% |
| B: ERC-20 equal | 2,793,003 | 2,815,898 | 28,159 | 0.82% | 2,846,710 | 1.92% |
| C: ERC-721 sequential, safe | 3,765,149 | 3,772,382 | 37,724 | 0.19% | 3,815,559 | 1.34% |
| D: ERC-721 gapped, safe | 3,765,317 | 3,772,550 | 37,726 | 0.19% | 3,815,727 | 1.34% |
| E: ERC-1155 same ID/equal | 3,197,133 | 3,202,647 | 32,026 | 0.17% | 3,247,694 | 1.58% |
| F: ERC-1155 mixed (16 IDs) | 3,269,133 | 3,274,647 | 32,746 | 0.17% | 3,319,694 | 1.55% |

**Strict scaling, total receipt gas:**

| Shape | 1 | 10 | 50 | 100 | 300 |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 68,198 | 318,609 | 1,429,058 | 2,817,477 | 8,374,967 |
| B | 68,198 | 317,946 | 1,428,021 | 2,815,898 | 8,371,110 |
| C | 74,297 | 410,492 | 1,904,680 | 3,772,382 | 11,243,706 |
| D | 74,297 | 410,492 | 1,904,680 | 3,772,550 | 11,245,746 |
| E | 67,575 | 352,587 | 1,619,295 | 3,202,647 | 9,536,055 |
| F | 67,575 | 395,787 | 1,691,295 | 3,274,647 | 9,608,055 |

**Fixed and marginal terms.** Fit `gas(n) ≈ fixed + marginal*n` using n=100 and n=300. Fixed is an extrapolated intercept, not a literal empty-batch cost (empty batches revert). F includes warming 16 distinct sender ID balances in its intercept. Small integer/calldata effects and memory expansion prevent exact linearity.

| Shape | Reference fixed / marginal | Strict fixed / marginal | Lenient fixed / marginal |
| --- | ---: | ---: | ---: |
| A | 33,204 / 27,607.1 | 38,732 / 27,787.5 | 38,744 / 28,095.5 |
| B | 33,426 / 27,595.8 | 38,292 / 27,776.1 | 38,304 / 28,084.1 |
| C | 32,787 / 37,323.6 | 36,720 / 37,356.6 | 35,180 / 37,803.8 |
| D | 32,019 / 37,333.0 | 35,952 / 37,366.0 | 34,413 / 37,813.1 |
| E | 33,429 / 31,637.0 | 35,943 / 31,667.0 | 32,065 / 32,156.3 |
| F | 105,429 / 31,637.0 | 107,943 / 31,667.0 | 104,065 / 32,156.3 |

For one recipient the strict product overhead versus reference is 3.9–8.0%; it is a fixed-cost amortization issue, not a reason to remove safety checks. By 300 recipients it is 0.12–0.72%. All variants, per-recipient values and byte sizes are in `benchmarks.csv`.

**Ordinary owner single-transfer transactions:**

| Token / transfer | Total gas | Execution excluding base/calldata |
| --- | ---: | ---: |
| ERC20 transfer | 51,471 | 29,839 |
| ERC721 safe EOA | 62,414 | 40,474 |
| ERC721 unsafe EOA | 59,642 | 37,702 |
| ERC1155 EOA | 56,849 | 34,501 |
| ERC721A safe EOA | 86,234 | 64,294 |

Do **not** multiply these by n to claim an atomic gas floor. Single owner transactions do not pay BulkSend operator authorization, and each has cold storage plus a separate transaction base. In a batch, token addresses, sender balances and operator/allowance slots are warm after the first use. The reference slope is the better lower-bound comparison.

**NFT implementation sensitivity, 100 recipients:**

| Fixture / ordering | Reference | Current strict |
| --- | ---: | ---: |
| OZ721 unsafe | 3,486,937 | 3,494,170 |
| ERC721A ascending | 5,478,849 | 5,486,122 |
| ERC721A gapped ascending | 7,896,300 | 7,903,573 |
| ERC721A descending | 6,441,723 | 6,468,719 |

ERC721A cases use one lazy mint of 901 tokens and safe EOA transfers. The descending case is the first 100 IDs reversed; it is not a claim that every descending batch fits a live-chain stipend. Ascending costs about 15% less than descending here, and gapped ownership scans cost considerably more. For OZ721, arbitrary/gapped IDs barely change gas; safe EOA checks add about 278,000 gas over 100 unsafe transfers. Neither effect is router inefficiency. Existing tests cover accepting/rejecting/heavy receiver contracts, but these benchmark tables do not price those receiver hooks.


## D. Gas breakdown

At n=100, opcode traces separate token execution at call depth 2 from router execution at depth 1. Fixtures have no deeper calls for these EOA distributions. Token execution includes classification probe execution and any warmed owner slot it creates; router execution includes CALL/STATICCALL access costs, loop/ABI work, validations, guard and summary event. There are no storage-clear refunds in these six scenarios. These three components reconcile exactly to receipt gas.

| Shape | Token execution | Token % of total | Router execution | Router % of total | Base + calldata | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 2,595,291 | 92.11% | 142,414 | 5.05% | 79,772 | 2,817,477 |
| B | 2,595,124 | 92.16% | 141,914 | 5.04% | 78,860 | 2,815,898 |
| C | 3,601,070 | 95.46% | 98,312 | 2.61% | 73,000 | 3,772,382 |
| D | 3,601,070 | 95.45% | 98,312 | 2.61% | 73,168 | 3,772,550 |
| E | 3,003,500 | 93.78% | 112,007 | 3.50% | 87,140 | 3,202,647 |
| F | 3,075,500 | 93.92% | 112,007 | 3.42% | 87,140 | 3,274,647 |

The token column is the underlying execution paid in this context, not a universal constant. Router overhead is **not all removable**: the safe reference still needs a loop, ABI encoding, external calls, safety checks and calldata. The much smaller delta versus the reference in section C is the useful measure of removable/product overhead. Thus 3–5% router execution does not imply a safe 3–5% optimization opportunity. ERC-721 ownership implementation, fresh/existing recipient balances, ERC-20 finite versus infinite allowance and unique ERC-1155 sender ID slots can all change the token portion substantially.


## E. High-value optimizations and execution planner

**No new implementation meets the threshold for a worthwhile production optimization.** Only simple strict shape prototypes were built; no packed decoder, new assembly or dependency change was attempted.

| Prototype | Current strict, n=100 | Prototype gas | Saving | Calldata bytes: current → prototype | Complexity / difficulty | Compatibility and security risk |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| ERC-20 equal amount | 2,815,898 | 2,795,283 | 0.73% | 6,596 → 3,332 | Small Solidity change; moderate integration/test work | Strict-only selector; new version routing. Same transfer acceptance checks on success; not adversarially qualified for production. |
| ERC-721 sequential IDs | 3,772,382 | 3,781,457 | -0.24% | 6,628 → 3,364 | Small Solidity change; moderate integration/test work | Strict-only selector; new version routing. Same transfer acceptance checks on success; not adversarially qualified for production. |
| ERC-1155 same ID/equal amount | 3,202,647 | 3,180,937 | 0.68% | 9,860 → 3,364 | Small Solidity change; moderate integration/test work | Strict-only selector; new version routing. Same transfer acceptance checks on success; not adversarially qualified for production. |

At n=300 the equal-amount ERC-20 and ERC-1155 savings are still below 1%; sequential ERC-721 remains slightly worse. Repeated small integers contain many zero bytes already, so removing half the ABI bytes does not remove half the gas. Nitro compression can further change data savings; no current L1-fee benefit is claimed. The prototypes are evidence against pursuing these optimizations now, not a claim that every possible specialized implementation must cost exactly this much. Do not spend more time chasing their sub-1% result.

The high-value behavior is **already implemented**: ascending complete-row NFT ordering. It saves about 983,000 gas in the measured ERC721A descending-versus-ascending case without changing the recipient/ID pairs (but intentionally changes execution order). Preserve it and its tests. No production work is needed to obtain that benefit.


The frontend already chooses wallet-native versus router execution and sorts complete NFT rows. Keep ERC-20 on the router: a generic wallet batch does not necessarily validate ERC-20 false returns. An off-chain shape detector would be cheap to run, but new selectors, deployment/version routing, receipt handling, simulation and recovery tests are the real cost. An on-chain detector still receives redundant arrays and pays to scan them. **Do not build a shape planner for the measured savings.**

ERC-1155 `safeBatchTransferFrom` moves multiple IDs to **one recipient**, not one ID to many recipients. It is not a replacement for the distribution loop. Grouping several IDs for the same recipient might help a different workload, but changes callback shape, event parsing and lenient failure granularity. No measured recommendation is made for that distinct product feature. See the [ERC-1155 batch signature](https://eips.ethereum.org/EIPS/eip-1155).

## F. Do not touch

- **Direct caller-to-recipient transfers.** Pulling into router custody first adds transfers, approvals/accounting and fee-on-transfer hazards.
- **Safe NFT transfers/default, transient guard, zero/self checks and exact return validation.** These have actual protections and tests; removing them is not an equivalent-safety optimization.
- **Lenient stipend, reserve, capped returndata and ambiguity-fatal behavior.** They prevent griefing, misleading skips and paid-then-retried rows. Never benchmark by weakening these policies.
- **Existing calldata arrays, custom errors and unchecked loop increments.** Already appropriate; no meaningful free improvement was established.
- **Compiler/optimizer pipeline and existing assembly.** The deployed build is reproducible. No new assembly, memory-pointer reuse, packed decoder, per-iteration call encoder or codegen migration is warranted by these results. Memory growth exists but is small over practical batch sizes; a small curvature is not a justification for fragile buffer reuse.
- **Classification guards.** They close real ERC-20/ERC-721 selector confusion. Fixed overhead amortizes rapidly. Do not remove them to improve one-recipient benchmarks.
- **Summary and skip events.** The UI consumes them for recovery. Do not trade receipt integrity for small gas savings.
- **NFT row ordering and recipient association.** Preserve ascending order and move the whole row together. Token ownership layout matters more than loop tuning.
- **Admin/upgrade/rescue architecture and deployed addresses.** This audit provides no reason to change their trust assumptions.

## G. Test quality and remaining high-value coverage

Existing coverage is strong for this small router: real OZ/ERC721A implementations, no-return/false/fee tokens, paid-then-lies and malformed return data, blacklists, wrong selectors, duplicate IDs, malicious receivers, reentrancy, gas hogs, return bombs, stipend boundaries, allowance withdrawal, fuzzing and conservation invariants. It supports confidence in the core transfer logic. It is not proof of compatibility with every deployed token.

Validation performed:

- Existing ordinary contracts: 111 test result entries passed, including a grouped invariant campaign containing all three predicates. That is 110 ordinary/fuzz tests plus three invariant predicates, with 96 runs × 24 calls, 2,304 handler calls and zero unexpected reverts. Three pre-existing fuzz tests use 512 runs each.
- Historical probe suites: AuditProbe 14 pass / 6 intentional fail; Audit12 5 / 2; Audit13 1 / 1. Source hashes and the complete assertion/status fingerprints match the baseline. This is not a newly failing contract suite.
- New [`test/FloorAudit.t.sol`](../../test/FloorAudit.t.sol): five passing tests, including 512 mixed ERC-1155 fuzz cases checking every recipient/ID pair, duplicates and sender conservation; direct-deposit/forced-ETH behavior; attached ETH rejection; late lenient failure rollback; and malicious classification exhaustion.
- Every benchmark distribution checks **each** recipient balance or NFT ownership after execution; setup and state verification are outside receipt gas measurements.
- `preflight.sh` passed; source hash and runtime hash match the recorded mainnet manifest. No live RPC, wallet, deployment or real-fund transaction was performed by the audit scripts.
- Full browser/worker suites, `verify.sh`, the live fork suite and live-bytecode retrieval were **not** rerun. No frontend files were modified. Local Foundry/Node differ from CI pins.

Only remaining test recommendations: run the existing full CI verification on its pinned toolchain before accepting future production changes; preserve the new mixed-pair oracle; add a focused frontend recovery case for a legitimate forwarding receiver if that workflow is supported. Any future specialized selector must undergo differential fuzzing against the existing strict path, including malformed input, all return modes and reentrant/rejecting receivers, before it could be shipped. Benchmark prototypes have only successful-shape validation and are not production-ready.

## H. Recommendation categories

1. **MUST FIX BEFORE MAINNET:** None demonstrated in the reviewed router. The repository already records a mainnet deployment; this verdict concerns source findings, not an independent live verification.
2. **SHOULD IMPROVE:** Retain these isolated receipt benchmarks and targeted tests; use receipt gas separately from gas-limit/headroom estimates in future analysis. Run the existing pinned CI/full integration and live-bytecode checks for any later release. Add the forwarding-receiver recovery test only if supported by product scope.
3. **OPTIONAL OPTIMIZATION:** None currently clears the user's value threshold. Revisit only with evidence of materially different workload or chain data-pricing costs.
4. **NOT WORTH CHANGING:** Equal-amount/sequential selectors, a new shape planner, generic packed calldata, new assembly/buffer reuse, blanket probe gas caps, removal of safety/event checks, pipeline churn, custody/admin redesign, or replacing many-recipient ERC-1155 sends with a one-recipient native batch.

## Reproduction and artifacts

From repository root, using the installed Foundry executables on PATH:

```sh
forge build audit/2026-09-13/References.sol
anvil --host 127.0.0.1 --port 18547 --hardfork cancun --gas-limit 100000000 --steps-tracing --silent
# In another terminal, against that throwaway local chain only:
node audit/2026-09-13/benchmark.mjs
forge test --match-path test/FloorAudit.t.sol
```

`References.sol` is an isolated experiment, deliberately not a deployable product recommendation. It reuses existing production call helpers/guard and existing assembly patterns, adds no novel assembly, and omits reference-only product conveniences. It inherits production code to reuse safety machinery; deployment cost/code-size comparisons are therefore out of scope. [`results.json`](results.json) contains the raw measurements and conditions; [`benchmarks.csv`](benchmarks.csv) contains totals, per-recipient gas and calldata for every measured shape/size/variant. [`test-results.json`](test-results.json) records test outcomes. No production edits are proposed by this pass.
