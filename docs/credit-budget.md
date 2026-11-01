# The Blockscout PRO credit budget

Audit round eighteen, S-9 and scope item 2, asked for "a credit-and-rate budget for `BLOCKSCOUT_KEY`, with a
stated behaviour on exhaustion". This is it.

## What the key buys

The free PRO plan is 100K credits a day and 5 requests a second; the counter resets at 00:00 UTC
(<https://docs.blockscout.com/rate-limits>). Endpoints not in the published price table cost 20 credits, and the
module calls the Worker makes (`getTokenHolders`, `tokennfttx`, `gettxinfo`, `getsourcecode`) are not in it, so
the working figure is **about 5,000 upstream calls a day**, not 100,000. The docs do not name the status code for
an exhausted plan; the live Workers answered 402 on 2026-11-01 (integrity run 41354798068) and the Worker treats
402 as "budget spent". The response header `x-credits-remaining` carries what is left.

One inventory lookup is up to 20 calls, 400 credits. Before this change the keyed path had no server-side cache
at all (`cf: { cacheTtl: 0 }`, and a Worker's own `cache-control` does not populate Cloudflare's cache), so every
page load, reload and retry spent credits, and `?anything=1` made a new request each time.

## Behaviour now

| situation | behaviour |
| --- | --- |
| a good answer was seen recently | served from `caches.default`, no upstream call (`x-explorer-state: cached`) |
| identical requests at once | one upstream call, shared |
| junk query strings | ignored; only `page` on holders is part of the cache key. The API key is never in a cache key or entry |
| upstream answers 402 | the Worker stops spending until 00:00 UTC (in memory and as a shared marker in the colo's cache) |
| budget spent, cached answer exists | served labelled `x-explorer-state: stale` with `stale_seconds` in the body, within the stale window |
| budget spent, nothing usable | the usual `{"error":"upstream","status":402}` envelope plus `reason: "credits_exhausted"` and `retry_after` (next 00:00 UTC) |
| more than 16 distinct walks in flight in one isolate | admission limit: stale if allowed, else `reason: "busy"` with a 5 s `retry_after` |
| `x-credits-remaining` under 4,000 (observation expires at the next 00:00 UTC) | the 20-call inventory walk is shed (`reason: "credits_low"`); holders, transactions and contracts continue |

| answer | fresh | may be served stale for |
| --- | --- | --- |
| holders page | 10 min | never (see below) |
| NFT inventory | 5 min | never |
| transaction | 24 h | 7 d |
| contract, verified | 24 h | 7 d |
| contract, unverified | 10 min | 7 d |

Holders and inventories are never served stale: they feed recipient selection and proportional allocation, and
the page cannot yet show how old a snapshot is (the reader ignores `stale_seconds`). Until a page edit shows the
age, they are fresh or "could not check". Transactions and verified contracts do not change once mined and verified.

Failures are never cached, and `ok:false` answers (NOTOK, 4xx, 5xx) keep their audit-eighteen behaviour. The
envelope fields are additive: the pages read `error` and `status` only, so no page, CSP hash or reviewed digest
changes. A visible "explorer busy until 00:00 UTC" sentence on the pages is a follow-up that needs a page edit
and a re-hash; the data it needs (`reason`, `retry_after`) is already in the envelope.

## Not done, on purpose

* Holders and source verification cannot be rebuilt from the free RPCs (they need an index and the verified
  source), and the rule from round eighteen is that nothing is invented: a guessed `is_verified` is worse than
  "could not check". Hence stale-if-error rather than an on-chain substitute.
* The per-isolate budget is not a global counter. Cloudflare has no atomic shared counter without KV or a
  Durable Object; the 402 marker and the cache TTLs bound spend instead. If traffic grows past one key, bind a
  KV namespace and count there.

## The integrity check

`.github/workflows/integrity.yml` now tells "credits exhausted" (402, or `reason` credits_exhausted/credits_low)
from "path dark": the first is a `::warning::` annotation and skips that host's content assertions; everything
else that is not a real holders list, unverified contract and verified contract still fails. Each of the three lookups per host is classified on its own (`test/integrity-classify.test.sh`). Stale age is recomputed when an answer is served and browser caching is capped to what remains of the window. The check itself
spends about 24 calls (480 credits) a day.

## Rotation and monitoring

Rotate the key if a Cloudflare log is ever exported (round eighteen S-7). To see the balance without the
Worker: `curl -sI "https://api.blockscout.com/v2/api?chain_id=4663&module=block&action=eth_block_number&apikey=$KEY"`
and read `x-credits-remaining`; it costs one call.
