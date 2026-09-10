# Who reads what, and which of them have to agree

Five of the last two rounds' findings are one shape: **a reader taught something its twin was not.** The
twelfth round's only blocker was that; the thirteenth's blocker was that; so were three of its should-fix
items. Fixing each instance as it is found has not worked, because the next instance is a different function
reading the same input.

This file is the map. It exists so that "fix the reader" can be followed by "and here is every other reader of
that input", which is the step that was missing.

**The rule this file supports:** when a reader is fixed, list every other reader of the same input in the
commit message, and say for each whether it needed the same change.

---

## Input 1 — the recipient box (`#list`)

Every function that reads or writes it, and whether it goes through the shared cutters (`boxColumns`,
`addressOn`, `splitRow`, `deliveriesOn`).

| function | reads | writes | uses the shared cutters |
| --- | :---: | :---: | --- |
| `boxColumns` | ● | | it *is* one |
| `parseList` | ● | ● | `splitRow` |
| `walletsInBox` | ● | | `boxColumns`, `addressOn`, `deliveriesOn` |
| `unreadableLinesInBox` | ● | | `boxColumns`, `addressOn` |
| `refuseForUnreadableLines` | ● | | via `unreadableLinesInBox` |
| `deliveriesOn` | ● | | `splitRow` — **takes `col` and never uses it** (round 13 S-2) |
| `$('csv')` change | | ● | `splitRow` |
| `$('pickUse')` click | ● | ● | via `walletsInBox` / `refuseForUnreadableLines` |
| `$('assign')` click | ● | ● | `boxColumns`, `addressOn`, `splitRow` |
| `$('shuffle')` click | ● | ● | `boxColumns`, `addressOn`, `splitRow` |
| `$('applyWeight')` click | ● | ● | `boxColumns`, `addressOn` |
| `$('dropContracts')` click | ● | ● | `boxColumns`, `addressOn` |
| `confirmOverwrite` | ● | | counts raw lines, and says "lines" — correct as written |
| `$('snap')` click | | ● | none — **writes only**, one bare address per line, which every reader handles |

### What the map found that the round did not

Round thirteen found two instances of *counting lines where the code means wallets* (S-1: the heading row
counted as unreadable; S-2: `deliveriesOn` ignoring the column map). Reading the whole map turned up a third:

- **`$('applyWeight')` reports `lines.length` as a wallet count.** On a file headed `label,address,tokenId`
  it says "3 wallets" for two wallets and a heading. It does not corrupt the list — `addressOn` returns null
  for the heading and the line is passed through unchanged — but the number it shows and the number it acts
  on are different numbers, which is the family this page exists to avoid.

And one that is sound and is recorded so nobody re-opens it:

- **`$('snap')` uses none of the shared cutters and does not need to.** It only ever writes, and it writes one
  bare address per line, which is the simplest thing every reader can read.

---

## Input 2 — a token address pasted into the wrong form (the contract's paste guards)

| guard | on | probes | mirror-complete? |
| --- | --- | --- | --- |
| `_mustBeNft` | `airdrop721` | `ownerOf(ids[0])`, then `ownerOf(ids[n-1])`, then `supportsInterface(0x80ac58cd)` | yes, since v12 |
| `_mustNotBeNft` | `airdrop20` | `ownerOf(amounts[0])` **only** | **no — this is round 13's B-1** |
| *(none)* | `airdrop1155` | — | **not needed, and here is why** |

### Why `airdrop1155` needs no guard

The reason the other two need one is a selector collision, measured rather than assumed:

```
ERC-721  transferFrom(address,address,uint256)                  0x23b872dd
ERC-20   transferFrom(address,address,uint256)                  0x23b872dd   <- identical
ERC-721  safeTransferFrom(address,address,uint256)              0x42842e0e
ERC-1155 safeTransferFrom(address,address,uint256,uint256,bytes) 0xf242432a   <- distinct
```

`airdrop1155` calls `0xf242432a`, which no ERC-20 or ERC-721 implements, so a token of another standard passed
to it reverts on the first row instead of quietly moving something. The reverse directions are also closed:
an ERC-1155 sent to `airdrop721` fails `_mustBeNft` (no `ownerOf`, and `supportsInterface(0x80ac58cd)` is
false), and one sent to `airdrop20` passes `_mustNotBeNft` but then calls `0x23b872dd`, which an ERC-1155 does
not implement, so every row reverts and nothing moves.

**This is the finding the map exists to produce: the v13 change set is B-1 and nothing else.** Without
checking, the safe-looking assumption would have been "add a guard to all three", which would have cost a
staticcall per batch on a path that cannot be reached that way.

---

## Coverage, as a second opinion on the same question

`forge coverage` reports 98.67% of lines and 83.64% of branches in `BulkSend.sol`. The nine uncovered branches
are not spread evenly — they cluster on `_airdrop1155` and `_airdrop20`:

| line | branch |
| --- | --- |
| 178 | `AmbiguousResult` on the 721 path |
| 233, 234 | `LengthMismatch`, `EmptyBatch` on the 1155 path |
| 241 | the zero-address skip, 1155 lenient |
| 245 | `AmbiguousResult`, 1155 lenient |
| 252 | `ZeroRecipient`, 1155 strict |
| 256 | `AmbiguousResult`, 1155 strict |
| 296, 297 | `LengthMismatch`, `EmptyBatch` on the 20 path |

Arrived at mechanically, it says the same thing the map says by hand: **the ERC-721 path is better tested than
the other two**, in a tool whose entire reason to exist is covering all three standards equally.
