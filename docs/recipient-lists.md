# How to say who gets what

This is the whole of it. Every way this page will read a recipient list is on this page, and nothing here is
planned to change: a list that works today is meant to work in a year.

Two rules underneath all of it:

- **One line is one delivery, except where a line names several NFTs.** What you paste becomes the list of
  transfers, and the count on screen is the count that gets signed.
- **Nothing is guessed.** A line that cannot be read is reported with its line number and what is wrong with
  it, and the send waits until you have seen it. A row is never quietly dropped to make the rest work.

## The shortest thing that works

```
0xAbC…001
0xdEf…002
0x123…003
```

Just addresses. Set **How many each**, press **Assign my token ids**, and the ids you hold are filled in for
you — at random by default, so nobody can pick which one they get. Delivery still goes out lowest id first,
because that is cheaper and the fairness is in the pairing, not the order.

## ERC-721 — unique NFTs

An NFT cannot be divided, so **the ids are the count**. Listing three ids says three NFTs; there is no
separate amount that could disagree with it.

| what you write | what it means |
|---|---|
| `0xabc,251` | that wallet gets NFT 251 |
| `0xabc,251,252,253` | that wallet gets all three |
| `0xabc,251`<br>`0xabc,252` | the same thing, one per line |
| `0xabc` | one NFT, chosen for you by **Assign** |
| `0xabc x3` | three, chosen for you |

`x3` after an address overrides **How many each** for that wallet alone.

## ERC-1155 — editions

Here an id and an amount are both needed and neither implies the other: the id says *which* edition, the
amount says *how many of it*.

```
0xabc,1,5      five of edition 1
0xabc,2,3      three of edition 2
```

One edition per line. Several ids on one line is refused for ERC-1155, because `0xabc,1,2,3` cannot say
whether 3 is an id or an amount, and a format that can lie to itself has no business moving assets.

## ERC-20 — tokens

```
0xabc,1.5
0xabc,0.000001
```

Amounts are in the token's own units, and the token's own `decimals` decides how many places you may use.
More places than it has is refused rather than rounded: the page will not decide for you how much of
someone's payment to discard.

## A heading row, if you have one

If the first line names its columns, **the order stops mattering entirely** — the columns are read by name.

```
address,tokenId              tokenId,amount,address
address,quantity,tokenId     Owner,Token ID
address,tokenIds             HolderAddress,Balance
```

Recognised names, in any capitalisation, with spaces, underscores or camelCase:

- **who** — address, wallet, recipient, receiver, holder, owner, account, user, destination, beneficiary, voter, and the `…Address` forms of those
- **which** — tokenId, tokenIds, id, ids, nft, nftId, token, tokenNumber, edition, serial
- **how many** — amount, quantity, qty, count, number, balance, held, value, weight, shares, vp

A `tokenIds` cell may hold several, separated by spaces: `0xabc,"251 252 253"`.

A first line that is *not* a heading anyone can read is not thrown away. It is reported, with both readings
offered, and the send waits.

## Files from other tools

These are read as they come out, no editing:

| source | what it exports | how it is read |
|---|---|---|
| Etherscan holders | `HolderAddress,Balance` | a proportional drop, one per NFT held |
| Blockscout holders | `Address,Balance` | the same |
| Safe airdrop app | `token_type,token_address,receiver,amount,id` | one delivery per row |
| thirdweb | `address,quantity` | how many each |
| Dune / Premint | `wallet,…` / `wallet_address` | wallets, ids to be assigned |
| Moralis, Alchemy | `owner_address,token_id,amount` | one delivery per row |
| OpenSea | `Owner,Token ID` | one delivery per row |
| snapshot.org | `voter,vp` | wallets and weights |
| disperse.app | `0xabc 1.5` or `0xabc=1.5` | one delivery per row |

Separators: comma, tab, semicolon, `=`, or spaces. Quoted fields are understood, so a value containing a
comma survives. Empty cells keep their position — a blank id column is a hole in the file, not a shift of
everything after it.

## Proportional drops

Read a collection's holders with **Fetch**, then choose how much each wallet gets: the same for everyone, one
for each one they hold, or a fixed number for each one they hold — with a cap, so one large holder cannot take
the drop. The block the reading came from is shown, because an explorer's holder list is its latest indexed
answer and not a snapshot of any particular block.

## Choosing exactly which NFTs

**Choose which ones** shows the NFTs you hold and pairs the ones you pick with the wallets in the box, in the
order shown. Where a collection keeps its art on the chain the picture comes from the chain itself. Art kept
on a web server is not fetched — this page also signs transactions, and a thumbnail is not worth telling that
server who is looking — so those tiles say so and those NFTs still send normally.

Past a couple of hundred wallets the picker declines and points at **Assign my token ids**, which handles any
number. Picking one at a time is curation; that is a different job.

## What is refused, and why

| input | answer |
|---|---|
| `alice.eth,1` | names are not resolved here; paste the 0x address |
| an address whose capitals fail its checksum | one character is wrong, or the capitals were altered — only the source can say which |
| `0xabc,251,251` | that id is listed twice |
| `0xabc,1.5` on ERC-721 | not a whole token id |
| `1.23457E+11` | a spreadsheet has rounded it; re-export that column as text |
| a file saved as UTF-16 | re-save as CSV UTF-8 |
| an amount with more decimals than the token has | sending it would mean rounding |
| a list of addresses that share a long prefix and run in sequence | these look counted rather than collected, and nobody holds the key to an address nobody made |
