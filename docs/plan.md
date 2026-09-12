# The plan from here to a first release

> ## Start here
>
> **State on 12 September 2026, evening: BulkSend v13 is LIVE ON MAINNET.** Rounds seventeen, twenty and
> twenty-one found no release blocker; after twenty-one the product tree did not change (the one commit before
> the deploy, `bf4c61d`, was release mechanics only). On the maintainer's explicit written authorization the
> contract was deployed once to Robinhood Chain 4663 from `DeployBulkSendMainnet`: `0x904412cfe982f33385f486aaff8c8a4a6f4b5fbf`,
> tx `0xfde31639c69dcac7f7dbf7b48a4b06891664fe48a3675223bd39c3ae22881e7c`, block 61365130, 2,145,104 gas, about 0.00021 ETH. The runtime read back
> from the mainnet RPC is byte-identical to this source's build and to testnet's v13; Sourcify reports an exact
> match; the deployment record is `deployments.mainnet.json`. This commit enables chain 4663 in the page (the
> placeholder and `LIVE_CHAINS`, two lines) and gate 14's mainnet branch now runs in both workflows.
> **What remains:** nothing before release. Post-mainnet candidates, none of them release work: native PRO REST
> with a Bearer key for the Worker's contract, transaction and holder lookups; one bounded retry on an upstream
> 5xx; chain-first run reconstruction on the page from `Airdrop20` logs and calldata; an equal-amount entry
> point and a scratch-memory return read in a future contract version, each worth about one percent of gas.
> Blockers by round: 15, 11, 5, 9, 9, 4, 6, 3, 4, 3, 5, 1, 2, 4, 5, 1, 0, 1, 1, 0, 0.
>
> - **BulkSend v13 is DEPLOYED on testnet** at `0xf2eD6359F5deE0334d68cd21d306D9D3E7a49232` (tx `0x5cb0037f…`), byte-identical
>   at 9,752 bytes, fully verified. The on-chain B-1 reproduction against it reverts `IsAnNft`
>   ([`0x5b46a00557…`](https://explorer.testnet.chain.robinhood.com/tx/0x5b46a00557302eb7ec212a655e10e0d77707ba1b2d115076a2559fb656aae851)). v12 at `0xc2e4…f481` is a tombstone.
> - **Rounds twelve and thirteen are fully closed.** Every probe file in the repository is at its baseline,
>   and round thirteen's six browser probes are at **0 of 6**.
> - **Phases 0 to 5 of this plan are done.** Phase 6 is the only one left and it needs the chain.
> - **Mainnet: the deployer's nonce is 1, spent on the one deployment; nothing else may touch it.** Testnet gas and nonces move for reasons unrelated to
>   this project -- the deployer is shared with the maintainer's game NFT experiments. See `status.md`.
>
> **Phase 6, as of the evening of 10 September 2026.** Steps 0 to 6 are done: the pre-deploy gate (every branch
> tested, invariants, snapshot, the gas assertion), the pre-round gate (both pages name all fifteen errors,
> the report published, status and README and for-reviewers current, the NFT path's unheld-id line, CI's
> bytecode step last, the probes in preflight's address check), the fork suite, the deploy, the on-chain
> B-1 refusal, the nine files, and all four live scripts read back from the explorer. What remains:
>
> 7. **Done.** Both pages published from `790c9b5`; live bytes identical to the repository (the publisher's own
>    post-publish check, and an independent fetch).
> 8. **Rounds fourteen, fifteen and sixteen have run**, against `f5b7614`, `9426c2c` and `ebc910b`, and their
>    reports are published as written. Blockers: 4, 5, 1. Every one is closed against the reviewer's own
>    reproduction, the last of them (an older Assign completion overwriting newer input) in the commit that
>    carries this file, which is also the first publish since `790c9b5`. Two should-fix items stay open on
>    purpose and are written down in `status.md`: the guard probes' unbounded returndata copy, which needs a
>    v14 and is not an asset-loss path, and nothing else. The next round is pointed at the Assign fix and its
>    twins first.
>    **Round seventeen ran against `4cc8a1c` and found no release blocker**, the first round to do so. Eleven
>    should-fix items; S-1, S-3, S-4 and S-9 are closed in the commit after it, S-8's two items are gates
>    below, the rest are open in `status.md`. Its report is published as written. Both pages were published
>    from `4cc8a1c` and are byte-identical live; integrity issue #1 is closed.
> 8b. **Round eighteen** runs against the commit that closes S-1 and S-3, on Opus rather than Fable (a
>    reviewer round does not need the larger model, and two of them on Fable cost five hours of usage in one
>    day). If it also finds no blocker, the mainnet question is the maintainer's, subject to gates 9 to 12.
> 9. **Production RPC is now an explicit gate.** Robinhood's public mainnet endpoint is suitable for the
>    present read-only rehearsal but its own documentation calls it rate-limited and not recommended for
>    production. Select a dedicated provider, keep its credential in the Worker rather than `index.html`, and
>    add an independently operated fallback/monitor before mainnet is enabled.
>     **Done, 11 September 2026.** Each chain lists three endpoints in order (Robinhood's own, then PublicNode,
>     then Pocket on mainnet; Robinhood's, PublicNode and dRPC on testnet), all answering the right chain id and
>     `eth_simulateV1` when checked; the page probes them in order at connect and on a network change and reads
>     through the first that answers, saying so when it is not the first. The integrity workflow probes every
>     listed endpoint four times a day and fails if the first, or every fallback, for a chain stops answering.
>     No credential: all three are public. The Worker keeps no RPC.
> 10. **Repeat the real-wallet boundary once, on the final testnet page.** The v13 live scripts are green but
>     their wallets are test implementations, and the manual MetaMask run predates v10. Complete one injected-
>     wallet and one phone/WalletConnect airdrop with freshly minted testnet assets, then read both back before
>     changing the mainnet placeholder.
>     The runbook is [`real-wallet-run.md`](real-wallet-run.md); `deploy/mint-fixtures.sh <address>` mints the
>     fixtures. Needs the maintainer's wallet address and an hour of their time; testnet gas only.
>     **Done, 11 September 2026.** Four runs from the maintainer's own wallet against the published page and
>     v13: ERC-721 `0x36d11da8…`, ERC-1155 `0x860ccb24…`, ERC-20 `0x8114062…` from a browser wallet, and
>     ERC-721 `0x448db323…` from a phone over WalletConnect with the tab backgrounded. Every hash read back from
>     the explorer and the chain agrees with the page. Two minor findings, both fixed the same day: the ERC-20
>     confirmation line showed base units; and a "never came back" line about a batch that landed a second
>     later, which round eighteen read as reconciliation judging the in-flight batch and guarded against. Round
>     nineteen's F-5 showed that guard unreachable (nothing reconciles mid-send: the connect controls are locked,
>     a dropped phone session keeps the account); it is removed, and the line is now understood as the pre-send
>     reconciliation truthfully reporting an EARLIER attempt the backgrounded wallet never answered, which is
>     what the maintainer said happened. Gate 12 is proven by the same phone run: the
>     send path took its hash from the wallet and its receipt from the page's RPC.
>  11. **An explorer that answers this origin on mainnet** (round seventeen S-8). Today the mainnet explorer
>     answers the worker's passthrough with a Cloudflare managed challenge, so on mainnet Assign's fallback,
>     holder snapshots and Check's source verification and revert reasons would all be dark. An API key, an
>     allowlisted origin, or a different indexer; proven by an integrity step that fails on the
>     `{"error":"upstream"}` envelope for `/x/4663/`, which today it would.
>      **Wired, 11 September 2026, inert until a key exists.** Blockscout is retiring per-instance API keys for a
>      multichain PRO API (`api.blockscout.com/chains/4663/api/v2/…`, same REST shape, free tier 5 requests a
>      second, 100K credits a day). The Worker now reads the mainnet explorer through it whenever a
>      `BLOCKSCOUT_KEY` secret is bound, and behaves exactly as before when it is not; `deploy/publish.sh` binds
>      the key from `BLOCKSCOUT_KEY_FILE` in `deploy/local.env`. Verified only as far as a missing key allows:
>      the PRO API answers "proceed with API key", so whether it serves chain 4663 in the REST shape is
>      confirmed the day the maintainer signs up. **Confirmed the same evening, and it changed the shape of the
>      work:** the PRO API serves chain 4663 only in the Etherscan-style module API, not the REST shape the pages
>      use, so the Worker needs a translation layer for four paths and the airdrop page must route through the
>      Worker on mainnet. The spec is [`gate-11-explorer.md`](gate-11-explorer.md). Sonnet-sized work from that
>      spec, then one verify, a publish with the key bound, and the integrity step that fails on the
>      `{"error":"upstream"}` envelope closes this gate. **Done, 11 September 2026, late:** built from the spec
>      (a Sonnet pass; `deploy/render-worker.py`, `test/worker.test.mjs` with 23 offline assertions), verified,
>      published with the key bound, and read live through both Workers: a real mainnet collection's holders
>      (100 a page, paging), its verification record with a 90-entry ABI, a holder's inventory of 1,535 NFTs
>      netted from transfer history, a transaction's record; no key marker in any response. The integrity
>      workflow now reads that holders page four times a day and refuses the envelope.
>  13. **On the day the mainnet address is substituted** (round nineteen F-11): the integrity workflow's
>     bytecode step compares the testnet contract only. That day, before the publish, it gains the mainnet
>     address from a `deployments.mainnet.json` and compares both. The page's `{{BULKSEND_MAINNET}}` placeholder
>     and its `LIVE_CHAINS` line are replaced by a reviewed edit in the signed enabling commit, not by any
>     script (an earlier version of this item said `preflight.sh` would do it; nothing does, and nothing needs
>     to: the substitution is two lines, read in review). What checks them is gate 14 below, in both workflows:
>     the page must name the address recorded in `deployments.mainnet.json`, and the runtime at that address
>     must be the one this source builds. Until then the placeholder is what keeps mainnet off.
>  14. **Every automated check on the deployed contract watches testnet only** (round twenty, the reviewer's
>     "missing control"): both workflows read `deployments.testnet.json` and ask the testnet RPC, so on the
>     day the placeholder is swapped the strongest control this project has would still be watching a
>     contract that holds nothing. Both workflows now end with a mainnet step: while the page carries the
>     placeholder it asserts mainnet is off and passes; once the placeholder is gone it must find
>     `deployments.mainnet.json`, assert the page names that address, and compare mainnet bytecode to the
>     build, failing clearly on a missing file or a mismatch. The enabling change is therefore checked by
>     the same step that checked the placeholder, not by editing a grep on the day.
>  12. **The send path must not depend on the wallet's RPC** (round seventeen S-8, second item). S-3's fix
>     takes the hash from `eth_sendTransaction` and waits on this page's RPC; gate 9's production endpoint
>     then covers every read the page makes. Proven by the S-3 regression and by one real-wallet send under
>     gate 10 with the wallet on the public endpoint.
>
> **The test harness, after round eighteen and before real money** (maintainer, 11 September: "if you have to
> constantly adjust for delay variables I just have to ask if our testing setup is correct"). The browser
> suites are right about what they test and wrong about how: they wait on wall-clock delays, a single thrown
> error kills all 350 checks with the results buffered until the end, the two mocks model the page's plumbing
> (wallet path, page-RPC path) rather than a chain, and every assertion pays for a headless browser. Two cheap
> fixes first: per-block isolation with incremental output, and a hold-and-release gate on both mock paths
> replacing `slowMethod` and `delayNextRpcMs`. Then, as its own task and not a mainnet gate: one fake chain
> behind both mocks, and node-level unit tests for the fourteen readers of the recipient box. Process rule in
> force now: one `./verify.sh` per change (it already runs both suites); documents-only commits get
> `preflight.sh` only; reviewer rounds run on Opus with the expected cost stated first.
>
> **Deferred on purpose, and written down so it is not forgotten:** the four live scripts and the on-chain
> B-1 script sign with `cast send --private-key`, which puts a testnet-only key in a process argument list
> for the length of the command. The deployer key no longer does (the deploy script reads the environment).
> A keystore import for the two testnet keys is the fix; it is not release-relevant and it is not done.
>
> **What a "clean" round means, so it is not mistaken for something easier.** The gate asks for a round with
> **no release blockers**, not a round with no findings. Blockers by round so far: 15, 11, 5, 9, 9, 4, 6, 3,
> 4, 3, 5, 1, 2. It has not trended to zero, and twice a fix from one round became the next round's finding in
> the contract specifically. v13 changed a guard, so v13 is the least trustworthy thing in the repository and
> the next round should be pointed at it first.

## Re-evaluated before Phase 6, 10 September 2026

Before touching the chain, every tool the round needs was exercised read-only, and the repository was checked
against what this plan claims about it. Numbers, then what was found.

**The tools, each run today, each working:**

| tool | result |
| --- | --- |
| explorer API (`/api/v2`) | v12 fully verified: compiler 0.8.36, cancun, 10,000 runs, ABI carries all 15 errors. Decodes the B-1 transaction's four logs and its input against the verified ABI. Needs a browser User-Agent. |
| `forge` / `cast` 1.8.1 | at `~/.foundry/bin`, **not on PATH in a fresh shell**; `verify.sh` exports it. Both reach both RPCs. |
| fork suite | 4 passed: 20 real ERC-721 collections accepted by the NFT guard and refused by the ERC-20 guard, 20 real ERC-20s accepted, and 20 of 20 let through by v12. |
| anvil fork of testnet | the deploy rehearsed from the real deployer, impersonated, no key: 2,700,921 gas, runtime 9,437 bytes, byte-identical to `out/BulkSend.sol/BulkSend.json`. The deployer is EIP-7702-delegated to this project's own `Batch7702`, and contract creation from a delegated account works. |
| `forge verify-contract --show-standard-json-input` | builds; one source, settings match `foundry.toml`. |
| `forge coverage` on v13 | 82.46% of branches, **10 uncovered arms** -- the nine `readers.md` listed, plus one new: v13's own second probe in `_mustNotBeNft` (line 456). |
| Slither 0.11.6 on v13 | 0 High, 0 Medium, 6 Low (all `calls-loop`), 13 informational. Now installed at `~/.local/bin/slither`; it had been living in a session scratchpad and would have vanished. |
| `forge snapshot` | 97 entries, produced, not yet committed. |
| balances | deployer 0.001634 ETH on testnet at 0.01 gwei (about 65 deploys), `testnet-sender` 0.003972, `testnet-plain` 0.002983. Mainnet: deployer 0.002047 ETH, **nonce 0**; the test keys hold nothing there. |
| the live pages | both at `44e6350`, the commit round thirteen reviewed. |
| CI | red for eight commits; see "Start here". |

**Found, and must close before the deploy** (the contract deploys once; a defect found by any of these after
the deploy is a v14):

1. **v13's own new branch has no passing test.** `_mustNotBeNft` catching a collection that does not answer
   `supportsInterface` by its *last* id when the first is dead is the exact B-1 shape, and the only thing that
   reaches that arm is round thirteen's probe, which is written to fail. `testBareRevert721_throughTheErc20Path_isCaughtByTheIdProbe`
   puts the live id first, so the first probe catches it and the second is never asked.
2. **The nine arms `readers.md` listed on 10 September were never written**: `AmbiguousResult` on the 721 path
   (178), `LengthMismatch` and `EmptyBatch` on the 1155 path (233, 234), the 1155 lenient zero-address skip
   (241), `AmbiguousResult` 1155 lenient and strict (245, 256), `ZeroRecipient` 1155 strict (252), and
   `LengthMismatch` and `EmptyBatch` on the 20 path (296, 297). The map called this "the ERC-721 path is
   better tested than the other two" and then left it so.
3. **Invariant tests: promised "with v13", zero exist.** `sent + skipped == n`; nothing leaves that was not
   approved; BulkSend holds nothing afterwards. The fuzz runs exist and assert examples.
4. **`.gas-snapshot`: promised with v13, not committed.**
5. **`test_gas_400_recipients` asserts nothing** (round thirteen, "where the tests are weaker", item 7). Four
   `log_named_uint`s and no `assertLt`, under a cap derived from a 30,000,000 budget.

**Found, and must close before round fourteen** (the reviewer would find them, and each is a known finding
walking into the round that is supposed to find none):

6. **The Check page decodes 12 of the contract's 15 errors.** `IsAnNft`, `NotAnNft` and `Reentered` reach the
   user as a bare selector. That is round thirteen's S-7 surviving on the twin reader: `preflight.sh` check
   3b reads `web/index.html` and not `web/check.js`. The two most likely refusals a user of v13 will ever see
   are the two it cannot name.
7. **Round thirteen's report is not published in `docs/`.** Every other round is, and the reviewer prompt tells
   the next reviewer the reports are published unedited.
8. **`status.md` describes round twelve** and calls v12 current with no mention of thirteen; "three further
   scripts" introduces a list of four. `README.md` says 82 contract tests and 166 for the browser total, against a breakdown beside it of 118, 316 and 116.
   `for-reviewers.md`'s "Previous review" ends at twelve.
9. **`checkTotals` has no ERC-721 branch** (round thirteen, item 8): the ERC-20 and ERC-1155 paths pre-check
   the aggregate and say so; the NFT path leaves it to the per-batch `staticCall`. In a tool whose point is
   three standards to one standard, that is a product gap, not a test gap.
10. **This block listed five files to update at deploy; nine name the address.**
11. **The reviewer prompt is written for round thirteen against v12.**
12. **CI's step order.** The bytecode check runs second and stops the job, so a deliberate not-yet-deployed
    change hides every suite behind it. Move it last, or into its own job.

**Not done, and decided not to do before this round**, so it is on the record rather than forgotten: round
thirteen's harness items 2, 3 and 4 (the mock answers `eth_estimateGas` with a constant and checks `data` but
not `to`; the mock's `eth_call` falls through to a plausible word for any unknown selector; dialogs are
auto-accepted by default). Items 2 and 3 are small and worth doing with the page work; item 4 changes the
default for 316 tests and is a round of its own.

**Key handling for the deploy.** Previous deploys read the key into a shell variable and passed it as
`--private-key`, which puts it in a process argument list for the duration of the command. It never reached a
transcript or a tracked file, but it need not be there at all: import it once into a Foundry keystore and
deploy with `--account`. The live scripts read the key files in node and are unaffected.

`status.md` says what is true today. This says what happens next, in what order, and how each step is known
to be done. It is updated as steps close, and a step is only ticked when the check beside it passes.

Written after round thirteen (2 blockers, 7 should-fix, 1 inherent limit), against the finish line in
[`what-this-is-for.md`](what-this-is-for.md).

## The finish line, restated

Nothing here is finished until all four are true at once:

1. every promise proven **for all three standards**, live on chain, not only against mocks
2. a review round that finds **no release blockers**
3. explicit permission from the maintainer, given **after** that round
4. `docs/status.md` accurate on the day it is read

Testnet is not a rehearsal for this. It is the only place any of it has ever been demonstrated, so a
demonstration that is sloppy here is a claim that is unsupported everywhere.

## Why the order is the order

Round thirteen's own closing observation is the reason this is a plan and not a list:

> Six of this round's findings are one reader being taught something its twin was not. That is not
> carelessness, it is a missing step.

So the sequencing follows two rules:

- **Guards before fixes.** The probe files pin roughly twenty closed findings and nothing runs them
  automatically. Every fix made before that is a fix with nothing watching it. S-3 is therefore first, ahead
  of both blockers, even though it is only a should-fix.
- **Map before cutting.** The contract can only be redeployed once per change set without creating its own
  drift. So the reader-parity map is built *before* the contract is touched, not after, or B-1's fix ships and
  the sweep finds a second contract change the next day.

## Phase 0 — make the guards run

| | |
| --- | --- |
| **Covers** | S-3 |
| **Why first** | Everything after this is protected by it. Nothing before it is. |
| **Done when** | CI runs `./verify.sh` (probes included) and `./test/csp-gate.test.sh` on every push, and a deliberately reopened finding turns CI red in a scratch branch. Verified by doing it, not by reading the workflow. |
| **Status** | **done.** CI runs `preflight.sh` then `verify.sh`. Proved by reopening round twelve's S-7 on a branch and opening a PR: CI failed at the verify step with *"browser probes audit-probe-12: 1 findings reproduce, was 0. Something closed has come open again"*, while the same commit on `main` passed. PR closed unmerged, branch deleted. |

CI currently runs `forge test --no-match-path 'test/Audit*.t.sol'` — it excludes every probe file. It also
runs neither the CSP gate nor `preflight.sh`. A fresh clone has no `core.hooksPath`, so the pre-commit checks
exist only for whoever configured them.

## Phase 1 — the reader-parity map

| | |
| --- | --- |
| **Covers** | the cause of B-1, S-1, S-2 and S-5 |
| **Why here** | It decides the full contract change set, so the contract is deployed once. |
| **Done when** | `docs/readers.md` lists, for each shared input, every function that reads it and what each does with it; and a test asserts the ones that must agree do agree. |
| **Status** | **map done** ([`readers.md`](readers.md)). It settled the v13 change set as B-1 alone, and turned up a third instance of the count-lines-not-wallets defect in `applyWeight` that round thirteen did not find. Tests land with the fixes in Phase 4. |

Two shared inputs, and this round found a disagreement in both:

- **the recipient box** — `parseList`, `walletsInBox`, `deliveriesOn`, `unreadableLinesInBox`, `addressOn`,
  `boxColumns`, `shuffle`, `applyWeight`, `dropContracts`, `assign`, `pickUse`. Eleven readers; three
  disagreed.
- **the contract's paste guards** — `_mustBeNft`, `_mustNotBeNft`. Two readers; one had not been updated,
  which is B-1.

The output is a document plus tests, not a refactor. Collapsing eleven readers into one is a bigger change
than this project can verify right now.

## Phase 2 — the contract, once

| | |
| --- | --- |
| **Covers** | B-1, plus anything Phase 1 finds in the contract |
| **Status** | **code done, NOT DEPLOYED.** v13 is built and tested; it goes to testnet in Phase 6 so the contract is deployed once. |
| **Done when** | v13 deployed to testnet, verified on the explorer, runtime byte-identical to the build; the B-1 probe FAILS; and the real-chain reproduction is re-run and now refuses. |

B-1 is proven on chain against v12, not only in a test:
[`0xc6b4cf63…`](https://explorer.testnet.chain.robinhood.com/tx/0xc6b4cf63b9e63eea42950973f0c8269ccfbe0f9eb6cb5d889359a1063dad9295)
records two ERC-721 `Transfer` events and an `Airdrop20(sent 2, skipped 1)` in one transaction. The fix is
checked the same way: the same paste, against v13, must refuse.

## Phase 3 — the second blocker

| | |
| --- | --- |
| **Covers** | B-2 |
| **Status** | **done.** Probe S13-1 reads fixed, and the probe itself had to be repaired first: its mock answered a two-value function with one value, so the page never signed and the probe measured nothing. |
| **Done when** | probe `S13-1` reports fixed: a pending record exists in `localStorage` *while the wallet still has the request*, and a tab killed mid-signature holds those recipients on the next load rather than offering them again. |

Nothing is written down until the wallet answers, so a batch signed on a phone and lost with the tab is paid
twice. The recovery path for a hash-less pending record already exists in `reconcilePending` and nothing ever
creates one. The page's own footer states the opposite of the current behaviour.

## Phase 4 — the parity fixes

| | |
| --- | --- |
| **Covers** | S-1, S-2, S-5 |
| **Status** | **done**, with the `applyWeight` instance the map found, plus two more the tests found underneath it. |
| **Done when** | each probe reports fixed, and each fix names in its commit message every reader of that input that was checked. |

The commit-message rule is the habit round thirteen asked for, and it is the only part of this plan that is
about process rather than code: **when a reader is fixed, list every other reader of the same input.**

## Phase 5 — what the software says about itself

| | |
| --- | --- |
| **Covers** | S-4, S-6, S-7 |
| **Status** | **done.** All six of round thirteen's browser probes read fixed, from six reproducing. |
| **Done when** | the quoted cost cannot understate by 3x; `SECURITY.md` describes the approval scope truthfully for all three standards; every one of the contract's fifteen errors reaches the user as a sentence, not a hex selector. |

These are not crashes. They are the page being wrong about itself, which is the failure this whole tool
exists to prevent, so they are release-blocking for mainnet even though they are not for testnet.

## Phase 6 — prove it, then ask

| | |
| --- | --- |
| **Done when** | all four live scripts pass against v13; every transaction is read back **from the explorer**, not from this repository's own receipt parsing; `status.md` and `plan.md` are accurate; round fourteen runs and finds no blockers. |

Then, and only then, the mainnet question goes to the maintainer. Two conditions, both required, neither
sufficient alone: a round with no release blockers, and explicit permission given after it.

## The tools, and which of them this project was not using

The block explorer was sitting there for the whole project and I was reading receipts with the same code that
wrote them, which is checking code with itself. That was a symptom. Here is the whole toolbox, what it says,
and where it now feeds into the plan.

| tool | state before | what it found |
| --- | --- | --- |
| **Blockscout explorer** | unused | Decodes against the *verified* ABI, independently of this repository. Ended B-1 in one transaction, confirmed the right entry point is called on all four paths, and showed the gas probe over-estimates by 2-20% — always in the safe direction, previously assumed rather than known. |
| **`forge coverage`** | **never run** | 98.67% of lines but **83.64% of branches**. Nine uncovered, and they cluster: the ERC-1155 path's zero-address skip, its strict `ZeroRecipient`, its `LengthMismatch`/`EmptyBatch`, and three `AmbiguousResult` branches — the guards added in v11. Branches are where B-1 lived. |
| **Slither** | **never run** | 102 detectors, **0 High, 0 Medium**. The 6 Lows are all `calls-loop`, which is what a batch airdrop is. Worth recording as a real result: static analysis finds nothing here, so the adversarial rounds are carrying the weight, not duplicating a scanner. |
| **Fork testing** (`vm.createSelectFork`) | **never used** | Works against Robinhood Chain mainnet. Read-only and local — a fork is a sandbox, no transaction is sent and no gas is spent. This is the answer to "a mocked test answers its own question": the guards can be tested against the **58 real mainnet collections** instead of fixtures this repository wrote. |
| **`cast run` / `debug_traceTransaction`** | unused | **Unavailable on this chain.** The public RPC exposes no `debug_*`, and `cast run` cannot even parse an Orbit block: every block carries an internal system transaction of type `0x6a`, which the deserialiser rejects. Recorded so nobody spends another half hour on it. |
| **Fuzz / invariant tests** | 3 fuzz, **0 invariant** | `foundry.toml` already sets `runs = 512` and almost nothing uses it. The contract's properties — "sent + skipped == n", "nothing leaves that was not approved" — are invariants, and are currently asserted example by example. |
| **`forge snapshot`** | unused | No gas regression tracking at all. v13 changes the guards, so this is the round to start. |

Three of these become work rather than notes:

- **The uncovered branches go into Phase 1's map.** Nine untested branches on the ERC-1155 and ERC-20 paths is
  the same finding as the reader map, arrived at mechanically: this tool covers all three standards, and its
  ERC-721 path is better tested than the other two. That is a coverage claim I could have measured on any day
  of this project and did not.
- **The guards get tested against real collections in Phase 2**, on a mainnet fork, before v13 is deployed.
  B-1 is exactly the question "does the guard agree with reality", and reality is 58 contracts that exist.
- **Invariants and a gas snapshot land with v13**, because that is when the contract changes.

## Where this stands, and what the next session picks up

**Phases 0 to 5 are done and pushed.** Round thirteen: both blockers closed, all seven should-fix closed, and
its probe files are in the repository and in the baseline, so they gate like every other round.

| set | reproducing |
| --- | --- |
| round thirteen browser probes | **0 of 6** |
| round twelve browser probes | 0 |
| round eleven airdrop probes | 8 (the acknowledged inherent limits) |
| Check page, set two | 1 (correct behaviour; the finding was the combination, and that half is fixed) |

**Phase 6 is what remains, and it is the one that needs the chain:**

1. Deploy **v13 to testnet** (46630), verify on the explorer, confirm the runtime is byte-identical.
2. Re-run the on-chain B-1 reproduction against v13. Against v12 it produced two ERC-721 `Transfer` events and
   an `Airdrop20(sent 2, skipped 1)` in one transaction
   ([`0xc6b4cf63…`](https://explorer.testnet.chain.robinhood.com/tx/0xc6b4cf63b9e63eea42950973f0c8269ccfbe0f9eb6cb5d889359a1063dad9295)).
   The same paste against v13 must be refused with `IsAnNft`.
3. Update `deployments.testnet.json`, the page, the tests and the CHANGELOG together — preflight enforces that
   they agree, and the doc check now covers published documents too.
4. All four live scripts against v13, and **read every transaction back from the explorer**, not from this
   repository's own receipt parsing.
5. Publish both pages, then round fourteen.

Nothing is deployed yet and the mainnet deployer is still at nonce 0.

## Standing practices adopted this round

- **Read the chain back from the explorer.** Checking receipts with the same code that wrote them is checking
  code with itself. The explorer decodes against the verified ABI independently. It ended the B-1 argument in
  one transaction, and it showed the gas probe over-estimates by 2-20% — always in the safe direction, which
  was previously assumed rather than known.
- **When a reader is fixed, enumerate its twins in the commit message.**
- **Do not deploy the contract twice for one change set.** Map first.
- **Run the mechanical tools before the human argument.** `forge coverage` and Slither cost minutes and answer
  questions no amount of reading answers. Neither had ever been run here.
- **Prefer a fork over a fixture** where a real contract exists to test against.

## What this plan does not cover

- Real wallet extensions, beyond one manual session on a phone against a pre-v10 contract. Deliberately
  deferred until the software stops changing under the person testing it.
- Mainnet behaviour. Nothing has run there and nothing will until the gate opens.
- The inherent limits, including I-1: one RPC endpoint is the sole witness for every "arrived", "skipped" and
  "held" verdict. That cannot be engineered away in a browser; it is disclosed, not solved.
