# Thirteenth external review — Robinhood Chain tools

**Commit** `f4f5ca6` · **Contract** `BulkSend` v12 at `0xc2e4a9C4c9215600d1B348d02b63C6148d0Ef481` (testnet 46630)
**Date** 2026-09-10 · Complete.


> Published as written. The reviewer worked in a fresh clone outside this repository at commit `f4f5ca6`,
> against BulkSend v12. Nothing in this file has been edited, the findings least of all. Both blockers and all
> seven should-fix items were closed after it, in the order set out in [`plan.md`](plan.md); the probes it
> added (`test/Audit13.t.sol`, `test/web/audit-probe-13.mjs`) are in the repository and in the baseline.

---

## The release bar I am judging against

"Ready" for software that moves other people's money in a browser, written by one person and audited by no
firm, means all six of these are true. I am not measuring against "no bugs"; I am measuring against "the
failure modes that remain are ones the user is told about before they sign."

1. **The contract cannot be made to move what the caller did not intend to move.** Not "does not normally" —
   *cannot*, for any token the caller can paste into the form, including one pasted into the wrong form. Where
   the contract cannot tell two situations apart, it must refuse rather than pick, because the caller's loss
   is irreversible and the contract's is nothing.
2. **Every statement the software makes about what happened is either true or explicitly hedged.** A counter
   that says "delivered" must mean a transfer call was made and did not fail, and the software must say that
   that is all it means. A row reported as skipped must be a row that provably moved nothing. The asymmetry
   matters: over-reporting a skip causes a double payment, over-reporting a delivery causes a silent
   underpayment, and both are real losses.
3. **The default path is the safe path.** A user who reads nothing, clicks through, and uses the page the
   obvious way must not be able to lose funds. Safety that depends on reading the README is not safety.
4. **Nothing signs twice for one intent.** Across reloads, crashes, tab closes, replaced transactions, wallet
   disconnects and two tabs, one click means at most one on-chain effect, or the page says plainly which of
   those cases it cannot cover.
5. **What is served is what was reviewed.** The bytes on the origin match the bytes in the repository, the
   runtime bytecode matches the source, and the chain from "commit reviewed" to "byte served to a browser" has
   no step where something else can be substituted without a check failing loudly.
6. **The read-only page is read-only, and its confidence is calibrated.** It must never present a transaction
   or a contract as safer than the evidence supports, and it must never resolve an ambiguity in attacker
   controlled input by picking the friendlier reading.

A finding **blocks release** if it breaks 1, 2, 3 or 5, or breaks 4 or 6 in a way a normal user will hit.
A finding is **should-fix** if it needs an unusual but reachable state, or costs correctness without costing
funds. A finding is an **inherent limit** if no browser page talking to contracts nobody controls could do
better — for those I say what the page should *say*, not what it should do.

---

## What I ran, and the baseline I worked from

    forge test                          113 passed, 7 failed   (the 7 are probe files; expected)
    npm test                            301 + 116 passed, 0 failed
    node test/web/audit-probe-12.mjs    0 demonstrated, 10 no longer reproduce
    cast code 0xc2e4…f481               identical to out/BulkSend.sol/BulkSend.json

Round twelve's zeros are earned, not worded. I read the probes rather than the counts: A-3 checks the
per-recipient figure numerically (`'54,000'`, not `'40,000'`), A-1b is written inverted so the control has to
read "fixed", and A-2's refusal is real. The one caveat is that `audit-probe-12.mjs` runs in no automated
configuration — see **S-3**.

**Two probe files added by this round**, in the repository's own backwards convention (a probe that PASSES is
a defect that reproduces):

    forge test --match-path test/Audit13.t.sol      2 pass  -> 2 findings reproduce
    node test/web/audit-probe-13.mjs                6 demonstrated, 0 no longer reproduce

`./verify.sh` will fail on both with "the baseline has never heard of this file", which is that guard working.
Once both findings are closed the entries should be `"Audit13": 1` and `"audit-probe-13": 0`. The 1 is not a
surviving finding: `test_probe_strict_mode_survives_the_same_paste` is a control that passes either way, and
`verify.sh` counts passing tests including controls (which is why `Audit12` is 5 with 7 tests in the file).

---

## Findings at a glance

| | finding | where |
|---|---|---|
| **blocks release** | **B-1** `_mustNotBeNft` probes one id where its mirror probes three; NFTs spent as ERC-20 amounts | `src/BulkSend.sol:299,438` |
| **blocks release** | **B-2** nothing is written down until the wallet answers; a batch lost with the tab is paid twice | `web/index.html:3034,3113` |
| should fix | **S-1** every headed CSV is refused by "Use these" and by "Assign", and told to delete its heading | `web/index.html:1496` |
| should fix | **S-2** `deliveriesOn` takes the column map and never reads it | `web/index.html:1466` |
| should fix | **S-3** CI runs none of `verify.sh`, the CSP gate, or `preflight.sh`; the hook is not wired | `.github/workflows/tests.yml` |
| should fix | **S-4** a low RPC estimate understates the quoted cost ~3x while labelled "at most" | `web/index.html:344,2192` |
| should fix | **S-5** Check simulates a call whose calldata it could not read, and gives it a verdict | `web/check.js:1372` |
| should fix | **S-6** SECURITY.md's "approves the exact batch total" is false for ERC-721 and ERC-1155 | `SECURITY.md` |
| should fix | **S-7** 9 of the contract's 15 errors reach the user as a bare hex selector | `web/index.html:3221` |
| inherent limit | **I-1** one RPC endpoint is the sole witness for every arrival verdict | throughout |

---

### B-1 · `_mustNotBeNft` is defeated by the exact state its twin was taught to survive — **blocks release**

**Category:** blocks release (promise 1 and 2 both fail: NFTs leave the sender and the batch calls it an
ERC-20 delivery). **Demonstrated**, not reasoned: `test/Audit13.t.sol`.

**Where:** `src/BulkSend.sol:299` (`_mustNotBeNft(token, amounts[0])`) and `src/BulkSend.sol:438-440`.

**The shape you said catches you twice.** v12 rewrote `_mustBeNft` because probing a single id was not enough:
it now probes `ids[0]`, then `ids[n-1]`, then `supportsInterface(0x80ac58cd)`, precisely because the first id
in a list can be burned or unminted. `_mustNotBeNft` — described in its own comment as "the mirror of
`_mustBeNft`… it exists for the same reason" — was written the same day and still probes one value:
`ownerOf(amounts[0])`. The fix went to one reader and not to its twin.

**Input and state.** The sender holds ids 2 and 3 of a collection; id 1 was burned, sold, or never minted.
They put the collection address into the ERC-20 path with their id list as amounts:

```
0xAA…, 1
0xBB…, 2
0xCC…, 3
```

`ownerOf(1)` reverts, so `_mustNotBeNft` returns without objecting. Row 0 then reverts (no such id) and, in
**lenient** mode, is *skipped*. Rows 1 and 2 call `transferFrom(msg.sender, dst, 2)` and
`transferFrom(msg.sender, dst, 3)` — one selector, both standards — a conforming ERC-721 returns nothing, and
`_erc20Answer` reads empty returndata as a USDT-style success.

**Cost to the user.** Two NFTs leave the wallet irreversibly, to addresses chosen for an ERC-20 drop. The
contract emits `Airdrop20(token, from, sent=2, skipped=1)` and returns `sent = 2`, so both the counter and the
event describe a token airdrop that did not happen. This is the failure the guard was added to prevent, and
the guard reports success while it happens.

(I checked what the page would then say, rather than assuming the worst: `confirmArrival` reads
`balanceOf(address)`, which an ERC-721 also implements, so the recipient's count rises by 1 against a `want`
of 2 or 3 and the rows are classified **short** — "this token takes a cut on transfer" — and held rather than
recorded. So the page does not compound it into a double payment, but it does explain an irreversible loss of
two NFTs as a fee-on-transfer token. The loss itself is already done by then, and it is the contract that did
it.)

**Reproduce:**
```
forge test --match-path test/Audit13.t.sol
```
`test_probe_mustNotBeNft_is_bypassed_when_the_first_id_is_not_minted` PASSES today (`sent = 2`, `ownerOf(2)`
and `ownerOf(3)` both moved). Its companion `test_probe_strict_mode_survives_the_same_paste` shows strict mode
is saved only by row 0 reverting first — which is luck, not design: put the unminted id last and strict mode
delivers the earlier NFTs before it reverts… except it does not, because a revert undoes them. Strict is
genuinely safe here; lenient is not.

**On your own argument.** You wrote that the second case — an NFT address pasted with genuine 18-decimal
amounts — is harmless because no such token id exists so every transfer reverts. That argument is sound *for
that case*, and it is not the case that breaks. What breaks is the first case, the one the guard exists for:
"amounts that are really ids" is only caught when `amounts[0]` happens to be a live id.

**Fix, in a form you can check later.** Make the mirror an actual mirror. `_mustNotBeNft` should refuse if
**any** of these answers:

```solidity
function _mustNotBeNft(address token, uint256 probeA, uint256 probeB) internal view {
    if (_answersOwnerOf(token, probeA)) revert IsAnNft(token);
    if (probeB != probeA && _answersOwnerOf(token, probeB)) revert IsAnNft(token);
    (bool ok165, bytes memory r165) =
        token.staticcall(abi.encodeWithSelector(0x01ffc9a7, bytes4(0x80ac58cd)));
    if (ok165 && r165.length == 32 && abi.decode(r165, (uint256)) == 1) revert IsAnNft(token);
}
```
called as `_mustNotBeNft(token, amounts[0], amounts[n - 1])`. The `supportsInterface` probe is the one that
actually closes it, because it does not depend on which ids the sender happens to have listed, and it costs
one extra `staticcall` per batch (~2,600 gas against a batch of tens of millions). Note the asymmetry in
cost direction: for `_mustBeNft` the extra probes are in the failure path, for `_mustNotBeNft` they are in the
happy path — that is the price, and it is small. The check clears when
`test_probe_mustNotBeNft_is_bypassed_when_the_first_id_is_not_minted` FAILS with `IsAnNft`.

**Caveat on the page.** The page auto-detects the standard from ERC-165 and overrides the dropdown, so
reaching this through `rhairdrop.gmgnrepeat.com` needs a collection that does *not* answer `supportsInterface`
— which is exactly the collection class v12 taught `_mustBeNft` about. The contract is public, ownerless and
permissionless, and `docs/for-reviewers.md` presents it as the thing that matters; it must not depend on one
particular front end to be safe.

---

### B-2 · Nothing is written down until the wallet answers, so a batch signed on a phone and lost with the tab is paid twice — **blocks release**

**Category:** blocks release (promise 4 fails, and the footer states the opposite). **Demonstrated**:
`test/web/audit-probe-13.mjs`, probe `S13-1`.

**Where:** `web/index.html:3034-3042` (bulk path) and `web/index.html:3113-3117` (wallet-batch path). In both,
`addPending(...)` runs **after** the wallet's promise resolves:

```js
const tx = await bulk[fn](...args, onThisChain());   // the user has already approved; it is on the wire
// Written down before the wait: if this tab closes now, …
const pid = newPid();
if (!addPending({ pid, run: ledgerKey(), …, hash: tx.hash, … })) { … }
```
The comment is true about the window it names and silent about the window before it.

**Input and state.** A phone. The user connects over WalletConnect (the page's own advice pushes people to a
phone wallet, and `connectPhoneWallet` is a first-class button), presses **Send**, and is switched into their
wallet app to approve. The wallet broadcasts. The browser tab is evicted by iOS/Android — routine on mobile,
and the reason `switchChain` already has a "the wallet may never answer" path — or the user simply closes it.
The page never receives `tx.hash`, so `addPending` never runs, so **nothing at all** exists in `localStorage`
for that batch.

**Cost to the user.** On the next visit the ledger has no delivered rows and no pending record. Every
recipient in that batch is offered again and paid a second time. For a 100-recipient ERC-20 batch that is 100
duplicate payments; for NFTs it is a second transfer attempt that fails (the sender no longer owns them) and
wastes gas, but for ERC-20 and ERC-1155 it is a straight double payment out of the sender's balance.

**Why this is not covered by the stated limits.** The footer says, in the page's own words:

> "A batch that was signed but never confirmed here is written down too, and read back from the chain next
> time before anything else is sent."

That sentence describes exactly this batch — signed, never confirmed here — and it is not written down. The
disclosed limits are "another browser, another device, a cleared cache or a private window". This is the same
browser, the same device, the same profile.

**Reproduce:**
```
node test/web/audit-probe-13.mjs
```
`S13-1` holds `eth_sendTransaction` open for 20 s, closes the tab while the wallet still has it, reopens in
the same browser context, and reports: no `bulksend:pending:*` key at any point, and the same recipient
offered again with no "held back" and no "already delivered".

**Fix, in a form you can check later.** Write the record **before** the call, not after — the recovery path
for it already exists and is currently unreachable. `reconcilePending` already handles an entry with no hash:
"was sent to your wallet and never came back with a transaction. Connect the same wallet on the same network
and reload… Until then those recipients are held back." Nothing creates such an entry for the bulk path.

1. Build the calldata first (`bulk.interface.encodeFunctionData(fn, args)` / the `calls` array).
2. `addPending({ pid, run: ledgerKey(), …, hash: null, at, rows, via, token, std, call: { to, data, from } })`
   and refuse to send if that write fails — the same refusal already written for the post-hash case.
3. Then sign. On success, `updatePending(pid, e => { e.hash = tx.hash; })`.
4. If the wallet *rejects*, drop the record (`dropPending(pid)`) — a rejected request moved nothing, and there
   is a definite answer to act on.
5. If the page never gets an answer at all, the record stays, hash-less, and the next load holds those rows
   and asks the user to check the explorer.

The check clears when `S13-1` reports **fixed**: a `bulksend:pending:*` key exists while the wallet still
holds the request, and the reopened page holds those rows back rather than offering them.

The residual window then shrinks to "the write to `localStorage` and the wallet prompt", which is
microseconds and synchronous, rather than "however long the user spends in their wallet app".

---

### S-1 · Every CSV that names its columns is refused by both box rewriters, and the refusal tells the user to delete the heading — **should be fixed**

**Category:** should be fixed (no funds lost; the workaround it recommends can make a valid file unreadable).
**Demonstrated**: `test/web/audit-probe-13.mjs`, probe `S13-2`.

**Where:** `web/index.html:1496-1506` (`unreadableLinesInBox`) with `web/index.html:887-899` (`addressOn`).

`unreadableLinesInBox()` walks every non-blank line and calls any line without a readable address unreadable.
On a headed file the heading is such a line — `addressOn` reads `cells[col.to]`, gets the text `address`, and
returns null. So `refuseForUnreadableLines` fires on **every** correctly-headed CSV, for both of its callers:
`"Use these"` in the picker and `"Apply to the list"` in the weighting panel.

**Input and state.** ERC-721, a file the page's own named-column reader parses cleanly:
```
address,tokenId
0x…111,1
0x…222,2
```
`Check list` reports "2 recipients, 2 distinct wallets". Open the picker, select two, press **Use these**:

> "3 lines are in the box and 2 of them have a wallet address on them. "Use these" would rewrite the box and
> line 1 would go with it. Fix or remove that line first."

**It also blocks the workflow the page itself recommends.** `refuseForUnreadableLines` has two callers, and
the second is `"Assign my token ids"` (`web/index.html:1919`). `parseList` routes a file headed `address` with
nothing else in it to `offerToAssign`, whose panel says:

> "These are wallets with no token ids yet. Press "Assign my token ids" and the ones you hold are filled in
> for you."

Press it, and:

> "3 lines are in the box and 2 of them have a wallet address on them. Assign would rewrite the box and line 1
> would go with it. Fix or remove that line first."

The page sends the user to a button and the button refuses the file the page sent them there with. Probe
`S13-2b`.

**And this is the twin-reader shape again, five ways.** Five things rewrite or re-read the recipient box.
Three handle a heading correctly and two do not:

| rewriter | heading handled? | how |
|---|---|---|
| `$('shuffle')` (`:1835`) | ✔ | filters the first line through `looksLikeHeading` |
| `$('dropContracts')` (`:1902`) | ✔ | keeps any line with no address in the drop set |
| `$('applyWeight')` (`:1856`) | ✔ | `if (!addr) return l` — unreadable lines are kept verbatim |
| `$('pickUse')` (`:1571`) | ✘ | `refuseForUnreadableLines` |
| `$('assign')` (`:1919`) | ✘ | `refuseForUnreadableLines` |

**Cost to the user.** The picker and Assign — the two features for turning a list of wallets into a list of
pairs — cannot be used with any file that has a header row, which is what every export in the list at
`web/index.html:840-843` (Etherscan, Blockscout, Safe, thirdweb, Dune, Moralis, OpenSea, Premint, snapshot)
produces. Worse, the advice is actively wrong for a file whose address column is not first: delete the heading
from `tokenId,address` and the positional reader takes column 1 — the token id — as the recipient, and every
row is refused as "not a wallet address". It fails closed, so no funds move; it is still a refusal message
that recommends the one edit that breaks the file.

**Fix.** `unreadableLinesInBox()` should skip the heading row when `boxColumns()` is non-null, the same way
`parseList` and `walletsInBox` already do, and the rewriters should preserve the heading rather than dropping
it:
```js
function unreadableLinesInBox() {
  const col = boxColumns();
  const lines = $('list').value.split(/\r?\n/);
  const headIdx = col ? lines.findIndex((l) => l.trim()) : -1;
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === headIdx) continue;                      // a heading the page itself read is not unreadable
    if (!lines[i].trim()) continue;
    if (!addressOn(lines[i], col)) bad.push(i + 1);
  }
  return bad;
}
```
The check clears when `S13-2` reports **fixed** and the box is rewritten with its heading intact.

---

### S-2 · `deliveriesOn` takes the column map and never reads it, so the picker and the parser disagree about how long the list is — **should be fixed**

**Category:** should be fixed. **Demonstrated**: `test/web/audit-probe-13.mjs`, probe `S13-3`.

**Where:** `web/index.html:1466-1478`. The signature is `deliveriesOn(line, col)`; `col` appears nowhere in
the body. Every caller passes it (`walletsInBox`, `web/index.html:1479-1487`), and the function's own comment
is:

> "The rules are parseList's, deliberately: if these two ever disagree the picker silently shortens the list
> again."

They disagree. On a headed file the function cuts the line positionally, exactly the reader S-8 was written to
remove.

**Input and state.** ERC-721 with a file headed `address,tokenId,amount` (a Dune or thirdweb export that
carries a quantity column alongside the ids):
```
address,tokenId,amount
0x…111,1,1
0x…222,2,1
```
`parseList` reads it by name — one row per line, 2 recipients. `deliveriesOn` takes `parts.slice(1)` =
`['1','1']`, sees two whole numbers, and returns **2 deliveries per line**. The picker therefore reports
`0 chosen of 4 wallets` for a list the page has just told the user is 2 recipients.

The other direction is the dangerous one and is currently masked by S-1: a file headed `address,tokenIds` with
a quoted multi-id cell (`0x…111,"11 12 13"`) is three rows to `parseList` and **one** delivery to
`deliveriesOn`, so `"Use these"` would rewrite three NFTs' worth of list as a single line. Today
`refuseForUnreadableLines` blocks that before it happens — the two defects cancel. Fixing S-1 without fixing
S-2 uncovers it, which is worth knowing before you fix only one.

**Cost to the user.** Today: the picker is unusable on headed files and states a wallet count that
contradicts the parse. After S-1 is fixed and if S-2 is not: silent shortening of the recipient list, which is
the thing the picker's own comment promises never to do.

**Fix.** Use the map:
```js
function deliveriesOn(line, col) {
  const t = String(line || '').trim();
  if (!t) return 0;
  if (std() !== '721') return 1;
  const cells = splitRow(t);
  if (col) {
    if (col.qty !== undefined && col.id === undefined) return wholeNumber(cells[col.qty]) || 1;
    if (col.id === undefined) return 1;
    const many = String(cells[col.id] || '').trim().split(/[\s|]+/).filter(Boolean);
    return (many.length > 1 && many.every((x) => wholeText(x) !== null)) ? many.length : 1;
  }
  const rest = splitRow(t).filter(Boolean).slice(1);
  const mult = rest.find((x) => /^x\d+$/i.test(x));
  if (mult) { const n = parseInt(mult.slice(1), 10); return Number.isFinite(n) && n > 0 ? n : 1; }
  if (rest.length > 1 && rest.every((x) => wholeText(x) !== null)) return rest.length;
  return 1;
}
```
The check clears when `S13-3` reports **fixed** and the picker's count equals the parser's recipient count for
that file, and for `address,tokenIds` with a quoted `"11 12 13"` cell.

### S-3 · The three guards that stop a fix reopening a finding are in no configuration that runs automatically — **should be fixed**

**Category:** should be fixed. **Demonstrated** by inspection of the configuration plus one command.

**Where:** `.github/workflows/tests.yml:22-45`, `.githooks/pre-commit`, `README.md:220-222`, `docs/status.md:196`.

Three mechanisms in this repository exist specifically to catch the failure mode you name as your worst: a fix
from one round becoming the next round's finding. None of them runs without a human remembering to.

1. **`./verify.sh`** — the only thing that compares probe counts against `test/findings-baseline.json` and
   fails when "something closed has come open again". CI does not run it. `tests.yml` runs
   `forge test --no-match-path 'test/Audit*.t.sol'` and `npm test`, both of which deliberately **exclude every
   probe file**. So a commit can reopen any of the twenty findings the probes pin, and CI stays green.
2. **`./test/csp-gate.test.sh`** — the 21 checks that a weakened published CSP is refused. Run by `test.sh`
   and `verify.sh`; not by CI, and not by `npm test`. `deploy/csp-gate.py` itself runs only at publish time.
3. **`./preflight.sh`** — the stale-CSP-hash check, the stale-`check.html`-copy check, and the
   page/manifest/tests/docs contract-address agreement check. It runs from `.githooks/pre-commit`, and
   **nothing sets `core.hooksPath`**:

```
$ git config --get core.hooksPath      # in this clone, at f4f5ca6
(unset, exit 1)
$ grep -rn hooksPath . --exclude-dir=.git --exclude-dir=node_modules
(nothing)
```
A fresh `git clone` runs `.git/hooks`, which holds only the samples. `README.md:222` says preflight "Runs on
every commit through `.githooks/pre-commit`" and `docs/status.md:196` says "`./preflight.sh` runs the cheap
consistency checks on every commit". Both are false in any clone that has not had one undocumented command
run in it, and the README does not give that command.

**Cost.** Not funds directly. It is the reason the next round finds the same shape again: the one automated
thing that would say "this fix reopened an earlier finding" is opt-in, and the history in
`docs/for-reviewers.md` says opting in is exactly what does not happen under pressure ("eight commits with no
CI" is a commit message in this repository).

**Fix.**
- Add to `tests.yml`, after the existing steps: `./test/csp-gate.test.sh` and `./verify.sh`. `verify.sh`
  already exits non-zero on both the "count went up" and the "unknown probe file" cases.
- Either commit a `core.hooksPath` bootstrap that a contributor is told to run
  (`git config core.hooksPath .githooks`, in the README next to `./preflight.sh`), or drop the "every commit"
  claim from README and status.md and call preflight what it is: a script you run.
- Note that `verify.sh` also needs `forge` on PATH and a Playwright browser, both of which CI already installs
  by the time the last step runs.

**Note for this round:** I added `test/Audit13.t.sol` and `test/web/audit-probe-13.mjs`. `verify.sh` will fail
on both with "the baseline has never heard of this file", which is the behaviour working as designed. The
entries, once you have fixed the findings, should be `"Audit13": 1` under `contract_probes` (one of the two
is a control that passes either way) and `"audit-probe-13": 0` under `web_probes`. **Today they are
`Audit13: 2` and `audit-probe-13: 6`.**

---

### S-4 · A hostile or broken RPC cannot break the batch cap, but it can understate the quoted cost by about three times — **should be fixed**

**Category:** should be fixed (promise 2: a figure the user acts on can be wrong by 3x). **Reasoned from
source**, with the bounds checked arithmetically.

**Where:** `web/index.html:344-347` (`measuredCap`, `maxBatch`), `web/index.html:394-404` (the probe's
guards), `web/index.html:2192-2201` (`costLine`).

**Your belief is right about the cap.** I worked the bounds and they hold in both directions:
- `per` must satisfy `Number.isFinite(g) && g > 21000` and `per >= fallbackPer()/4`.
- `measuredCap() = Math.max(1, Math.floor(30_000_000 / (per * 1.35)))`, so an enormous `per` gives 1 and a
  non-finite product gives `floor(x/Infinity) = 0 → max(1, 0) = 1`.
- `maxBatch() = Math.min(400, cap || 200)`, and `cap` is never 0 or `NaN` because of the `Math.max(1, …)`.
- The smallest accepted `per` for ERC-721 is `153000/4 = 38250`, giving `floor(30e6/51637) = 581 → 400`. So the
  worst a hostile answer can do to the cap is push it to 400, which is the ceiling an honest cheap collection
  already gets. **The cap is bounded. That half of the question is answered.**

**What is not bounded is the sentence next to it.** `gasPerRecipient()` is the same number and it feeds
`costLine`, which the confirmation dialog prints as `Estimated cost: … ETH in gas` and the plan panel prints
under the label **"at most"**. An RPC that answers `21000 + 38250` for a collection that really costs 152,843
produces a quote of 51,637 a wallet — about a third of the truth — labelled as a ceiling. `syncBatchRow` then
prints "This collection was measured rather than assumed", which is the page vouching for the number.

**Input and state.** `rpc.testnet.chain.robinhood.com` (hardcoded, not user-selectable) returns a low but
plausible `eth_estimateGas` — a node running an out-of-date state root, a node behind a proxy that caches an
estimate from before a collection's transfer hook was added, or a compromised endpoint. No other guard fires.

**Cost to the user.** They budget a third of what the airdrop costs, and the oversized batch then fails at
`eth_estimateGas` time in their wallet (32,000,000 tx limit), so they pay nothing for the failed attempt but
are told a false number before deciding to proceed. On a long list split into many transactions, they run out
of gas money partway through a run that is already delivering.

**Fix.** The word "at most" is a claim about a ceiling, so make it one: quote
`Math.max(measuredPerRecipient, fallbackPer())` — the larger of the measurement and the known-dearest token of
that kind — while continuing to size the cap from the measurement alone. That keeps the cap responsive to a
cheap collection and stops the cost line ever going below the only figure on the page that is a real bound. If
you prefer to keep the quote at the measured figure, then drop "at most" and say "measured, and a measurement
is not a ceiling".

---

### I-1 · One RPC endpoint is the sole witness for every "arrived", "skipped" and "held" verdict — **inherent limit**

**Category:** inherent limit of doing this in a browser.

`confirmArrival`, `holdingsOf`, `arrivalsFromReceipt`, `readBatchReceipt`, `reconcilePending` and `probeGas`
all read `cfg().rpc` — a single hardcoded endpoint. The page's language consistently attributes lying to the
*token* ("a token written to lie can lie here too", `web/index.html:2338`) and never to the node. A node that
fabricates a receipt, or reports a `Skipped` event that never happened, moves rows out of the delivered
ledger and back into the payable list; a node that reports arrivals that did not occur records rows as
delivered that were never paid. Neither is detectable from inside the page.

There is no fix available in a browser — the page cannot run a light client, and asking two endpoints only
moves the trust to whoever operates the second. The footer already points at the explorer
(`explorer.testnet.chain.robinhood.com`) as a second host, which is genuinely the right mitigation and is
worth more than it currently gets said.

**What the page should say**, rather than what it should do: the delivery notes should name the node as well
as the token. Today they say

> "That is the token's own answer about its own state, which is the strongest evidence available from a
> browser and still not proof: a token written to lie can lie here too."

which should be

> "…and it reached this page through one node, `rpc.testnet.chain.robinhood.com`. A token written to lie can
> lie here, and so can a node. The transaction on the explorer is a second, independent reading of the same
> thing, and it is the one to trust if the two ever disagree."

The `SECURITY.md` / `docs/for-reviewers.md` trust-model sections should list the RPC endpoint alongside
Cloudflare, the registrar, GitHub and Reown as a control-plane dependency this repository cannot prove.

### S-5 · Check gives a sequence verdict for a request it has just said it will give no sequence verdict for — **should be fixed**

**Category:** should be fixed (promise 6: the friendlier reading is picked for a field it could not read).
**Demonstrated**: `test/web/audit-probe-13.mjs`, probe `S13-4`.

**Where:** `web/check.js:1372` (`simulatable`), `web/check.js:1286` and `web/check.js:1400`.

The rule is stated correctly for one field and not applied to the other:

```js
const simulatable = calls.every((c) => ADDR_RE.test(String(c.to || '')));
```
An unreadable **destination** stops the sequence from being simulated, with the reason spelled out —
"Running the others in order would leave that one out, and a verdict with a member missing is not a verdict."
An unreadable **calldata** does not. `readTransaction` sets `data: '0x'` when the bytes cannot be read, marks
the call `invalid`, and the sequence is then simulated *as a plain transfer of ETH*.

**Input and state.** The page's own worst historical input: an unlimited approve whose `0x` was lost on the
way through a chat window.

```json
{"method":"eth_sendTransaction","params":[
  {"to":"0x2020…2020","data":"095ea7b30000…0000ffffffff…ffff"}]}
```
with an address in the "from" box. `HEX.test("095ea7b3…")` is false, so `invalid` is set, `invalidMembers`
becomes 1, and the batch renderer runs. The output contains, in this order:

> **1 of its 1 entries could not be read as calls** — "…**No verdict is given for the sequence as a whole.**"
>
> **run in order, every call succeeds — as read here** — "Simulated as one sequence, as 0x00…dead, against the
> chain as it is now."
>
> **This could not be read as a call** — "…**Nothing has been simulated** and nothing is described below."

Three cards about one call: one promising no verdict, one giving a verdict, one saying nothing was simulated.

**Cost to the user.** A reader who takes the middle card at face value signs a request whose calldata this
page never read. The hedging is real and it is buried between two cards that contradict it, and "every call
succeeds" is the largest, greenest-shaped sentence on the screen. It is the same class of wrong answer as the
`0x`-stripped approve that this page's own history calls out.

**Fix.** Make the two fields obey the same rule, since they are the same rule:
```js
const simulatable = calls.every((c) => ADDR_RE.test(String(c.to || '')) && !c.invalid);
```
and extend the existing "this cannot be checked as a sequence" card to name the calldata case as a third
reason alongside the two `to` cases it already distinguishes. The check clears when `S13-4` reports **fixed**:
`run in order, every call succeeds` no longer appears for that input.

---

### S-6 · `SECURITY.md` says the page approves the exact batch total; for two of the three standards it grants the whole collection — **should be fixed**

**Category:** should be fixed (promise 6 applied to the repository's own claims about itself; you asked me to
test them). **Reasoned from source**, both sides read.

**Where:** `SECURITY.md`, "What this software can and cannot do to you"; `web/index.html:2850-2863`.

SECURITY.md:

> "Approving a bulk sender is a real risk in general: an allowance outlives the transaction that used it. **The
> page approves the exact batch total rather than an unlimited amount**, and tells you to revoke afterwards."

That is true for ERC-20 (`t.approve(bulk, total)`, and it clears a non-zero allowance first, which is
careful). It is false for ERC-721 and ERC-1155, where the only approval that exists is
`setApprovalForAll(bulk, true)` — an unlimited, unexpiring grant over **every token in that collection**,
including ones minted later. That is not a defect in the page (there is no per-batch NFT approval to grant);
it is a defect in the sentence, in the file a reader goes to for the risk model, about the single largest
standing risk the tool creates.

**Cost to the user.** Someone who reads SECURITY.md before an NFT airdrop believes their exposure is bounded
by the batch and does not revoke. The approval outlives the run, and BulkSend can move any token of that
collection the wallet holds for as long as it stands. BulkSend itself cannot be made to do that by anyone —
that part of the file is true — but the wallet's own compromise, later, now reaches the whole collection.

**Fix.** Replace the sentence with the truth, which is more reassuring for one standard and less for two:

> "For an ERC-20 the page approves the exact batch total rather than an unlimited amount, and clears any
> previous allowance first. For an ERC-721 or ERC-1155 there is no per-batch approval to grant: the only
> approval the standards define is `setApprovalForAll`, which covers every token in that collection,
> including ones minted afterwards, and lasts until you revoke it. Revoke it when the airdrop is done — the
> page has a button, and your wallet and the explorer can do it too."

---

### S-7 · Nine of the contract's fifteen errors reach the user as a bare hex selector, including every guard added in v11 and v12 — **should be fixed**

**Category:** should be fixed (promise 2: the software cannot say what happened). **Demonstrated**:
`test/web/audit-probe-13.mjs`, probe `S13-5`.

**Where:** `web/index.html:3221-3240`. `OURS` is built at load from an `ethers.Interface` that declares six
errors:

```js
'error LengthMismatch()', 'error EmptyBatch()', 'error TransferFailed(address to,uint256 id)',
'error NotAContract(address token)', 'error ZeroRecipient(uint256 index)', 'error OutOfGasForBatch(uint256 index)',
```
`BulkSend` declares fifteen. The nine missing ones fall through `KNOWN[sel] || OURS[sel]` to
`'reverted with ' + sel`:

| error | selector | what the user is shown |
|---|---|---|
| `NotAnNft(address)` | `0x21443d13` | `reverted with 0x21443d13` |
| `IsAnNft(address)` | `0x16102772` | `reverted with 0x16102772` |
| `DelegatedWallet(address)` | `0xc1666f64` | `reverted with 0xc1666f64` |
| `SelfRecipient(uint256)` | `0x7d797df3` | `reverted with 0x7d797df3` |
| `ZeroAmount(uint256)` | `0x9af70448` | `reverted with 0x9af70448` |
| `AmbiguousResult(address,uint256)` | `0xe387d1d9` | `reverted with 0xe387d1d9` |
| `GasOutOfRange(uint256,…)` | `0x072383b4` | `reverted with 0x072383b4` |
| `GasIsForLenientOnly()` | `0x059845fb` | `reverted with 0x059845fb` |
| `Reentered()` | `0xb5dfd9e5` | `reverted with 0xb5dfd9e5` |

Two of these — `GasOutOfRange` and `GasIsForLenientOnly` — have prose written for them in the `words` object
three lines below, which is dead: `iface.forEachError` only walks the six the Interface declares, so those
strings have never been shown to anyone.

**Input and state.** Anything that trips a v11 or v12 guard. Paste an NFT into the ERC-20 form and the test
run says "Test run stopped at batch 1: reverted with 0x16102772". Paste a wallet address as the token and get
`0xc1666f64`. Put the contract's own address in the recipient list and get `0x7d797df3` — the page has a
message for that case in `recipientProblem`, but only if the row reaches `parseList`; via a snapshot or an
assign it does not. And `AmbiguousResult`, the error behind the deliberately-declined `false` decision and
therefore the one most likely to be met by an ordinary user with a blocklisting token, is a bare selector.

**Cost to the user.** They are stopped, correctly, and told nothing they can act on. Every one of these
refusals has a specific and different remedy — change the standard, check the address, remove a row, lower the
stipend, remove the blocklisted wallet — and the page hands them a hex string instead. The whole argument of
this codebase is that "I could not tell" and "it said no" must not share wording; here nine distinct
"it said no"s share one wording, and that wording is not English.

**Reproduce:** `node test/web/audit-probe-13.mjs`, probe `S13-5` calls `window.__decodeReason` for each
selector and lists the ones that come back as `reverted with 0x…`.

**Fix.** Declare all fifteen in the `ethers.Interface` and give each an instruction. The ones that matter
most, in the page's own voice:

- `IsAnNft` — "That address is an NFT collection, not a token. Its ids would be spent as amounts. Change the
  token type to ERC-721 above."
- `NotAnNft` — "That address does not answer like an NFT collection: it has no `ownerOf` for either the first
  or the last id in this list, and it does not declare ERC-721. If it really is a collection, put an id you
  own at the front of the list."
- `AmbiguousResult` — "One of these wallets is refused by the token in a way that cannot be told apart from
  having been paid, so the whole batch was refused and nothing moved. That is deliberate: recording a payment
  that happened as a skip is how a re-run pays someone twice. The test run names the wallet — remove it and
  send the rest."
- `DelegatedWallet` — "That address is a wallet, not a token contract. Check the token address."
- `SelfRecipient` — "One of the recipients is BulkSend itself, which has no way to send anything back."
- `ZeroAmount` — "One row asks to send zero, which is not a delivery. Remove it or give it an amount."
- `GasOutOfRange` / `GasIsForLenientOnly` — the text you already wrote, now reachable.
- `Reentered` — "A recipient's contract called BulkSend again in the middle of this batch, which is refused."

The check clears when `S13-5` reports **fixed**.

---

---

## Smaller things, none of which block anything

These are worth a line each and not a section.

1. **`decodeReason` reads a selector out of bytes a hostile recipient chose, and one of the answers is safety
   advice.** `web/index.html:3242`. The `reason` on a `Skipped` event is up to 128 bytes of whatever the
   token's transfer reverted with, and under an ERC-721 that bubbles its receiver's revert unchanged (rather
   than wrapping it the way OpenZeppelin v5 does), the *recipient* chooses those bytes. `0x64a0ae92` and
   `0xd1a57ed6` map to advice ending "untick the safe-transfer box and a plain transfer reaches it" — which,
   followed, strands an NFT in a contract that cannot hold it, permanently. This is the same shape as round
   twelve's inert `explainCallError` fix, one layer down: that one was fixed by refusing to read a selector
   out of a *message*, and this one reads it out of *data*, which is the legitimate place, from a party who
   picked it. What saves it today is the sentence already appended: "A contract that genuinely cannot hold
   NFTs looks like this too, so leave the box ticked if you are not sure who this is." That hedge is
   load-bearing; do not shorten it. Consider also naming the source: "the recipient's own contract said this".
2. **Three different numbers for one gas limit.** `BATCH_ROOM = 30_000_000` decides the cap
   (`web/index.html:302`), `syncBatchRow` tells the user the number is "as many as fit inside one
   transaction's **32,000,000** gas" (`:2166`), and `syncGasRow` warns above **28,000,000** (`:2265`). All
   three are defensible individually; printed together they mean the sentence on screen does not describe the
   arithmetic behind it. Say 30,000,000, or say "32,000,000 with headroom".
3. **`csp-gate.py`'s error messages send you to the wrong file.** Four of them say "add it to
   `ALLOWED_SOURCES`/`FIXED`/`HOSTS` in **`deploy/publish.sh`**"; all three tables live in
   `deploy/csp-gate.py`. They were moved and the strings were not.
4. **"Review held rows" prints ERC-20 amounts in base units.** `web/index.html:2043` builds the confirm dialog
   with `'  x' + r.amount`, unformatted, so a one-token row reads `x1000000000000000000`. That dialog is where
   someone decides whether to release rows for a second payment; it should use
   `ethers.formatUnits(r.amount, decimals)` like every other place that shows an amount to a human.
5. **`preflight.sh` checks the CSP hash by presence, `csp-gate.py` by exact set.** `preflight.sh:24-32` uses
   `("'" + want + "'") not in policy`, which is exactly the invariant `csp-gate.py:19-20` says is not the
   invariant ("A policy naming this hash *and* an older one still authorizes the older inline script"). The
   publish gate catches it, so nothing weak can ship — but with S-3 unfixed, `main` can carry it and stay
   green. One line: reuse the exact-set rule in preflight.
6. **`img-src` grants `blob:`; I checked before flagging it and it is needed** — `web/wc.js` calls
   `URL.createObjectURL` twice for the Reown modal's images. Not a finding. The one source I would still
   question is `style-src 'unsafe-inline'`, which is required both by the page's own `<style>` block and by
   the connector's injected styles, and which leaves CSS-based UI spoofing and CSS exfiltration open on a page
   that displays addresses. Moving the page's own CSS to a hashed or external stylesheet does not help while
   the connector needs it, so I would leave it and say so in SECURITY.md rather than pretend the policy is
   tighter than it is.

---

## The declined finding: `false` from an ERC-20 still reverts the whole lenient batch

**I think the decision is right, and I would keep it.** You asked what new information would separate "refused
and moved nothing" from "paid and then lied". Here is the honest answer and its price.

Nothing *inside the call* separates them, and `PaysThenLies20` is the proof. The only thing that separates
them is a balance read on both sides of the transfer, which is what the page already does after the fact and
what the contract cannot afford to do per row — two `SLOAD`s of a cold slot per recipient is roughly 4,200 gas
on top of a ~29,000-gas ERC-20 transfer, a 14% tax on every honest batch to distinguish a case the standard
says should not happen. That trade is not worth making, and the direction of the error matters more than its
frequency: the current choice fails toward "nobody was paid and the sender knows it", and the alternative
fails toward "someone was paid and is recorded as skipped", which is the double-payment path this whole
codebase is organised around avoiding.

Two things would change my answer, and neither is available:
- **A standard way to ask.** If ERC-20 had a `transferFrom` variant whose revert data distinguished "refused"
  from "failed", or if tokens reliably emitted `Transfer` only when they moved something, the receipt would
  settle it. They do not, and a token that lies in its return value lies in its events too.
- **A caller-supplied assertion.** A `…WithBalanceCheck` entry point that reads the recipient's balance before
  and after and treats a `false` with an unchanged balance as a genuine skip. That is real, implementable, and
  costs the caller who opts into it rather than everyone. If you ever want the lenient-blocklist case to work,
  that is the shape I would build — but it is a feature, not a fix, and it should not delay a release.

What I would change is the **wording**, not the behaviour. The page currently tells the user, after a failed
lenient batch, whatever `AmbiguousResult` decodes to. `AmbiguousResult` is not in `KNOWN` or `OURS` in
`web/index.html:3211-3240`, so it falls through to `'reverted with 0x…'` — a bare selector for the one
outcome most likely to be hit by an ordinary user with a blocklisting token. Add it, with the reasoning:

> "One of these wallets is refused by the token in a way that cannot be told apart from having been paid, so
> the whole batch was refused and nothing moved. That is deliberate: recording a payment that happened as a
> skip is how a re-run pays someone twice. Remove that wallet from the list and send the rest."

The test run already names the address before anything is signed, which is the mitigation that makes the
decision liveable. That should be said in the message too.

## Direct answers to the questions you asked

**`_mustBeNft`, both directions.** Sound, and better than it needs to be. The happy path is unchanged from
v11 — `if (_answersOwnerOf(token, probeA)) return;` is one `staticcall` and the two extra probes are below it,
so a real collection whose first id exists costs exactly what it did (`src/BulkSend.sol:396-408`, verified by
reading; the `test_gas_400_recipients` numbers below are unchanged from what round twelve measured).
*Is there a non-NFT that satisfies any of the three?* Yes, and you have both of them pinned:
`PolitelyDoesNothing` (a bare fallback returning 32 bytes) satisfies `_answersOwnerOf` and is then caught
downstream by `AmbiguousResult`; `PretendsToBeAnNft` satisfies everything and is the true boundary, which
`test_theBoundary…` documents. A contract with a data-returning fallback and a void `transferFrom` is the
general shape and it is exactly `PretendsToBeAnNft`. *Is there a real ERC-721 that satisfies none?*
`BareRevert721NoIntrospection` — bare reverts and no ERC-165 — and you have pinned it as a known limit with a
workable remedy (put an id you own at the front). I could not construct another.

**Anything closer to the 32,000,000 limit?** No. Measured at `f4f5ca6`, 400 recipients:

```
OZ721 strict SAFE   14,973,671
OZ721 strict plain  13,860,897
ERC721A lenient     20,897,478   <- the worst case, 65% of BATCH_ROOM, 70% of the chain limit
OZ20 lenient        11,266,155
```
Unchanged from what round twelve recorded. Note these are pure EVM gas; the Orbit L1-data surcharge is on top
and is what the live measurement covers.

**Deployed runtime vs. source.** Identical. `cast code 0xc2e4…f481` on 46630 is byte-for-byte
`out/BulkSend.sol/BulkSend.json → deployedBytecode.object`, 8,968 bytes.

**The `onlyOnce` three-minute window.** Your description of it in the brief is out of date, and the code is
safer than the brief says: the guard **does not release** at three minutes. `signing = false` happens only in
the `.then()` chained onto `fn`, and the `giveUp` timer only wins the `Promise.race` so a message can be
logged (`web/index.html:227-241`). So the answer to "can releasing let the first signature and a second one
both reach the chain" is: it cannot, because nothing releases. The cost is the other direction — a wallet that
never answers leaves `signing` true and that button disabled until the page is reloaded, with the message
telling the user to go and answer or dismiss it in their wallet. **That is the right trade** and I would not
change the window in either direction. One thing to fix in the docs rather than the code: your own brief
believes it releases, which means the next person to touch it may "restore" the release.

**Can a gas answer taken for one token be read for another?** No, and I tried to break it. The key
(`web/index.html:365-368`) carries chain, token, standard, safe-mode, account, probe row id and probe row
amount. The post-await `if (gasProbeKey !== key) return` closes the two-in-flight case in both orders, and the
"question is gone" branch clears `perRecipient` and the key together. Changing token away and back re-asks,
because the intervening change moved the key. The one hole is not in the key: `probeRow()` picks the lowest id
and the key records it, so a list change that keeps the same lowest id keeps the answer — which is correct,
because the measured row is the same row.

**Is 1.15 enough?** It is now 1.35, and 1.35 is a reasonable number for the OperatorFilterer case you
identified. It is not a bound, and the page should stop implying one — see S-4.

**Is there a collection where a later id costs much more than the first?** Yes: any collection whose transfer
reads per-id state that is populated for some ids and not others — a staking lock, a per-token royalty
override, a per-token transfer cooldown. The reasoning for ERC721A is right (ascending order makes the first
transfer the dear one), and it does not generalise. The consequence is bounded, though, and this is the part
worth stating plainly: an under-measured batch runs out of gas and **reverts** rather than partly delivering —
`_tryCall`'s `g - g/64 < stipend + GAS_RESERVE` check (`src/BulkSend.sol:357`) turns what would be a
mis-attributed skip into `OutOfGasForBatch`, and strict mode reverts anyway. So the cost of a wrong
measurement is wasted gas, never a wrong delivery record. That guard is doing real work and is the reason I
did not rank the measurement higher.

**Are the probe's selector tests asserting the right thing?** Yes for the selector — `client.test.mjs:2366-2418`
reads `p.data.slice(0,10)` off the wire for all four shapes and checks 1155 is not measured with the 721 call.
Two gaps: they assert the selector and not `p.to` or `p.from`, so a probe aimed at the wrong address would
pass; and the mock answers `eth_estimateGas` with a constant regardless of the call, so nothing distinguishes
"measured the right thing" from "measured something" beyond those four selector checks.

---

## Areas I examined and found sound

Silence elsewhere in this report should mean something, so here is what it covers.

**The contract, apart from B-1.**
- The reentrancy lock is correct and genuinely necessary for the reason the comment gives — a recipient hook
  that calls back in could emit real `Skipped` events naming rows it was paid for. Transient storage, released
  on the normal path and by revert, verified by `test_probe_lockIsReleasedByARevertInTheSameTransaction`.
- `_erc20Answer` decides exactly what the inline code used to: empty → delivered, exactly 32 bytes holding 1 →
  delivered, everything else → unreadable. I checked the three branches against the v11 inline form and
  against `TwoWord20`, `LongReason20`, `False20` and `PaysThenLies20`. No behaviour change, which is what a
  stack-limit extraction should be.
- The strict-mode `returndatasize()` check reads the transfer call's own returndata and not a nested one —
  `Chatty721` pins that, and I confirmed no Solidity-generated call sits between the transfer and the assembly
  block.
- `_tryCall`'s stipend arithmetic: `g - g/64` cannot underflow, the 63/64 reservation is correct, and
  reverting rather than clamping is what keeps `eth_estimateGas` from settling on a limit that skips
  recipients because skipping is cheaper. That is a subtle and correct piece of reasoning.
- `_mustBeContract`'s 23-byte `0xef0100` delegation check is right, and
  `test_probe_a23ByteNonDelegationAccountIsNotRejected` covers the false positive.
- No owner, no upgrade path, no fee, no pause, no storage between transactions. `transferFrom(msg.sender, …)`
  everywhere. Promise 1 holds: nobody, including the author, can change what it moves.

**Provenance, promise 7 — the strongest part of this repository.** All four legs verified live at the time of
writing:
```
curl -s https://rhairdrop.gmgnrepeat.com/ | cmp - web/index.html   ->  identical
curl -s https://rhcheck.gmgnrepeat.com/   | cmp - web/check.html   ->  identical
curl -s https://rhairdrop.gmgnrepeat.com/wc.js | sha256sum
   d4c35a1b…64d7  ==  web/wc-build/EXPECTED-SHA256  ==  sha256sum web/wc.js
cast code 0xc2e4…f481                                              ->  identical to the build
```

**Transport.** Both hosts 301 plain HTTP with `Strict-Transport-Security: max-age=31536000; includeSubDomains`
**on the redirect itself** as well as on the HTTPS response, plus `x-content-type-options`, `referrer-policy`
and `cross-origin-opener-policy`. The full CSP arrives as a header including `frame-ancestors 'none'`, which a
meta tag cannot express. I agree with not setting preload: it is a commitment for every subdomain of
`gmgnrepeat.com` and it is not reversible on a useful timescale. SECURITY.md's `/cdn-cgi/*` disclosure is
accurate, correctly scoped, and unusually honest for a section of a document like that.

**The CSP gate.** `deploy/csp-gate.py` is the right design: the whole policy held to a table, an unknown
directive refused rather than ignored, `'strict-dynamic'` called out by name for the reason that actually
matters, and the cdnjs grant narrowed from an origin to one file path. Holding `script-src`'s hash set to
*exactly* one entry rather than to containment is the correct invariant. My only complaints about it are S-3
(it is not in CI) and a wrong filename in four error strings.

**The publish chain.** Dirty-tree refusal, `EXPECTED-SHA256` required to be a real digest and to match,
origin-first ordering with a digest-keyed prefetch that refuses to activate a Worker against a bundle the
origin does not serve, `node --check` on the generated Worker, and a post-publish byte comparison. The bypass
flags announce themselves on every run where they are in effect, which is the right answer to a flag left in
`local.env`. `NO_PHONE_WALLET` no longer silently skips the whole connector chain. I could not find a way to
put something else at the end of that chain without the deploy credential.

**The `/x/` explorer passthrough.** The path regex excludes `%`, so percent-encoded traversal cannot reach
`includes('..')`; `redirect: 'manual'` stops an explorer choosing what gets served from this origin; and
non-JSON upstream answers are replaced with a 200 JSON error object rather than passed through, which is the
right call given Cloudflare substitutes its own page for a Worker's 4xx.

**The workflows.** `tests.yml` runs on `pull_request` (not `pull_request_target`) with `contents: read`,
`persist-credentials: false` and no secrets, so a fork's PR gets a runner it cannot write anything from.
`integrity.yml` is schedule/dispatch only, holds `issues: write` solely for the failure path, and every action
is pinned to a commit hash rather than a tag. Neither is a way in. The integrity checks themselves are better
than most: they compare bytes rather than status codes, check the CSP *header* separately from the body
because the header lives in the Worker and not in the repo, assert the error paths carry the hardening
headers, and assert that `/cdn-cgi/` still does *not* send HSTS so that SECURITY.md's own caveat fails loudly
if it stops being true. Pinning `foundry-toolchain` to `v1.4.1` in the monitor as well as the test job is
exactly right.

**The delivery ledger, apart from B-2.** I went looking for another input that can move the key, the sender or
the list under a running send and did not find one. `sendRunKey` is captured when the lock is granted and
`ledgerKey()` throws outside a locked send. `lockForm(true)` sets `sending` synchronously and disables the
whole `FORM` list. Every handler that could move `me` — `accountsChanged`, the WalletConnect `disconnect`,
`disconnectWallet` — checks `sending` first and sets `stopFlag` instead. `renderWalletChoice` returns before
appending the phone-wallet button when connected, so `connectPhoneWallet` is unreachable mid-send. Every ledger
write goes through `commitDelivered` under `withRunLock`, including the two that historically did not
(`forgetRun` and the release in "Review held rows"), and `writeDeliveredFor` reads back what it wrote because
a quota failure is not always thrown. `heldRunKey` records *which* run's lock this tab holds, not merely that
it holds one. `readCallsStatus` treats an EIP-5792 status it cannot read as `unknown` and lets a contradicting
receipt downgrade a claimed failure to `partial` — only 400 and 500 release rows, which is the one direction
that must never be got wrong. The run lock uses `ifAvailable` and refuses to send rather than queueing.

**The NFT picker.** I attacked it as asked and found nothing. `dataImage` requires `data:image/<known type>;`
at the front, so `data:text/html`, `javascript:` and a bare `data:image/svg+xml,` (no parameter) are all
refused; an SVG that does reach an `<img src>` cannot execute script or fetch subresources in that context,
independently of CSP. Names are `typeof j.name === 'string'` and set through `textContent`, and
`JSON.parse` returning a number, `null` or an array all fall through harmlessly. `URI_CAP`/`JSON_CAP`/`IMG_CAP`
bound the work before it is done. `pickContext` covers chain, account, standard and collection and is
re-checked *at the moment the list is rewritten*, not only when the picker opened, so a wallet cannot be paired
with an NFT from a different collection. `pickGen` drops a stale load. I agree with both deliberate choices:
not widening `img-src` (it would tell every collection's server the IP of everyone previewing an airdrop, on a
page that also signs) and not proxying (it would put you in the position of serving other people's bytes from
your origin). The one residual is a collection returning a multi-megabyte `tokenURI` 250 times, which is
bounded by the RPC and self-inflicted by choosing that collection.

**The recipient-list reader, apart from S-1 and S-2.** `splitRow` implements RFC 4180 quoting, keeps empty
cells so a blank column cannot shift every later cell left, and pops only a trailing separator. `readHeader`'s
two-pass whole-name-then-whole-word matching does correctly stop `tokenId` claiming the address column via the
`to` inside it, and the `([a-z])([A-Z])` split is what makes `HolderAddress` work. `wholeText` accepts `1.0`
and refuses `1.50`; `SCIENTIFIC` refuses `1.23457E+11` by name instead of guessing; `tooPrecise` refuses
rounding and says what to write instead. `rowKey` is built from parsed `BigInt` values, not typed text, so
`100` and `100.0` are one payment, and `finishParse`'s occurrence numbering means two identical lines are two
payments rather than one. `orderForDelivery` compares `BigInt`s numerically. The checksum-failure message is
long, but it is the right length: it names both possible causes, says the page cannot tell which, offers the
lowercase workaround *and* says in the same breath that it turns the check off rather than making a wrong
address right. That is the correct handling of an error message that offers a way around a safety check.

**The Check page, apart from S-5.** Dispatching on `method` first, refusing unknown methods **by name**, and
keeping an unreadable field's raw value so "names a chain nobody can read" cannot collapse into "names no
chain" are all correct. I checked the EIP-5792 schema rules against the specification rather than against your
description: `version`, `chainId` and `atomicRequired` are required and `id`, `from` and `capabilities` are
optional, which is what `readEnvelope` enforces; `chainId` must be a hex *quantity*, so the leading-zero
refusal is right and your note that EIP-5792's own example contradicts the rule is also right; `atomicRequired`
as three states rather than two is right, and so is refusing to summarise a request whose capabilities the
page does not implement. A broken member keeping its index rather than being dropped is the correct choice.
The `allCallShaped` heuristic requires `length > 1` and no `method`/`from`/`calls` on any member, and it says
out loud which reading it took. `readTransaction` reading `input` when `data` is absent is the safe direction
(the alternative is describing a token approval as a plain ETH transfer), and the `data`/`input` disagreement
case is refused rather than resolved. Nothing on that page signs or sends: the only wallet call is
`eth_requestAccounts`, to fill in the sender box.

---

## Where the tests are weaker than they look

You asked to be told this, and you were right that more of the harness is like `hangOnAddChain`. That specific
one is genuinely fixed — `page.exposeFunction('__chain', …)` now `await`s `answer(...)`, so a
never-resolving Promise really does hang. Here is what I found that is still proving less than it appears.

1. **CI runs none of the three regression guards.** See S-3. This is the largest one: `forge test
   --no-match-path 'test/Audit*.t.sol'` and `npm test` between them exclude every probe file, the CSP gate and
   `preflight.sh`. Twenty pinned findings can reopen with a green tick.
2. **The mock answers `eth_estimateGas` with a constant, whatever it is asked.** `client.test.mjs:143-148`.
   The four selector assertions are the only thing separating "the probe measured the right call" from "the
   probe measured something", and they check `p.data` alone — not `p.to`, not `p.from`. A probe encoding the
   right selector against the wrong address passes every test in the file.
3. **The mock's `eth_call` falls through to `return enc(1)`.** `client.test.mjs:213`. Any selector the mock
   does not recognise gets a plausible-looking word back, so a page that calls the wrong function gets an
   answer where a real chain would revert. That makes the mocked suite systematically more forgiving than
   testnet, which is one reason the four live-script defects were only findable live.
4. **Dialogs are accepted by default.** `page.on('dialog', d => opts.dismissDialogs ? d.dismiss() : d.accept())`.
   Every `confirm()` in the send path — the manifest confirmation, the weighting overwrite, the "release these
   to be sent again" gate in Review — is auto-approved unless a test opts out. The gates are exercised as
   dialogs, not as gates. Exactly two tests in the 301 set `dismissDialogs`.
5. **Nothing runs the page from an `https://` origin, so nothing tests the Worker.** The suite loads
   `file://…/web/index.html`. `frame-ancestors`, the response-header CSP, the HSTS headers, the `/wc.js`
   digest refusal, the `/x/` passthrough and the unknown-path redirect are all Worker behaviour and all
   untested by `npm test`. The integrity workflow covers them against the live site, which is a different
   thing from covering them before a deploy: there is no test that would catch a bad Worker before it ships.
   `--allow-file-access-from-files` is not the problem here — it is needed for the WalletConnect module test
   and it does not disable the meta-tag CSP (which the suite demonstrably does enforce; that is exactly why
   `preflight.sh` has its stale-hash check). The problem is that only one of the two policies is ever tested.
6. **The harness had no way to model "the page dies while the wallet holds the request".** That is why B-2 was
   not found by 417 browser tests. Reproducing it needed a new option (`stall`) that holds an RPC method open
   *and* a tab close in the same browser context. Every existing "interrupted send" test starts from a
   `bulksend:pending:*` record already in `localStorage` — which assumes the very write that B-2 shows never
   happens. The tests describe recovery from a state the page cannot always reach.
7. **`test_gas_400_recipients` measures and prints; it asserts nothing.** `Audit12.t.sol:191-241` emits four
   `log_named_uint`s and has no assertion, so a change that doubled a batch's gas would still pass. Given that
   the batch cap is derived from a 30,000,000 budget, `assertLt(used, 30_000_000)` on each of the four would
   turn a printout into a guard.
8. **`checkTotals` has no ERC-721 branch**, so nothing pre-checks that the sender owns the ids in the list;
   that is left to the per-batch `staticCall`, which is correct but means the aggregate-shortfall message the
   ERC-20 and ERC-1155 paths give has no NFT equivalent.

---

## Verdict

**Two findings block release.** Everything else is fixable at leisure or is an inherent limit worth writing
down rather than engineering away.

**Blocking:**

- **B-1** — `_mustNotBeNft` probes one value where its stated mirror probes three, so a collection whose first
  listed id is burned or unminted passes the ERC-20 guard and has its remaining NFTs spent as amounts, counted
  as deliveries, and reported in an `Airdrop20` event. Clears when
  `test_probe_mustNotBeNft_is_bypassed_when_the_first_id_is_not_minted` FAILS with `IsAnNft`.
- **B-2** — nothing is written to the ledger until the wallet answers, so a batch approved on a phone and lost
  with the tab is invisible to the next visit and every recipient in it is paid again. Clears when probe
  `S13-1` reports **fixed**: a `bulksend:pending:*` record exists while the wallet still holds the request,
  and the reopened page holds those rows back.

I want to be plain about the asymmetry between them. B-1 needs an unusual paste and is largely shielded by the
page's own standard detection — but it is in the contract, it is irreversible, and the contract is presented
as the thing that matters and is used by things other than this page. B-2 needs nothing unusual at all: a
phone, a WalletConnect session, and an operating system deciding to reclaim a backgrounded tab. That is the
ordinary case for the ordinary user this page is built for, and it produces the exact outcome the page's whole
architecture exists to prevent. **B-2 is the one I would fix first**, and it is the smaller change.

**Not blocking, and the release bar is otherwise met.** I want to say this without hedging, because I went
looking hard and the list is short for a reason. Promise 7 is fully verified: both pages are byte-identical to
the repository right now, the connector matches its reviewed digest, and the deployed runtime is byte-identical
to what this source builds. Promise 1 holds — I could not construct any way to make BulkSend move something
the caller had not approved inside the transaction they signed. Promise 6 holds: the Check page's only wallet
call is `eth_requestAccounts`, and its request reader is now, as far as I can tell, correct against EIP-5792
rather than against a paraphrase of it. Promise 3 holds — the defaults are strict-ish, safe-transfer is on,
mainnet is off, and the test run runs before anything is signed. The delivery ledger's locking discipline is
better than most production systems I have read.

**What I would do about the pattern, not the bugs.** Five times a fix has become the next round's finding, and
this round is six: B-1 is v12's own guard, S-1/S-2/S-5 are all one reader being taught something its twin was
not. That is not carelessness, it is a missing step. The step is: **when you fix a reader, grep for every
other function that reads the same input and list them in the commit message.** For the recipient box that is
`parseList`, `walletsInBox`, `deliveriesOn`, `unreadableLinesInBox`, `addressOn`, `boxColumns`, `$('shuffle')`,
`$('applyWeight')`, `$('dropContracts')`, `$('assign')` and `$('pickUse')` — eleven of them, and this round
found three that disagreed. For the contract's paste guards it is `_mustBeNft` and `_mustNotBeNft` — two, and
this round found the one that had not been updated. S-3 is the automated half of the same step, and it is not
running.

**If you fix B-1 and B-2 and nothing else, I would call it ready** for testnet-only public use, with the
should-fix list as a queue and the inherent limits written into SECURITY.md. Before mainnet I would also want
S-3 (so the guards run without anyone remembering), S-6 (so the file people read about risk is true for all
three standards) and S-7 (so a user who is stopped is told why in words), because on mainnet a refusal nobody
can act on and an approval nobody was told the scope of both cost real money.

