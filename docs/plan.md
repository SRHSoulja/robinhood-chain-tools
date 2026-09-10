# The plan from here to a first release

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
| **Done when** | v13 deployed to testnet, verified on the explorer, runtime byte-identical to the build; the B-1 probe FAILS; and the real-chain reproduction is re-run and now refuses. |

B-1 is proven on chain against v12, not only in a test:
[`0xc6b4cf63…`](https://explorer.testnet.chain.robinhood.com/tx/0xc6b4cf63b9e63eea42950973f0c8269ccfbe0f9eb6cb5d889359a1063dad9295)
records two ERC-721 `Transfer` events and an `Airdrop20(sent 2, skipped 1)` in one transaction. The fix is
checked the same way: the same paste, against v13, must refuse.

## Phase 3 — the second blocker

| | |
| --- | --- |
| **Covers** | B-2 |
| **Done when** | probe `S13-1` reports fixed: a pending record exists in `localStorage` *while the wallet still has the request*, and a tab killed mid-signature holds those recipients on the next load rather than offering them again. |

Nothing is written down until the wallet answers, so a batch signed on a phone and lost with the tab is paid
twice. The recovery path for a hash-less pending record already exists in `reconcilePending` and nothing ever
creates one. The page's own footer states the opposite of the current behaviour.

## Phase 4 — the parity fixes

| | |
| --- | --- |
| **Covers** | S-1, S-2, S-5 |
| **Done when** | each probe reports fixed, and each fix names in its commit message every reader of that input that was checked. |

The commit-message rule is the habit round thirteen asked for, and it is the only part of this plan that is
about process rather than code: **when a reader is fixed, list every other reader of the same input.**

## Phase 5 — what the software says about itself

| | |
| --- | --- |
| **Covers** | S-4, S-6, S-7 |
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
