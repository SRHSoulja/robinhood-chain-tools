# What a batch costs, and how big one can be

Every number on this page was measured on Robinhood Chain, not estimated from a table. The method is at the
bottom so anyone can repeat it and disagree with it.

## The short version

- One transaction stops at **32,000,000 gas**, which the chain declares itself:
  `ArbGasInfo.getGasAccountingParams()` returns it as `maxTxGasLimit` on both networks.
- **How many recipients that buys depends entirely on the collection**: measured across 58 live mainnet
  collections, between **209 and 765**.
- **So the cap is measured, not chosen.** The page estimates one real transfer of the token you are sending
  and derives the cap from that: `30,000,000 / (measured x 1.35)`, capped at 400. Against all 58 live
  collections that never picks a batch that cannot fit, and it gives 56 of the 58 more room than a flat 200
  would. The same margined figure is what the page quotes as the cost, so the price and the batch size come
  from one number rather than two. **200** is the fallback for a token that will not answer, because 200 is the number every one of the
  58 clears. **25** when your wallet is sending the transfers as itself, because wallets refuse long batches.
- **Bigger batches are cheaper, but not by much.** A thousand NFTs cost about 8% less delivered 400 at a time
  than 100 at a time. Delivered 25 at a time they cost 42% more.
- **Order matters far more than size on a lazily-minted collection.** Shuffled ids cost 45% more than
  ascending ones, and descending ids do not complete at all. The page sorts ascending for you.

## Gas per recipient

Delivering to addresses that held nothing before, which is the expensive case and the normal one for an
airdrop. Marginal cost, taken from the slope between 200 and 400 recipients, so the fixed per-transaction
cost is excluded.

| what you are sending | gas per recipient |
| --- | --- |
| ERC-20 | 28,769 |
| ERC-1155 | 34,054 |
| ERC-721, plain transfer | 35,810 |
| ERC-721, with the recipient check on | 38,610 |
| ERC-721 lazily minted (ERC721A), ids in ascending order | 56,618 |
| ERC-721 lazily minted, ids shuffled | 44,326 and rising with the batch |

The recipient check ("Check that each recipient can hold NFTs") costs between 5 and 8%, more of it the
larger the batch: 5.1% at 25 recipients, 6.2% at 100, 7.8% at 400. It is worth it: an NFT sent
to a contract that cannot handle it is stuck there permanently.

## A thousand-piece collection

Standard ERC-721, recipient check on, skip-and-continue. Priced at 0.172 gwei, which is where Robinhood Chain
mainnet has sat across the last half a million blocks, and ETH at $2,462.

| recipients per transaction | transactions | total gas | ETH | cost |
| --- | --- | --- | --- | --- |
| 25 | 40 | 57.3M | 0.00985 | $24.26 |
| 50 | 20 | 47.7M | 0.00821 | $20.22 |
| 100 (the default) | 10 | 43.5M | 0.00748 | $18.41 |
| 200 | 5 | 41.4M | 0.00712 | $17.54 |
| 400 | 3 | 40.3M | 0.00693 | $17.06 |

The whole airdrop costs less than twenty dollars, and the difference between the cheapest and the default
setting is $1.35. That is the honest reason the default is 100 and not 400: the saving is small and a failed
transaction at 400 wastes four times as much gas as one at 100.

## The ceiling

| recipients in one transaction | gas | result |
| --- | --- | --- |
| 400 | 16.0M | fine |
| 700 | 27.5M | fine |
| 800 | 31.4M | fine |
| **819** | **32.2M** | the largest that completes *for this token* |
| 900 and above | | reverts, `OutOfGasForBatch(index)` |

The revert is BulkSend's own guard, not a silent truncation. It names the index it stopped at, and nothing in
the batch lands. That is the behaviour you want: a batch too large to finish should fail visibly and cost you
a failed transaction, not deliver half a list and leave you to work out which half.

## Why the order of the ids matters

A lazily-minted collection (ERC721A and the many contracts derived from it) does not write an owner record
for every token when it mints. It writes one at the start of each mint batch, and a transfer walks backwards
through the ids until it finds one. That walk is what you pay for.

Delivered in ascending order, each transfer leaves behind a record that the next one lands on immediately, so
the walk is a single step every time. Delivered scattered, every transfer walks again from wherever it landed.
Delivered descending, every transfer walks the full length of the mint batch.

Measured against a real 400-token ERC721A on this chain:

| 100 recipients, ids... | gas | |
| --- | --- | --- |
| ascending | 6.1M | |
| shuffled | 8.9M | 45% more |
| descending | | does not complete: `OutOfGasForBatch` |

The page sorts every list into ascending id order before it sends, and says so in the log when the order it
sends differs from the order you typed. Everyone still receives the id you listed for them; only the sequence
of the transfers changes. This is why the picker, which hands back a scattered set of ids by design, does not
cost you anything extra.

## How this was measured

Testnet (46630), against the same BulkSend the page uses, with real tokens minted for the purpose:
`OZ721` (OpenZeppelin ERC-721), `A721` (ERC721A), `OZ1155`, `OZ20`, all listed in `deployments.testnet.json`.

Batch gas came from `eth_estimateGas` on the real contract with the tokens actually held and approved, and
recipients that had never been touched. The estimates were checked against transactions really sent earlier:
ERC-20 at 100 recipients estimated 3.34M and spent 3.37M, at 400 estimated 12.01M and spent 12.08M. Within
one percent, which is what makes the rest of the sweep worth trusting.

Prices came from the live mainnet base fee (`eth_baseFee`, sampled across 500,000 blocks: 0.17 to 0.20 gwei)
and a public ETH price. Gas costs are a property of the chain; the dollar figures are only as current as the
day they were written, 9 September 2026.

## What real collections actually cost

The figures above come from tokens deployed for the purpose, which is a fair test of the contract and a poor
test of the world. So: every ERC-721 collection that moved a token on Robinhood Chain mainnet inside a recent
12,000-block window, 58 of them, measured by asking the chain to estimate a real transfer by the token's real
current owner to an address that has never been touched. Read-only, nothing signed.

Converted to what one more recipient costs inside a batch (a standalone estimate carries the 21,000 base cost
a batch pays once; the conversion is measured both ways on the same contract and the conservative end is used
here):

| | gas per recipient | recipients that fit in one transaction |
| --- | --- | --- |
| cheapest collection | 41,825 | 765 |
| median | 54,987 | 581 |
| 75th percentile | 70,399 | 454 |
| 90th percentile | 105,218 | 304 |
| dearest measured | 152,843 | 209 |

Two things fall out of that, and they point opposite ways to what I expected.

**The cap of 200 is right, and it is not conservative.** Not one of the 58 collections would fail at 200. The
dearest fits 209. The cap that looked like it had four times the headroom it needed has, against the real
worst case on this chain, about four percent.

**The cap of 400 is too high.** Six of the 58 would not fit a 400-recipient batch:

| collection | gas per recipient | fits |
| --- | --- | --- |
| QUOTRONS | 152,843 | ~209 |
| Only Traits | 148,635 | ~215 |
| up Position NFT | 106,794 | ~299 |
| Uniswap V3 Positions | 106,776 | ~299 |
| DUELISTS | 106,233 | ~301 |
| The Reserve | 105,218 | ~304 |

That is 10% of what is live. Nobody would lose money over it, because the test run simulates the whole batch
and the contract's own guard stops it, but they would hit a wall the page never warned them about. 400 is
only reachable with the recipient check off and all-or-nothing chosen, which is a rare combination, but rare
is not the same as safe.

**And the per-recipient figure the page shows is too low for a third of them.** The page assumes 57,000 gas
per recipient in its careful modes. 19 of the 58 cost more than that, up to 2.7 times more. The plan calls
its estimate a ceiling, and for those it is not one.

The fix for all three is the same, and it is smaller than any of them: stop assuming. The page knows the
collection and it knows an id the sender holds, so it asks the chain what one transfer of *this* token costs,
by this sender, to an address that has never held it. That single answer sets the cost estimate, the
per-recipient figure and the cap.

Checked against all 58: the cap it would choose fits every one of them, and 56 of the 58 get more room than a
flat 200 would.

The margin is 1.35, and it was 1.15 first. 1.15 covered the direction that had been measured -- the same
contract standalone against in-batch, where the derivation runs up to 5% light on a lazily-minted collection
and up to 35% heavy on a plain one. It did not cover the direction that had not been measured. **The probe
sends the token as its owner; BulkSend sends it as an operator.** A collection using the OperatorFilterer
pattern charges a cold call into a registry on the operator path and nothing at all on the owner path: 5,000
to 10,000 gas on a base of about 40,000, so 12-25%, against a 15% margin. Collections with a transfer
validator are detected and routed away already; this pattern is not detectable from outside, so the margin
has to carry it. At 1.35, 56 of the 58 still get the full 400.

The old table survives only as a stopgap for the second before the answer arrives, and the page says which
of the two it is looking at rather than presenting a guess as a measurement.

## The other two standards

Same method, same window, same chain. ERC-20 is everywhere here (1,876 `Transfer` logs in 120 blocks, 398
distinct contracts); ERC-1155 is rare (17 `TransferSingle` logs in 400 blocks, 10 contracts found across
32,000 blocks). Of those, the ones with a holder whose transfer could actually be estimated: 29 and 6.

| | gas per recipient | | | fits in one transaction |
| --- | --- | --- | --- | --- |
| | median | p90 | dearest | at the dearest |
| ERC-20 | 30,975 | 57,318 | 57,414 | 557 |
| ERC-1155 | 43,937 | 75,614 | 75,614 | 423 |

The same mistake was waiting in both. The page assumed 32,000 gas for an ERC-20, and **9 of the 29 cost
more**. The dearest are not obscure contracts either: `GameStop`, `Intel` and `Alibaba` Robinhood Tokens all
cost 57,318 a recipient, close to double a plain ERC-20, and those tokenised equities are much of the reason
this chain exists. For ERC-1155 the 57,000 assumption was closer and still wrong for 2 of the 6.

Neither changes the cap. 200, the fallback, clears both with room: the dearest ERC-20 fits 557 in one
transaction and the dearest ERC-1155 fits 423.

Both change what the page says when it cannot measure. The fallbacks now hold the dearest token of each kind
found in this survey, 57,500 for an ERC-20, 76,000 for an ERC-1155 and 153,000 for an NFT. That is a more
conservative planning figure than a median, not an upper bound on contracts the survey never saw. The page
calls it a fallback and says it is not a ceiling. A measurement is called an estimate for the same reason.

### Is the probe measuring the right thing?

The probe estimates a standalone transfer; BulkSend makes the same transfer inside a loop, and for an ERC-20
it goes through `transferFrom`, which also writes an allowance. So the derivation could in principle run
light. Measured both ways on the same contract:

| | standalone minus 21,000 | real cost inside a batch | the derivation runs |
| --- | --- | --- | --- |
| ERC-20 | 39,797 | 28,769 | 38% heavy |
| ERC-1155 | 49,410 | 34,054 | 45% heavy |
| ERC-721 | 51,984 | 38,610 | 35% heavy |
| ERC721A | 53,944 | 56,618 | **5% light** |

Only the lazily-minted case runs light, and by 5%. That is why the margin cannot be 1.0. It is not why it is
1.35: this table measures the same call made the same way, and the margin also has to cover a call made a
*different* way, as an operator rather than as the owner, which this table cannot see at all. That is the
12-25% described above, and it is the half that took the margin from 1.15 to 1.35.

## What is still not settled
- **The ERC-1155 sample is six.** That is every one that was findable and measurable, and it is not enough
  to say much about the shape of the distribution, only about its top.
- **A collection dearer than QUOTRONS can be deployed tomorrow.** No fixed cap survives that, which is the
  argument for deriving it from the token in front of you rather than from a table.
- **The L1 data component moves.** Calldata carries a surcharge that counts against the same 32M limit. It is
  under 1% today (111,320 gas of a 16,026,033 batch at 400 recipients, measured through the chain's own
  NodeInterface), so it changes nothing now, but it scales with the L1 fee and it does not amortise.
