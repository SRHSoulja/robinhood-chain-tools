# Security

## Reporting

Open an issue, or reach the maintainer through [gmgnrepeat.com](https://gmgnrepeat.com). There is no bounty.

## What this software can and cannot do to you

`BulkSend` has no owner, no upgrade path, no fee, no pause and no stored state. Every transfer it makes is
`transferFrom(msg.sender, …)`, so it can only move what you approved, inside the transaction you signed. It
cannot move anything on its own, and it cannot be made to do so later by anyone, including whoever wrote it.

It cannot give anything back. There is no rescue function, so anything sent **to** the contract is lost. The
contract refuses itself as a recipient, and the page refuses it too.

Approving a bulk sender is a real risk in general: an allowance outlives the transaction that used it. The page
approves the exact batch total rather than an unlimited amount, and tells you to revoke afterwards. Revoke
afterwards.

## Status

Deployed on testnet only. Nothing here has been reviewed by a human audit firm. See
[docs/for-reviewers.md](docs/for-reviewers.md) for the review history and
[docs/audit-2026-09-06-external.md](docs/audit-2026-09-06-external.md) for the last audit in full.
