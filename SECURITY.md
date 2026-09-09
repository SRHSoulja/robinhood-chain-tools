# Security

## Reporting

**Privately, please, if it is exploitable.** Use GitHub's private vulnerability reporting on this repository
(Security tab → Report a vulnerability). That opens a channel only the maintainer can see, so a live issue is
not published to everyone while it is still live. For anything that is not exploitable, a normal issue is
fine. There is no bounty.

## Transport

Both pages are served over HTTPS only. Plain HTTP is redirected permanently, and every HTTPS response carries
`Strict-Transport-Security` -- the successes, the redirects and the errors alike -- so a browser that has seen
the site once over HTTPS will not try HTTP again. The header is sent on the HTTP redirect too, but say what
that is worth: a browser is required to ignore HSTS on a plain-HTTP response, so it is the first *HTTPS*
answer that pins someone, not the redirect that got them there. This matters
more here than on an ordinary site: the page builds transactions, and a page delivered once over HTTP could be
replaced in transit before any of its own protections exist. HSTS preload is deliberately not set, because
that is a commitment on behalf of every subdomain of the domain rather than just these two.

The content security policy allows scripts only from this origin, names the page's own inline script by
SHA-256 hash rather than allowing inline scripts generally, and permits `cdnjs.cloudflare.com` for the pinned
ethers build (which also carries Subresource Integrity) and `static.cloudflareinsights.com` for the analytics
beacon Cloudflare injects at the edge. It is sent as a response header as well as a meta tag.

## What this software can and cannot do to you

`BulkSend` has no owner, no upgrade path, no fee, no pause and no stored state. Every transfer it makes is
`transferFrom(msg.sender, …)`, so it can only move what you approved, inside the transaction you signed. It
cannot move anything on its own, and it cannot be made to do so later by anyone, including whoever wrote it.

It cannot give anything back. There is no rescue function, so anything sent **to** the contract is lost. The
contract refuses itself as a recipient, and the page refuses it too.

Approving a bulk sender is a real risk in general: an allowance outlives the transaction that used it. The page
approves the exact batch total rather than an unlimited amount, and tells you to revoke afterwards. Revoke
afterwards.

## What a delivery count means

`BulkSend` reports a delivery when the token's own transfer function was called and did not revert. A token
that accepts the call and moves nothing, or moves less than asked, produces the same report. No contract can
check this from the inside. Treat the count as what was attempted and the chain as what happened.

## Status

Deployed on testnet only. Nothing here has been reviewed by a human audit firm.
[docs/for-reviewers.md](docs/for-reviewers.md) is the current threat model and the full review history;
[docs/audit-2026-09-08-tenth-external.md](docs/audit-2026-09-08-tenth-external.md) is the most recent audit in
full. Every audit is in [docs/](docs/), unedited and in order. Read the newest one: the older reports describe
code that has since been rewritten, and several of their findings were themselves introduced by the fix for an
earlier one.
