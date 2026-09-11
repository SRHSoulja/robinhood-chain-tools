# Prior art: what already exists, and why this is not just another loop

Reviewed 10 September 2026. This is a bounded comparison of the closest public implementations found, not a
claim that no other airdrop tool exists. Source links are pinned to the revisions examined so the comparison
can be repeated after those projects change.

## The standards do not provide one-to-many delivery

ERC-20 and ERC-721 expose one recipient per transfer. ERC-1155 has a
[`safeBatchTransferFrom`](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-1155.md#safeBatchTransferFrom)
operation, but its arrays are token ids and amounts for one `from` and one `to`; it does not send one holder's
tokens to a list of recipients. A one-to-many sender therefore needs either repeated wallet calls, a helper
contract, or a claim system.

## Closest implementations examined

| project | useful precedent | materially different from this product |
| --- | --- | --- |
| [Disperse](https://github.com/banteg/disperse/blob/15fa895bf05478a95f8fe1af11746fae2551292e/brownie-disperse/contracts/Disperse.sol) | Small, permissionless ETH/ERC-20 distribution contract; direct and contract-funded ERC-20 variants | No ERC-721 or ERC-1155; all-or-nothing only; its documented interface requires boolean ERC-20 returns |
| [GasliteDrop](https://github.com/PopPunkLLC/gaslite-core/blob/808376786ac3903cf97ce33536ebfd4c4b871691/src/GasliteDrop.sol) and [GasliteDrop1155](https://github.com/PopPunkLLC/gaslite-core/blob/808376786ac3903cf97ce33536ebfd4c4b871691/src/GasliteDrop1155.sol) | Permissionless, highly optimized push delivery for ERC-20, ERC-721, ERC-1155 and native currency | All-or-nothing only; no per-row result or bounded failure isolation; the ERC-20 path pulls the total into the helper before distributing it and the assembly checks call success rather than decoding token return data |
| [thirdweb Airdrop](https://github.com/thirdweb-dev/contracts/blob/0da770f27209774061e118401e8b9796ead97ced/contracts/prebuilts/airdrop/Airdrop.sol) | The broadest precedent: push, Merkle-claim and signed distributions for native currency and all three token standards | Owner-initialized and stateful, with claim roots, processed request ids and signatures; the push methods are all-or-nothing and serve an administered distribution contract rather than a stateless public utility |
| [Safe MultiSend](https://github.com/safe-fndn/safe-smart-account/blob/d9996a336705f1d87b8b93814b1031c9b8cb9ad7/contracts/libraries/MultiSend.sol) | Mature generic atomic batching of arbitrary calls | Must execute by delegatecall in a Safe; it does not understand recipient lists, token standards, partial delivery or retry state |
| [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792) | Standard wallet RPC for ordered call batches, capability discovery, atomicity requests and later status reads | Wallet support is optional; non-atomic execution exists; status is wallet evidence rather than proof that each intended token balance changed |

A claim drop is important prior art too. It is usually the better design when recipients can pay their own
gas and the sender does not require immediate push delivery. thirdweb's contract supports that mode. BulkSend
deliberately solves the other case: the sender already owns arbitrary existing tokens and wants to push them
without changing the token contract or operating a claim service.

## What was reused

- The direct `transferFrom(sender, recipient, …)` shape used by Disperse and other permissionless helpers.
- Standard ERC-721/1155 safe receiver behavior, including the fact that some EIP-7702 delegated wallets
  cannot receive safe transfers.
- EIP-5792 capability discovery, `wallet_sendCalls`, explicit atomicity, and `wallet_getCallsStatus` for the
  optional no-approval path.
- Ascending ERC-1155 token-id order, which the ERC-1155 standard itself recommends for implementations whose
  storage layout makes that cheaper.
- The distinction Safe makes explicit: a batch is only all-or-nothing when the execution mechanism actually
  guarantees atomicity.

## What remains specific here

The contract is ownerless, permissionless, stateless, fee-free and has no upgrade path. It supports both
all-or-nothing and bounded-gas keep-going execution for ERC-20, ERC-721 and ERC-1155, reports each skipped row,
and refuses ambiguous ERC-20 results rather than calling them success or failure.

The larger difference is the browser workflow, not the transfer loop. It parses and maps real recipient-file
formats, simulates the exact batches before signing, checks token-standard mismatches, plans around measured
gas without claiming a ceiling, records a request before asking the wallet, reconciles interrupted sends from
receipts and balances, and keeps uncertain rows held so a retry does not silently pay them twice. The separate
Check page explains calldata and simulates an unsent call.

No examined project combined those behaviors. That is not proof each feature is novel; it is the reason a
wholesale swap to one of these contracts would remove reviewed behavior rather than simply replace custom
code with a known equivalent.

## What should still be borrowed or benchmarked

- Compare final mainnet gas against Gaslite and Disperse using identical lists and token contracts. Assembly
  savings are useful only after preserving return-data checks, skip semantics and useful failure evidence.
- Offer a claim-based path as a separate future product when shifting gas to recipients is acceptable. It
  should not be folded into this contract late in the release cycle.
- Keep EIP-5792 conformance tests aligned with the current specification, especially status values, chain id,
  sender, atomicity and bundle-too-large behavior.
- Treat Safe Transaction Builder as an export target for Safe users rather than pretending the present
  injected-wallet flow is a Safe-native interface.

The release implication is conservative: prior art validates the need and several design primitives, but it
does not remove the need to review this implementation's extra failure and recovery behavior. It also does
not justify changing the deployed contract late merely to resemble a better-known, differently-scoped one.
