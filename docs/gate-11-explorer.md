# Gate 11: the mainnet explorer, through the Worker, through Blockscout's PRO API

## Why

The mainnet explorer (`robinhoodchain.blockscout.com`) answers browsers and challenges every other client with a
Cloudflare managed challenge. The Worker's `/x/4663/…` passthrough therefore returns `{"error":"upstream"}` for
everything, and the airdrop page does not even go through the Worker on mainnet: `EXPLORER_API()` calls the
explorer directly, which a browser cannot read either (no CORS header). So on mainnet, today, Assign's
fallback for collections without `tokenOfOwnerByIndex`, "Fetch holders", and Check's source verification and
revert reasons are all dark. Their sentences are honest ("or the explorer would not say"); the features are not
there. Round seventeen's S-8.

## What was verified on 11 September 2026, with a free PRO API key

Blockscout is retiring per-instance keys. The multichain PRO API (`https://api.blockscout.com/v2/api`, free
tier 5 requests a second, 100K credits a day) serves chain 4663, but **only in the Etherscan-style module API**.
The REST shape the pages use (`/api/v2/…`) does not exist there for any chain (`{"error":"Network not
supported"}`, even for chain 1). Verified with the key, `chain_id=4663`:

| module call | answers | shape |
| --- | --- | --- |
| `module=token&action=getTokenHolders&contractaddress=A&page=N&offset=M` | yes | `result: [{address, value}]` |
| `module=account&action=tokennfttx&address=W&contractaddress=A&page=N&offset=M` | yes | `result: [{tokenID, from, to, contractAddress, hash, blockNumber, …}]` |
| `module=account&action=addresstokennftinventory` | **no** ("Unknown action") | holdings must be derived from `tokennfttx` |
| `module=transaction&action=gettxinfo&txhash=H` | yes | `result: {input, logs, revertReason, success, from, to, …}` |
| `module=contract&action=getsourcecode&address=A` | yes | `result: [{ABI, ContractName, CompilerVersion, OptimizationRuns, IsProxy, SourceCode, …}]` |
| `module=token&action=getToken&contractaddress=A` | yes | `result: {name, symbol, decimals, type, totalSupply}` |
| `module=block&action=eth_block_number` | yes | a hex block number |

The key is bound to the Worker as a secret (`BLOCKSCOUT_KEY`; `deploy/publish.sh` reads `BLOCKSCOUT_KEY_FILE`
from `deploy/local.env`). It never reaches a page. That plumbing is in place and inert.

## What to build

One translation layer in the Worker (`deploy/publish.sh`, the `x_route` template), used **only** when the chain
is 4663 and `env.BLOCKSCOUT_KEY` is bound. Testnet keeps the direct passthrough. Without the binding, mainnet
keeps today's `{"error":"upstream"}` envelope, so the page's "could not check" handling is unchanged.

The pages read exactly these fields, and nothing else may be invented:

| page path (as requested) | reader uses | build from |
| --- | --- | --- |
| `/tokens/{A}/holders?{next}` | `items[].address.hash`, `items[].value`, `next_page_params` | `getTokenHolders`, page/offset 100; `next_page_params = {page: n+1}` while a full page came back; the reader passes it back verbatim as the query string |
| `/addresses/{W}/nft?type=ERC-721%2CERC-1155&{next}` | `items[].token.address_hash`, `items[].id`, `next_page_params` | `tokennfttx` for `W` (all contracts; the reader filters by token address itself), newest first, at most 20 pages of 100; net `to == W` minus `from == W` per `(contractAddress, tokenID)`; emit one item per id still held; `next_page_params` null (the whole inventory is computed in one answer; cap at 2,000 ids and say so with `truncated: true`) |
| `/transactions/{H}` | `revert_reason` (string or `{raw}`) | `gettxinfo.revertReason` → `revert_reason` (string, may be empty → omit); also `status: success ? "ok" : "error"`, `hash`, `from: {hash}`, `to: {hash}` |
| `/smart-contracts/{A}` | `is_verified`, `is_partially_verified`, `name`, `abi`, `compiler_version`, `evm_version`, `optimization_enabled`, `proxy_type`, `implementations`, `verified_at` | `getsourcecode[0]`: `is_verified = ABI is not "Contract source code not verified"`, `name = ContractName`, `abi = JSON.parse(ABI)` or `[]`, `compiler_version = CompilerVersion`, `optimization_enabled = OptimizationUsed == "1"`, `proxy_type = IsProxy == "true" ? "unknown" : null`, `implementations = ImplementationAddress ? [{address: ImplementationAddress}] : []`, `is_partially_verified: false`, `evm_version` and `verified_at` from the record when present, else null |

Anything the module API cannot supply is `null`, never a guess: the readers already treat null as "could not
check". Every upstream call carries `chain_id=4663`, the key, and a 10-second timeout; every answer is cached at
the edge for 60 seconds; a non-200 or non-JSON upstream answer is the existing `{"error":"upstream"}` envelope.
Rate: the free tier is 5 requests a second; the NFT derivation may need up to 20 upstream pages for one page
request, so it runs sequentially and stops early when a page comes back short.

## The airdrop page

`EXPLORER_API()` in `web/index.html` must return `'/x/4663'` when the page is served from its Worker origin
(`location.origin` ends with `gmgnrepeat.com`) and the chain is 4663, and the direct testnet URL otherwise. The
Check page already does this (`route === 'direct' ? api(path) : '/x/' + chainId() + path`); copy its rule. The
CSP `connect-src` already allows `'self'`.

## Tests

A new `test/worker.test.mjs`: build the Worker exactly as `publish.sh` does (factor the template rendering into
`deploy/render-worker.py` so both call it), load it into node with a fake `fetch` that answers the module API
from fixtures captured on 11 September (one holders page, a `tokennfttx` history with a mint, a transfer out
and a transfer back in, a reverted `gettxinfo`, a verified and an unverified `getsourcecode`), and assert each
translated response field by field against the table above, plus: no key in any response body or header; the
testnet path untouched; the mainnet path without a binding still returns the envelope. `verify.sh` runs it.

## Done when

`./verify.sh` green with the new suite; published with the key bound; then, read from the live Worker: a real
mainnet collection's holders page, the maintainer's mainnet address's NFT inventory, one reverted mainnet
transaction's reason, and BulkSend's own verification once it is deployed. Then the integrity workflow gains
the step that fails on `{"error":"upstream"}` for `/x/4663/tokens/…`, and gate 11 is closed.
