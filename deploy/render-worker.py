#!/usr/bin/env python3
"""Renders the Worker script text that serves one page.

    python3 deploy/render-worker.py <page.html> <out worker.js> <airdrop|check> <wc_bundle_url> <wc_sha256> <csp_hash>

This is the exact template deploy/publish.sh used to build inline, moved here so a test can render the same
worker.js publish.sh would produce without publishing anything. publish.sh calls render(...) through this
script's command line; test/worker.test.mjs calls it the same way. Neither one guesses at the template: there
is one copy of it, and this file is it.
"""
import json, re, sys


def render(src, target, wc_bundle, wc_sha, csp_hash):
    m = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)">', open(src, encoding="utf-8").read())
    assert m, "no CSP meta tag to derive the header from"
    # The same policy the page carries, sent as a header as well, where a browser cannot be tricked out of it by
    # anything that arrives before the meta tag is parsed. Plus the framing and form rules.
    csp_header = m.group(1) + "; frame-ancestors 'none'"
    html = open(src, encoding="utf-8").read()

    wc_route = """
  // The WalletConnect bundle is served from this same origin, so importing it needs no CORS and the page
  // never takes signing code from a third party.
  if (url.pathname === '/wc.js') {
    if (!WC_BUNDLE) return new Response('connector not configured', { status: 404, headers: secure() });
    // The digest is in the URL, so the edge cache is keyed on the exact bundle. Without it a changed bundle
    // is fetched from a day-old cache, fails its own digest check, and the connector goes dark until the
    // cache expires: the check is right and the input to it is stale.
    const upstream = await fetch(WC_BUNDLE + (WC_BUNDLE.includes('?') ? '&' : '?') + 'v=' + (WC_SHA256 || ''), { cf: { cacheEverything: true, cacheTtl: 86400 } });
    if (!upstream.ok) return new Response('connector unavailable', { status: 502, headers: secure() });
    // Read it, hash it, and serve it only if it is the file this deployment was built against. Without this
    // the page's own signing code could change after review without anything here changing.
    const bytes = await upstream.arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (WC_SHA256 && digest !== WC_SHA256) return new Response('connector digest mismatch', { status: 502, headers: secure() });
    return new Response(bytes, { headers: Object.assign(secure(), { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400' }) });
  }
""" if target == "airdrop" else ""

    # Gate 11 needs this on both pages, not just Check: Assign's holder-snapshot fallback and NFT inventory
    # read through it on the airdrop page, exactly as source verification and revert reasons do on Check
    # (docs/plan.md, "the airdrop page must route through the Worker on mainnet"). So this is no longer
    # generated for one target only.
    x_route = """
  // The mainnet explorer sends no Access-Control-Allow-Origin, so a browser cannot read it from this page.
  // A worker can: it is a server. Read-only, one host per chain id, and nothing but the API path is passed on.
  const x = url.pathname.match(/^\\/x\\/(4663|46630)(\\/[A-Za-z0-9_\\-\\/.]{1,200})$/);
  if (x) {
    const base = EXPLORERS[x[1]];
    if (!base || x[2].includes('..')) return new Response('bad path', { status: 400, headers: secure() });
    const upstreamFail = (status) => new Response(JSON.stringify({ error: 'upstream', status: status || 0 }), {
      status: 200,
      headers: Object.assign(secure(), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }),
    });
    const upstreamOk = (body) => new Response(JSON.stringify(body), { status: 200, headers: Object.assign(secure(), {
      'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' }) });

    // Gate 11: the mainnet explorer challenges every non-browser client, this worker included, so every
    // /x/4663 answer would be the upstreamFail envelope above on its own. Blockscout is retiring per-instance
    // keys for a multichain PRO API that serves chain 4663, but only in the Etherscan-style module shape, not
    // the REST shape these four page paths ask for -- checked with a key on 11 September 2026 -- so each one
    // is translated here when a key is bound. Everything else on mainnet, and everything on testnet, falls
    // through to the direct passthrough further down, unchanged. The spec is docs/gate-11-explorer.md.
    if (x[1] === '4663' && env.BLOCKSCOUT_KEY) {
      const mod = async (params) => {
        const u = new URL('https://api.blockscout.com/v2/api');
        for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
        u.searchParams.set('chain_id', '4663');
        u.searchParams.set('apikey', env.BLOCKSCOUT_KEY);
        let r;
        try {
          // Round eighteen S-7 and S-8: these subrequests are not cached at the edge. Cached for a minute, a NOTOK
          // answer was everyone's answer for a minute, and the key in the URL was part of the cache key. Good
          // answers are cached by this Worker's own response header; failures carry no-store.
          r = await fetch(u.toString(), {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(10000),
            cf: { cacheTtl: 0 },
          });
        } catch (e) { return { ok: false, status: 0 }; }
        const ct = String(r.headers.get('content-type') || '');
        if (!r.ok || !ct.includes('json')) return { ok: false, status: r.status };
        let json; try { json = await r.json(); } catch (e) { return { ok: false, status: r.status }; }
        // Round eighteen B-1/B-2: a 200 with {"status":"0"} (not found, rate limit, NOTOK) or with no status at
        // all ({"error":"Unauthorized"}) is not an answer, and deriving anything from it invented a field --
        // every unverified contract read as verified. Only the success shape gets past this line.
        if (!json || String(json.status || '') !== '1') return { ok: false, status: r.status };
        return { ok: true, json };
      };

      let mm;
      if ((mm = x[2].match(/^\\/tokens\\/(0x[0-9a-fA-F]{40})\\/holders$/))) {
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
        const res = await mod({ module: 'token', action: 'getTokenHolders', contractaddress: mm[1], page: String(page), offset: '100' });
        if (!res.ok) return upstreamFail(res.status);
        if (!Array.isArray(res.json.result)) return upstreamFail(res.status || 200);
        const result = res.json.result;
        return upstreamOk({
          items: result.map((h) => ({ address: { hash: h.address }, value: h.value })),
          next_page_params: result.length === 100 ? { page: page + 1 } : null,
        });
      }
      if ((mm = x[2].match(/^\\/addresses\\/(0x[0-9a-fA-F]{40})\\/nft$/))) {
        const addr = mm[1].toLowerCase();
        // The module API has no inventory call (checked: "Unknown action"), so holdings are derived here by
        // netting every transfer of every id this address has ever touched, newest first, one upstream page
        // at a time so the free tier's 5-requests-a-second limit is never burst. It stops as soon as a page
        // comes back short, which is the end of this address's history.
        const held = new Map();   // "contract|id" (lowercased) -> [net count, original contract, original id]
        let hitCeiling = false;
        for (let page = 1; page <= 20; page++) {
          const res = await mod({ module: 'account', action: 'tokennfttx', address: mm[1], page: String(page), offset: '100', sort: 'desc' });
          if (!res.ok || !Array.isArray(res.json.result)) return upstreamFail(res.status || 200);   // B-3: not a shorter inventory
          const result = res.json.result;
          for (const t of result) {
            const key = String(t.contractAddress).toLowerCase() + '|' + String(t.tokenID);
            const cur = held.get(key) || [0, t.contractAddress, t.tokenID];
            const toIt = String(t.to || '').toLowerCase() === addr;
            const fromIt = String(t.from || '').toLowerCase() === addr;
            cur[0] += (toIt ? 1 : 0) - (fromIt ? 1 : 0);
            held.set(key, cur);
          }
          if (result.length < 100) break;
          if (page === 20) hitCeiling = true;   // B-3: the walk stopped because of this limit, not because it was done
        }
        let truncated = hitCeiling;
        let entries = [...held.values()].filter((e) => e[0] > 0);
        if (entries.length > 2000) { entries = entries.slice(0, 2000); truncated = true; }
        return upstreamOk({
          items: entries.map((e) => ({ token: { address_hash: e[1] }, id: e[2] })),
          next_page_params: null,
          truncated,
        });
      }
      if ((mm = x[2].match(/^\\/transactions\\/(0x[0-9a-fA-F]{64})$/))) {
        const res = await mod({ module: 'transaction', action: 'gettxinfo', txhash: mm[1] });
        if (!res.ok) return upstreamFail(res.status);
        if (!res.json.result || typeof res.json.result !== 'object') return upstreamFail(res.status || 200);
        const r = res.json.result;
        const success = r.success === true || r.success === 'true';
        const out = { hash: mm[1], status: success ? 'ok' : 'error', from: { hash: r.from || null }, to: { hash: r.to || null } };
        if (r.revertReason) out.revert_reason = r.revertReason;
        return upstreamOk(out);
      }
      if ((mm = x[2].match(/^\\/smart-contracts\\/(0x[0-9a-fA-F]{40})$/))) {
        const res = await mod({ module: 'contract', action: 'getsourcecode', address: mm[1] });
        if (!res.ok) return upstreamFail(res.status);
        const arr = Array.isArray(res.json.result) ? res.json.result : null;
        if (!arr || !arr.length || typeof arr[0] !== 'object') return upstreamFail(res.status || 200);
        const r = arr[0];
        // An unverified contract on this chain answers status "1" with a record holding only its Address (captured
        // 11 September 2026): no ABI key at all. So verified means a non-empty ABI string was published, and
        // nothing else; the old test read a missing ABI as verified.
        const isVerified = typeof r.ABI === 'string' && r.ABI.trim() !== '' && r.ABI !== 'Contract source code not verified';
        let abi = [];
        if (isVerified) { try { abi = JSON.parse(r.ABI); } catch (e) { abi = []; } }
        return upstreamOk({
          is_verified: isVerified,
          is_partially_verified: null,   // round nineteen F-8: the module API does not say; null, not a claim
          name: r.ContractName || null,
          abi,
          compiler_version: r.CompilerVersion || null,
          optimization_enabled: r.OptimizationUsed === '1',
          evm_version: r.EVMVersion || null,
          proxy_type: r.IsProxy === 'true' ? 'unknown' : null,
          implementations: r.ImplementationAddress ? [{ address: r.ImplementationAddress }] : [],
          verified_at: r.VerifiedAt || null,
        });
      }
      // x[2] matched none of the four known page paths: fall through to the direct passthrough below, which
      // is the same challenge-page answer this got before the translation layer existed.
    }

    const search = url.search;
    // The mainnet explorer answers browsers and challenges everything else, so ask the way a browser does.
    // One reader's lookup at a time, cached at the edge for a minute so it stays that way.
    // The user-agent below no longer buys anything: Blockscout's managed challenge fires on the mainnet
    // explorer regardless of it, so every /x/4663/* request degrades. Kept because it costs nothing and the
    // testnet explorer still answers, but it is not a working spoof and the code should not imply it is.
    // `redirect: 'manual'` because following one would let an explorer decide which host gets to put a
    // document on this origin.
    const upstream = await fetch(base + '/api/v2' + x[2] + search, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' },
      redirect: 'manual',
      cf: { cacheEverything: true, cacheTtl: 60 },
    });
    // Only a real answer is worth keeping. The explorer occasionally answers a challenge page instead, and
    // caching that for a minute serves the failure to everyone who asks in that minute -- including after the
    // explorer has recovered. A transient error must not become the cached answer.
    const good = upstream.ok && String(upstream.headers.get('content-type') || '').includes('json');
    // Refusing to relabel a bad response is not the same as refusing to serve its bytes, which is what this
    // used to do. Nothing that is not a real JSON answer is passed through at all now: not the body, and not
    // the status. The status matters as much as the body, because Cloudflare intercepts a 404 from a worker
    // and substitutes this origin's own page for it, without any of the headers above. The page's reader
    // already treats this shape as "could not check" rather than "nothing found", which is the distinction
    // that keeps a failed lookup from being reported as a clean bill of health.
    if (!good) {
      return new Response(JSON.stringify({ error: 'upstream', status: upstream.status }), {
        status: 200,
        headers: Object.assign(secure(), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }),
      });
    }
    return new Response(upstream.body, { status: 200, headers: Object.assign(secure(), {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60' }) });
  }
"""

    return """// Serves the %s page from Cloudflare's edge. Generated by deploy/publish.sh; do not edit by hand.
const HTML = %s;
const WC_BUNDLE = %s;
const WC_SHA256 = %s;
const CSP = %s;
const EXPLORERS = { '4663': 'https://robinhoodchain.blockscout.com', '46630': 'https://explorer.testnet.chain.robinhood.com' };
// Sent on every response. A wallet-connected page delivered once over plain HTTP can be replaced in transit
// before any of its own protections exist, so the first request is redirected and the browser is told never
// to try HTTP again. No preload: that is a decision about every subdomain, not just this one.
const HSTS = 'max-age=31536000; includeSubDomains';
// Every response this worker constructs goes through here, the failures included. A visitor whose first
// contact with the host is a 400 or a 502 is exactly the visitor who has not been pinned to HTTPS yet, and
// leaving those bare made "on every response" untrue in the one case where it mattered most.
const secure = () => ({
  'strict-transport-security': HSTS,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  // Everything this worker returns other than the page itself. `frame-ancestors` cannot be written in a
  // <meta> tag, so a response carrying no CSP header has no framing protection at all, whatever the document
  // inside it says about itself.
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox",
});
export default { async fetch(request, env) {
  const url = new URL(request.url);
  const visitor = request.headers.get('cf-visitor') || '';
  if (url.protocol === 'http:' || visitor.includes('"scheme":"http"')) {
    url.protocol = 'https:';
    // A browser ignores HSTS on a plain-HTTP response, so this header changes nothing on its own -- but the
    // documentation said every response carries it, and a claim that is false anywhere is a claim nobody can
    // check. It is carried here too, and the sentence in SECURITY.md now says what actually pins a visitor.
    return new Response(null, { status: 301, headers: Object.assign(secure(), { location: url.toString() }) });
  }
%s%s  // Anything else goes to the page rather than to a 404. Cloudflare replaces the headers on an error
  // response from a worker, so a 404 here arrives without HSTS or the rest of the hardening: a visitor whose
  // first ever contact with this host is a mistyped path would not be pinned to HTTPS. A redirect keeps them.
  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    return new Response(null, { status: 302, headers: Object.assign(secure(), { location: '/' }) });
  }
  return new Response(HTML, { headers: Object.assign(secure(), { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'content-security-policy': CSP }) });
} };
""" % (target, json.dumps(html), json.dumps(wc_bundle or None), json.dumps(wc_sha or None), json.dumps(csp_header), wc_route, x_route)


if __name__ == "__main__":
    src, out, target, wc_bundle, wc_sha, csp_hash = sys.argv[1:7]
    open(out, "w", encoding="utf-8").write(render(src, target, wc_bundle, wc_sha, csp_hash))
