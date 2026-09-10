# Twelfth external review — robinhood-chain-tools @ `59e979f`

Reviewer: independent automated pass, in a fresh clone outside this repository. Scope and priorities taken
from `PROMPT.md`. Everything below was checked against the source at that commit; where I say "demonstrated"
there is a command in the finding you can run.

> Published as written, with one change: the reviewer's line naming its own working directory held an absolute
> path from the machine it ran on, and that path is removed. Nothing else in this file has been edited, the
> findings least of all.

---

## The release bar I am judging against

Before I say whether this is ready, here is what "ready" means for this specific kind of software: a
browser page that asks a wallet to sign transactions which move other people's assets, plus an immutable
contract that those transactions call.

1. **No silent value movement.** Nothing may move value that the user did not see described accurately in
   the moment before they signed. A number on screen that is 20% wrong about cost is a defect; a number on
   screen that is wrong about *who receives what* is a blocker.
2. **Failure must be honest and conservative.** Every state the software cannot resolve must resolve to
   "held", never to "delivered" and never to "safe to send again". A statement about the chain must be
   supported by something the page actually read from the chain. "I could not tell" and "the chain says no"
   are different sentences and must not share wording.
3. **The immutable half must be minimal and non-discretionary.** The contract may only move what the caller
   approved, in the transaction the caller signed, with no owner, no upgrade, no fee and no pause. Any
   heuristic *inside* the contract about what a token "is" must fail closed, and must fail closed the same
   way in both directions.
4. **Idempotence across the interruptions that actually happen.** Reload, crash, closed tab, replaced
   transaction, two tabs, wallet disconnect, account switch mid-flight. Each of these must either be covered
   or be named in the UI as not covered.
5. **The read-only tool must never overstate.** A page whose job is to tell a non-technical user whether a
   transaction is safe is more dangerous than one that signs, because its output is acted on directly. Every
   green verdict must be traceable to evidence; ambiguity must be reported as ambiguity, never resolved by
   picking the likelier reading.
6. **What is served is what was reviewed.** Deployed bytes must be reproducible from the repository, and the
   chain from published page to reviewed source must have no step where a human or a workflow can substitute
   something else without the check failing.
7. **The tests must be able to fail.** A suite that asserts counters rather than consequences locks in bugs.
   For each promise there must be at least one assertion that would go red if the promise broke.

A release is reasonable when 1–7 hold for every path a normal user can reach, and every path they cannot is
either unreachable by construction or documented as an inherent limit with the software *saying so on
screen*.

---

## Findings

Sorted into the three categories the brief asks for. A summary table, a promise-by-promise table and direct
answers to the specific questions are at the end.

## Blocks release

### B-1 — Check: a transaction that names another chain is read against this one, whenever it reaches the batch renderer

**Demonstrated.** `node test/web/audit-probe-12.mjs` → `C-1a`, `C-1b` reproduce; `C-1c` is the control and
reads "fixed".

`web/check.js:1400-1422` guards the single-call path:

> *"A single call skips the batch renderer, so the check that lives there has to live here too."*

The comment has it backwards. The check that lives in the batch renderer is
`web/check.js:1266-1294`, and it is guarded by `if (env && env.chainId !== null …)`. `env` is the
*wallet\_sendCalls envelope*. A request read by `readTransaction` (`web/check.js:1073-1125`) has
`envelope: null` and carries its `chainId` on the call object instead (`web/check.js:1110`, inside `readTransaction`). **Nothing in the
batch renderer ever reads `calls[i].chainId`.** So the moment an `eth_sendTransaction` takes the batch path,
its declared network is read by nobody — exactly round eleven's B-4, on the other reader.

`readJsonRequests` (`web/check.js:1170-1174`) only returns `kind: 'call'` for a single request with a single
call, a valid `to`, no notes, no refusals, no schema problems and no invalid members. Two ordinary ways to
miss that:

1. Paste two requests (a wallet showing an approve and then a swap, which is the common case).
2. Paste one request carrying any field `readTransaction` does not recognise — a stray `calls: []`, a
   `gasLimit`, anything — which produces a note and disqualifies the single-call path.

**Input and state.** Page set to Robinhood Chain testnet (46630), sender address in the box:

```json
[{"method":"eth_sendTransaction","params":[{"to":"0x…20","data":"0x095ea7b3…ffff","chainId":"0x1"}]},
 {"method":"eth_sendTransaction","params":[{"to":"0x…20","data":"0x095ea7b3…ffff"}]}]
```

**What the page says** (full output captured in the probe):

> Request 1 of 2: run in order, every call succeeds — Simulated as one sequence, as 0x000000…00dEaD,
> against the chain as it is now.
> Request 1 of 2: call 1 of 1 — Let 0x111111…111111 spend an unlimited amount of your **Test Token**, now and
> at any time in the future… *would succeed* … Destination 0x000000…000020 — a contract — Source: none published

Every word of that was read off Robinhood Chain. The request said chain 1. The token name, the "a contract"
verdict, the "no published source" verdict and the green "would succeed" all belong to a different contract at
the same address on a different chain. There is no mention of the mismatch anywhere in the output.

**What it costs the user.** The page's whole job is to answer "is this safe to sign". A drainer approval on
Ethereum reads as a harmless approval on Robinhood Chain if the address is a benign token here — or the
reverse. The user acts on a green verdict about the wrong contract. This is the same class the maintainer
already rated blocking (B-4, round eleven, "chainId read by nobody, so another chain's contract described as
this one's"), and the reason given there applies unchanged: *"the same address is a different contract on a
different chain, and an answer from the wrong one is worse than none."*

**Fix.** In the batch renderer, before the sender/simulation block, run the same three-way chainId test
against `reqs[ri].calls[i].chainId` for requests with `envelope === null` — leading zero, unreadable, and
foreign — and `continue` in each case. Better: give `readTransaction` a one-call envelope
(`{chainId, from}`) so both readers produce the same shape and one check covers both. The
regression test is `C-1a`/`C-1b` in `test/web/audit-probe-12.mjs`: they must stop reproducing.

**Clears when:** `node test/web/audit-probe-12.mjs` reports `C-1a` and `C-1b` as `fixed`, and a case in
`test/web/check.test.mjs` asserts that a two-request paste where request 1 names `0x1` produces a "different
network" card and no per-call verdict for that request.

---

## Should be fixed, does not block

These are ordered by how much they undermine a claim the repository makes about itself, not by how loud they
are.

### S-1 — The `tests` workflow has failed on every commit for the last eight, because it runs a suite that is designed to fail

**Demonstrated.**

```
$ forge test >/dev/null 2>&1; echo $?
1
$ ./test.sh; echo "exit $?"          # never reaches "=== pages ==="
exit 1
```

```
$ curl -s https://api.github.com/repos/SRHSoulja/robinhood-chain-tools/actions/runs?per_page=12
tests | completed | failure | 2026-09-10T08:58:06Z | 59e979f1 | push      <- HEAD
tests | completed | failure | 2026-09-10T08:12:32Z | cebe40c1 | push
tests | completed | failure | 2026-09-10T07:52:05Z | a5326835 | push
tests | completed | failure | 2026-09-10T07:28:12Z | 6b030adb | push
tests | completed | failure | 2026-09-10T07:03:57Z | 04bf84da | push
tests | completed | failure | 2026-09-10T06:30:09Z | 87d081b6 | push
tests | completed | failure | 2026-09-10T06:16:26Z | 00baa743 | push
tests | completed | failure | 2026-09-10T06:13:31Z | 66784ed2 | push
tests | completed | success | 2026-09-10T05:44:54Z | 995a8de5 | push      <- last green
```

Job steps for the run on HEAD:

```
4 contract tests                                  -> failure
5 the deployed bytecode is what this source builds -> skipped
6 setup-node                                       -> skipped
7 browser tests                                    -> skipped
8 the connector is reproducible from its pinned source -> skipped
```

**Cause.** `.github/workflows/tests.yml:23` runs bare `forge test`. `docs/status.md` states, correctly, that
`forge test` includes "20 reviewer probes of which 5 must FAIL". A suite containing tests that must fail
cannot be run under a bash step that treats a non-zero exit as failure. `verify.sh` handles this properly
(`grep -vc 'test_probe_'`); `tests.yml` and `test.sh` do not. It first broke at `66784ed`, the commit where
the S-12 fix made `F1a`, `F1b` and `F3` start failing.

**What it costs.** For the entire duration of the round-eleven fix work — every commit from `66784ed` to
`59e979f`, which is where the contract became v11 and where the newest and least-reviewed page code was
written — CI has verified nothing at all. Not the deployed-bytecode equality, not the 386 browser assertions,
not that `web/wc.js` is still reproducible from its pinned source. The README carries the badge for this
workflow at `README.md:4`. `SECURITY.md` and `docs/for-reviewers.md` both point a reader at the workflows as
evidence.

**Fix.** Move the probe suites out of the default `forge test` path — `foundry.toml` `[profile.default]
no_match_path = "test/Audit*.t.sol"` plus a `[profile.probes]` that runs them — or make `tests.yml` call
`./verify.sh`, which already knows the rule. `test.sh` needs the same treatment: as written it is not
"everything in one command", it is the contract half followed by an abort.

**Clears when:** the `tests` badge is green on a commit that still contains the probe files, and step 7
(browser tests) shows as run rather than skipped.

---

### S-2 — The live Check page is not the Check page in this repository, and the fixes it is missing are two that `docs/status.md` marks closed

**Demonstrated.**

```
$ curl -sSL https://rhairdrop.gmgnrepeat.com/  | sha256sum   # matches web/index.html      ok
$ curl -sSL https://rhairdrop.gmgnrepeat.com/wc.js | sha256sum # matches web/wc.js         ok
$ curl -sSL https://rhcheck.gmgnrepeat.com/    | sha256sum
  live   8682cae2fa2c20d30cd7dcceaec1e8405358fdfd937e554de99c252f1e26fa76
  source 6217d973deaeeaf8cbadbbd1efe03f34094ef018a03c256797d817a4698cb081
```

The difference is exactly the round-eleven S-8/S-9 fix, committed in `87d081b` at 06:30Z and never published.
Client half, present in `web/check.js` and absent from the live page:

```js
if (j && j.error === 'upstream') {
  explorerRoute = route; reached = true;
  if (Number(j.status) === 404) { missing = true; continue; }   // really not there
  continue;                                                     // reached, but it would not answer
}
```

Worker half, observable right now on the live host:

```
$ curl -sI https://rhcheck.gmgnrepeat.com/x/46630/tokens/0x0000000000000000000000000000000000000000
HTTP/2 404
content-type: text/html; charset=UTF-8
cache-control: no-cache
   (no strict-transport-security, no content-security-policy,
    no x-content-type-options, no referrer-policy, no cross-origin-opener-policy)
```

That is Cloudflare's own HTML error document, served from `rhcheck.gmgnrepeat.com` with none of the hardening,
which is precisely what S-8 and S-9 described. The current `deploy/publish.sh` generates a worker that answers
`200 {"error":"upstream","status":404}` with the full `secure()` header set instead. Compare the airdrop
host, which *is* current:

```
$ curl -sI https://rhcheck.gmgnrepeat.com/nothing-here   |  no content-security-policy
$ curl -sI https://rhairdrop.gmgnrepeat.com/nothing-here |  content-security-policy: default-src 'none'; frame-ancestors 'none'; …
```

**What it costs.** Two things. The narrow one: on the site people actually use, an explorer 404 still comes
back as a third-party document from this origin with no `nosniff`, no CSP and no HSTS. The wide one: at this
commit, `docs/status.md` states *"the deployed pages match these files | `deploy/publish.sh` verifies the hash
after publishing | ✅"* and marks S-8 and S-9 closed. Both statements are false as of now. The brief's own
standard applies: a fix present in the source but not reachable in the configuration that actually runs is not
a fix.

**Note in fairness:** the deployed page and the deployed worker are a matched pre-fix pair, so there is no
page/worker inconsistency, and `integrity.yml` will fail on its next scheduled run and open an issue. The
finding is that `docs/status.md` speaks in the present tense about a state that is up to six hours (plus
GitHub's scheduling drift, which the run history shows running four to seven hours late) from being checked.

**Fix.** Publish the Check page. Then either make `docs/status.md`'s deployment rows generated from a live
check rather than written by hand, or date them.

---

### S-3 — The contract on chain is not what this source builds, and both checks that would say so are unable to run

**Demonstrated.**

```
$ forge build && diff <(cast code 0x8a28…7fE) <(jq -r .deployedBytecode.object out/BulkSend.sol/BulkSend.json)
equal: False   lens 18276 18276
first diff at char 18190:  …a264697066735822122003e9959c…   (chain)
                           …a2646970667358221220976d486c…   (built)
```

Every executable byte is identical. The 32 bytes that differ are the IPFS hash inside the CBOR metadata
trailer, and they differ because `src/BulkSend.sol` gained a six-line doc comment in `cebe40c` — after v11 was
deployed. The explorer confirms it from the other side:

```
$ curl -s .../api/v2/smart-contracts/0x8a28…7fE
is_verified True | partial False | compiler v0.8.36 | optimizer True 10000 | evm cancun
explorer source == repo src/BulkSend.sol : False
--- explorer                          +++ repo
-    /// @dev A low-level call to an address with no code "succeeds" with empty return data, …
+    /// @dev Refuses an address with NO code. That is all it does, and the distinction matters: …
```

**What it costs.** Nothing to a user's funds: the runtime logic is byte-identical. What it costs is the claim.
`docs/status.md` says *"deployed bytecode matches what this repository builds | v11, byte-identical, 18,276
chars, and verified on the explorer (not partially, compiler 0.8.36) | ✅"*. Both halves are now false, and
the repository's own equality tests — `tests.yml:24-36` and `integrity.yml`'s "the deployed contract is
byte-for-byte what this source builds" — use exact string comparison and would both fail. The first is
skipped because of S-1; the second has not run since before the change. A reviewer who checks this by hand,
as `docs/for-reviewers.md` invites, gets a mismatch and no way to tell a comment from a backdoor.

**Fix.** Either set `bytecode_hash = "none"` in `foundry.toml` — the honest choice for a project whose whole
argument is bit-reproducibility, since it makes comment edits bytecode-neutral and removes a class of false
alarm — or freeze `src/BulkSend.sol` after a deploy and treat any edit, comments included, as requiring a
redeploy and re-verification. Do not "fix" it by comparing only the code before the metadata trailer without
saying so in the step name; that is how a check's name outlives what it does.

---

### S-4 — `airdrop20` has no mirror of `_mustBeNft`, so an ERC-721 through the ERC-20 entry point spends its "amounts" as token ids

**Demonstrated.** `forge test --match-test test_probe_airdrop20_on_an_erc721 -vv` (in
`test/Audit12.t.sol`) passes, meaning the finding reproduces:

```solidity
nft.mint(me,1); nft.mint(me,2); nft.mint(me,3);
nft.setApprovalForAll(address(bulk), true);
amounts = [1, 2, 3];                       // "1, 2 and 3 tokens"
(sent, skipped) = bulk.airdrop20(address(nft), [a,b,c], amounts, false);
assertEq(sent, 3);                         // reported as three ERC-20 deliveries
assertEq(nft.ownerOf(1), a);               // what actually moved was NFT #1
assertEq(nft.ownerOf(2), b);
assertEq(nft.ownerOf(3), c);
```

`transferFrom(address,address,uint256)` is one selector for both standards, and a conforming ERC-721 returns
nothing, which `_airdrop20`'s `answeredTrue = ret.length == 0` reads as a USDT-style success
(`src/BulkSend.sol:317`). The v11 work closed this direction for `airdrop721` — `_mustBeNft` at
`src/BulkSend.sol:395` — and left the mirror open.

**What it costs.** A caller loses NFTs to arbitrary addresses while the counter, the `Airdrop20` event and any
client reading them all say a token airdrop of 1, 2 and 3 units succeeded. **Not reachable from this page**:
`tokenInfo()` (`web/index.html:763`) runs ERC-165 detection and overrides the dropdown, and a 721 without
ERC-165 fails `decimals()` and leaves `tokenLoadedFor` null, which blocks Send. But `BulkSend` is a public,
verified, ownerless utility that the README invites others to use, and this is the one asymmetry left in a
guard that exists specifically to stop cross-standard confusion.

**Fix.** In `_airdrop20`, refuse a token that answers `ownerOf(amounts[0])` with 32 bytes — the exact inverse
of `_mustBeNft`, one staticcall per batch. A conforming ERC-20 has no `ownerOf` and reverts empty. Add
`error IsAnNft(address token)`. (It cannot be perfect — a hybrid can answer both — but the same argument that
justified `_mustBeNft` justifies its mirror.)

---

### S-5 — `_mustBeNft` refuses a real ERC-721 whose `ownerOf` reverts with empty returndata, and it only ever looks at `ids[0]`

**Demonstrated.** `test/Audit12.t.sol`, two tests that both pass:

```solidity
// ownerOf refuses an unminted id with a bare `require(o != address(0));` — no reason string.
// That is a revert with EMPTY returndata, and it is what Vyper's bare `assert` produces too.
nft.mint(me, 2); nft.mint(me, 3);            // id 1 was burned, or never minted
ids = [1, 2, 3];
vm.expectRevert(NotAnNft.selector);
bulk.airdrop721(address(nft), [a,b,c], ids, false, /*lenient*/ true);   // whole batch dies

// the identical collection, with a first id that exists, works perfectly:
ids = [2, 3];  → sent == 2
```

The discrimination at `src/BulkSend.sol:397` rests on *"a contract without that function reverts empty while a
real NFT refusing an id reverts with its own error and data"*. That is true of OpenZeppelin v5
(`ERC721NonexistentToken`) and ERC721A (`OwnerQueryForNonexistentToken`), and false of any implementation
written `require(cond);` with no reason string, of the canonical Vyper ERC-721 reference implementation, and of
anything using `assembly { revert(0,0) }`. Solidity's `require(x)` with no message compiles to `revert(0,0)`.

**What it costs.** In lenient mode, whose whole promise is that a row which cannot be delivered is skipped and
the rest goes out, one stale id at the front of the list refuses the entire batch — and refuses it with
`NotAnNft(token)`, which the page translates as a statement about the *collection*, not about that row. Whether
this bites depends on the first id in the chunk, so it is intermittent: the same list, reordered or split
differently, works.

**How likely.** The page's own flows put an owned id first (`Assign`, the picker, ascending sort), so it is not
the common path. It is reachable through the "download the skipped list and retry those" loop the page
recommends (`web/index.html:2933`), through a hand-written list, and through any collection where a burn
leaves a hole.

**Fix.** Two independent improvements, both cheap:
1. Treat "reverted empty" as inconclusive rather than as proof, and fall back to a second probe that cannot
   be answered by a non-NFT — `supportsInterface(0x80ac58cd)`, which the page already uses for exactly this
   question — before refusing.
2. Do not decide a batch on one id. If `ownerOf(ids[0])` reverts empty, try `ids[n-1]` before giving up. One
   extra staticcall in the failure path only.

---

### S-6 — One `false` answer from an ERC-20 takes the whole lenient batch down, so nobody is paid

**Demonstrated.** `test/Audit12.t.sol::test_probe_one_false_answer_reverts_the_whole_lenient_erc20_batch`
passes:

```solidity
tok.refuse(b);                                       // returns false for b, moves nothing, reverts nothing
vm.expectRevert(abi.encodeWithSelector(AmbiguousResult.selector, b, 1));
bulk.airdrop20(address(tok), [a,b,c], [100,100,100], /*lenient*/ true);
assertEq(tok.balanceOf(a), 0);                       // the row before it keeps nothing
assertEq(tok.balanceOf(c), 0);                       // and so does the row after
```

This is a direct answer to the question in the brief ("does `AmbiguousResult` in the lenient branches break
promise 3?"). **For ERC-721 and ERC-1155 the trade is right**: the answer is a property of the token, so the
first row reveals it and the batch was never going to work. **For ERC-20 it is not**, because
`answeredTrue` (`src/BulkSend.sol:317`) folds two different things together:

- `ret == abi.encode(false)` — the token said, in the standard's own vocabulary, "I did not transfer". A
  conforming token that returns false has moved nothing. This is not ambiguous; it is a refusal.
- `ret == 16 bytes` / `ret == abi.encode(2)` / anything else — genuinely uninterpretable, and reverting is right.

`docs/for-reviewers.md` decision 3 says *"Reporting a possible payment as a skip is worse than failing."*
Agreed for the second case. The first case is not a possible payment; it is the token's own "no". Round
eleven's own fixture set contains `False20`, and the shape it models — a token that refuses a chosen recipient
by returning false rather than reverting — is a real blocklist pattern. Under the current rule, one such
recipient anywhere in a 400-row lenient batch means the sender pays gas for up to 400 transfers, gets none of
them, and is told the batch is "ambiguous".

**What it costs.** No funds; the revert undoes everything. It costs the gas of the whole batch and it costs
promise 3: lenient mode is documented to *"skip only recipients that genuinely could not receive"*, and this
is a recipient that genuinely could not receive.

**Fix.** Split the branch:

```solidity
if (ret.length == 32 && abi.decode(ret,(uint256)) == 0) {
    if (o.lenient) { ++skipped; emit Skipped(token, dst, 0, amounts[i], ret); unchecked{++i;} continue; }
    revert TransferFailed(dst, 0);
}
if (!answeredTrue) revert AmbiguousResult(dst, i);
```

If you decide this is deliberate, say so in `docs/for-reviewers.md` decision 3 in these terms — "a returned
`false` is treated as ambiguous even though the standard defines it" — because the current wording does not
cover it, and add the case to `test/BulkSendReal.t.sol` so the choice is pinned.

---

### S-7 — "Use these" in the NFT picker silently deletes list lines whose address it cannot read

**Demonstrated.** `node test/web/audit-probe-12.mjs` → `A-2` reproduces.

Three lines in the box, the middle one an address with a broken checksum (an ordinary paste error). Open the
picker, "Select the first 2", "Use these". The box afterwards:

```
0x0000000000000000000000000000000000000111,1
0x0000000000000000000000000000000000000222,2
```

`#msgList` says *"Using the 2 you chose, paired in the order they are listed."* `#problems` is empty. The third
recipient, and the text the user pasted, are gone with no undo.

`walletsInBox()` (`web/index.html:1430-1442`) drops any line where `addressOn()` returns null, and `pickUse`
(`web/index.html:1509`) writes `$('list').value = wallets.map(…)`, replacing the box with only what
`walletsInBox()` could read. Because the count check (`chosen.length !== wallets.length`) is also computed
from `walletsInBox()`, the shortfall is invisible to it: the user is never told the list they see and the list
being paired are different lengths.

**What it costs.** A recipient is dropped from an airdrop without a word — and worse, dropped *before*
`parseList` would have flagged them, so the subsequent "Check list" reports a clean list. This is exactly the
class the picker's own comment says it must not do (*"it must never shorten the recipient list to fit what was
selected"*), reached by a different route.

**Fix.** Have `walletsInBox()` return unreadable lines as well, and refuse in `pickUse` if any exist:
*"3 lines are in the box and 2 of them have a wallet address on them. Fix or remove line 2 before pairing."*
The same rule belongs on `Assign` (`web/index.html:1809`), which uses `addressOn` the same way.

---

### S-8 — A quoted CSV is read correctly with a header row and rejected line by line without one

**Demonstrated.** Same page, same file, header row removed:

```
"0x…111","1"           →  0 recipients, 2 problem lines skipped
"0x…222","2"              line 1: that is not a wallet address (""0x00000000000…")

"address","tokenId"    →  2 recipients, 2 distinct wallets
"0x…111","1"
"0x…222","2"
```

The header path uses `splitRow()` (`web/index.html:812`), which implements RFC 4180 quoting. The positional
path uses `t.split(/[,\t;=]+|\s+/)` (`web/index.html:1120`), which does not. So quoting works only if the file
also happens to name its columns. `web/index.html:96` tells users *"Exports from Etherscan, Safe, thirdweb,
Dune, OpenSea and disperse are read as they come"*; several of those quote fields, and deleting the header row
is a natural thing for a user to do.

This is the shape the brief asked me to hunt for — two readers for one input, where a file takes the wrong one
and gets a different answer — and the message it produces is the unhelpful half: `addressProblem` reports the
quotes as part of the address and offers the "maybe this is a heading" hint on line 1.

**What it costs.** The user cannot send at all, and is told their addresses are wrong when they are not. This
is the same failure mode as *"a real user could not send at all"* from the last round.

**Fix.** Use `splitRow()` on the positional path too, then fall back to whitespace splitting when it yields one
cell — `splitRow` already does that at line 828. The two paths should differ in *which column means what*, never
in *how a line is cut into cells*.

---

### S-9 — `switchChain` tells a user their wallet refused, when what happened is that it never answered

**Reasoned from source, and pinned by a test that asserts the wrong sentence.**

`web/index.html:708-722`:

```js
let missing = false, stillWaiting = false;
for (const [method, params] of [...]) {
  if (stillWaiting) break;
  try { await askWallet(method, params); }
  catch (e) { if (e && e.timedOut === TIMED_OUT) { stillWaiting = true; } … }
  if (await walletChainId() === id) { …; return; }
}
showManualNetwork(await walletChainId(), missing, eth === wcProvider);
```

`stillWaiting` is computed, used to break the loop, and then **never passed to `showManualNetwork`**, which has
only two states: "does not have it" and "would not switch to it". A wallet that has not answered in twelve
seconds gets *"Your wallet is on chain N and would not switch to Robinhood Chain."* That is a statement about
what the wallet did, and the page does not know it. The request is still sitting in the wallet — the same
situation `onlyOnce` goes to considerable trouble to describe honestly ninety lines earlier — and the advice
that follows ("press Connect again") will stack a second request and get `-32002`.

The existing test locks this in. `test/web/client.test.mjs:1783-1795`:

```js
['never answers', { walletChain: '0x1', hangOnAddChain: true }],
…
check('a wallet that ' + what + ' still gets the user somewhere',
  /does not have|would not switch/.test(msg) && /add-chain/.test(msg), …);
```

It asserts that the page says one of two things, and for the "never answers" case both of them are false.

**Fix.** Add a third state. `showManualNetwork(onChain, missing, overWC, stillWaiting)`, and when
`stillWaiting`: *"Your wallet has not answered the request to switch network. It may still be waiting for you
— open your wallet and approve or dismiss it. Do not press Connect again first."* Then change the test to
assert that sentence for `hangOnAddChain` and the current one for `refuseAddChain`.

---

### S-10 — Check: `readTransaction` validates neither `to` nor `from`, and reports a malformed destination as a contract being created

**Demonstrated.** `node test/web/audit-probe-12.mjs` → `C-2a`, `C-2b`, `C-2c` all reproduce. Reading the
parsers directly:

```
readEnvelope: to  →  /^0x[0-9a-fA-F]{40}$/ or null      from → validated
readTransaction (web/check.js:1098-1110):
  to:   o.to   || null      → "0x1234" survives; so does {"evil":1}
  from: o.from || null      → "nonsense" survives
```

Three consequences, all in the batch renderer:

1. `{"to":"0x1234"}` reaches `noTo` (`web/check.js:1352`) and is reported as *"An entry with no `to` is
   usually a contract being created, and this page cannot tell you what that contract would do."* The entry
   had a `to`; it was malformed. Telling someone their transaction creates a contract is a wrong answer, not a
   cautious one. The same message fires for a `to` whose checksum is wrong — a real address a wallet would
   send to without complaint, because `ethers.isAddress` enforces the checksum and JSON-RPC does not.
2. `{"to":…,"from":"nonsense"}` produces *"Simulated as one sequence, as nonsense, against the chain as it is
   now."* An unreadable sender is used as the sender.
3. A `from` that differs from the address in the box silently wins, with no notice. The `wallet_sendCalls`
   path warns about exactly this (*"the request names a different sender than the box"*,
   `web/check.js:1303`), because `envSender` is only derived from an envelope and `readTransaction` produces
   none. The page's own reasoning — *"Who is asking decides what most contracts do"* — makes this worth saying.

**What it costs.** Wrong answers rather than lost funds: a description of the wrong operation, or a "would
succeed" computed for a sender that is not the user.

**Fix.** Validate `to` and `from` in `readTransaction` with the same regexes `readEnvelope` uses, set them to
`null` when they fail, and report the reason on the call (`invalid: 'Its destination is not an address: …'`)
rather than letting it fall into the contract-creation branch. Split `noTo` into "no destination given" and
"destination unreadable". Give `readTransaction` a one-call envelope so the sender-differs warning covers it
too — which also closes B-1.

---

### S-11 — `arrivalsFromReceipt` still reads the live account, so every pending batch is reported as unconfirmed on page load

**Demonstrated.** `node test/web/audit-probe-12.mjs` → `A-1a` reproduces, `A-1b` is the control.

Seed one `bulksend:pending:*` record for a wallet batch, put a receipt on the chain containing both of its
`Transfer` events, load the page, connect nothing. The log says:

> Caught up on a batch your wallet sent from 9/10/2026: **the token reported 0 transfers in that transaction**,
> which are now recorded, and 2 it did not report, which stay held back. Check the transaction, then use
> "Review held rows".

Press Connect, with the account that sent it, and the *identical receipt* now reads:

> the token reported **all 2** of these transfers in that transaction, so they are recorded and will not be
> sent again.

`arrivalsFromReceipt` (`web/index.html:2262-2270`) takes `forToken` and `forStd` as parameters — the round-eleven
fix, and its comment explains exactly why: *"The token and the standard belong to the batch that was sent, not
to whatever the form happens to be showing when this runs."* Three lines later it reads the sender from the
module-level `me`:

```js
const from = String(me || '').toLowerCase();
if (addr(l.topics[1]) !== from) continue;
```

`reconcilePending(true)` runs at load (`web/index.html:3151`) when `me` is `null`, so `from` is `''`, every
log is filtered out, and every pending batch in the browser is judged as reporting nothing. The same happens
whenever the connected account is not the one that sent the batch.

**What it costs.** No funds and no double payment — it fails held, which is the right direction. It costs the
truth of the sentence, and it costs the feature: the load-time catch-up that exists so a closed tab recovers
by itself never recovers anything, and instead tells the user on every single page load to go and check a
transaction on an explorer about a problem that does not exist. That is the fastest way to train someone to
stop reading these messages, which matters because one of them is real.

**Fix.** Record the sender in the pending entry (`from: me` — the bulk path already stores `call.from`; the
wallet path stores nothing) and pass it in: `arrivalsFromReceipt(rc, rows, sentAs.token, sentAs.std,
sentAs.from)`. Where no sender was recorded, say *"this batch does not record who sent it, so its transfers
cannot be attributed; those rows stay held"* rather than reporting zero transfers.

---

### S-12 — `readBatchReceipt` reads the live form, so reconciliation can only ever read back the batch currently on screen

**Reasoned from source; same root as S-11 and it is worth fixing in the same change.**

`readBatchReceipt` (`web/index.html:2313-2316`) takes the token, the standard and the sender from
`$('token').value`, `std()` and `me`. It is called from the send loop, where the form is locked and those are
correct — and from `reconcilePending` (`web/index.html:2444`), which the file's own comment says *"walks every
pending record in this browser — every chain, account, token and standard"*.

For any pending record whose token, standard or sender is not what the form currently shows, every BulkSend
event fails `evToken !== token` or `evFrom !== mine`, `summaries !== 1`, and `ambiguous` comes back true. The
page then logs, not gated by `quiet`, on every load:

> A batch from … cannot be read back line by line, so it is left alone. **Check it on the explorer before
> sending to those wallets again.**

Which is a claim about the receipt. The receipt is fine; the page looked at it with the wrong token in its
hand.

**Fix.** `readBatchReceipt(rc, chunk, bulkAddr, forToken, forStd, forFrom)`, with the send loop passing its own
values. This is the same fix as S-11 applied to the other reader; the round-eleven change fixed one of the two
functions that had this bug.

---

### S-13 — The cost quoted to the sender carries none of the margin the same measurement gets before it sets the cap

**Demonstrated.** `node test/web/audit-probe-12.mjs` → `A-3`. With `eth_estimateGas` answering 61,000, the
page reports `about 40,000 gas a wallet` and prices the whole run from it.

`measuredCap()` divides by `PROBE_MARGIN` (1.35); `costLine()` does not:

```js
const measuredCap = () => (perRecipient ? Math.max(1, Math.floor(BATCH_ROOM / (perRecipient * PROBE_MARGIN))) : null);
const gasPerRecipient = () => perRecipient || fallbackPer();
const gas = BigInt(n) * BigInt(gasPerRecipient()) + batches * BigInt(TX_BASE);
```

The comment above `PROBE_MARGIN` (`web/index.html:303-314`) is the argument against this: the probe measures a
transfer made *by the owner*, BulkSend makes it *as an operator*, and on an OperatorFilterer collection that
is *"5,000-10,000 gas on a base of ~40,000, so 12-25%"* — undetectable from outside, which is why the margin
exists. The cap gets the margin. The number the user reads before deciding whether they can afford the
airdrop does not.

**What it costs.** An understated cost estimate, by up to a quarter, labelled "about" and shown in ETH and
dollars. Small, but it is the one number a sender uses to decide whether to go ahead.

**Fix.** Use `perRecipient * PROBE_MARGIN` in `costLine` too, and label it *"at most"* rather than *"about"*
when the margin is applied — or state both. And reconcile `docs/gas-and-batches.md`, which still argues for
1.15 in four places (lines 13, 160, 205) and derives its "checked against all 58 collections" conclusion from
it; `PROBE_MARGIN` became 1.35 in `e466e22` and the document has not moved since `71fe027`.

---

### S-14 — Send does not check the `signing` guard, so Approve and Send can each have a wallet prompt open at once

**Reasoned from source.**

`onlyOnce` (`web/index.html:217`) opens with `if (signing || sending) return;` and disables only its own
button. `$('send')` does not go through it (`web/index.html:2743`):

```js
$('send').addEventListener('click', async () => {
  if (sending) return;                       // `signing` is not consulted
  lockForm(true); …
```

`plan()` enables `#approve` and `#send` under the same conditions, and `onlyOnce` only calls `plan()` *after*
its work settles. So while an approval prompt is open in the wallet, `#send` is still enabled and clicking it
starts a run.

Most of the time the run stops itself — the preflight staticCall sees the approval has not landed and returns
`willDeliver === 0`. If the account was already approved for the collection, it proceeds, and the user has two
signature prompts queued from one page. That is the shape the maintainer describes fixing for approve and
revoke: *"three setApprovalForAll transactions to one contract in eight seconds… A guard on one code path is
not a guard."* Send is the remaining code path.

**Fix.** `if (signing || sending) return;` in the send handler, and set `signing = true` for the duration of
`runSend` (or route `send` through `onlyOnce` with `sending` doing the form lock).

---

### S-15 — The publish gate checks `script-src` exhaustively and no other directive at all

Round eleven's S-10 is marked **open** in `docs/status.md`, honestly. Half of it is now closed: the gate in
`deploy/publish.sh` requires exactly one hash, refuses `unsafe-inline` / `unsafe-eval` / `strict-dynamic` /
`unsafe-hashes` / `*`, and holds host sources to an `ALLOWED_SOURCES` set. All of that is good, and the
`strict-dynamic` reasoning in particular is right.

The other half is untouched: the gate parses `script-src` and never looks at the rest of the policy. A commit
that adds a host to `connect-src`, drops `object-src 'none'`, widens `img-src` to `*`, or removes `base-uri
'none'` publishes without a word. `connect-src` is the interesting one on a page that builds transactions:
adding one host there is how a page starts talking to somewhere it should not, and it is a one-word diff in a
250-character attribute nobody reads.

**Fix.** Hold the whole policy to a table in `deploy/publish.sh`, directive by directive, with the same "add it
here in the same commit" rule the script already applies to `script-src` hosts. It is about fifteen lines and
it converts the entire CSP into something a reviewer can diff.

---

### S-16 — `script-src` grants the whole of `cdnjs.cloudflare.com`, on a page whose own comment says signing code should not come from a third party

`web/index.html:168` loads ethers 6.13.4 from `cdnjs.cloudflare.com` with a SHA-384 SRI, and the CSP grants the
origin: `script-src 'self' https://static.cloudflareinsights.com https://cdnjs.cloudflare.com 'sha256-…'`.

The SRI is what actually protects the bytes, and it does. Two things are still worth changing:

1. The grant is origin-wide, so any injection point that can add a `<script src>` gets to pick any file on
   cdnjs — including builds of libraries chosen for what they do. A CSP source expression may carry a path:
   `https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.4/ethers.umd.min.js` is a legal source and costs
   nothing. That reduces the grant from an origin to one file.
2. The inconsistency is worth naming. `web/index.html:495-497` says of the WalletConnect bundle: *"The bundle is
   served from our own origin rather than a third-party CDN: this page builds transactions, and a signing
   page should not take its code from somewhere we do not control."* ethers is the library that encodes every
   transaction this page produces and it is loaded from a third-party CDN. The SRI makes that defensible; the
   asymmetry in the stated policy is not. Either self-host ethers the way `wc.js` is self-hosted — it is
   ~350 KB against `wc.js`'s 2 MB, so the "it is too big to embed" argument does not apply — or amend the
   comment to say why the two are treated differently.

`SECURITY.md` describes this accurately, so this is a hardening suggestion rather than a correction.

---

### S-17 — `integrity.yml` hashes bodies, so a worker republished with a weaker header set on the page itself would pass

The workflow checks the header set on error paths (`/nothing-here`, `/x/…/a..b`, `/wc.js`) and on the explorer
passthrough, which is good and unusual. On the two pages themselves it checks only `strict-transport-security`
and the body hash. The body cannot show a header change, because the CSP header is generated by
`deploy/publish.sh` from the meta tag at publish time and lives in the worker, not in `web/*.html`.

So a worker published without `frame-ancestors 'none'` — the one directive a meta tag cannot express — would
pass every check here. S-2 above is the empirical case: rhcheck's worker is currently missing the CSP header
from `secure()` entirely and the monitor's green runs did not notice, because the responses it checks for CSP
are the `/x/` ones and the last run predated the change.

**Fix.** In the "plain HTTP is still refused" step, also assert on `https://$host/` that
`content-security-policy` is present, contains `frame-ancestors 'none'`, contains the same `sha256-` hash the
local file's meta tag names, and contains no `unsafe-inline`. Four greps.

---

### S-18 — Small, grouped

- **`forgetRun()` does not take the run lock** (`web/index.html:1631`). It deletes the delivered ledger with
  `localStorage.removeItem(runKey())` while another tab may be mid-send on that run under
  `navigator.locks`. The button says it removes the double-send protection, so the outcome is what it
  advertises, but the write should go through `withRunLock` like every other change to that key — the file's
  own comment says *"Every change to what a run has delivered goes through here"*, and this one does not.
- **`docs/for-reviewers.md:118`** says *"The contract has been clean for seven rounds and has not changed
  since the third."* It is v11 and changed twice today. `docs/status.md` has it right; `for-reviewers.md` is
  the file a reviewer is pointed at first.
- **`SECURITY.md:60`** points at `docs/audit-2026-09-08-tenth-external.md` as *"the most recent audit in
  full"*. The eleventh is in `docs/` and is newer.
- **`web/index.html` `probeRefused` is never cleared on an early return** (`web/index.html:317`, `380`). Clear the
  token field after a refused probe and the "the answer was too small to be real" wording stays on screen
  describing a token that is no longer in the box. Cosmetic.
- **The wallet is never given a `chainId` to check the send against.** `bulk[fn](...args)`
  (`web/index.html:2878`), `t.setApprovalForAll(...)` and `t.approve(...)` all send with no overrides, so the
  `eth_sendTransaction` request carries no `chainId`. A wallet that is on a different network than it reports
  therefore signs rather than refusing. Adding `{ chainId: chainId() }` to the overrides costs nothing and
  converts an undetectable failure into a wallet-side refusal. Matters more on mainnet, where the same
  address is a different contract.
- **`$('shuffle')` and `$('dropContracts')` read column 0 rather than `addressOn(line, boxColumns())**
  (`web/index.html:1732`, `1793`). On a file headed `label,address,tokenId`, Shuffle answers *"Shuffle would
  drop N lines that have no id yet"* about lines that have ids. Same two-readers shape as S-8, milder
  consequence.

---
## Inherent limits of doing this in a browser, against contracts nobody controls

These cannot be engineered away. For each one, what matters is what the software *says*.

### I-1 — No on-chain test separates a token from something wearing its shape

`_mustBeNft` raises the bar and does not settle the question. `test/RealTokens.sol::PretendsToBeAnNft`
answers `ownerOf`, accepts the transfer, returns nothing exactly as a conforming ERC-721 does, and moves
nothing. That is where the boundary is, and it is where the maintainer says it is — the test asserting it is
correct.

**What it should say:** what it already says. `SECURITY.md`'s "What a delivery count means" is the right
paragraph and the page's footer repeats it. Nothing to change.

One addition worth making after S-5: the current message for a refused token is `NotAnNft(token)`, which the
page turns into a statement about the collection. It should distinguish "this address has no `ownerOf` at
all" from "`ownerOf` would not answer for the id I asked about", because those want opposite reactions from
the sender.

### I-2 — A balance read before and after cannot be attributed to your transaction

`confirmArrival` for ERC-20 and ERC-1155 compares `holdingsOf` before and after (`web/index.html:2184`). Any
third party paying the same recipient inside that window inflates the delta, and a row can read as arrived on
someone else's transfer. The page mitigates this on the recovery path — `arrivalsFromReceipt` reads the
token's own events *in that transaction* and filters on the sender, and its comment names exactly this
failure — but the live path still uses the balance delta.

**What it should say:** the live path's "read back as held by their recipient after the transfer" message is
careful about the token lying and silent about attribution. Add the second half: *"this compares the balance
before and after, so a payment from anyone else in the same moment would look the same."* Or better, use
`arrivalsFromReceipt` on the live path too — the receipt is right there, and it is strictly stronger evidence.

### I-3 — A gas estimate for an owner-path transfer cannot predict an operator-path transfer

The `PROBE_MARGIN` comment is the clearest statement of this in the repository and it is correct: the probe
measures what it can reach, the real cost is 12-25% higher on collections using the OperatorFilterer pattern,
and that pattern is not detectable from outside. The margin carries it. The residual is that a collection
dearer than the margin allows produces a batch that does not fit, which fails cleanly.

**What it should say:** see S-13 — apply the margin to the figure the user reads, and say "at most".

### I-4 — A metadata blob is decoded before it can be measured

`readTokenMetadata` (`web/index.html:1314`) checks `uri.length > URI_CAP` — but `uri` is already a fully
decoded JavaScript string by then, produced by `t.tokenURI(id)`, and `loadPickable` runs eight of those
concurrently across up to 250 ids. A collection returning 50 MB per `tokenURI` costs the tab that memory
before any cap applies. The caps do prevent the expensive half (base64 decode, JSON parse, image decode).

**What it should say:** nothing to the user. But an `eth_call` size guard is available cheaply: fetch the
`tokenURI` through `rp.call()` and reject the raw hex over ~2× `URI_CAP` before ethers decodes it.

### I-5 — `localStorage` cannot know about another browser

Correct, and the footer says so in plain words. No change.

### I-6 — Transient storage is a chain-configuration dependency

`nonReentrant` uses `TSTORE`/`TLOAD` (`src/BulkSend.sol:71-83`) and `foundry.toml` pins `evm_version =
"cancun"` on the strength of "nitro v3.11 at ArbOS 61 (checked 2026-09-06)". That is right for testnet today.
It is a fact about a chain the maintainer does not operate, and mainnet is a separate deployment.

**What it should be:** a pre-deploy step, not a comment. Before any mainnet deploy, read
`ArbSys`/`ArbOwnerPublic` for the ArbOS version on 4663 and refuse if it is below the one that shipped
TSTORE. A contract whose reentrancy guard silently becomes an invalid opcode is not a contract to find out
about afterwards.

---

## Examined and found sound

Silence elsewhere should mean something, so here is what I actually checked and did not find a problem with.

**The contract.**

- **`returndatasize()` after a high-level call reads the transfer, not something else.** Verified rather than
  reasoned: `test/Audit12.t.sol::test_returndatasize_reads_the_transfer_call_not_a_nested_one` puts a token in
  front of it whose `transferFrom` calls another contract that returns 64 bytes and then returns nothing
  itself. The batch is counted correctly (3 sent). Solidity emits the `EXTCODESIZE` check before the `CALL`
  and no other call between the `CALL` and the assembly block, and a reverted call is bubbled before the read
  is reached, so the "after a revert" case the brief asks about never executes the read at all.
- **The ERC-404 / hybrid shape is caught.** `test_hybrid_404_is_refused_by_the_ambiguity_check`: a contract
  that answers `ownerOf` and whose `transferFrom` returns a bool is refused with `AmbiguousResult` rather than
  counted. This is the realistic version of "a non-NFT that satisfies `ownerOf`", and the v11 return-data
  check handles it. `DN404Mirror`, the other hybrid shape, is a conforming ERC-721 face and works correctly.
- **`SilentlyDoesNothing` and `PolitelyDoesNothing` are both refused** by `_mustBeNft` now (empty return and
  32-byte return respectively), which is why two of the round-eleven probes flipped to FAIL.
- **Gas, measured at 400 recipients** (`forge test --match-test test_gas_400_recipients -vv`):

  | | 400 recipients | per recipient | headroom on 32,000,000 |
  | --- | --- | --- | --- |
  | OZ721 strict, safe | 14,949,495 | 37,374 | 53% |
  | OZ721 strict, plain | 13,836,721 | 34,592 | 57% |
  | ERC721A lenient | 20,878,102 | 52,195 | 35% |
  | OZ20 lenient | 11,229,328 | 28,073 | 65% |

  Nothing sits closer to the limit than the last round measured. The v11 additions cost one warm staticcall
  per batch (~100 gas, the address is already warm from `_mustBeContract`'s `EXTCODESIZE`) and a
  `RETURNDATASIZE`/`ISZERO`/jump per row, which is under 15 gas a recipient — under 0.05% of any row above.
- **The reentrancy lock, the stipend arithmetic, `_tryCall`'s EIP-150 reserve, the returndata cap, the
  zero-address handling, the `SelfRecipient` refusal and the absence of any admin surface** are all as
  described and have been tested for six rounds. I re-read them and found nothing to add.

**The gas probe and the batch cap.** I tried to break the cap with a hostile RPC and could not get past the
guards. The bound is: `per` must be `> 21,000` and `>= fallbackPer()/4`, so the largest cap a lying node can
buy is the hard ceiling of 400 (an answer of 38,250 for ERC-721 yields `floor(30e6 / 51,637) = 581 → 400`),
and the smallest is 1 via `Math.max(1, …)`. A cap of 400 on a collection that really costs 152,843 produces a
batch that cannot be estimated inside the block limit; the send fails, the pending record is written before
the wait, and reconciliation reads `rc.status === 0` and returns the rows to the list. No funds move and
nothing is recorded. The maintainer's stated belief here is correct, and now has the arithmetic behind it.
The keying is also right: `gasProbeKey` covers chain, token, standard, receiver-check, account, probed id and
probed amount, and the post-await `if (gasProbeKey !== key) return` closes the two-probes-in-flight case. I
could not construct a token change, chain change, list change or concurrent probe that reads one answer for
another question.

**Probing the lowest id** is the right choice and the reasoning holds: on a lazily-minted collection delivered
in ascending order, the first transfer does the long ownership walk and every later one lands next door to a
slot the previous transfer wrote, so the lowest id is the dearest and the estimate is conservative. I could
not construct a collection where a later id costs materially more *given ascending delivery*.

**The NFT picker's rendering surface.** I tried the attacks named in the brief and none of them work:
`data:text/html` in `image` is rejected by `dataImage`'s type list; `javascript:` likewise; a `name` that is
not a string becomes `null` and falls back to `#<id>`; names and reasons go in through `textContent`; the
image only ever reaches an `<img src>`, and an SVG loaded through `<img>` runs in secure static mode — no
script, no external references, no access to the parent document — so the network-reaching SVG does not
reach the network. `img-src` deliberately not allowing arbitrary hosts is the right call and the page's
reason for it (a collection's server learning the IP of everyone previewing an airdrop, on a page that also
signs) is a better reason than the usual one; not proxying is also right, because proxying would put
third-party bytes on this origin, which is the thing S-9 was about. The identity checks are right too:
`pickContext()` covers chain, account, standard and collection, and it is re-checked at "Use these" rather
than only at open, so a wallet can never be paired with an NFT from another collection. The one defect here
is S-7, which is about the list rather than the pairing.

**The delivery ledger.** I looked specifically for another input that can move the key, the sender or the list
under a running send, and for a write or release outside the locked commit, and found neither:
`sendRunKey` is captured when the lock is granted and `ledgerKey()` throws outside a send; `lockForm` disables
every input that feeds the key; `accountsChanged` and the WalletConnect `disconnect` handler both return early
while `sending`; `heldRunKey` is per-run rather than a boolean; `commitDelivered` is the single path and does
re-read, merge, write, read-back, then shrink-or-drop, in that order, under `withRunLock`; `writeDeliveredFor`
reads back what it wrote; `writePending` reads back the record rather than a count; each pending batch has its
own key so two tabs cannot clobber one another; and `reconcilePending` is called before the run lock is taken
rather than inside it, which is the correct answer to the deadlock it describes. The only unlocked write is
`forgetRun` (S-18), which is operator-initiated and advertised.

**`readCallsStatus`.** The three-way handling of EIP-5792 status codes is right, including the part most
implementations get wrong: `code >= 400 && contradicted` returning `partial` rather than `failed`, so a wallet
that claims failure alongside a successful receipt cannot release rows for re-payment. The refusal to map the
undefined string `'FAILED'` to 400 is also right.

**The Check page's schema checks against EIP-5792.** I read them against the specification rather than the
description. `version`, `chainId` (required, hex quantity, no leading zero), `atomicRequired` (required
boolean, three-state), `id`, `from`, `capabilities`, and the per-call `to`/`data`/`value`/`capabilities` are
all checked, and the unknown-capability handling — name it, describe the ordinary reading, and withhold the
sequence verdict — is the correct response to a field that is defined as "the wallet may do something else".
The `reqs[ri].unread` gate, which withholds the green verdict when *any* field was dropped, is the right
generalisation. The leading-zero note, including the observation that EIP-5792's own example violates its own
rule, is accurate. The only gap I found on this reader is B-1/S-10, both on the `eth_sendTransaction` side.

**The publish chain.** The dirty-tree refusal, the exactly-one-hash rule, the `NEVER` token list, the
`ALLOWED_SOURCES` allowlist for script hosts, the `EXPECTED-SHA256` must-be-a-real-digest check, the
digest-keyed prefetch that refuses to activate a Worker against a bundle the origin does not serve, the
`node --check` on the generated worker, and the post-publish byte comparison are a genuinely closed chain for
`script-src` and for the connector. I could not find a way to put something else at the end of it short of the
control-plane facts the brief excludes. The bypasses announce themselves on every run, which is the right
design for a flag that lives in a gitignored env file. The remaining gap is S-15 (the rest of the CSP).

**The workflows.** Both are read-only and pinned to commit hashes. `tests.yml` runs on `pull_request` rather
than `pull_request_target`, with `persist-credentials: false` and `contents: read`, so a hostile pull request
can run code in the runner and reach nothing — the correct posture, and the one most repositories get wrong.
`integrity.yml`'s `issues: write` is only reachable from `schedule`/`workflow_dispatch` on the default branch.
Neither is a way in. The `/cdn-cgi/` assertion — testing for the *absence* of HSTS so the workflow fails if
`SECURITY.md`'s sentence stops being true — is an unusually good idea and I would keep it.

**Transport, verified live.** Both hosts 301 plain HTTP with HSTS on the redirect; both send HSTS,
`x-content-type-options`, `referrer-policy` and `cross-origin-opener-policy` on the page; both send the full
CSP as a header with `frame-ancestors 'none'` appended; the airdrop host sends the hardened set on error
responses too (the check host currently does not — S-2). Not setting preload is the right call for a domain
that carries other subdomains, and `SECURITY.md` gives the right reason. `SECURITY.md`'s `/cdn-cgi/` section
is honest about the one place the claim stops, which is more than most projects manage.

**The two deliberate non-changes from round seven.** I agree with both. `static.cloudflareinsights.com` is
injected at the edge after the Worker runs, so removing it buys a console error and nothing else. The `axios`
advisories are in the build graph and not in the artifact — I confirmed `web/wc.js` contains no `axios`,
`form-data`, `follow-redirects` or `proxy-from-env`.

---

## Where the tests are weaker than they look

The brief asked for this specifically.

1. **`forge test` cannot be run under `set -e`, and two of the three places that run it do.** S-1. This is
   the most expensive testing defect in the repository: it has silently disabled the browser suites, the
   bytecode equality check and the connector-reproducibility check for eight commits.

2. **`client.test.mjs:1783-1795` asserts the wrong sentence.** For the "wallet never answers" case it requires
   the page to say either "does not have" or "would not switch", and both are false statements about a wallet
   that has not answered (S-9). A test that accepts either of two messages, one of which is wrong, cannot
   distinguish them. This is the shape the brief warns about: an assertion that checks a *counter* — did the
   user get *somewhere* — instead of a *consequence* — were they told something true.

3. **`verify.sh`'s baseline can be lowered in the same commit as a regression.** `check_set … down` fails when
   more findings reproduce and prints "update it" when fewer do; `test/findings-baseline.json` is a tracked
   file that any commit may edit. That is inherent to the design and worth knowing rather than fixing.

4. **The mocked suite never runs `reconcilePending` with a pending record that does not match the form.**
   That is the entire population `reconcilePending` was written for, and it is where S-11 and S-12 live. The
   suite's fixtures all connect first and all use one token; the load-time path with `me === null` — which
   runs on every real page load — is untested. My `A-1a` probe is nine lines and would have caught it.

5. **Nothing tests the list readers against each other.** `parseList`'s two paths, `walletsInBox`,
   `deliveriesOn`, `addressOn`, `$('shuffle')` and `$('dropContracts')` are six readers of one textarea. There
   are tests for individual behaviours and none that assert *the same file gets the same answer from all of
   them*. S-7, S-8 and the `$('shuffle')` item in S-18 are all that shape. A property test — for a corpus of
   files, assert `parseList` count == `walletsInBox` count and that no path silently drops a line — would
   cover a class rather than an instance.

6. **`--allow-file-access-from-files`** (`client.test.mjs:374`) is fine. It exists so `import('./wc.js')`
   resolves over `file://`, and it relaxes the *test browser's* same-origin policy for local files, not
   anything about the page. It does mean the suite is not exercising the page under its real CSP and real
   origin, but the CSP-hash preflight in both suites covers the specific failure that matters (a page the
   browser refuses to run), and the live scripts cover the real origin.

7. **The count in `docs/status.md` is 270 + 116, not 386 + something.** `verify.sh` reports `client page: 270
   passed, 0 failed` and `check page: 116 passed`. That matches. No issue; noting it because the brief said
   386 and the numbers should be checkable.

---

## The promises, one by one

| | promise | verdict |
| --- | --- | --- |
| 1 | BulkSend moves only what the caller approved, in the transaction they signed, and nobody can change that later | **holds.** No owner, no upgrade, no fee, no pause, no storage between transactions. Every path is `transferFrom(msg.sender, …)`. Re-read at v11 and confirmed. |
| 2 | never reports a transfer as skipped when it may have moved value; never records a recipient as delivered when they may not have been paid | **holds inside the contract**, at the cost of S-6 (a token's own `false` is treated as ambiguous). Holds in the page, and errs held in every failure I could construct — S-11 and S-12 are cases where it holds rows it should not need to, which is the safe direction. |
| 3 | "all or nothing" is all or nothing; "keep going" skips only recipients that genuinely could not receive | **all-or-nothing holds** (`strictSplit` blocks a list that needs more than one transaction, and the wallet path refuses to split on a 5740). **"Keep going" does not** — S-6 (one `false` kills the batch) and S-5 (one unminted first id kills the batch). |
| 4 | will not pay the same recipient twice across reloads, crashes, closed tabs, replaced transactions and multiple tabs, and is honest about what it cannot cover | **holds.** I attacked the ledger specifically and found no path that writes or releases outside the locked commit. The honesty is in the footer and is accurate. |
| 5 | a recipient list is delivered exactly as parsed: no silent rounding, re-scaling, reordering that changes who receives what, or dropped rows | **holds for parsing and delivery** — the decimal handling, the scientific-notation refusal, the ascending sort that preserves pairing, and the occurrence-numbered keys are all correct. **Fails for one editing path**: S-7, where "Use these" deletes rows it cannot read. |
| 6 | the Check page signs nothing, sends nothing, and never presents a transaction as safer than the evidence supports | **signs and sends nothing** — confirmed, there is no signer anywhere in `check.js`; `useWallet` reads an address and says so. **Presents something as safer than the evidence supports**: yes — B-1. |
| 7 | the deployed pages match the repository, and the deployed runtime matches what the repository builds | **false at this commit, twice.** S-2 (rhcheck page) and S-3 (contract metadata). The airdrop page and `wc.js` do match. |

---

## Verdict

**Something blocks release: B-1.**

One finding meets the bar I set out at the top — "a user can act on a false statement". The Check page's whole
function is to answer whether something is safe to sign, and it will describe, simulate and give a
succeeds-verdict for a transaction that says on its face it belongs to another chain, reading a different
contract at the same address to do it. That is round eleven's own blocking finding, still live on the reader
it was not fixed on. It is a fifteen-line fix.

**To clear B-1**, in a form you can check later: `node test/web/audit-probe-12.mjs` reports `C-1a` and `C-1b`
as `fixed`, and `test/web/check.test.mjs` gains a case asserting that a paste of two `eth_sendTransaction`
requests, where the first names `chainId: "0x1"`, produces a "this request is for a different network" card
and **no** per-call description or simulation verdict for that request.

**Nothing else blocks**, and I want to be plain about that: the contract is in good shape, the ledger is the
most carefully built part of the repository and I could not break it, the publish chain is closed for the
things it claims to close, and the Check page's EIP-5792 reader is better than most production wallets'.
Fourteen should-fix items is not a bad round; three of them (S-1, S-2, S-3) are the same underlying problem —
**the machinery that proves the claims has been unable to run since the round-eleven fixes started landing**,
so three separate statements in `docs/` are presently false and nothing told you.

**Before mainnet**, beyond B-1, I would treat these as gates rather than as should-fixes, because each one is
a claim in `docs/` that a reader will check:

- **S-1** — get the `tests` badge green on a commit that still contains the probe files. Until that happens,
  no assertion in this repository is being checked by anything except a human remembering to run `verify.sh`.
- **S-3** — either `bytecode_hash = "none"` or a redeploy, so that the equality check `docs/for-reviewers.md`
  invites a reviewer to run actually passes. A reviewer who runs it today gets a mismatch and has no way to
  tell a comment from a backdoor.
- **S-2** — publish the Check page, and date the deployment rows in `docs/status.md` so a stale one reads as
  stale rather than as checked.
- **I-6** — read the mainnet chain's ArbOS version and confirm TSTORE before deploying there. The reentrancy
  guard is the one piece of this contract that fails silently if the chain disagrees with `foundry.toml`.

The two-condition rule in `docs/status.md` — a round with no release blockers, *and* explicit permission given
after it — is the right rule and this round does not satisfy the first half.

---

## Reproducing everything in this report

Two files were added, both following the repository's existing probe convention (an assertion that **passes**
is a finding that **reproduces**):

```
test/Audit12.t.sol             forge test --match-path test/Audit12.t.sol -vv
test/web/audit-probe-12.mjs    node test/web/audit-probe-12.mjs
```

Current state of both:

```
$ forge test --match-path test/Audit12.t.sol
7 passed          # S-4, S-5, S-6 reproduce; two are controls; one is the gas table

$ node test/web/audit-probe-12.mjs
8 demonstrated, 2 no longer reproduce
  REPRODUCES  C-1a  two pasted eth_sendTransaction: chainId 0x1 raises no network warning     -> B-1
  REPRODUCES  C-1b  one eth_sendTransaction with any unrecognised field: same                 -> B-1
  fixed       C-1c  control: the single-call reader DOES refuse the same foreign chainId
  REPRODUCES  C-2a  a malformed `to` is reported as a contract being created                  -> S-10
  REPRODUCES  C-2b  a `from` that is not an address replaces the sender in the box            -> S-10
  REPRODUCES  C-2c  a differing `from` says nothing about the difference                      -> S-10
  REPRODUCES  A-1a  on load, a pending batch is reported as 0 transfers, receipt in hand      -> S-11
  fixed       A-1b  control: connecting the sending account reads the same receipt correctly
  REPRODUCES  A-2   "Use these" rewrote a 3-line list as 2 lines, silently                    -> S-7
  REPRODUCES  A-3   the per-recipient figure quoted to the sender carries no margin           -> S-13
```

Everything else is a `curl` or a `git` command quoted inline in the finding. Note that `Audit12.t.sol` adds
seven passing contract tests, which changes `forge test`'s totals but not the `AuditProbe.t.sol` counts
`verify.sh` compares against — the baseline is unaffected. Delete both files once the findings are closed, or
keep them as the round-twelve probe set; the convention already exists for that.

---

## The questions you asked, answered directly

**BulkSend v11**

- *Is the `_mustBeNft` discrimination sound? Is there a real ERC-721 that reverts `ownerOf` with empty
  returndata, or a non-NFT that satisfies it?* Yes to the first — S-5, demonstrated. `require(x)` with no
  reason string and Vyper's bare `assert` both revert empty, and the Vyper ERC-721 reference implementation
  does exactly this. For the second: the realistic candidate is a hybrid, and v11 catches it — a contract that
  answers `ownerOf` and returns a bool from `transferFrom` now reverts `AmbiguousResult`
  (`test_hybrid_404_is_refused_by_the_ambiguity_check`). What still passes is a contract deliberately built to
  answer `ownerOf` with a word and `transferFrom` with nothing, which is `PretendsToBeAnNft`, which is where
  you say the boundary is.
- *Is `returndatasize()` reading what you think, including after a bubbled revert?* Yes, verified —
  `test_returndatasize_reads_the_transfer_call_not_a_nested_one`. A revert is bubbled by Solidity before the
  read is reached, so that case never executes it.
- *Does `AmbiguousResult` in the lenient branches break promise 3?* For 721 and 1155, no — the answer is a
  property of the token, so the first row settles it and the batch was never going to work. For ERC-20, yes:
  a returned `false` is the standard's own word for "I did not transfer", not an ambiguity, and folding it in
  means one blocklisted recipient stops the whole lenient batch. S-6, with a fix.
- *Does anything sit closer to 32,000,000 than last round?* No. Measured table in "Examined and found sound".
  Worst case at 400 recipients is ERC721A lenient at 20.9M, 35% under. v11's additions cost under 15 gas a row.
- *Is the boundary where you say it is?* Yes.

**The gas measurement**

- *What can a hostile or broken endpoint make this page do?* Bounded, and I could not get past it. Full
  arithmetic in "Examined and found sound". The worst case is a cap of 400 on a collection that cannot fit
  400, which produces a transaction that fails estimation. Nothing is recorded and the rows return to the list.
- *Is 1.35 enough for a contract you did not measure?* Probably, for the OperatorFilterer case you sized it
  for. It is not the number in `docs/gas-and-batches.md`, which still argues for 1.15 in four places — S-13.
- *Is there a collection where a later id costs much more than the first?* Not given ascending delivery; your
  reasoning holds and I could not construct a counterexample.
- *Can an answer taken for one token be read for another?* No. The key and the post-await re-check cover
  every combination I tried.
- *Are the tests asserting the right thing about the probe?* The selector-on-the-wire assertion is right. What
  is not asserted is that the answer is *used* consistently — S-13 is exactly a case where the measured number
  reaches one consumer with a margin and another without, and no test compares them.

**Everything a wallet is asked to do**

- *Is the three-minute window wrong in either direction?* It is wrong short, in the sense that it is a
  *message* and not a release, so its only job is to tell someone why nothing is happening — and three minutes
  is far longer than anyone will wait before pressing something. Thirty to forty-five seconds would serve the
  same purpose better, and because it releases nothing, shortening it costs nothing. The decision not to
  release on timeout is right and I would not change it.
- *Can releasing it let the first signature and a second both reach the chain?* No. `signing` is cleared only
  in the `.then()` after `fn` settles; the timeout path sets nothing. The gap is elsewhere: Send never checks
  `signing` at all — S-14.
- *A wallet that answers late, wrongly, twice, or changes account or chain mid-flight?* Handled.
  `switchChain` re-reads the chain rather than believing the answer; `onSelectedChain()` runs before every
  batch; `chainChanged` and `accountsChanged` set `stopFlag` and, critically, do not move `me` while
  `sending`. The one honesty gap is S-9.
- *A wallet that reports a chain it is not on?* Nothing on the page can detect it, and the page currently
  gives the wallet no second chance to catch it either: `bulk[fn](...args)` sends with no overrides, so the
  request carries no `chainId` for the wallet to validate against its own selected network. Adding
  `{ chainId: chainId() }` to the overrides on the send, approve and revoke calls costs nothing and turns a
  wallet that is on the wrong network from "signs it anyway" into "refuses the request". Worth doing before
  mainnet, where the same address is a different contract.

**The NFT picker** — attacked as asked; nothing got through. Details in "Examined and found sound". The one
defect is S-7, which is about the recipient list rather than the pairing. Your two deliberate choices
(`img-src` not allowing arbitrary hosts, images not proxied) are both right, and the second is right for a
reason worth writing down: proxying would put third-party bytes on this origin, which is what S-9 was about.

**The recipient-list reader** — the same shape is elsewhere: S-8 (quoting works only with a header row),
S-7 ("Use these" drops what it cannot read), and the `$('shuffle')` item in S-18. On the checksum message: it
is now accurate about what lower-casing does and does not do, and the paragraph is the right length. I would
still move the escape hatch to the end and lead with the two possibilities, because a user who reads the first
line and stops currently reads "the right length, but its capitals do not match" — which sounds like a
formatting problem.

**`check.js`'s request reader** — the ambiguity resolved by picking an answer is B-1, and the second is S-10.
The new schema rules check out against EIP-5792 itself; details in "Examined and found sound".

**The delivery ledger** — I looked for another input that can move the key, the sender or the list under a
running send, and for a write or release outside the locked commit. There is none. The remaining items
(S-11, S-12) are about *reading batches back*, not about writing them, and both fail held.

**The publisher and the supply chain** — the chain is closed for what it claims to close. The gaps are S-15
(the rest of the CSP is ungated) and S-17 (the monitor hashes bodies, so a header regression on the page
itself passes). S-2 is the case where that gap and a missed publish combined into a live, observable
regression.

**`docs/for-reviewers.md`'s design decisions** — I disagree with one, decision 3, and only for ERC-20: see
S-6. The other five I would keep as they are. Decision 1 (ownerless, no rescue) is the right trade and the
reasoning given for it — a refusal is cheaper than a privileged role — is the correct way to state it.

---

## Findings by severity

| | | where | demonstrated |
| --- | --- | --- | --- |
| **B-1** | a transaction naming another chain is read against this one | `web/check.js:1266` | yes |
| S-1 | `tests` CI red for 8 commits; browser suites and bytecode check skipped | `.github/workflows/tests.yml:23`, `test.sh` | yes |
| S-2 | the live Check page is not this repository's; S-8/S-9 live on the deployed host | deployment | yes |
| S-3 | deployed runtime ≠ what this source builds (metadata trailer) | `src/BulkSend.sol`, `foundry.toml` | yes |
| S-4 | `airdrop20` on an ERC-721 spends amounts as token ids | `src/BulkSend.sol:290` | yes |
| S-5 | `_mustBeNft` refuses a bare-`require` ERC-721; probes `ids[0]` only | `src/BulkSend.sol:395` | yes |
| S-6 | one `false` answer reverts the whole lenient ERC-20 batch | `src/BulkSend.sol:317` | yes |
| S-7 | "Use these" silently deletes unreadable list lines | `web/index.html:1509` | yes |
| S-8 | a quoted CSV works with a header row and fails without one | `web/index.html:1120` | yes |
| S-9 | "would not switch" reported for a wallet that never answered | `web/index.html:708` | reasoned |
| S-10 | `readTransaction` validates neither `to` nor `from` | `web/check.js:1098` | yes |
| S-11 | `arrivalsFromReceipt` reads the live account | `web/index.html:2269` | yes |
| S-12 | `readBatchReceipt` reads the live form during reconciliation | `web/index.html:2315` | reasoned |
| S-13 | the quoted cost carries none of the 1.35 margin; docs still say 1.15 | `web/index.html:329` | yes |
| S-14 | Send does not check the `signing` guard | `web/index.html:2743` | reasoned |
| S-15 | the publish gate checks `script-src` and no other directive | `deploy/publish.sh` | reasoned |
| S-16 | origin-wide `cdnjs` grant; ethers from a third-party CDN | `web/index.html:168` | reasoned |
| S-17 | `integrity.yml` hashes bodies, so a header regression on `/` passes | `.github/workflows/integrity.yml` | reasoned |
| S-18 | six small items, grouped | various | mixed |
| I-1..I-6 | inherent limits, with what the software should say | — | — |

**1 blocking, 18 should-fix (S-18 groups six smaller items), 6 inherent limits.**
