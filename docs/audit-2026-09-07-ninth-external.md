# Independent correctness, safety, and site-security reaudit — round nine

Reviewed code/configuration commit: `595ac039b4d54b51865f7643ae211d90962299d6`

Date: 2026-09-07

## Release bar and verdict

For public software handling real value, release-ready means the exact sender, chain, method, call bytes,
call boundaries, recipients, values, ordering, and atomicity shown to the user are what the wallet will execute;
uncertain delivery can never become either a false success or a repeat payment; shared-state coordination must
fail closed while a send is in flight; and the reviewed source, reproducible dependencies, deployed pages, and
deployed runtime must form one verifiable chain. Browser, wallet, explorer, and hostile-contract limits must be
stated beside the decision they qualify.

**Verdict: do not release this commit for real-value use.** Four findings block release. Three are manifestations
of one underlying Check boundary error: the parser infers semantics from object
shape and aliases instead of dispatching by method and validating that method's schema. It can consequently
simulate a different sender, different calldata, or different transaction than a wallet. The fourth is in the
new delivery-lock fix: a WalletConnect disconnect can change the run key after the lock is captured, put a paid
row in the anonymous ledger, delete its pending journal, and make it payable again when the sender reconnects.

This target is nevertheless substantial progress over the eighth audit. Its three exact Check regressions, the
two-run lock deadlock, publisher self-mutation, ordinary-path HSTS failure, push-workflow runtime comparison, and
test-workflow reproducibility issues are fixed. The publisher's connector-origin ordering fix is incomplete,
the scheduled workflow still selects moving Foundry `stable`, and public review claims remain stale.

The contract remains clean and unchanged since `3700331`; this is a fifth consecutive round with no new
Solidity finding. All 248 claimed tests pass (82 Forge and 166 browser). The live pages and connector match this
target byte-for-byte, the connector independently rebuilds to the reviewed digest, and deployed runtime is
byte-for-byte identical to the build. The mainnet gate remains intact. No transaction was signed or sent.

## Scope and method

The checkout is `82f01f5`, one documentation-only commit beyond the requested target; its only addition was the
previous round's `AUDIT.md`. All reviewed executable and configuration files are exactly those at `595ac03`.
Scope included the rewritten Check input and simulation boundary, delivery ledger and snapshot binding,
WalletConnect build/publication chain, publisher, both workflows, documentation claims, `src/BulkSend.sol`,
tests, and both live sites. `lib/` and `src/research/` were excluded as requested.

Evidence included source-level state/concurrency traces; direct execution of the exact `readInput` function
extracted from `web/check.html`; both repository suites; an independent WalletConnect rebuild; live response
body/header checks; local-versus-chain runtime comparison; the final
[EIP-5792 specification](https://eips.ethereum.org/EIPS/eip-5792); the pinned Foundry action's source; current
GitHub run results; and CSP/SRI recomputation. No key was accessed and no live transaction was submitted.

## Previous finding remediation

| Eighth-audit item | Status at `595ac03` |
|---|---|
| B-01, call sender overrode an envelope sender | **Exact case fixed.** An envelope sender now wins and conflict is shown. An optional envelope plus an invalid call sender still chooses the call sender; see B-01. |
| B-02, separate JSON-RPC requests became one sequence | **Exact case fixed.** Top-level boundaries remain separate. Method semantics are still inferred from parameter shape; see B-03. |
| B-03, non-atomic wording promised an outcome | **Cleared.** The displayed range now includes partial execution, atomic execution, and refusal. |
| S-01, different run locks deadlocked | **Cleared for stable run identities.** Global reconciliation occurs before the send lock. A WalletConnect disconnect can still change the key under that lock; see B-04. |
| S-02, Worker activated before connector origin | **Ordering changed, chain still open.** The origin hook receives only HTML and is not required to publish/verify the connector; see S-02. |
| S-03, unreadable chain defaulted to selected chain | **Exact case fixed.** Unreadable values are refused. Other noncanonical/missing required fields are normalized; see S-01. |
| S-04, publisher mutated source after dirty check | **Cleared.** It now refuses a stale CSP rather than rewriting tracked HTML. |
| S-05, runtime step compared only lengths | **Cleared.** The push workflow compares exact bytes. |
| S-06, mutable test-workflow inputs | **Cleared in `tests.yml`.** Foundry and Node are exact and installs use lockfiles. The integrity workflow still uses moving Foundry `stable`; see S-05. |
| S-07, stale review history | **Partly fixed.** README was corrected; Security and the reviewer guide still disagree with the repository; see S-06. |
| S-08, arbitrary HTTPS errors omitted HSTS | **Ordinary paths fixed.** Unknown paths now receive hardened 302 responses. A reachable Check 400 and connector failure paths still omit the headers; see S-04. |

## Blocks release

### B-01 — An optional envelope lets a nonexistent call sender replace the actual wallet sender

- **Severity/category:** High — blocks release
- **Evidence:** Demonstrated with the exact shipped parser; propagation into both simulation paths reasoned from source
- **Location:** `web/check.html:1004-1017` and `web/check.html:1077-1086`
- **Exact input/state:** The selected wallet account is A. Paste this request, whose envelope legitimately omits
  optional `from` but whose call contains the non-EIP field B:

  ```json
  {
    "jsonrpc":"2.0",
    "id":1,
    "method":"wallet_sendCalls",
    "params":[{
      "version":"2.0.0",
      "chainId":"0xb626",
      "atomicRequired":true,
      "calls":[{
        "to":"0x3333333333333333333333333333333333333333",
        "from":"0x2222222222222222222222222222222222222222",
        "data":"0x06fdde03"
      }]
    }]
  }
  ```

  The extracted parser returned envelope `from:null`, `conflictingSenders:0`, and call `from:B`. Line 1085 then
  keeps B rather than filling the selected sender A. Ordered and per-call simulation therefore run as B.
- **Why execution differs:** EIP-5792 call tuples contain `to`, `data`, `value`, and optional capability
  metadata, not `from`. If the envelope omits `from`, the wallet should let the user view/select it. A wallet
  ignoring the unknown call field executes as A; a strict wallet rejects the malformed request. Neither executes as B.
- **User cost:** A destination can be harmless for B while using A's ownership, approvals, balances, or roles
  to move assets. Check can give A a green ordered result for the path belonging to B, and A can lose approved
  tokens or privileged assets after acting on it.
- **Reproduction:** Extract `readInput` from lines 989-1051, run it on the JSON, and inspect
  `requests[0].calls[0].from`. In a browser RPC mock, assert every `blockStateCalls[0].calls[*].from` is A or
  that the request is refused. The existing regression at `test/web/check.test.mjs:569-583` covers only the
  case where the envelope itself names A.
- **Fix/clear condition:** Dispatch and validate the EIP-5792 schema. Reject every call-level `from`. If the
  envelope omits `from`, require a valid sender in the page's sender box and apply that one sender to all calls,
  while saying it was supplied by the reader rather than the request. Add the optional-envelope regression.

### B-02 — `input` inside an EIP-5792 call is silently reinterpreted as executable `data`

- **Severity/category:** High — blocks release
- **Evidence:** Demonstrated with the exact shipped parser; wallet behavior follows the EIP-5792 tuple
- **Location:** `web/check.html:1004-1017`
- **Exact input/state:** Paste a `wallet_sendCalls` request with a call such as:

  ```json
  {
    "to":"0x3333333333333333333333333333333333333333",
    "input":"0x06fdde03"
  }
  ```

  inside an otherwise valid envelope. There is no `data`. The demonstrated parse changes this into
  `data:"0x06fdde03"` and Check simulates/renders those bytes.
- **Why execution differs:** `input` is not an EIP-5792 call field. A wallet that ignores unknown properties
  sends empty calldata; one enforcing the request schema rejects it. Check instead borrows a transaction-object
  alias and answers for nonempty calldata. A contract can make `name()` harmless while its empty-calldata
  receive/fallback path uses an existing allowance to drain the sender.
- **User cost:** The page can display a successful harmless function while the wallet executes a value-moving
  fallback. The loss is whatever the sender has approved or otherwise exposed to that destination.
- **Reproduction:** Execute the extracted `readInput` on an envelope containing the call above. Current output
  has `data:"0x06fdde03"`; a correct parser refuses it or keeps canonical `data:"0x"`. The canonical test at
  `test/web/check.test.mjs:465-478` never substitutes `input` for `data`.
- **Fix/clear condition:** Make aliases method-specific. `wallet_sendCalls` must read only EIP-5792 fields and
  reject unknown fields that can change the interpretation; `input` may be supported only for transaction
  objects where its semantics are defined. Add a test proving the simulated bytes equal canonical `data`.

### B-03 — A standard transaction carrying a `calls` property is replaced by those inner calls

- **Severity/category:** High — blocks release
- **Evidence:** Demonstrated with the exact shipped parser
- **Location:** `web/check.html:1004-1037`
- **Exact input/state:** Paste this JSON-RPC request, using a complete unlimited-approval payload as `data`:

  ```json
  {
    "jsonrpc":"2.0",
    "id":3,
    "method":"eth_sendTransaction",
    "params":[{
      "from":"0x1111111111111111111111111111111111111111",
      "to":"0x3333333333333333333333333333333333333333",
      "data":"0x095ea7b30000000000000000000000004444444444444444444444444444444444444444ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      "calls":[{
        "to":"0x5555555555555555555555555555555555555555",
        "data":"0x06fdde03"
      }]
    }]
  }
  ```

  `asRequest` sees the `calls` array before it considers `method`. The demonstrated result discards the outer
  token address and approval bytes, constructs a batch containing only the benign inner call, and labels that
  batch `method:"eth_sendTransaction"`.
- **Why execution differs:** `eth_sendTransaction` sends the outer transaction object; `calls` belongs to
  `wallet_sendCalls`, not this method. A strict wallet/node rejects the extra field. A wallet that sanitizes or
  ignores it executes the outer approval. Check does neither: it invents an EIP-5792-like envelope from shape.
- **User cost:** The user can act on a benign inner-call answer while granting a spender unlimited access to
  the outer token balance. That standing approval can cost the full balance.
- **Reproduction:** Run the extracted parser and verify that current output names only
  `0x5555…5555/0x06fdde03`. A browser regression should assert method dispatch preserves the outer `to/data` and
  never places the inner call in `eth_simulateV1`. The existing test at `test/web/check.test.mjs:586-600`
  proves two ordinary transaction requests stay separate; it does not prove that the method determines schema.
- **Fix/clear condition:** Dispatch on a strict allowlist before examining parameter shape. Parse exactly one
  transaction object for `eth_sendTransaction`, one EIP-5792 envelope for `wallet_sendCalls`, and refuse
  unsupported/malformed methods. Add mixed-method and conflicting-shape regressions.

### B-04 — WalletConnect disconnect can record a paid row under `anon` and release it for payment again

- **Severity/category:** High — blocks release
- **Evidence:** Source-level asynchronous event trace
- **Location:** `web/index.html:342-345`, `web/index.html:714-722`, `web/index.html:1790-1811`,
  `web/index.html:1910-1959`, and `web/index.html:1969-2031`
- **Exact input/state:** Connect account A through Phone wallet. Start a one-row send, so `lockedRun` is A's run
  and a pending record is created. After the receipt/call status is confirmed but while the public-RPC
  `confirmArrival` check is outstanding, disconnect the WalletConnect session. Its event handler clears `me`
  even though `sending` is true. When arrival returns, `commitDelivered(runKey(), ...)` recomputes the key as
  `anon`, writes the paid row there, and deletes A's pending record.
- **Why the lock does not save it:** The exact-run bypass correctly sees that A's lock is held only when passed
  A. Here it is passed `anon`, so it acquires another lock while still holding A's and commits to the wrong
  ledger. The same recomputation appears in both BulkSend and wallet-batch paths. The extension
  `accountsChanged` handler avoids this by not changing `me` while sending; WalletConnect `disconnect` does not.
- **User cost:** Reconnect/reload as A. A has neither a delivered key nor a pending journal for the row, so it
  is offered and can be paid a second time. The cost is the full duplicated transfer; two tabs can also acquire
  A/anon locks in opposite order and hang.
- **Reproduction:** In the browser mock, delay the recipient holding read, send one confirmed transfer through
  a mock WalletConnect provider, emit `disconnect`, then release the holding read. Assert the delivered key is
  under A, no `:anon:` ledger is created, and reconnecting A suppresses the row. Current source fails those
  assertions. No live transaction was sent to demonstrate this.
- **Fix/clear condition:** Freeze a run context once: `lockedRun`, sender, chain, token, standard, and rows. Use
  `lockedRun` for every `addPending` and `commitDelivered`, and use the frozen sender when checking receipts.
  During an active send, a WalletConnect disconnect should set `stopFlag` but must not mutate that context until
  the current transaction is safely journaled/settled. Add the disconnect-during-arrival regression.

## Should be fixed but does not block release by itself

### S-01 — Malformed request members are coerced or silently dropped instead of invalidating the answer

- **Severity/category:** Low — should be fixed but does not block
- **Evidence:** Demonstrated with the exact parser and checked against EIP-5792 schema/error requirements
- **Location:** `web/check.html:1004-1039` and `web/check.html:1089-1108`
- **Exact inputs/state:** `atomicRequired:"false"` becomes boolean `true`; numeric `chainId:46630` is accepted
  instead of the required prefixed hexadecimal string; missing required chain/atomic fields are treated as no
  restriction/false; and `[ {"to":"0x3333…3333","data":"0x06fdde03"}, null, "junk" ]` becomes one clean
  call because invalid members are skipped.
- **User cost:** A conforming wallet should reject schema-invalid EIP-5792 input with invalid params, so these
  cases do not themselves execute value. The page nevertheless gives a confident answer for a request no
  standards-compliant wallet is required to execute, and a corrupted plain list looks complete.
- **Reproduction:** Run `readInput` on those values. The demonstrated outputs have `atomicRequired:true`, accept
  the numeric chain, and contain no trace of `null`/`"junk"`.
- **Fix:** Schema-validate required types and canonical hex before normalization. If any member of a claimed
  request/list is invalid, keep its index and withhold the request-level verdict rather than dropping it.

### S-02 — The reordered origin hook still has no connector artifact to publish or verify

- **Severity/category:** Medium — should be fixed but does not block
- **Evidence:** Source-level publication trace
- **Location:** `deploy/publish.sh:17-18`, `deploy/publish.sh:86-107`, and `deploy/publish.sh:191-227`
- **Exact state:** Change `web/wc.js` from H1 to H2 and publish `airdrop` with `WC_BUNDLE_URL` plus the documented
  `ORIGIN_PUBLISH_CMD`. The hook now runs before the Worker, but receives only the HTML source and target name.
  Nothing passes it `web/wc.js`/H2 or verifies `WC_BUNDLE_URL?v=H2` before the Worker carrying H2 is activated.
  If that URL still serves H1, live `/wc.js` becomes 502 until the external origin is updated. Post-publish
  verification detects the outage only after activation.
- **User cost:** WalletConnect disappears for phone-wallet users during the gap. Digest enforcement fails
  closed, so unreviewed JavaScript is not served and funds are not redirected.
- **Reproduction:** Use a staging origin that keeps H1 while the local committed bundle is H2; make the origin
  hook successfully copy only the HTML. Publish and request `/wc.js`.
- **Fix:** Make connector publication an explicit hook input/step, then fetch the exact digest-keyed origin URL
  and compare H2 before Worker PUT. Alternatively upload versioned immutable bundles and activate only after
  the required digest is reachable.

### S-03 — Publisher preconditions test presence, not one exact policy/digest invariant

- **Severity/category:** Low — should be fixed but does not block
- **Evidence:** Source-level condition evaluation; current files separately verified exact
- **Location:** `deploy/publish.sh:57-104`
- **Exact states:** (1) Put the current CSP hash anywhere in the meta policy while leaving a second stale
  `sha256-…` source in `script-src`; `if want not in policy` passes and the stale inline script remains
  authorized. (2) Commit an empty `web/wc-build/EXPECTED-SHA256`; the nonempty guard skips comparison and pins
  whatever committed `web/wc.js` happens to contain.
- **User cost:** Neither state exists now, and CI catches the empty expected digest. The cost is weakened
  publication assurance: an older authorized inline payload can run if it is injected, or an accidental bundle
  change can be published before the failing CI is noticed.
- **Reproduction:** Evaluate lines 75-83 with a policy containing both `want` and an old hash; evaluate lines
  96-103 with `EXPECTED=""`. Both continue. Current pages each have exactly one correct hash, and current
  expected/file/rebuild digests all agree.
- **Fix:** Parse `script-src` and require its hash-token set to equal `{want}`. Require expected digest to match
  `^[0-9a-f]{64}$` and equal `WC_SHA256`; absence or emptiness must fail.

### S-04 — Reachable Worker error responses still omit HSTS and all common hardening headers

- **Severity/category:** Low — should be fixed but does not block
- **Evidence:** Demonstrated live for Check 400; reasoned from generated Worker for connector 404/502
- **Location:** `deploy/publish.sh:118-150`; live `https://rhcheck.gmgnrepeat.com/x/46630/a..b`
- **Exact state:** The live path above returns HTTP 400 with no HSTS, `nosniff`, referrer policy, or COOP. The
  `/wc.js` not-configured, upstream-error, and digest-mismatch branches likewise construct bare 404/502
  responses. Normal roots, connector success, and unknown-path 302s are hardened.
- **User cost:** A first authenticated visit to such an error path does not prime HSTS, contradicting the
  every-response promise. An already stored HSTS policy is not removed, and no replacement path for a healthy
  page was found.
- **Reproduction:** `curl -sS -D - -o /dev/null https://rhcheck.gmgnrepeat.com/x/46630/a..b` returns 400 without
  `strict-transport-security`; compare either live root or an arbitrary unknown path.
- **Fix:** Apply `secure()` to every locally constructed response, including failure responses, and enforce the
  headers at the zone if Cloudflare strips Worker headers on errors. Monitor root, `/wc.js`, unknown, 400, and
  a controlled connector-failure response.

### S-05 — The scheduled integrity build still selects moving Foundry `stable`

- **Severity/category:** Low — should be fixed but does not block
- **Evidence:** Workflow review plus pinned action source fetched from its exact commit
- **Location:** `.github/workflows/integrity.yml:76-91`
- **Exact state:** Unlike `tests.yml`, the integrity workflow gives `foundry-toolchain` no `version`. At pinned
  action commit `908c540…`, the default is `stable`, which installs the latest stable Foundry at run time.
- **User cost:** A toolchain release can alter compiler/build behavior and make monitoring fail or, less likely,
  agree for reasons not reproduced by the tested toolchain. Permissions are only `contents:read`, so this is
  assurance drift, not a route into production.
- **Reproduction:** Inspect the workflow and the action's
  [pinned `action.yml`](https://github.com/foundry-rs/foundry-toolchain/blob/908c540300062bd5a7e473851cdb4282204cee09/action.yml);
  its `version.default` is `stable`.
- **Fix:** Add `with: { version: v1.4.1 }` here too, or centralize the exact version used by both jobs.

### S-06 — Public audit/provenance documentation remains stale and internally wrong

- **Severity/category:** Low — should be fixed but does not block
- **Evidence:** Documentation/source comparison
- **Location:** `SECURITY.md:42-46`, `docs/for-reviewers.md:76-79`, and `docs/for-reviewers.md:103-108`
- **Exact state:** Security still calls the first external audit “the last audit in full.” The reviewer guide
  says the eighth report had `3 blocking/8/3`, but its headings contain five inherent limits. It also says the
  publisher “corrects” a stale CSP file, while the fixed publisher now refuses it.
- **User cost:** Reviewers can stop at the oldest threat model or misunderstand both the current publication
  behavior and audit history. It does not change execution.
- **Reproduction:** Follow Security's link; count `I-01` through `I-05` in the eighth report; compare the CSP
  statement with `deploy/publish.sh:78-83`.
- **Fix:** Point Security to the reviewer guide and newest full audit, correct the eighth count to `3/8/5`, and
  say `web/sync.sh` updates hashes while publication verifies/refuses drift.

## Inherent limits and required wording

### I-01 — Browser-local duplicate protection is not a payment registry

`localStorage` cannot coordinate another profile, device, origin, cleared cache, restored backup, or deliberate
“Forget” action. Current UI/README disclose this. Keep wording beside Send/release: “This browser's record
prevents accidental repeats here; the chain/explorer is the cross-device record.” A global guarantee needs a
shared service or on-chain state. B-04 is not inherent because it loses protection inside the promised one
browser/run boundary.

### I-02 — A token supplies evidence about its own state and events

Before/after holdings and receipt events are strong evidence for conventional tokens, but hostile code can lie
in `ownerOf`/`balanceOf`, emit false events, accept a call while moving less/nothing, or let an unrelated balance
change resemble arrival. Keep: “The token reports this balance/event; an untrusted token can lie. Verify the
transaction and actual asset state.” The contract appropriately treats ambiguous ERC-20 return bytes as a full
revert rather than a skip.

### I-03 — Explorer holder reads are not block-pinned snapshots

The explorer can lag, omit/change pages during pagination, or disagree with the surrounding RPC blocks. The
page now correctly calls this “the explorer's latest indexed list,” says it was read across pages while the
chain moved, and binds collection/chain/block/holdings/wallets together. Keep that language beside weighting and
always require review of the exact exported allocation.

### I-04 — Check cannot prove intent or future execution state

Even with a correct parser, simulation describes one sender and one present chain state. Time, balances,
approvals, preceding transactions, ordering, builders, and upgradeable implementations can change before
execution. Verified source and familiar selectors do not prove intent. Keep the current “right now” and
unverified/proxy warnings; the parser blockers must clear because those caveats help only after simulation
represents the request being discussed.

### I-05 — No HSTS preload leaves a first-visit downgrade window

HSTS protects after a browser receives it over authenticated HTTPS. Without preload, an initial manually typed
HTTP request on a hostile network can be intercepted before the redirect/header. Preload is registrable-domain-
wide and difficult to reverse, so I agree the deliberate choice is not a blocker. Continue publishing only
HTTPS links; reconsider only if every present and future subdomain can sustain the commitment.

## Areas examined and found sound

- **BulkSend:** 82/82 Forge tests pass. Entry points are nonpayable; no owner, upgrade, fee, rescue, or persistent
  state exists. Transfers originate from `msg.sender`; strict mode is one-transaction atomic; lenient mode
  never labels an ambiguous ERC-20 success as skipped; zero/self recipients, EOA/delegated-wallet token
  addresses, gas starvation, return bombs, and receipt-event reentrancy are handled defensively. No Solidity
  issue was found.
- **Delivery accounting apart from B-04:** The old cross-run deadlock is removed by global reconciliation
  before lock acquisition. For a stable run key, all delivered mutations re-read/merge/write/read back under
  that exact lock before a pending record shrinks. Missing/unreadable/partial/replaced transactions remain held;
  receipt summaries and full skipped tuples are cross-checked; arrival evidence is grouped correctly for
  duplicate recipients. Storage inability fails before signing and a full ledger never evicts silently.
- **List fidelity and atomicity:** Strict mode cannot silently split a wallet batch or omit predicted failures.
  ERC-20 values use `parseUnits` at the token's read decimals; NFT/edition quantities are whole `BigInt`s; zero,
  malformed, rounded, separator-ambiguous, duplicate-id, and checksum-bad inputs are refused or explicitly
  acknowledged. Identical rows keep occurrence keys. The frozen delivery order, transaction boundaries, and
  exact CSV manifest are shown before confirmation.
- **Snapshots:** Collection, chain, approximate RPC block, explorer holdings, and wallet set travel as one
  object; collection/network changes invalidate it. Truncation refuses the list. Current wording accurately
  distinguishes explorer indexing from a chain snapshot.
- **Check outside B-01 through B-03/S-01:** It has no signing or state-writing call. “Use mine” requests an
  account only. Untrusted values are inserted as text, external links use `noopener`, stale lookups are dropped,
  incomplete sequences withhold the all-calls verdict, non-atomic failure language gives the full outcome
  range, and unreadable chain/code/source remains unknown. Nested calls and approvals are recursively exposed
  with raw bytes.
- **Current source/deployment identity:** Live Airdrop SHA-256 is
  `ca6272b0cd50e28b4befb5817223adc8cf529db3d72a92686c854d86db86c920`; live Check is
  `282bdf2a36c196f397bc27589dca24540509481369c78eb645210f64f54212e6`; live connector is
  `d4c35a1b2b743b9f48b781730b171942a31d1b82d992b5d2dbb082b3843064d7`. Each exactly matches source.
  `web/check.js` equals Check's inline script after its intentional enclosing newline.
- **WalletConnect current artifact:** Independent pinned build produced 2,092,782 bytes and the connector
  digest above, matching `web/wc.js`, `EXPECTED-SHA256`, and live `/wc.js`. No `axios`, `form-data`,
  `follow-redirects`, or `proxy-from-env` code/string appears in the bundle. Worker success service hashes
  upstream bytes and fails closed on mismatch; the accepted build-graph advisories are not re-reported.
- **Runtime and mainnet gate:** Local and testnet runtime are both 8,164 bytes, SHA-256
  `a7c05392fa894bcd6ce00eb2930e61f67ca85c9d7109a2b34d983aa213c66db7`, and exactly equal. Explorer reports
  full verification with Solidity 0.8.36, Cancun, optimizer 10,000. `LIVE_CHAINS` contains only 46630; mainnet
  code at the intended address is `0x`; the testnet creator's mainnet nonce is `0x0`.
- **Transport/current CSP:** Both HTTP hosts return same-path 301 on roots, `/wc.js`, unknown paths, and the
  tested Check error route. Both HTTPS roots, successful `/wc.js`, and
  unknown-path 302s carry HSTS (`max-age=31536000; includeSubDomains`) and common hardening. Each page has one
  inline script and exactly one matching SHA-256 source; header CSP equals the meta policy plus
  `frame-ancestors 'none'`; scripts receive no `unsafe-inline`. Ethers 6.13.4's fetched SHA-384 exactly matches
  its SRI. `static.cloudflareinsights.com` remains the documented deliberate exception and is not re-reported.
- **Workflows:** Both action identities are pinned to official-repository commits and both jobs grant only
  `contents:read`; neither has a deploy step, production secret, or wallet key. `tests.yml` pins Foundry v1.4.1
  and Node 22.20.0 and uses `npm ci`; its exact target run succeeded. Runtime comparison now checks equality.
  Integrity's last observed run succeeded, subject to S-05 and its root-only transport coverage.

## Verification record

| Check | Result |
|---|---|
| `forge test` | 82 passed, 0 failed |
| `npm test` | 166 passed, 0 failed (83 Airdrop + 83 Check) |
| Exact parser probes | reproduced B-01, B-02, B-03, and S-01 outputs |
| Independent connector build | exact `d4c35a…064d7` match |
| Live Airdrop / Check / connector bodies | exact source matches |
| Local vs testnet deployed runtime | 8,164 bytes, exact match |
| HTTP transport | both hosts return same-path 301 on root, connector, unknown, and tested error paths |
| Live error transport | Check `400` reproduced without HSTS/hardening |
| CSP | one exact inline hash per page; header/meta agreement; no script `unsafe-inline` |
| Ethers SRI | exact SHA-384 match |
| Mainnet gate | UI disabled; target code empty; creator nonce 0 |
| Workflow target run | tests success at `595ac03`; permissions read-only |
| Syntax/worktree | publisher shell and browser-script syntax checks pass; `git diff --check` clean |

## Release-clear checklist

1. Make Check method-dispatched and schema-validating, then add regressions for an omitted envelope sender plus
   call-level `from`, EIP call `input`, and `eth_sendTransaction` carrying `calls`. Assert the exact sender,
   destination, calldata, value, chain, boundaries, and atomicity reaching simulation.
2. Freeze the send's run context and use `lockedRun` for every pending/delivered mutation. Add a Phone-wallet
   disconnect between confirmation and arrival-read completion; prove the row stays protected under account A
   across reconnect/reload and that no `anon` ledger is touched.
3. Re-run all 248 tests and the focused failing regressions, independently rebuild the connector, compare live
   bodies/runtime again, and keep mainnet disabled until both blocker groups clear.

With those conditions unmet, the source-to-live identity is operationally strong but the user-facing
correctness bar is not met. Do not move the mainnet nonce or describe this target as ready for real value.
