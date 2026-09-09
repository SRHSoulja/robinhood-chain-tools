# What a batch costs, and how big one can be

Every number on this page was measured on Robinhood Chain, not estimated from a table. The method is at the
bottom so anyone can repeat it and disagree with it.

## The short version

- One transaction on this chain stops at roughly **32M gas**. A plain ERC-721 batch reverts above **819
  recipients**, at 32.2M.
- The page caps a batch at **200** whenever it is checking recipients or leaving room for a transfer to
  fail, which covers the default settings and almost every real send. **400** needs both of those off: no
  recipient check and all-or-nothing. **25** when your wallet is sending the transfers as itself, because
  wallets refuse long batches.
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
| **819** | **32.2M** | the largest that completes |
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
