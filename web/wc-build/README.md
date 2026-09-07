# Rebuilding `web/wc.js`

`web/wc.js` is the WalletConnect provider, bundled so the airdrop page can import it from its own origin
rather than from a third party's CDN. It is 2 MB, which is why it ships as a built file rather than as source.

    cd web/wc-build
    npm ci            # package-lock.json pins every transitive dependency
    npm run build     # writes ../wc.js
    sha256sum ../wc.js
    cat EXPECTED-SHA256

The digest of the committed file is in `EXPECTED-SHA256`, and `deploy/publish.sh` bakes that digest into the
Worker, which refuses to serve a `/wc.js` that does not match it. So the guarantee is not "this file was
definitely built from these inputs" — bundler output is not always byte-reproducible across machines and
versions — but "the file this repository contains is the only one the live page will load". If your rebuild
produces a different digest, that is worth investigating before trusting either file.
