# Changelog

Every version below was deployed to Robinhood Chain **testnet** (chain id 46630) and verified on the block
explorer. Nothing has been deployed to mainnet. Superseded addresses are left in
[`deployments.testnet.json`](../deployments.testnet.json) as tombstones so any transaction referring to one
can still be traced.

## v13 — `0xf2eD6359F5deE0334d68cd21d306D9D3E7a49232` (current)

Round thirteen's contract blocker, and the thing writing its test showed.

- **`_mustNotBeNft` was not the mirror it said it was.** v12 taught `_mustBeNft` that probing one id is not
  enough -- the id in hand can be burned or never minted -- and wrote its mirror the same day probing one
  value. A sender holding ids 2 and 3 of a collection, with id 1 unminted, pasting the collection into the
  token form got two real ERC-721 `Transfer` events and an `Airdrop20(sent 2, skipped 1)` in one transaction.
  Demonstrated on chain against v12 (`0xc6b4cf63…`), and the same paste against v13 is refused on chain
  with `IsAnNft` ([`0x5b46a00557…`](https://explorer.testnet.chain.robinhood.com/tx/0x5b46a00557302eb7ec212a655e10e0d77707ba1b2d115076a2559fb656aae851)): the explorer decodes the
  revert, records no log, and both ids are still with the sender. The guard is now the same shape as its twin: ERC-165
  first, then the first id, then the last.
- **And then one question that does not depend on ids at all.** Writing the test for that second probe showed
  what two id probes cannot see: a collection with no ERC-165 whose live ids are in the middle of the list
  answers neither. So the guard also asks `isApprovedForAll(address,address)`, which every ERC-721 and every
  ERC-1155 must have and no ERC-20 has. A 32-byte answer means the thing pasted into the token form is an NFT
  contract of one kind or the other. A hybrid that is both, ERC-404 style, is refused too, on purpose: in such
  a token an amount that happens to be a live id moves an NFT, which is this exact hazard. Against a read-only
  fork of mainnet, 20 of 20 real collections are refused and 20 of 20 real ERC-20s still deliver.
- **The residual, written down.** A contract with `ownerOf` and `transferFrom` but neither ERC-165 nor
  `isApprovedForAll` is not an ERC-721 by the standard's own definition, and when both probed ids are dead
  there is nothing left to ask that a token would not also answer. Pinned as a known limit in
  `testBareRevert721_withNeitherIntrospectionNorOperators_isTheResidual`.
- Cost: four staticcalls on every ERC-20 batch, about 10,000 gas, against a batch that costs tens of millions.
  Nothing else in the contract changed; the diff against v12 is one function and its call.
- Every branch of the contract now has a test (100% branch coverage, from 82%), its properties hold over
  2,304 random calls in `test/Invariants.t.sol`, and `.gas-snapshot` records the gas of every test.
- Deployed and verified; runtime is 9,437 bytes, byte-for-byte equal to what this repository builds.

## v12 — `0xc2e4a9C4c9215600d1B348d02b63C6148d0Ef481`

Round twelve's contract findings, and one of them declined with its reason written down.

- **`airdrop20` had no mirror of the "is this an NFT" guard.** `transferFrom(address,address,uint256)` is one
  selector for both standards, and a conforming ERC-721 returns nothing, which the ERC-20 path reads as a
  USDT-style success. An NFT collection pasted into the ERC-20 form therefore spent its token *ids* as amounts:
  the NFTs left the wallet, and both the count and the `Airdrop20` event reported a token airdrop that never
  happened. v11 closed this direction for `airdrop721` and left the mirror open.
- **The "not an NFT" guard refused real collections.** It read a revert with empty returndata as proof that no
  `ownerOf` existed. That is true of OpenZeppelin v5 and ERC721A and false of `require(cond);` with no reason
  string, of Vyper's reference ERC-721, and of any bare `assert` -- all real ERC-721s. So a genuine collection
  was refused outright whenever the first id in the chunk happened to be burned or unminted, and refused with a
  message about the whole collection rather than that one row. It now tries a second id from the same list and
  then `supportsInterface(0x80ac58cd)` before refusing, and only in the failure path, so nothing costs more.
- **A returned `false` from an ERC-20 still takes the batch down, in both modes.** This one was argued the
  other way and declined. The reasoning for changing it is good: the standard defines `false` as "I did not
  transfer", so a conforming token answering it has moved nothing, and one blocklisted recipient should not
  cost a 400-row lenient batch. But `PaysThenLies20` in this repository's own fixtures moves the balance and
  *then* answers `false`, and from inside the call there is nothing to tell the two apart. Reporting a payment
  that happened as a skip is how a re-run pays someone twice. The choice, its cost, and what would have to
  change to revisit it are in [`for-reviewers.md`](for-reviewers.md) decision 3, and both halves are pinned by
  tests.
- Deployed and verified; runtime is 8,968 bytes, byte-for-byte equal to what this repository builds.

## v11 — `0x8a28d0487F2E10fb325E15B81445aa083a35E7fE`

The half of the same confusion the audit did not ask about. Refusing a token that *answers* closed the
"returns false" shape in v10. A token that returns **nothing** is byte-for-byte what a conforming ERC-721
transfer looks like from the caller's side, and USDT is exactly that shape. Measured before the guard existed:
`airdrop721` pointed at a no-return ERC-20, with an "id" of `100e18`, moved 100 real tokens and reported
`sent = 1`. So `airdrop721` began checking the shape of the contract before sending anything -- one staticcall
per batch, not per row. It also closed a separate finding about a one-byte `STOP` contract counted as a
delivery. The discrimination it used (an empty revert means no such function) was itself wrong for a class of
real collections, which is what v12 fixes.

## v10 — `0x240D8928d288E7d5c23dcF774Cf0a345bA4Af2b2`

Round eleven's two contract findings, after seven rounds with none.

- **The 721 and 1155 paths never read what came back.** The ERC-20 path refuses anything that is not exactly
  empty or exactly `1`; the other two treated "the call did not revert" as delivered. So `airdrop721` pointed
  at an ERC-20 that returns `false` reported `sent = 3, skipped = 0` with every balance still zero -- and with
  that token approved, it read the token *ids as amounts* and moved real balances. A conforming 721/1155
  transfer returns void, so anything coming back now reverts `AmbiguousResult`. Strict mode had the same hole
  by a different door: a high-level call to a void function ignores what comes back.
- **`ZERO_REASON` was the selector of an error this contract does not declare.** A blank row in a spreadsheet
  produced "reverted with 0x9fabe1c1", in the one case where the contract knows the answer exactly. It is
  `ZeroRecipient(i)` now, and it carries the row number.

## v9 — `0x91949D7328387A3613b29E56f6979Ae893ccd23C`

The third external audit's contract finding, and the one that mattered most in the whole series.

- **A recipient's receive hook could write into the receipt the client reads.** The hook runs in the middle of
  a batch, and a hostile one could call `BulkSend` again and emit real `Skipped` and `Airdrop*` events from the
  real address, naming whatever row it liked. The client reads that receipt to decide who was paid, so a
  recipient could have itself recorded as skipped *after* being paid, and collect again on the retry.
  Reproduced before it was fixed: one row in, one injected `Skipped` event and two summaries out.
- **The fix is a transient lock** (EIP-1153 `TSTORE`/`TLOAD`, `Reentered()`), about 100 gas, storing nothing
  between transactions. A recipient whose hook legitimately calls back in is skipped in lenient mode rather
  than trusted.
- The client now reads a receipt as though the contract had not: every event must be about this token and this
  sender, there must be exactly one summary, and sent plus skipped must equal the batch that was sent.

The contract has not changed since. Rounds four through nine of the external review found nothing in it.

## v8 — `0x3159F3AbF0235eaCedfF866312Cb1BB335D6f80E`

The second external audit's contract finding.

- **An ERC-20 answer must be exactly nothing or exactly one word holding one.** It used to accept
  `ret.length >= 32`, and 64 bytes beginning with a one is not a `bool`. Proved on chain.

## v7 — `0xC6AE3189eDAE544Ed60ADf5Ec057E338ce224F74`

Closes the last open finding from the external audit, plus the client work the auditor asked for.

- **The lenient gas stipend is the caller's choice, inside bounds the contract enforces** (audit L-02).
  `airdrop721WithGas` / `airdrop1155WithGas` / `airdrop20WithGas` take `gasPerTransfer` between `MIN_GAS`
  (100,000) and `MAX_GAS` (5,000,000); the plain entry points still use `DEFAULT_GAS` (400,000). The point of
  the change is honesty: no constant separates an honest receiver from a hostile one, so 400,000 was a policy
  choice being presented as a correctness boundary. A stipend passed with strict mode reverts
  `GasIsForLenientOnly` rather than being accepted and ignored.
- **A gas reserve on top of the stipend.** `_tryCall` now requires `stipend + GAS_RESERVE` (40,000) to be
  available, because enough gas for a transfer is not enough gas for the transfer *and* the record of it.
- Cost of both: 13 gas per recipient and 1,312 runtime bytes, measured. The loop options moved into a memory
  struct because the legacy code generator ran out of stack otherwise.
- Client: a batch that was signed but never confirmed is written down and read back from the chain before
  anything else is sent; two identical rows are two payments, not one; the exact ordered list and its
  transaction boundaries are shown and downloadable before the confirmation; a connected wallet can be changed
  without reloading.

## v6 — `0x83b2A9C4a09976E0f5221aD198BCE1CB2A12ABD1`

The external audit's High and Medium contract findings.

- **H-01, the important one.** A lenient ERC-20 transfer that *succeeded* at the EVM level and returned
  something other than `true` was being counted as skipped. The balance may already have moved, so the page
  would invite a second payment to someone already paid. It now reverts `AmbiguousResult` and undoes the
  batch. This had been looked at before and dismissed in a code comment as fail-closed behaviour. It was not.
- **H-07.** `BulkSend` refuses to be its own recipient (`SelfRecipient`); it has no owner and no rescue
  function, so anything sent to it would be gone for good.
- **M-04.** Zero amounts are refused (`ZeroAmount`) instead of counted as deliveries.
- **L-02, half of it.** Strict mode no longer truncates the token's revert data, which used to hand back a
  fragment that no longer decoded as the error it came from.

## v5 — `0x752960A560EA676BEc736f55D98773eb0e1fb3DF`  *(the audited version)*

- Refuses an EIP-7702 delegated wallet as a token address: 23 bytes of `0xef0100 || address` is code, but it
  is not a contract, and calling it as one is how a mistyped address becomes a "successful" delivery.
- Strict mode bubbles the token's own error so the page can name the real reason.

## v4 — `0xd013c00eEc3E7f1b93223a75eaF50F77b863853F`

- Applied a gas review: ascending token id delivery (16% measured on chain, 27% on fresh ERC721A mints),
  `optimizer_runs = 10000`, strict-mode counting moved out of the loop.

## v3 — `0x0e6E6D592091fD5A43259cb33B67279C4f28FBfA`

- Second internal audit: the gas-starvation guard (`OutOfGasForBatch`), so a batch that cannot afford the
  stipend stops rather than blaming the recipient it ran out of gas on; the stipend extended to the ERC-20
  path; bounded revert data in lenient mode against return-bomb recipients.

## v2 — `0x7f8bA77De30099D4617657d3ec87e98484E568bF`

- First internal audit: the lenient-mode gas stipend against EIP-150 gas griefing, defensive ERC-20 return
  decoding, and pinned `solc` / `evm_version` / optimizer settings so the deployed bytecode is reproducible.

## v1 — `0x904412CFe982f33385f486aAff8C8a4A6f4B5fBf`

- First deploy, unoptimized. Refuses a token address with no code, because an empty return from an EOA looks
  exactly like a USDT-style success.
