#!/usr/bin/env python3
"""The published Content-Security-Policy, held to a table.

    python3 deploy/csp-gate.py web/index.html <sha256-...>

deploy/publish.sh calls this before it publishes anything, and it exits non-zero with a sentence saying what
is wrong. It lives in its own file rather than inside the publisher because a gate that can only be exercised
by publishing is a gate nobody tests: the run that would prove it works is the run that ships the thing it was
supposed to stop. test/csp-gate.test.sh doctors a copy of the page six ways and requires a refusal each time.
"""
import re, sys
path, want = sys.argv[1], sys.argv[2]
html = open(path, encoding="utf-8").read()
m = re.search(r'(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(">)', html)
assert m, "no CSP meta tag"
policy = m.group(2)
# This checks; it does not repair. A publisher that edits the file it is about to ship is a publisher that
# ships bytes no commit contains, which is exactly what the dirty-tree guard above exists to prevent.
# Presence is not the invariant. A policy naming this hash *and* an older one still authorizes the older
# inline script, so what is required is that the hash set in script-src is exactly this one.
src = re.search(r"script-src ([^;]*)", policy)
if not src:
    raise SystemExit("the page's CSP has no script-src")
hashes = sorted(t for t in src.group(1).split() if t.startswith("'sha256-"))
if hashes != ["'%s'" % want]:
    raise SystemExit(
        "the page's CSP must name exactly one script hash, its own.\n  script-src hashes: %s\n  this page's script: '%s'\nRun web/sync.sh and commit the result."
        % (", ".join(hashes) or "(none)", want))
# Naming the right hash is not the same as being a safe policy. A script-src can carry this exact hash and
# still authorize everything, so the rest of the directive is checked too.
NEVER = ("'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'", "'unsafe-hashes'", "*")
tokens = src.group(1).split()
for t in tokens:
    if t in NEVER:
        raise SystemExit(
            "the page's CSP script-src contains %s, which this project does not publish.\n"
            "  'strict-dynamic' in particular makes every host source below it irrelevant: any script the\n"
            "  hashed inline script inserts would load from anywhere, which is the whole thing the hash buys."
            % t)

# And the host sources are an allowlist, not whatever is there. An addition is loud, and a deliberate one is
# a one-line commit to this file rather than a change nobody sees.
# A CSP source expression may carry a path, and this one does. Granting the cdnjs ORIGIN meant any injection
# point that could add a <script src> got to pick any file on cdnjs, including builds of libraries chosen for
# what they do. The SRI is what protects the bytes and it still does; this reduces the grant from an origin to
# one file, and costs nothing. Note the trailing filename: a path that ends in a file matches that file only.
ALLOWED_SOURCES = {"'self'", "https://static.cloudflareinsights.com",
                   "https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.4/ethers.umd.min.js"}
extra = {t for t in tokens if not t.startswith("'sha256-")} - ALLOWED_SOURCES
if extra:
    raise SystemExit(
        "the page's CSP script-src names sources this script does not know: %s\n"
        "  If that is deliberate, add it to ALLOWED_SOURCES in deploy/publish.sh in the same commit, so the\n"
        "  change is reviewable rather than silent." % ", ".join(sorted(extra)))

# script-src was the only directive this gate has ever read. Everything else in the policy published without a
# word: a host added to connect-src, `object-src 'none'` dropped, img-src widened to `*`, base-uri unset. On a
# page that builds transactions connect-src is the one that matters most, and it is a one-word diff inside a
# 700-character attribute nobody reads line by line. So the whole policy is held to a table now, and a
# directive this table has never heard of is refused rather than ignored -- otherwise the gate silently
# reverts to trusting whatever is new, which is the failure it was written to prevent.
FIXED = {
    "default-src":  "'none'",
    "object-src":   "'none'",
    "base-uri":     "'none'",
    "form-action":  "'none'",
    # Inline styles only, no host may serve any. 'unsafe-inline' in style-src cannot execute script; it is
    # accepted here deliberately and would not be accepted in script-src, where NEVER above refuses it.
    "style-src":    "'self' 'unsafe-inline'",
}
# Directives whose value is a set of hosts. Each is an allowlist: adding one is a one-line commit to this file
# in the same change, so it appears in a diff rather than only in a header.
HOSTS = {
    "script-src": None,        # already checked above, exhaustively
    "connect-src": {
        "'self'",
        "https://rpc.testnet.chain.robinhood.com", "https://rpc.mainnet.chain.robinhood.com",
        "https://robinhoodchain.blockscout.com", "https://explorer.testnet.chain.robinhood.com",
        "https://api.coinbase.com",
        "wss://relay.walletconnect.org", "wss://relay.walletconnect.com",
        "https://relay.walletconnect.org", "https://relay.walletconnect.com",
        "https://api.web3modal.org", "https://pulse.walletconnect.org",
        "https://explorer-api.walletconnect.com",
    },
    "img-src":   {"'self'", "data:", "blob:", "https://explorer-api.walletconnect.com", "https://imagedelivery.net"},
    "font-src":  {"https://fonts.reown.com"},
    "frame-src": {"https://verify.walletconnect.org", "https://verify.walletconnect.com"},
}
REQUIRED = ("default-src", "object-src", "script-src", "connect-src", "base-uri", "form-action")

seen = {}
for chunk in policy.split(";"):
    parts = chunk.split()
    if not parts: continue
    seen[parts[0]] = parts[1:]

missing = [d for d in REQUIRED if d not in seen]
if missing:
    raise SystemExit("the page's CSP is missing %s. Every one of these has to be present in every published\n"
                     "  policy; a page that drops one is not the page this gate approved." % ", ".join(missing))

for name, value in seen.items():
    if name in FIXED:
        if " ".join(value) != FIXED[name]:
            raise SystemExit(
                "the page's CSP has %s %s, and this project publishes %s %s.\n"
                "  If the change is deliberate, change FIXED in deploy/publish.sh in the same commit."
                % (name, " ".join(value) or "(empty)", name, FIXED[name]))
    elif name in HOSTS:
        if HOSTS[name] is None: continue
        extra = {t for t in value if not t.startswith("'sha256-")} - HOSTS[name]
        if extra:
            raise SystemExit(
                "the page's CSP %s names sources this script does not know: %s\n"
                "  If that is deliberate, add it to HOSTS in deploy/publish.sh in the same commit, so the\n"
                "  change is reviewable rather than silent. On a page that builds transactions, an addition\n"
                "  to connect-src is how it starts talking to somewhere it should not."
                % (name, ", ".join(sorted(extra))))
    else:
        raise SystemExit(
            "the page's CSP has a directive this gate has never heard of: %s.\n"
            "  Add it to FIXED or HOSTS in deploy/publish.sh in the same commit. An unknown directive is\n"
            "  refused rather than ignored, because ignoring it is how the gate quietly stops covering the\n"
            "  policy it is meant to cover." % name)

print("  CSP: one hash, its own; no unsafe token; every directive held to the table in publish.sh")
