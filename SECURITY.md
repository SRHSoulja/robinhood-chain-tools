# Security

## Reporting

**Privately, please, if it is exploitable.** Use GitHub's private vulnerability reporting on this repository
(Security tab → Report a vulnerability). That opens a channel only the maintainer can see, so a live issue is
not published to everyone while it is still live. For anything that is not exploitable, a normal issue is
fine. There is no bounty.

## Transport

Both pages are served over HTTPS only. Every response **that this project's Worker produces** redirects plain
HTTP permanently and carries `Strict-Transport-Security` -- the successes, the redirects and the errors alike
-- so a browser that has seen the site once over HTTPS will not try HTTP again. The header is sent on the HTTP
redirect too, but say what that is worth: a browser is required to ignore HSTS on a plain-HTTP response, so it
is the first *HTTPS* answer that pins someone, not the redirect that got them there.

**Where that stops being true, because "every" was wrong when this said it.** `/cdn-cgi/*` is reserved by
Cloudflare and answered ahead of any Worker, so nothing in this repository can put a header on it:

    curl -sSI http://rhairdrop.gmgnrepeat.com/cdn-cgi/trace   ->  404, no HSTS, and no redirect

The missing redirect on the HTTP side also shows that zone-level "Always Use HTTPS" is off: the 301 you get on
`/` comes from the Worker, so the only thing pinning HTTP visitors is code that cannot run on that namespace.
Practical exposure is narrow -- a visitor's first-ever contact with the host would have to be a `/cdn-cgi/*`
URL over plain HTTP -- but Cloudflare's own beacon posts to `/cdn-cgi/rum` on this same host, so it is not a
namespace nobody touches. Closing it needs zone-level HSTS and "Always Use HTTPS" enabled in the Cloudflare
dashboard, which covers Cloudflare-generated responses, WAF blocks and 5xx interstitials as well. That is a
commitment across the whole domain rather than these two pages, so it is the domain owner's call and not
something this repository can make; until it is made, this section says so rather than claiming otherwise. This matters
more here than on an ordinary site: the page builds transactions, and a page delivered once over HTTP could be
replaced in transit before any of its own protections exist. HSTS preload is deliberately not set, because
that is a commitment on behalf of every subdomain of the domain rather than just these two.

The content security policy allows scripts only from this origin, names the page's own inline script by
SHA-256 hash rather than allowing inline scripts generally, and permits `cdnjs.cloudflare.com` for the pinned
ethers build (which also carries Subresource Integrity) and `static.cloudflareinsights.com` for the analytics
beacon Cloudflare injects at the edge. It is sent as a response header as well as a meta tag.

## Chain evidence

Every balance, owner, receipt and simulation the pages show comes through one configured RPC endpoint. A
token can lie in its own read functions or events, and a node can be stale, faulty or dishonest. The block
explorer is a separate service and a useful comparison, not cryptographic proof. If the page and explorer
disagree, stop rather than treating either answer as permission to pay a recipient again.

## What this software can and cannot do to you

`BulkSend` has no owner, no upgrade path, no fee, no pause and no stored state. Every transfer it makes is
`transferFrom(msg.sender, …)`, so it can only move what you approved, inside the transaction you signed. It
cannot move anything on its own, and it cannot be made to do so later by anyone, including whoever wrote it.

It cannot give anything back. There is no rescue function, so anything sent **to** the contract is lost. The
contract refuses itself as a recipient, and the page refuses it too.

Approving a bulk sender is a real risk in general: an allowance outlives the transaction that used it. **What
that exposure is depends on the standard, and it is not the same for all three:**

| | what the page asks you to approve | what that lets BulkSend move until you revoke |
| --- | --- | --- |
| **ERC-20** | `approve(BulkSend, exact batch total)` | that amount of that token, and no more |
| **ERC-721** | `setApprovalForAll(BulkSend, true)` | **every NFT you own in that collection**, now and any you acquire later |
| **ERC-1155** | `setApprovalForAll(BulkSend, true)` | **every id and quantity you own in that contract**, now and later |

That is not a choice this page made. ERC-721 and ERC-1155 define no per-token operator approval that a batch
sender can use: `setApprovalForAll` is the only one either standard has, and it is all-or-nothing over the
whole contract. The single-token `approve(to, tokenId)` on ERC-721 grants one id to one address, which cannot
express "these forty ids to this contract".

So for the two NFT standards the honest statement is that **the approval is wider than the batch**, it lasts
until you revoke it, and the thing that keeps it safe is that `BulkSend` has no owner, no upgrade path and no
way to move anything except inside a transaction you sign. The page offers a Revoke button and tells you to
use it. Use it.

Because the contract is immutable and has no pause, once you have approved it for a collection **the page is
the only lever anyone has.** Taking the page down, or republishing it with mainnet switched off, does not
revoke an approval already granted; only a revoke transaction from your own wallet does that.

There is one route that needs no approval at all: if your wallet supports EIP-5792 batching, the page sends
the transfers as your own wallet and `BulkSend` is never approved for anything. The page prefers that route
when the wallet offers it.

## What a delivery count means

`BulkSend` reports a delivery when the token's own transfer function was called and did not revert. A token
that accepts the call and moves nothing, or moves less than asked, produces the same report. No contract can
check this from the inside. Treat the count as what was attempted and the chain as what happened.

## Status

Deployed on testnet only. Nothing here has been reviewed by a human audit firm.
[docs/for-reviewers.md](docs/for-reviewers.md) is the current threat model and the full review history;
[docs/audit-2026-09-11-seventeenth-external.md](docs/audit-2026-09-11-seventeenth-external.md) is the most recent
review in full, and [docs/status.md](docs/status.md) says which of its findings are closed and which are not. Every audit is in [docs/](docs/), unedited and in order. Read the newest one: the older reports describe
code that has since been rewritten, and several of their findings were themselves introduced by the fix for an
earlier one.

## Signed commits

Commits and tags from 12 September 2026 onward are signed with the maintainer's SSH key, fingerprint
`SHA256:h7qfEZ2laSGtWhvq3aePPj2dHd2ygeRr/PVDtoOWQnI`, and show as Verified on GitHub. To check a signature
yourself rather than trust the badge, put the maintainer's email and public key on one line of an
allowed-signers file, point `gpg.ssh.allowedSignersFile` at it, and run `git log --show-signature`. Earlier
commits are unsigned; the release tag is the one that matters, and it will be signed.

