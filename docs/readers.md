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

Every function that reads or writes it, and whether it goes through the shared semantic path (`boxColumns`,
`addressOn`, `splitRow`, `serializeRow`, `deliveriesOn`). A shared parser is not enough: every writer must
serialize the same cells back without changing their columns or meaning.

| function | reads | writes | uses the shared cutters |
| --- | :---: | :---: | --- |
| `boxColumns` | ● | | it *is* one |
| `parseList` | ● | ● | `splitRow` |
| `walletsInBox` | ● | | `boxColumns`, `addressOn`, `deliveriesOn` |
| `unreadableLinesInBox` | ● | | `boxColumns`, `addressOn` |
| `refuseForUnreadableLines` | ● | | via `unreadableLinesInBox` |
| `deliveriesOn` | ● | | `splitRow`; named `tokenId` wins over an unrelated `amount` |
| `$('csv')` change | | ● | `splitRow` |
| `$('pickUse')` click | ● | ● | via `walletsInBox` / `refuseForUnreadableLines` |
| `$('assign')` click | ● | ● | `boxColumns`, `addressOn`, `splitRow` |
| `$('shuffle')` click | ● | ● | `boxColumns`, `addressOn`, `splitRow`, `serializeRow`; changes only the standard's named payload cells |
| `$('applyWeight')` click | ● | ● | `boxColumns`, `addressOn`, `splitRow`, `serializeRow`; changes only the named amount cell |
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
| `_mustNotBeNft` | `airdrop20` | `supportsInterface(ERC721)`, `isApprovedForAll(sender, BulkSend)`, `ownerOf(amounts[0])`, `ownerOf(amounts[n-1])` | yes, since v13 |
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
false), and one sent to `airdrop20` is refused by `_mustNotBeNft` because ERC-1155 also requires
`isApprovedForAll(address,address)`.

**This is the finding the map existed to produce: round thirteen's v13 change set was B-1 and nothing else.**
The pre-deploy coverage pass then made that guard independent of the ids by adding the operator question;
`airdrop1155` still needed no guard of its own.

---

## Coverage, as a second opinion on the same question

On 10 September `forge coverage` reported 98.67% of lines and 83.64% of branches in `BulkSend.sol`, with nine
uncovered branches clustered on `_airdrop1155` and `_airdrop20`, and it was left at that. Re-run before Phase
6 there were **ten**: the nine, plus v13's own second id probe in `_mustNotBeNft`, which no passing test
reached. All ten now have a test each in `test/BulkSendReal.t.sol`, and `test/Invariants.t.sol` asserts the
properties over random sequences of all three paths. **Branch coverage of `src/BulkSend.sol` is 100% (58 of
58)**; lines are 98.73%.

| line, then | branch | now tested by |
| --- | --- | --- |
| 178 | `AmbiguousResult` on the 721 path | `testChatty721_lenient_anAnswerIsAmbiguousNotDelivered` |
| 233, 234 | `LengthMismatch`, `EmptyBatch` on the 1155 path | `testOZ1155_rejectsMismatchedLengths_andEmpty` |
| 241 | the zero-address skip, 1155 lenient | `testOZ1155_lenient_zeroAddressIsSkippedNotBurned` |
| 245, 256 | `AmbiguousResult`, 1155 lenient and strict | `testChatty1155_anAnswerIsAmbiguousInBothModes` |
| 252 | `ZeroRecipient`, 1155 strict | `testOZ1155_strict_zeroAddressRevertsTheBatch` |
| 296, 297 | `LengthMismatch`, `EmptyBatch` on the 20 path | `testOZ20_rejectsMismatchedLengths_andEmpty` |
| 456 | `_mustNotBeNft`, caught by the last id when the first is dead | `testBareRevert721_throughTheErc20Path_isCaughtByTheLastIdWhenTheFirstIsDead` |

Arrived at mechanically, the original list said the same thing the map said by hand: **the ERC-721 path was
better tested than the other two**, in a tool whose entire reason to exist is covering all three standards
equally. That is no longer true of the branches, and the invariants hold the three paths to the same
properties.

### The ERC-20 guard, once more

Writing the test for line 456 showed what the two id probes cannot see: a collection with no ERC-165 whose
only live ids are in the *middle* of the list answers neither probe. So `_mustNotBeNft` now also asks
`isApprovedForAll(address,address)`, which every ERC-721 and ERC-1155 must have and no ERC-20 has, and which
does not depend on which ids the sender typed. `testNoIntrospection721_throughTheErc20Path_isCaughtByTheOperatorQuestion`
pins it, the fork suite still accepts 20 of 20 real ERC-20s, and the residual that remains -- a contract with
`ownerOf` and `transferFrom` but neither ERC-165 nor `isApprovedForAll`, which is not an ERC-721 by the
standard's own definition -- is pinned as a known limit in
`testBareRevert721_withNeitherIntrospectionNorOperators_isTheResidual`. Its twin `_mustBeNft` was considered
and left alone: its failure direction is refusal, and the operator question would let an ERC-1155 into the
NFT form.
