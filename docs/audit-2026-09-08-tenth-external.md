# Independent correctness, safety, and site-security reaudit — round ten

Reviewed commit: `6f4249e41aa399418908c7bc3860f8819e4403e7`

Date: 2026-09-08

## Release bar and verdict

For a public wallet-connected tool handling real value, release-ready means that every recipient, asset,
amount, sender, network, calldata byte, call boundary, and execution guarantee shown to the user is the one
actually checked and signed; untrusted metadata cannot gain execution or uncontrolled resource authority;
uncertain delivery cannot become either false success or repeat payment; and reviewed source, dependencies,
deployment, and runtime remain one independently verifiable chain. Limits inherent to browsers, wallets,
explorers, and hostile contracts must be stated at the decision they qualify.

**Verdict: not ready for a public real-money release.** Three findings block release. The contract and delivery
ledger remain sound in the paths examined, and the ninth-round fixes materially improved the project, but the
new picker can show one collection and prepare another, the new heading heuristic can silently omit an
intended recipient, and the Check page can give a request-wide success verdict after silently accepting an
invalid/incompletely read EIP-5792 request.

The blockers clear when:

1. picker state is keyed to and revalidated against the current chain, account, standard, and token at the
   instant it rewrites the list, with a regression that changes between two ERC-721 contracts after selection;
2. a first non-address row is skipped only when it is positively recognized as a header, or is otherwise
   surfaced as an acknowledged problem, including ENS-like and arbitrary non-`0x` first rows; and
3. the Check reader validates the complete EIP-5792 shape, preserves and explains capabilities, and withholds
   whole-request verdicts whenever a field that a wallet may honor is unread or unsupported.

## Blocks release

### B-01 — High — A picker selection survives a collection change and is applied to the new collection

**Demonstrated in Chromium and confirmed from source.** `web/index.html:920`, `web/index.html:938`,
`web/index.html:1044-1047`, and `web/index.html:1056-1087`.

The picker remembers only `pick.token` when it is loaded. Changing the token input resets parsed rows and starts
a new token lookup, but it neither closes nor invalidates the open picker. `pickUse` never compares the current
token field with `pick.token`; it simply writes the old selected numeric IDs into the recipient list. Token IDs
are scoped to a collection, so “ID 41” from contract A and “ID 41” from contract B are unrelated NFTs.

**Exact trigger and state:** connect a wallet that owns token 41 in ERC-721 contract A; enter one recipient;
open the picker, see A's art, and select 41; change the token field to a second valid ERC-721 contract B; after
B finishes loading, press **Use these** without reopening the picker. My focused browser probe produced:

```text
token  = 0x4444444444444444444444444444444444444444  (B)
before = 0x0000000000000000000000000000000000000941
after  = 0x0000000000000000000000000000000000000941,41
```

The image and name used to make the decision were A's, while the form now means B/41. If the connected wallet
owns B/41, preflight correctly approves that different NFT and the user can transfer it. This is not a stale
preview that merely fails closed; it can send the wrong valuable asset.

**Reproduce:** add a second ERC-721 address to the existing picker mock, select an ID under `NFT`, call
`useToken(page, NFT2, '721')`, press `#pickUse`, and assert that the list is unchanged or a stale-picker error
is shown. That desired assertion fails at this commit. The existing test at `test/web/client.test.mjs:1286`
only checks that two output lines end in digits; it does not assert the chosen IDs or collection identity.

**Fix:** make the picker context an immutable tuple of `{chainId, account, standard, token}`. Clear and close it
on any member changing. Before **Use these**, compare the tuple again and refuse on mismatch. Also generation-
guard asynchronous ID/metadata results so an obsolete load cannot repaint a newer context. Test two contracts
with overlapping IDs, plus chain and account changes.

### B-02 — High — The first intended non-`0x` recipient row is silently discarded as a heading

**Demonstrated in Chromium and confirmed from source.** `web/index.html:628-638`,
`web/index.html:785-795`.

`looksLikeHeading` defines every first line with no cell beginning `0x` as a header. That does recognize unknown
human header text, but it also silently chooses “header” for an ambiguous or invalid data row. This bypasses
`addressProblem`, the problems panel, and the acknowledgement gate.

**Exact input:** with ERC-721 selected and a valid token loaded, check this list:

```text
alice.eth,1
0x0000000000000000000000000000000000000002,2
```

The browser reported `1 recipients`, an empty problems area, no message, and no acknowledgement control.
`alice.eth,1` disappeared. The same `alice.eth` on a later line correctly says that names are unsupported and
asks for the resolved `0x` address. Arbitrary first rows such as `alice-wallet,1` have the same problem.

**Cost:** the user is shown a sendable list smaller than the list they supplied and can complete the airdrop
while Alice receives nothing. Gas is spent and the intended recipient is stranded from that run. This directly
breaks the promise that no row is silently dropped.

**Reproduce:** extend the heading test near `test/web/client.test.mjs:1042` with the two lines above and assert
that the first line appears in `#problems` and blocks sending pending acknowledgement. The current test encodes
the over-broad heuristic as correct by using only obvious prose as its unknown heading.

**Fix:** skip only a header positively identified by `readHeader` or a deliberately bounded set of header
syntax. If an unknown first row cannot be distinguished from data, report the ambiguity as a problem rather
than discarding it. In particular, pass ENS-like text through `addressProblem`.

### B-03 — High — The Check page silently ignores wallet-honored EIP-5792 fields and accepts an invalid schema

**Demonstrated in Chromium and checked against the specification.** `web/check.js:907-969`, especially
`web/check.js:924` and `web/check.js:938-953`; the spliced copy in `web/check.html` is byte-for-byte current.

The current [EIP-5792 RPC specification](https://eips.ethereum.org/EIPS/eip-5792#wallet_sendcalls-rpc-specification)
requires `version`, `chainId`, `atomicRequired`, and `calls`; requires call `value` to be hex; permits a typed
optional `id`; and defines request- and call-level `capabilities`. Capabilities are specifically the mechanism
through which a wallet honors additional semantics, and the EIP says capabilities may override its default
rules.

The reader checks missing/invalid `chainId`, three-state `atomicRequired`, the type of `version` only when it is
present, `from`, call `to`, and call `data`. It does **not** require `version`; validate `id`; validate call
`value`; validate either capabilities object; or even retain capabilities for display. `CALL_FIELDS` causes a
call-level `capabilities` member to be silently accepted and then dropped. Request-level capabilities are also
discarded without a note.

**Exact input:** `window.__check.readInput` was given:

```json
{
  "method": "wallet_sendCalls",
  "params": [{
    "chainId": "0xb626",
    "atomicRequired": true,
    "id": 7,
    "capabilities": "not-an-object",
    "calls": [{
      "to": "0x1111111111111111111111111111111111111111",
      "data": "0x",
      "value": "1",
      "capabilities": "not-an-object"
    }]
  }]
}
```

The returned request had `schemaProblems: []` and `invalidMembers: 0`; all capability and ID fields vanished,
and decimal `"1"` survived as value. With a sender supplied, the UI can proceed to “run in order, every call
succeeds” even though a conforming wallet may reject this request and the page has not interpreted fields a
wallet is allowed to honor.

**Cost:** the read-only page signs nothing, but it can present a malformed or semantically incomplete request
in the same success voice as a completely read request. A user can act on a false whole-request safety and
execution statement—the precise failure the Check page exists to prevent.

**Reproduce:** add the JSON above to `test/web/check.test.mjs` and require a bad schema notice, preservation of
the capability fields, and no ordered all-calls verdict. Existing S-01 cases test `atomicRequired`, numeric
`chainId`, and malformed call members, but not the remaining normative fields.

**Fix:** validate the full `SendCallsParams` and call-member types, including required string `version`, optional
string `id`, hex `value`, and object capabilities at both levels. Preserve every unsupported capability in the
rendered request and withhold the sequence/request verdict unless its effect is understood. Extra parameters
and conflicting aliases should likewise be explicit rather than coerced.

## Should be fixed but does not block release by itself

### S-01 — Medium — The named CSV reader and ID assigner disagree when the address column is not first

**Demonstrated in Chromium.** `web/index.html:639-646`, `web/index.html:691-712`, and
`web/index.html:1367-1384`.

For `label,address` followed by `one,<valid-address>` and `two,<valid-address>`, the named reader correctly
finds two wallets and offers **Assign my token ids**. The assigner then reparses every line positionally and
looks only at `p[0]`; it answers “Put the recipient wallets in the box first” and leaves the file unchanged.
The same mismatch affects reordered named columns with other harmless leading data.

This fails closed and loses no asset, but a valid file reaches two readers and gets contradictory answers.
Pass the parsed named rows/column map into assignment, or canonicalize a confirmed address-only file to one
address per line before offering the button. Add address-first and address-not-first cases to the CSV tests.

### S-02 — Medium — On-chain metadata has no size or work bound

**Reasoned from source.** `web/index.html:923-932`, `web/index.html:957-972`.

Up to eight `tokenURI` calls at a time are ABI-decoded to arbitrary strings, base64- or percent-decoded,
JSON-parsed on the main thread, and potentially handed to the image decoder. There is no limit on the URI,
decoded JSON, image data URI, SVG complexity, or parse/render time, and this repeats across as many as 250
tiles. A hostile collection can return megabytes per token or an expensive animated/filter-heavy SVG and make
the signing tab unresponsive or exhaust memory.

This is an availability attack by a token the user deliberately queried; it does not gain signing authority
and is therefore not a release blocker. Put explicit byte caps before decoding and rendering, reduce parallel
memory amplification, time out/abort obsolete work, and consider parsing/rasterizing in a worker or isolated
document. Oversized metadata should become a tile saying it was not previewed.

### S-03 — Medium — The send-time form lock does not lock all controls that rewrite the list

**Reasoned from source.** `web/index.html:1050-1087`, `web/index.html:1351-1359`, and
`web/index.html:1568-1570`.

`FORM` omits the picker buttons and dynamically created tiles, as well as **Remove contract addresses**.
Those handlers can programmatically rewrite the disabled textarea and call `parseList` while `sending` is
true. An earlier picker load can also finish by re-enabling its button after `lockForm(true)`.

The actual transfer list is copied into `base`/`pre` and the ledger key is frozen, so I did not find a path
from this to a wrong transfer or duplicate payment. The visible box and global `rows` can nevertheless stop
describing the run being preflighted or sent, and some later logging/receipt code still reads globals. Disable
the whole picker/drop-contract surface and add `if (sending) return` inside every mutating handler. Stronger:
create one immutable send context containing chain, account, token, standard, decimals, and rows, and use only
that context after the run lock is acquired.

### S-04 — Medium — Connector provenance checks disappear when `WC_BUNDLE_URL` is unset

**Reasoned from the publisher.** `deploy/publish.sh:102-124`, `deploy/publish.sh:126-141`, and
`deploy/publish.sh:227-250`.

For the airdrop target, the expected-digest validation, origin publication, exact digest-keyed prefetch, and
availability check are all conditional on nonempty `WC_BUNDLE_URL`. That variable is documented as optional.
With it unset, the generated worker intentionally returns a hardened 404 for `/wc.js`; if the also-optional
`URL_AIRDROP` is unset, publication has no final live connector comparison and may succeed. This silently
bypasses the otherwise explicit `ALLOW_CONNECTOR_GAP=1` exception and deploys a page whose phone-wallet button
cannot work.

No different connector bytes can pass the worker's digest check when configured, so this is availability and
assurance loss rather than code substitution. Require `WC_BUNDLE_URL` for the airdrop target and always require
the reviewed digest, or require an explicit mode that also removes/disables the phone-wallet feature. Add a
publisher test with both URL variables absent.

### S-05 — Low — The generated-address warning fires on either heuristic while its rationale requires both

**Reasoned from source.** `web/index.html:835-859`, `web/index.html:881-894`.

The comment and test rationale say that a list is identified by both a long common prefix and several nearby
numeric addresses. The implementation returns a warning when either signal exists. Three legitimate vanity
addresses beginning with the same eight hex digits therefore receive the red “these addresses look made up”
warning even though vanity EOAs can have real private keys. The explanatory text then centers the no-key,
irrecoverable case.

This does not block sending, but it is a stronger provenance claim than the evidence supports. Require both
signals as documented, or word each signal as a separate possibility and explicitly mention vanity-generated
addresses. Add a common-prefix-but-widely-spaced control case.

### S-06 — Low — “Every response carries HSTS” is false for both live HTTP redirects

**Demonstrated against both deployed hosts.** `SECURITY.md:12-16`; generated worker code in
`deploy/publish.sh:183-205`; monitor coverage at `.github/workflows/integrity.yml:54-63`.

Both `http://` endpoints correctly return permanent 301 redirects, but neither response contains HSTS or the
other hardening headers because the worker uses `Response.redirect` rather than `secure()`. The workflow checks
only the 301 code on HTTP and checks HSTS separately on HTTPS, so it does not test the literal documentation
claim.

This has no practical HSTS security cost: browsers must ignore HSTS received over insecure HTTP, so adding the
header to the redirect would not protect a first visit. Change the claim to “every HTTPS response” and state
that the first HTTP visit remains interceptable without preload. I agree that not preloading can be a reasonable
domain-wide operational choice, but it is an accepted first-visit limit, not equivalent to HTTPS-only delivery.

## Inherent limits and required wording

### I-01 — Hostile token contracts can lie about delivery

A token can return success and move nothing, emit a false event, take a transfer fee, rebase, blacklist later,
or change if it is upgradeable. The contract cannot prove honest semantics from inside the same call, and even
post-transfer balance/owner checks rely on that token's answers. The current UI and `SECURITY.md` generally say
this correctly. Keep the user-facing claim as “the token accepted/reported the transfer,” never “cryptographic
proof the recipient was paid.”

### I-02 — Browser-local duplicate protection is not a global payment ledger

Web Locks and `localStorage` coordinate tabs in one browser profile and origin. They do not cover another
browser, device, cleared storage, a changed hostname, or an operator deliberately pressing **Forget**. The UI
should continue saying exactly that at send/recovery decisions and should recommend retaining the downloadable
manifest for operational reconciliation.

### I-03 — RPC simulation, explorers, and ownership reads are observations, not execution guarantees

A node can be unavailable or dishonest; explorer holder/index data can lag and change between pages; state can
change after simulation; a contract recipient can change behavior; and an account can be upgraded between
check and send. The page mostly fails closed and warns about stale explorer lists. Keep “as the chain answers
now” adjacent to every preview and treat the wallet's final transaction display and mined receipt as decisive.

### I-04 — A lenient gas stipend cannot distinguish expensive honesty from griefing

The configured stipend is a liveness policy. An honest heavy receiver can exceed it and be skipped even though
it could receive with more gas. The contract and page correctly recommend retrying alone in strict mode or
raising the bounded stipend; retain that wording.

### I-05 — Refusing off-chain NFT art is the right default for this signing page

Allowing arbitrary metadata/image hosts would disclose every previewer's network address and add uncontrolled
tracking/content dependencies to a transaction-building origin. The current decision to render only known
`data:image/*` types and leave HTTPS art blank is sound. The UI should continue explaining that the NFT remains
sendable even when its preview is withheld.

## Areas examined and found sound

### NFT metadata isolation and pairing counts

- `data:text/html` and `javascript:` image values fail the image allowlist. Non-string names are ignored, and
  accepted names are assigned through `textContent` and truncated.
- A local Chromium attack used a `data:image/svg+xml` containing script, a parent-document mutation, an
  external SVG image, and a `foreignObject` external image. The parent remained unchanged and Chromium made
  zero attacker-network requests: SVG in an `<img>` stayed in the image-document sandbox. This does not cure
  S-02's resource exhaustion.
- Selection count must exactly equal recipient count. Too few or too many leaves the original list untouched;
  the mass-list cap is stated and does not shorten the list.

### Recipient parsing fixes

- Quoted CSV fields, reordered recognized headers, preserved empty interior cells, whole-number `.0` forms,
  scientific-notation refusal, ERC-20 decimal precision, zero amounts, UTF-16/NUL detection, checksum wording,
  all-rejected-row reasons, blank-ID versus quantity handling, duplicate IDs, and address-only first-column
  inputs were inspected and exercised by the suite.
- Leaving an unchanged token field no longer starts a second load. The message about disabling checksum by
  lowercasing now explicitly says that this cannot repair a wrong character.
- Apart from B-02 and S-01, rejected rows remain visible and require acknowledgement before a partial list is
  sendable.

### Delivery ledger and wallet changes

- The send key is captured after the Web Lock is granted and `runKey()` resolves to that frozen value for the
  send's lifetime. `ledgerKey()` refuses use outside such a send.
- WalletConnect disconnect, extension account change, and chain change all set `stopFlag` without clearing the
  sender during an in-flight batch. Delivered writes and pending-journal shrink/removal are ordered together
  under the matching run lock in `commitDelivered`.
- Reconciliation treats unknown, partial, unreadable, mismatched, or replacement outcomes conservatively and
  holds rows. Terminal off-chain failure/full revert releases rows; operator-forced release is explicit.
- The new WalletConnect stand-in reaches the disconnect handler and checks that the ledger stays under the
  original account. It is materially better than the previous mock-only path. After a mid-send disconnect the
  UI retains a stale connection until the operator changes it, but subsequent calls fail closed; this is an
  ergonomics cleanup, not a duplicate-payment path.

### Check page outside B-03

- Dispatch is method-first. Unsupported named methods are refused, a stray `calls` member on
  `eth_sendTransaction` is not substituted for that transaction, call-level `from`/`input` fields are not
  simulated as wallet-honored fields, malformed call members retain their indexes, wrong/unreadable chains
  withhold results, and atomicity remains true/false/unknown.
- Ordered batch simulation uses the resolved sender and withholds the sequence verdict if any destination is
  unsimulatable. Unknown source/code/explorer states are not converted to ordinary-wallet or unverified-code
  conclusions. The page does not request accounts until the user explicitly asks to fill the sender and has no
  send/sign path.

### Contract

- `src/BulkSend.sol` is unchanged from the previously reviewed version. It has no owner, persistent storage,
  upgrade, pause, fee, withdrawal, fallback, or autonomous call path. Every transfer originates from
  `msg.sender`; strict mode bubbles/reverts atomically; lenient mode bounds gas and return data; ambiguous ERC-20
  success return values revert rather than becoming skips; zero/self recipients and non-contract/delegated-
  wallet token addresses are refused; and the transient reentrancy lock protects receipt interpretation.
- All 82 Forge tests passed, including balance/supply conservation, hostile return data, reentrancy, gas grief,
  fee-on-transfer, false/no/odd ERC-20 returns, and strict/lenient outcomes.
- The deployed testnet runtime at `0x91949d7328387a3613b29e56f6979ae893ccd23c` and the local build are both
  8,164 bytes and are byte-for-byte identical.

### Publisher, CSP, deployment, and supply chain

- Each page has exactly one nonempty inline script and exactly one matching SHA-256 token in `script-src`.
  `check.html` contains the exact current `check.js`. The response CSP matches the meta policy plus
  `frame-ancestors 'none'`; neither script policy contains `unsafe-inline`. The external ethers asset is
  versioned and SRI-pinned. I accept the documented Cloudflare Insights exception and did not re-report it.
- With `WC_BUNDLE_URL` configured, the publisher checks a real 64-hex expected digest, matches the local
  bundle, publishes the connector first when a hook is supplied, probes the exact digest-keyed upstream URL,
  bakes the digest into the worker, verifies bytes again at `/wc.js`, and hardens constructed healthy and
  explicit error responses. S-04 is the configuration hole around that chain.
- Rebuilding `web/wc.js` from the pinned `web/wc-build` tree produced
  `d4c35a1b2b743b9f48b781730b171942a31d1b82d992b5d2dbb082b3843064d7`, identical to both the shipped file and
  `EXPECTED-SHA256`. The current axios advisories remain in a build-only branch; none of `axios`, `form-data`,
  `follow-redirects`, or `proxy-from-env` appears in the shipped bundle, so the seventh-round rationale remains
  sound.
- Live `index.html`, `check.html`, and `/wc.js` SHA-256 digests exactly matched repository files. HTTPS 200,
  302, 400, and connector responses carried the four hardening headers checked by the workflow. Both HTTP
  endpoints permanently redirected; see S-06 for the precise HSTS wording.

### Workflows and test strength

- Both workflows use read-only repository permissions and commit-pinned actions. The test workflow at this
  exact commit completed successfully. Recent scheduled integrity runs were green; the final audit also
  independently repeated the live byte, header, bundle, and runtime comparisons.
- `--allow-file-access-from-files` broadens only the isolated test browser so a copied `file://` page can import
  the local WalletConnect stand-in. Production imports same-origin HTTPS. I found no application path that can
  turn this test-only flag into production authority. It would mask a test intended to prove file-origin CORS,
  but no current assertion makes that claim.
- Mock weaknesses are material: the picker assertion does not verify IDs/contracts; metadata attack shapes
  and large responses are absent; the heading test asserts the unsafe heuristic instead of an ambiguous data
  row; named-column assignment is tested only with the address first; and EIP schema tests omit version,
  values, IDs, and capabilities. Mocks also answer promptly and consistently, so they prove less about stale
  asynchronous reads, explorer pagination races, browser resource pressure, and production transport. The
  live integrity job checks a healthy `/wc.js`, not the unavailable/digest-mismatch branches.

## Verification record

- `forge test`: **82 passed, 0 failed**.
- `npm test`: **144 airdrop + 92 Check = 236 passed, 0 failed**.
- Focused browser probes: stale picker contract reproduced; ambiguous first row silently dropped; named CSV /
  assigner disagreement reproduced; malformed EIP-5792 request returned no schema problems; hostile SVG made
  no network request and could not reach the parent.
- CSP/script splice: both inline hashes exact; `check.js` splice exact.
- Live bytes: both pages and `wc.js` exact repository matches.
- Live transport: HTTP 301 on both hosts; HTTPS healthy and tested error/redirect paths hardened.
- Contract: deployed/local runtime exact, 8,164 bytes.
- WalletConnect: rebuild, shipped bundle, expected digest, and deployed bundle all share the digest above.
- Dependency advisories: root tree 0; WalletConnect build graph reports axios advisories already covered by the
  documented non-shipped-code decision.
- Repository was restored after temporary audit probes; only this `AUDIT.md` is untracked.
