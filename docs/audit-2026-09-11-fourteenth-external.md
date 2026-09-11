# Fourteenth external review — `robinhood-chain-tools` at `f5b7614` (BulkSend v13)

Reviewed 10–11 September 2026. This is a fresh review of exact commit
`f5b76145a6de3a84cc66be9b6cae78b316487de7`; `HEAD`, `main`, and `origin/main` all resolved to that commit and
the worktree was clean before and after the review. I made no change to the project, signed or broadcast no
transaction, deployed nothing, and spent no gas.

## Verdict

**NOT READY FOR MAINNET. Do not replace the mainnet placeholder or enable chain 4663.**

I found **4 release blockers, 7 should-fix findings, and 5 inherent/operational limits**. Two list-rewrite
buttons can silently change which ERC-721 ids the user is preparing to send. Check can give an unqualified
green success verdict for the readable subset of a JSON request while admitting that another part was not
read. The live BulkSend page also does not match this reviewed commit and still serves the older gas and RPC
wording that `f5b7614` was meant to replace.

The repository's own four mainnet gates remain unmet independently: this round is not clean; there is no
production RPC/failover plan; the current v13 page has not had the required real injected-wallet and phone-wallet
rehearsal; and maintainer permission has not been given (`docs/status.md:9-25`). Mainnet remains disabled in
code, which is the correct present state.

## Release bar used

Release requires the exact reviewed list to remain the exact transaction plan unless the user knowingly changes
it; no uncertain transfer to become safely retryable; no unread request to receive a whole-request safety
verdict; bounded contract authority and exact deployed artifacts; ordinary wallet errors/reloads/replacements/
concurrent tabs not to create double payment; and the stated historical gates actually to enforce their
evidence. A reachable violation that can change assets or a published artifact mismatch is a blocker. Evidence,
compatibility, or warning weaknesses without a demonstrated ordinary loss path are should-fix. Unavoidable
limits are kept separate.

## Release blockers

### B-1 — Shuffle can turn metadata into additional ERC-721 transfers

- **Basis:** demonstrated in the shipped page.
- **Location:** `web/index.html:1856-1875`, especially `splitRow(...).filter(Boolean)` and
  `[wallet, ...rest].join(',')`; authoritative named parsing is at `web/index.html:1043-1164`.
- **Trigger:** ERC-721; a valid headed CSV has a numeric non-address column in addition to `address` and
  `tokenId`; press **Shuffle**. The documentation promises column-order independence and real-world extra
  columns (`docs/recipient-lists.md:64-103`).
- **Result/cost:** Shuffle drops the heading and emits every non-address cell positionally. The bare parser then
  reads every numeric trailing cell as an id. If owned and approved, extra NFTs are transferred; otherwise the
  plan fails. The UI falsely says the wallets and ids stayed the same.
- **Minimal reproduction:** select ERC-721 and enter:

  ```csv
  label,address,tokenId
  101,0x1111111111111111111111111111111111111111,7
  102,0x2222222222222222222222222222222222222222,8
  ```

  **Check list** reported `2 recipients / 2 distinct wallets`. After **Shuffle**, the observed box was:

  ```csv
  0x1111111111111111111111111111111111111111,101,7
  0x2222222222222222222222222222222222222222,102,8
  ```

  and the page reported `4 recipients / 2 distinct wallets / 2 wallets get more than one`. Random pairing can
  vary; the four-delivery result does not.
- **Fix:** preserve headings/named positions through one RFC-4180-aware serializer, or shuffle semantic
  `{to,id,amount}` rows and regenerate canonical input. Assert semantic equality before/after Shuffle for
  numeric metadata and documented Moralis/Alchemy `owner_address,token_id,amount` rows.

### B-2 — Apply Weight drops quoting and can replace the NFT id

- **Basis:** demonstrated in the shipped page.
- **Location:** `web/index.html:1878-1944`; `setQty` parses a quoted row then writes `cells.join(',')` at
  lines 1912-1916.
- **Trigger:** after holder controls are exposed, use an ERC-721 headed CSV with a quoted comma field plus
  `tokenId` and `amount`, then apply a flat weight. The user can fetch holders, then paste/edit the box.
- **Result/cost:** the CSV reader correctly makes `"123,456"` one cell, but the writer emits it unquoted. The
  unchanged header then points `tokenId` at `456`. A different owned/approved NFT can be sent. The confirmation
  discusses only quantity and does not disclose the id change.
- **Minimal reproduction:** start with:

  ```csv
  address,label,tokenId,amount
  0x1111111111111111111111111111111111111111,"123,456",7,1
  ```

  It parses as one recipient with id 7. Set “How many each” to 3 and accept **Apply to the list**. Exact output:

  ```csv
  address,label,tokenId,amount
  0x1111111111111111111111111111111111111111,123,456,7,3
  ```

  The next parse uses token id 456, not 7.
- **Fix:** use a shared serializer that quotes delimiter/quote/newline/edge-whitespace cells and doubles quotes;
  preferably mutate parsed semantic records and assert only the requested quantity field changes.

### B-3 — Check gives an unqualified green verdict after dropping another request

- **Basis:** demonstrated with deterministic mocked RPC/explorer answers.
- **Location:** `web/check.html:1248-1294` puts unsupported entries in top-level `refused`;
  `web/check.html:1335-1341` counts only accepted requests; `web/check.html:1375-1380` does not include top-level
  refusals in `req.unread`; `web/check.html:1495-1499` emits the unqualified green card.
- **Trigger:** paste a JSON array containing an unsupported signing method and one valid `wallet_sendCalls`; the
  readable call simulates successfully.
- **Result/cost:** Check shows “Part of that request was not read” and then green “run in order, every call
  succeeds,” without request numbering or “as read here.” A user can take the final green statement as a verdict
  on the pasted JSON despite an omitted signing request.
- **Minimal reproduction input:** 

  ```json
  [
    {"jsonrpc":"2.0","id":1,"method":"personal_sign","params":["0xdead","0x000000000000000000000000000000000000dead"]},
    {"jsonrpc":"2.0","id":2,"method":"wallet_sendCalls","params":[{"version":"2.0.0","chainId":"0xb626","from":"0x000000000000000000000000000000000000dead","atomicRequired":true,"calls":[{"to":"0x0000000000000000000000000000000000000721","data":"0x06fdde03"}]}]}
  ]
  ```

  Observed text contained both `Part of that request was not read` / ``personal_sign` is a method this page
  does not read` and `run in order, every call succeeds`; it did not contain `every call succeeds — as read
  here`.
- **Fix:** any top-level refusal must taint the whole paste. Say “accepted request 2 succeeds as read here; no
  verdict on the pasted set,” preserve original numbering, and test mixed supported/unsupported arrays.

### B-4 — The live BulkSend page is not the reviewed page

- **Basis:** demonstrated against the public origin using read-only HTTP.
- **Location:** expected equality at `.github/workflows/integrity.yml:36-57`; current source disclosure at
  `web/index.html:159-165`; current gas wording at `web/index.html:2155-2165,2217-2235`.
- **Trigger:** visit `https://rhairdrop.gmgnrepeat.com/`.
- **Result:** served SHA-256 was
  `7d557aa114cae2c357e79fe1721ba7c6634eff6a5aa75d0c14f5143e91062238`; reviewed source was
  `38d79b1dd1509e6b51f9cb228ad2d91106c968fb36b7dff0ef79bb7a01b32563`. Repository-history hashing identifies
  the live body exactly as commit `790c9b5`. Live Check and `/wc.js` did match this commit.
- **User consequence:** live BulkSend still describes a finite survey maximum as “at most”/a real upper bound,
  calls the explorer “the final word,” and lacks `f5b7614`'s explicit warning that its one RPC can be stale or
  wrong. These are precisely the material wording changes `f5b7614` relies on.
- **Cost:** testnet users receive known overstated assurances; a claim that current reviewed bytes are deployed
  is false. Enabling mainnet in this state would publish stale/unreviewed transaction-building code to mainnet
  users.
- **Reproduction:** 

  ```sh
  curl -sSL --max-time 30 https://rhairdrop.gmgnrepeat.com/ | sha256sum
  sha256sum web/index.html
  diff -u web/index.html <(curl -sSL --max-time 30 https://rhairdrop.gmgnrepeat.com/)
  for c in $(git rev-list --all -- web/index.html | head -30); do
    git show "$c:web/index.html" | sha256sum
  done
  ```

- **Fix:** first fix B-1/B-2 and review a new commit, then publish exactly that artifact through the guarded
  path and require the external integrity workflow green. Merely publishing `f5b7614` would publish its list
  blockers.

## Should-fix findings

### S-1 — Picker and parser still disagree when an ERC-721 file names id and amount

- **Basis/location:** reasoned from deterministic readers. `parseList` uses `tokenId` and ignores `amount` for
  ERC-721 (`web/index.html:1124-1143`), while `deliveriesOn` returns `amount` whenever it exists
  (`web/index.html:1473-1495`).
- **Trigger/cost:** `address,tokenId,amount` with `wallet,7,3` parses as one NFT but expands to three picker
  slots. **Choose which ones** can rewrite one documented delivery into three. This requires another explicit
  curation action, so it is below B-1, but it is the shared-reader defect family v13 claimed to close.
- **Fix:** if `col.id` exists, count the named id cell(s), never `qty`; assert picker count equals parsed rows for
  every documented header shape.

### S-2 — Guard probes copy unbounded returndata

- **Basis/location:** reasoned from Solidity low-level call allocation at
  `src/BulkSend.sol:396-407,427-429,451-466`.
- **Trigger/cost:** the selected token returns a huge successful payload to `supportsInterface`,
  `isApprovedForAll`, or `ownerOf`. Dynamic `bytes memory` copies it fully before `ret.length == 32` rejects it,
  potentially consuming all gas and reverting before transfers. Assets remain safe, but transaction gas is
  lost; the “about 10,000 gas” statement at lines 448-450 is not bounded for hostile tokens.
- **Fix:** assembly `staticcall` into a fixed 32-byte output area, inspect `returndatasize`, then decode; test
  oversized success/revert data on every guard selector.

### S-3 — Historical-probe enforcement is one-way and count-only

- **Basis/location:** demonstrated set comparison and source at `verify.sh:64-81,101-142`; baseline
  `test/findings-baseline.json`.
- **Trigger/cost:** it loops only current glob matches. New unlisted files fail, but deleted/renamed baseline
  files are never checked. A simulated deletion of `Audit13.t.sol` left baseline key `Audit13` unvisited. Counts
  also let one closed defect reopen while another probe disappears/fixes if totals cancel; contract counts below
  baseline pass (`verify.sh:112-118`). This weakens CI evidence, not runtime directly, and contradicts the
  stronger README claim (`README.md:231-243`).
- **Fix:** exact equality of discovered files and baseline keys both ways, plus per-test stable identifiers and
  expected status rather than aggregate counts. Decrease/deletion/rename must require reviewed baseline change.

### S-4 — “Last” bytecode step can hide connector reproducibility

- **Basis/location:** workflow order at `.github/workflows/tests.yml:49-80`.
- **Trigger/cost:** when source is ahead of testnet deployment, bytecode at line 53 intentionally fails and the
  connector rebuild at line 67 is skipped. The comment says bytecode is “Last, on purpose,” but it is
  penultimate, recreating its stated evidence-hiding problem for signing-page supply-chain evidence.
- **Fix:** run connector before bytecode or make independent gates continue/aggregate; keep bytecode literally
  last if documented as last.

### S-5 — Invariant suite overstates approval-withdrawal coverage

- **Basis/location:** `test/Invariants.t.sol:8-17,34-43,90-108`; public claim
  `docs/status.md:45-48,96-103`.
- **Trigger/cost:** property 3 says nothing moves after approval withdrawal across all three paths, but the
  handler toggles only ERC-721/1155. ERC-20 gets unlimited approval in the constructor and never revokes it. The
  2,304-call count is real (`foundry.toml:21-25`), but none covers ERC-20 withdrawal. This is an evidence
  overclaim, not a demonstrated contract defect.
- **Fix:** model ERC-20 allowance revocation in strict/lenient paths and assert no movement, or narrow the claim.

### S-6 — README review and gate counts are stale

- **Basis/location:** `README.md:30-33` says two mainnet conditions while `docs/status.md:14-21` lists four;
  `README.md:247-256` says twelve rounds while `docs/status.md:249-260` and
  `docs/for-reviewers.md:126-143` say thirteen.
- **Cost/fix:** the front-door release description understates remaining gates and review history. Update from a
  canonical source in the same commit as status.

### S-7 — Check omits the single-RPC trust boundary from its page

- **Basis/location:** `web/check.html:84-87` versus `SECURITY.md:40-45` and `web/index.html:159-162`.
- **Trigger/cost:** every result uses one RPC, but Check says only that data is read “from the chain and from the
  block explorer.” A stale/dishonest node can give false state/simulation answers; the explorer is not an
  independent proof and is not used for every conclusion.
- **Fix:** show the same single-node/staleness warning in Check and implement the production provider plus
  independent fallback/monitor already required before mainnet.

## Inherent and operational limits

1. **Standard detection is heuristic.** A conforming ERC-721 has ERC-165 and `isApprovedForAll`; a hand-rolled
   nonconforming NFT with neither can pass the ERC-20 guard when endpoint probe ids are dead. An ERC-20 with a
   permissive fallback returning canonical 0/1 can be conservatively refused. A genuine hybrid is deliberately
   refused because colliding `transferFrom` meaning cannot be safe generically.
2. **A token and sole RPC can lie.** Success, balance/owner reads, events, and simulation are evidence, not proof
   of honest token behavior. RPC failover reduces node risk but cannot make a malicious token honest.
3. **The journal is browser-local.** Another browser/device, cleared storage, or private mode cannot inherit it.
   Current BulkSend source discloses this; users must reconcile chain/explorer evidence before releasing rows.
4. **Lenient gas is policy.** A legitimate expensive receiver can exceed a stipend and be skipped; strict mode
   removes the stipend but lets one bad recipient revert the batch. No threshold proves honesty.
5. **Directly sent assets/ETH cannot be prevented or rescued.** “Holds nothing” describes the architecture, not
   a guarantee against direct token transfers or forced ETH. `SECURITY.md` correctly warns direct assets are
   unrecoverable.

## Examined areas found sound

- **v13 guard:** `_mustNotBeNft` checks ERC-721 ERC-165, the standard operator selector, and both endpoint ids.
  The read-only mainnet fork accepted 20/20 sampled ERC-20s, accepted 20/20 ERC-721s through `_mustBeNft`, and
  refused 20/20 through the ERC-20 guard. Saved v12 logic let 20/20 through with token-like amounts, showing the
  fix is material. I found no conforming-NFT bypass.
- **ERC-1155 matrix:** conforming ERC-1155 is refused by ERC-20's operator probe, fails the ERC-721 guard, and its
  five-argument selector does not collide. Hybrid/fallback contracts remain the disclosed heuristic limit.
- **Transfer results/reentrancy:** lenient transfer calls cap gas/returndata; unexpected NFT returndata and
  ambiguous ERC-20 success revert instead of becoming retryable. The transient lock prevents nested authentic
  BulkSend events; receipt parsing requires correct token/sender/standard, one summary, matching totals, and
  one-to-one skipped rows.
- **Recovery/double-pay direction:** both send paths persist hashless pending rows before asking the wallet
  (`web/index.html:3106-3145,3207-3255`). Only recognized rejection, definite off-chain failure, or full revert
  releases; unknown/pending/partial/missing-id/replacement ambiguity/RPC failure holds. Delivery and pending
  release commit together. Web Locks and same-tab state cover concurrent starts. I found no demonstrated
  ordinary reload/error double-pay path.
- **Numbers/gas in reviewed source:** `BigInt`/`parseUnits`, precision/zero/destination checks are sound. Current
  source labels cost estimate/fallback and denies a ceiling. B-1/B-2 occur during later serialization.
- **Check per-request handling:** malformed calldata/destination/chain/sender/required 5792 fields/capabilities
  and all 15 contract errors have cautious wording. B-3 is the cross-request composition gap.
- **Transport/artifacts:** live Check and `wc.js` matched. Both roots sent HSTS and CSP with
  `frame-ancestors 'none'`. Testnet BulkSend runtime was byte-identical at 9,752 bytes. Mainnet remained off.

## Harness weaknesses

- `verify.sh` has the missing-file and count-cancellation weaknesses in S-3.
- Browser coverage did not include lossless semantic round trips for each writer in `docs/readers.md`; tests
  checked wallet survival but missed numeric/quoted metadata becoming ids.
- Check tests covered unread fields within one accepted request but not top-level accepted+refused composition.
- Mainnet fork coverage is valuable but sampled (20+20), does not exercise permissive fallbacks, giant return
  data, hand-rolled nonconforming NFTs, or hybrids.
- Invariants use honest OZ fixtures and never revoke ERC-20 allowance (S-5); they are not adversarial-token proof.
- Preflight confirms each custom error name has non-empty page wording, not that the wording is semantically
  correct; the human/browser tests remain necessary.

## Commands and evidence

```sh
git status --short --branch
git rev-parse HEAD main origin/main
# clean; all => f5b76145a6de3a84cc66be9b6cae78b316487de7

./preflight.sh
# all checks ok; Preflight clean

/home/arson/.foundry/bin/forge test --match-path 'test/fork/MainnetGuards.t.sol' -vv
# 4 passed; 20/20 ERC-721 accepted as NFT and refused as ERC-20;
# 20/20 ERC-20 accepted; saved v12 guard let 20/20 through

curl -sSL --max-time 30 https://rhairdrop.gmgnrepeat.com/ | sha256sum
sha256sum web/index.html
curl -sSL --max-time 30 https://rhcheck.gmgnrepeat.com/ | sha256sum
sha256sum web/check.html
curl -sSL --max-time 30 https://rhairdrop.gmgnrepeat.com/wc.js | sha256sum
sha256sum web/wc.js
# BulkSend mismatch; Check and wc.js match

curl -sSI --max-time 30 https://rhairdrop.gmgnrepeat.com/
curl -sSI --max-time 30 https://rhcheck.gmgnrepeat.com/
# HSTS and CSP present; CSP includes frame-ancestors 'none'

# read-only eth_getCode at deployments.testnet.json BulkSend, compared to
# out/BulkSend.sol/BulkSend.json deployedBytecode.object
# 9,752 bytes each; exact equality
```

B-1 through B-3 used `node --input-type=module` Playwright snippets loading the actual pages. Exact inputs and
outputs are above. Check routed every RPC/explorer request to deterministic local mocks; no live chain was used.

One combined `./preflight.sh && ./verify.sh` was intentionally stopped after about eight minutes at the audit
coordinator's request. Before interruption it established Forge **130 passed, 9 expected probe failures** and
CSP **21 passed, 0 failed**. Its browser-suite result is not claimed. Separately, GitHub's public API reported
the exact-commit `suite` for `f5b7614` successful:
`https://github.com/SRHSoulja/robinhood-chain-tools/actions/runs/34566789267/job/103160450934`.
That green result does not contradict focused untested-shape reproductions, and S-3 explains why it is not proof
that every historical probe remains present.

Final worktree state was `## main...origin/main`. No project file was modified.
