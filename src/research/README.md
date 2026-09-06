# Research contracts, not part of the tool

Neither of these is deployed by the airdrop page, referenced by it, or used by `BulkSend`. They exist because
the wallet-batch path had to be proven against the real mechanism before the page was allowed to rely on it.

- **`Batch7702.sol`** — the shape a wallet delegates to under EIP-7702 so it can run several calls as itself.
  Real wallets ship their own; this one made it possible to exercise the path end to end on a fork.
- **`SelfBatch.sol`** — the same idea reduced to one function, used to demonstrate that a collection guarded by
  a creator transfer validator will move for its owner but not for any third-party operator.

They are kept in `src/` so they still compile and cannot silently rot. If you are auditing the tool, the
contract that matters is `src/BulkSend.sol`; these two are context.
