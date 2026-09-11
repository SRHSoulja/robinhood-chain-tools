# Independent adversarial release audit — round 16


> Published as written. The reviewer worked outside this repository against exact commit `ebc910b`, the head
> after round fifteen's fixes. Its one blocker, R16-B01, is closed in the commit that publishes this file,
> against the reviewer's own delayed-RPC reproduction; its two should-fix items with it; and the live-page
> mismatch it lists as an operational blocker is cleared by publishing that same commit.

## Exact target and verdict

**Target:** `ebc910b988929891f8b5199619c29b27633ee429` (`fix round fifteen release blockers`), parent `a0bb9798c358d6a5f7ad9dd040527a59bcb0ef43`.

I inspected and executed only the named commit. `git rev-parse HEAD` returned the target SHA, `git status --short --untracked-files=all` was empty, and the commit was also exported to temporary directories for clean-build, parent-comparison, and adversarial harness work. No later or uncommitted repository code was credited. I did not modify the repository.

**Verdict: NO — this exact commit is not safe for a public real-money mainnet release.** It contains **one demonstrated release-blocking source defect**. An in-flight **Assign my token ids** operation can overwrite a newer normal textarea edit with the older recipient set, parse that stale result, and re-enable Send. The exact reproduced end state had the old recipient in the visible list, a fresh one-recipient parse summary, and `Send.disabled === false`.

There is also one separate operational publication blocker: neither live HTML page matches this commit. That live mismatch is not counted as a defect contained in the commit. Thus the requested exact-commit blocker count is **1**, with **1 additional operational release gate**. Publishing this commit's reviewed artifacts would mechanically clear only the live hash mismatch; it would not make release safe while the source blocker remains.

No transaction was signed or broadcast, no deployment was made, no gas was spent, no token moved, and no DNS or production state was changed. Network activity was limited to read-only HTTPS/API/RPC checks.

## Demonstrated release blocker

### R16-B01 — stale asynchronous Assign completion overwrites newer recipient input and re-arms Send

**Classification: RELEASE BLOCKER.** Recipient-integrity / stale-state race.

**Where:** `web/index.html:2065-2094`, `web/index.html:2102-2139`, with the attempted general invalidation at `web/index.html:1057-1076` and readiness calculation at `web/index.html:2261-2289`.

Assign reads the current textarea into `wants`, saves `sourceBeforeAssign`, disables only the Assign button, and then awaits `myTokenIds(token, totalWanted)` (`2066-2094`). The recipient textarea, token, standard, network, account, quantity, and randomization controls remain live. A normal textarea edit while that RPC work is pending correctly fires the new `input` invalidator and clears the old parsed state. However, the earlier continuation does not compare the current textarea or context with its snapshot. It writes output derived from the old `wants` at `2102` or `2124`, calls `parseList()` at `2131`, and validates only that the generated rows match those same old `wants` at `2129-2135`. `plan()` consequently arms Send.

**Deterministic reproduction against the exact commit:**

1. Use a mocked ERC-721 wallet holding IDs 71 and 72, with approval already present.
2. Put recipient A (`0x0000000000000000000000000000000000000801`) in the textarea.
3. Delay the next holdings RPC by 1.2 seconds and click **Assign my token ids**.
4. While Assign is pending, use normal textarea input to replace A with recipient B (`0x0000000000000000000000000000000000000802`).
5. Allow the earlier RPC to finish.

Observed:

```json
{
  "finalList": "0x0000000000000000000000000000000000000801,72",
  "sendDisabled": false,
  "summary": "1 recipients1 distinct wallets"
}
```

The focused adversarial run reported four passing challenge cases for quantity parsing and malformed-simulation confirmation, then failed exactly this invariant:

```text
FAIL focus Assign async source race does not overwrite and re-arm a newer edit
```

This is a normal UI sequence, not a script-only mutation: Assign remains visibly in flight while the textarea remains editable. The user most recently supplied B, but the page later replaces it with an assignment for A and makes that plan executable without another Check-list action. The final confirmation and manifest provide secondary opportunities to notice the change, but they do not restore the required binding between the latest user-edited source and the plan the page arms. A hurried sender can irreversibly transfer NFTs to A while believing the just-entered list B is the working allocation.

The race also has adjacent context risk because `token` is captured before the await while `std()` and other globals are read after it. A token, standard, chain, or account transition can therefore make the completion consume a mixed context even though the direct recipient overwrite alone is sufficient to block release.

**Required fix:** snapshot an operation generation plus the exact textarea bytes, chain, account, token, standard, per-wallet quantity, and randomization choice before the first await. Immediately before any write, require every snapshot member and generation to remain current; otherwise leave the newer input byte-for-byte untouched, keep executable state disarmed, and report that Assign was cancelled because its source/context changed. Alternatively lock every relevant control for the full operation, but a generation check is still advisable for wallet events and programmatic state changes. Add delayed-RPC regressions for textarea, token/standard/network, and account changes.

## Round-15 blocker challenges

### B-01 — direct parsed-textarea binding

**Classification: closed for the originally reported path, but superseded by R16-B01.**

The direct parse binding is sound: `parsedListSource` records the exact textarea bytes (`web/index.html:208`, `1348-1351`); every ordinary input synchronously clears rows, derived skipped state, manifest, acknowledgements, summaries, and readiness (`1057-1076`); `plan()` counts rows only if the binding is current (`2261-2265`); preflight, approval, and Send revalidate (`2884`, `2952-2955`, `3063-3067`, `3110-3112`, `3145-3149`); and Send disables the form while in flight (`2377-2380`, `3093-3107`).

The exact commit passed normal edit, programmatic edit, preflight refusal, and no-wallet-request assertions. Running the new suite against the parent made all four fail; notably, the parent sent one wallet request after a programmatic list replacement. Editing during a standalone Test run may let that already-started read finish, but the input invalidator leaves Send disarmed. Normal editing during Send is prevented by the form lock. The uncovered asynchronous writer is the blocker above.

### B-02 — Assign quantity semantics and round trip

**Classification: closed for the synchronous/canonical parsing paths.**

`requestedNftQuantity()` makes a named amount/quantity column authoritative and otherwise reads bare `xN` (`web/index.html:928-942`). It shares `splitRow()` with the canonical parser, including RFC-4180 quotes and accepted separators (`862-903`), and rejects non-positive, fractional, unsafe, or otherwise non-whole quantities through `wholeNumber()` (`978-1003`). Assign consumes that reader (`2075-2086`), serializes safely (`2102`, `2123-2124`), reparses through `parseList()`, and compares aggregate wallet/quantity meaning (`2127-2141`).

The commit passed the Round-15 named `quantity`/quoted-metadata case (3+2 becomes five deliveries), the fractional-refusal/source-preservation case, and independent extensions for quoted CSV `x3`, whitespace `x2`, the `amount` alias, address-last columns, quoted comma/semicolon metadata, and `1.0` whole-number spelling. The parent produced only two assigned lines for the 3+2 input and rewrote the fractional source, failing all four new B-02 assertions. This does not cure the asynchronous stale-source race.

### B-03 — sender precedence and favorable verdicts

**Classification: closed.**

Both transaction and wallet-batch readers preserve `declaredFrom` and `senderUnreadable` (`web/check.js:1068-1084`, `1091-1159`). The compact shortcut retains the complete request (`1207-1213`), and `resolveRequestSender()` implements one precedence rule: valid declared sender, then UI only when omitted, with unreadable explicit input preventing substitution (`1216-1231`). Batch simulation and display use that resolution (`1286-1302`, `1377-1413`); the compact renderer applies the same resolver and disables simulation for unreadable explicit senders (`1531-1567`).

Independent DOM/RPC checks passed for: a valid single transaction whose sender differs from the UI; unreadable explicit senders as string, `null`, and number; two separate transactions retaining their independent senders and order; and UI fallback only when `from` is omitted. Unreadable cases made no `eth_simulateV1` request and rendered no `would succeed` pill.

The parent failed the declared-sender request capture, mismatch warning, and unreadable-sender surfacing. One parent-facing regression assertion nominally passed despite the old DOM containing a success pill; that harness weakness is recorded below, but the exact commit's behavior was independently checked using DOM elements and captured RPC senders.

### B-04 — ordered simulation cardinality, shape, order, status, and fallback

**Classification: closed.**

`completeOrderedSimulation()` requires exactly one top-level result, exactly the requested call count, object-shaped members, and status exactly `0x0` or `0x1` (`web/index.html:2938-2950`). The caller processes the array in requested order, stops on the first failure, and catches any validation/RPC error into `orderedCheckFailed` with an explicit isolated-check warning (`2986-3009`). The Send path then requires a separate weaker-check confirmation (`3167-3174`).

The exact commit passed empty, short, null response, null member, extra member, extra top-level result, missing calls, missing status, and unknown status cases. None printed the ordered-success statement. A focused Send test with empty ordered results and successful isolated calls confirmed that dismissing the weaker-check dialog produced `Stopped. Nothing was sent` and no wallet request. The parent falsely printed `every transfer holds` for the absent/short/extra families and failed all nine new B-04 assertions (the malformed-status cases stopped for the wrong reason rather than recognizing malformed evidence).

### B-05 — deployed artifact mismatch

**Classification: INHERENT/OPERATIONAL release gate; open, separate from source defects.**

Read-only fetches on 2026-09-11 produced:

| Artifact | Live SHA-256 | Exact-commit SHA-256 | Result |
| --- | --- | --- | --- |
| `https://rhairdrop.gmgnrepeat.com/` | `7d557aa114cae2c357e79fe1721ba7c6634eff6a5aa75d0c14f5143e91062238` | `03f456dffd867ce8b69bbfb1786b667f918b81819ce04a4879c12b202bb9e05d` | mismatch |
| `https://rhcheck.gmgnrepeat.com/` | `6fd92f7b7fe97ee13543f0536630c53197c5324dbc464b26dd31961a44df03b3` | `546cf4119429a31b37adcd85c78c779805a2c683d36058a6a5ae159d9093e988` | mismatch |
| live `/wc.js` | `d4c35a1b2b743b9f48b781730b171942a31d1b82d992b5d2dbb082b3843064d7` | same | match |

Both live roots returned HSTS and CSP headers, but their inline-script hashes correspond to the stale bodies, not this commit. Repository documentation correctly calls the mismatch open (`docs/status.md:143-155`). Publication of byte-identical reviewed artifacts, followed by independent body and header/hash comparison, is sufficient to clear this mismatch itself. Do not publish this commit: R16-B01 first requires a fixed successor and fresh exact-commit review.

## Should-fix findings

### R16-S01 — one B-03 regression can miss a visible success pill

**Classification: SHOULD-FIX.** Test-evidence precision, not a runtime defect in this commit.

`test/web/check.test.mjs:697-698` searches flattened `textContent` with `\bwould succeed\b`. Adjacent spans concatenate as `would succeedabout ...`, so there is no trailing word boundary. Against the parent, the DOM visibly contained the `would succeed` pill, yet that one assertion passed. Other B-03 assertions still failed and the exact commit is correct, but this check should query the success pill directly (for example `.pill.ok`) and separately assert zero ordered-simulation calls. The suite source fingerprint preserves the current assertion; it does not make a semantically weak assertion strong.

### R16-S02 — one status command table retains pre-Round-15 browser counts

**Classification: SHOULD-FIX.** Documentation only.

`docs/status.md:27-28` correctly reports 342 airdrop and 129 Check assertions, while the command table at `docs/status.md:41-42` still says 325 and 125. Correct the stale table so release evidence has one count.

## Probe-integrity, CI, CSP, manifests, runtime, and prior safety evidence

### S-02 fingerprint/inventory gate

**Classification: closed for the reported bypasses.**

`verify.sh:32-66` enumerates exact `audit-probe*.mjs` and `Audit*.t.sol` membership and hashes every complete probe source against `test/findings-baseline.json`. `verify.sh:75-98` treats file membership—not function-name substrings—as the trust boundary for ordinary contract tests. Assertion status/name fingerprints remain separately checked at `128-208`, and the two ordinary browser-suite sources are pinned at `100-115` and `211-214`.

Scratch-copy adversarial checks showed:

- a one-line comment-only mutation to an existing probe exited before long suites with `browser probe source changed`;
- adding `audit-probe-new.mjs` exited with `manifest differs ... unlisted`;
- an ordinary `test/OrdinaryFailure.t.sol` function named `test_probe_name_cannot_hide_an_ordinary_failure` appeared in the ordinary-file inventory and Forge failed it normally.

The complete-source scheme is not a proof against arbitrary malicious changes to the compiler, test runner, or all transitive dependencies; that is a general CI trust limit, not a demonstrated bypass in this exact remediation commit. None of those dependencies changed here.

### Test and CI results

- `./verify.sh`: exit 0. Five of five ordinary contract test files passed; airdrop page 342/342; Check page 129/129; CSP weakening gate 21/21; all browser/contract probe counts and assertion fingerprints exactly matched their baselines; full probe-source inventory/hash gate passed.
- Ordinary Forge run: 111/111 tests passed, including 96 invariant runs × 24 calls with no handler revert.
- Read-only mainnet fork: 4/4 passed; 20/20 sampled real ERC-721s accepted by the NFT guard and refused by the ERC-20 guard, 20/20 sampled ERC-20s accepted, and the retained v12 implementation let 20/20 collections through as the negative control.
- GitHub Actions run `34588973528` for exact SHA `ebc910b9...` completed successfully. Its preflight, full verify/probes, reproducible connector, and deployed-bytecode steps all report success. The workflow pins checkout, Foundry action/version, setup-node action/version, and installs from lockfiles (`.github/workflows/tests.yml:16-63`).
- The latest scheduled integrity runs were red, consistently with the deliberately open live-page mismatch rather than a hidden green deployment claim.

### CSP and delivery integrity

`./preflight.sh` passed both inline-script hashes, `check.html`/`check.js` identity, contract-address consistency, all 15 error decoders on both pages, key-material scan, and live-script token-ID checks. `test/csp-gate.test.sh` passed 21/21 mutations, rejecting widened/default/host directives, unsafe script tokens, and additional directives. The committed pages each contain one hashed inline script, pin ethers 6.13.4 with SHA-384 SRI (`web/index.html:168`, `web/check.html:89`), and do not grant `unsafe-inline` for script.

`deploy/publish.sh` refuses dirty application trees by default (`58-69`), validates the exact inline CSP hash (`74-92`), pins and verifies the WalletConnect digest (`95-130`), embeds HTML into the worker, and compares the externally served body after publication (`289-324`). Explicit bypass flags are announced (`23-43`); they remain operational authority and must not be used for release.

The WalletConnect rebuild from its pinned lockfile produced SHA-256 `d4c35a1b2b743b9f48b781730b171942a31d1b82d992b5d2dbb082b3843064d7`, equal to `web/wc.js`, `EXPECTED-SHA256`'s contents, and the live `/wc.js` bytes.

### Contract and duplicate-send safety

`src/BulkSend.sol` is byte-for-byte unchanged from the parent: `git diff --quiet <parent> <target> -- src/BulkSend.sol` succeeded, and its source SHA-256 is `61f7bb7f208d307542d51fc4e42fe99d5519d94893ae3a60fb7f07534b4c1159`.

A clean archive build of this exact commit produced a 9,752-byte runtime with SHA-256 `882905ef9966a5c1151e73708a8bbb5311d7085d9d3179db9913c3b8da4b2b81`. Read-only `eth_getCode` at testnet `0xf2ed6359f5dee0334d68cd21d306d9d3e7a49232` returned the identical 9,752 bytes and hash.

The existing duplicate-send defenses remain exercised by the green suite: click-level reentrancy guards, pre-wallet pending records, hashless EIP-5792 status reconciliation, receipt/log attribution, held-row behavior, account-scoped ledgers, cross-tab Web Locks, storage refusal, immutable run keys while sending, and exact manifests. Source review confirms the pending record is written before wallet submission in both bulk and wallet paths and uncertain outcomes remain held. These protections do not cure R16-B01 because that defect occurs while constructing and arming the plan before Send.

## Inherent and operational limits (non-blocking unless promoted above)

- **INHERENT/OPERATIONAL:** one RPC and token-reported state cannot independently prove simulation or delivery truth; reorgs, lying tokens, and faulty nodes remain possible. Keep independent post-send checks and a production RPC/failover plan.
- **INHERENT/OPERATIONAL:** browser-local duplicate state cannot coordinate another device/profile, cleared storage, or manual release of uncertain rows. The existing warnings and conservative holds are appropriate.
- **INHERENT/OPERATIONAL:** selector/interface probes cannot prove adversarial token semantics. Round-15 S-01 also remains a non-blocking gas-grief issue: uncapped high-level classification probes can consume gas or copy large returndata, but they run before transfers and revert rather than falsely accounting delivery. Address it in the next contract version with bounded calls and fixed-size returndata handling.
- **INHERENT/OPERATIONAL mainnet prerequisites:** the exact page still has an unsubstituted mainnet BulkSend address and `LIVE_CHAINS = new Set([46630])` (`web/index.html:174-175`, `280`), so mainnet sending is intentionally disabled. `docs/status.md:14-25` also requires a production RPC plan, current real-wallet rehearsals, clean review, and explicit maintainer authorization. Those controls must remain unmet until R16-B01 is fixed and reviewed.

## Final release answer

**Demonstrated release blockers contained in exact commit `ebc910b988929891f8b5199619c29b27633ee429`: 1.**

**Additional operational publication blocker: 1 live HTML mismatch.** It is not a source defect and byte-identical publication would clear that mismatch, but publication must wait for a reviewed successor that fixes R16-B01.

Accordingly, this exact commit must not be used for a public real-money mainnet release.
