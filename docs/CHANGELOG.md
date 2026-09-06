# Changelog

Every version below was deployed to Robinhood Chain **testnet** (chain id 46630) and verified on the block
explorer. Nothing has been deployed to mainnet. Superseded addresses are left in
[`deployments.testnet.json`](../deployments.testnet.json) as tombstones so any transaction referring to one
can still be traced.

## v7 — `0xC6AE3189eDAE544Ed60ADf5Ec057E338ce224F74` (current)

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
