# Rebuilding `web/wc.js`

`web/wc.js` is the WalletConnect provider, bundled so the airdrop page can import it from its own origin
rather than from a third party's CDN. It is 2 MB, which is why it ships as a built file rather than as source.

    cd web/wc-build
    npm ci            # package-lock.json pins every transitive dependency
    npm run build     # writes ../wc.js
    sha256sum ../wc.js
    cat EXPECTED-SHA256

`../wc.js` is exactly what those commands produce. That was not true until 2026-09-07: the file shipped
before then was 2,092,684 bytes with digest `050632a7…`, while the pinned toolchain produces 2,092,782 bytes
with digest `d4c35a1b…`. The difference was in esbuild's generated module helpers, consistent with the
original having been built by a different version of esbuild. An external reviewer found it by simply
following these instructions and comparing, which is the point of writing them down.

The bundle was replaced with the reproducible one, `EXPECTED-SHA256` updated deliberately, and both were
checked to load and export the same interface before deploying. CI rebuilds on every push and fails if the
result stops matching, so the source-to-artifact link cannot quietly come apart again.

`deploy/publish.sh` bakes that digest into the Worker, which refuses to serve a `/wc.js` that does not match
it. So the chain is: pinned source and lockfile → this file → the digest in the Worker → what the browser
loads. If your rebuild differs, something in that chain has moved and is worth understanding before trusting
either file.
