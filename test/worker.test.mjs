// Offline tests for gate 11: the Worker's /x/ route translating four Blockscout PRO API module calls into the
// REST shapes the pages read, when BLOCKSCOUT_KEY is bound. No network: every upstream call is answered from
// fixtures shaped like the calls verified against the real API on 11 September 2026 (docs/gate-11-explorer.md).
// A failure here is the translation's fault and nothing else.
//
//   node test/worker.test.mjs        (from the repository root)
//
// The worker under test is built the same way publish.sh builds it -- through deploy/render-worker.py, not a
// second copy of the template -- so this suite and the published worker can never quietly drift apart.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log('  ok   ' + name); };
const bad = (name, detail) => { fail++; console.log('  FAIL ' + name + (detail ? '  <- ' + String(detail).slice(0, 300) : '')); };
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

const ROOT = new URL('..', import.meta.url).pathname;
const KEY = 'test-key-should-never-leak-93a7f1';
const addrN = (n) => '0x' + n.toString(16).padStart(40, '0');

// ---------- fixtures, shaped like the module API's real answers ----------
const COLLECTION = addrN(0xc011);
const WALLET = addrN(0xdead);
const OTHER = addrN(0xbeef);
const ZERO = '0x0000000000000000000000000000000000000000';
const NFT_ID_HELD = '1';       // minted to WALLET, sent out, sent back -- net +1, still held
const NFT_ID_NOT_HELD = '2';   // minted to WALLET, sent out -- net 0, no longer held
const nftRecords = [
  { contractAddress: COLLECTION, tokenID: NFT_ID_HELD, from: ZERO, to: WALLET, hash: '0x' + '11'.repeat(32), blockNumber: '100' },
  { contractAddress: COLLECTION, tokenID: NFT_ID_HELD, from: WALLET, to: OTHER, hash: '0x' + '12'.repeat(32), blockNumber: '101' },
  { contractAddress: COLLECTION, tokenID: NFT_ID_HELD, from: OTHER, to: WALLET, hash: '0x' + '13'.repeat(32), blockNumber: '102' },
  { contractAddress: COLLECTION, tokenID: NFT_ID_NOT_HELD, from: ZERO, to: WALLET, hash: '0x' + '14'.repeat(32), blockNumber: '103' },
  { contractAddress: COLLECTION, tokenID: NFT_ID_NOT_HELD, from: WALLET, to: OTHER, hash: '0x' + '15'.repeat(32), blockNumber: '104' },
];

const HOLDERS_TOKEN = addrN(0x7071);
const holdersPage1 = Array.from({ length: 100 }, (_, i) => ({ address: addrN(0x9000 + i), value: String(1000 + i) }));
const holdersPage2 = [{ address: addrN(0x9999), value: '3' }, { address: addrN(0x9998), value: '4' }];

const TX_REVERTED = '0x' + 'a1'.repeat(32);
const TX_OK = '0x' + 'b2'.repeat(32);
const TX_FROM = addrN(0xf20a1), TX_TO = addrN(0xf20a2);

const SC_VERIFIED = addrN(0x5eed);
const SC_UNVERIFIED = addrN(0x5eef);
const SC_PROXY = addrN(0x5ee0);
const SC_IMPL = addrN(0x5ee1);
const VERIFIED_ABI = [{ type: 'function', name: 'foo', inputs: [], outputs: [], stateMutability: 'view' }];
// Round eighteen: the shapes the module API answers when there is NO answer, captured verbatim on chain 4663.
// An unverified contract is status "1" with a record holding only its Address -- no ABI key at all -- which the
// first translation read as verified. A rate limit, a rejected key and an unknown transaction are below.
const SC_UNVERIFIED_REAL = addrN(0x0259);   // {"message":"OK","result":[{"Address":"0x…"}],"status":"1"}
const SC_RATELIMIT = addrN(0x11a7);         // {"status":"0","message":"NOTOK","result":"Max rate limit reached"}
const SC_BADKEY = addrN(0xbad1);            // {"error":"Unauthorized"}  (no status field at all)
const TX_NOTFOUND = '0x' + 'c3'.repeat(32); // {"message":"Transaction not found","result":null,"status":"0"}
const HOLDERS_NOT_A_TOKEN = addrN(0x0001);  // {"message":"OK","result":[],"status":"1"}
const WALLET_MIDWALK = addrN(0x3a1d);       // page 1 full, page 2 a NOTOK envelope
const WALLET_CEILING = addrN(0xce11);       // twenty full pages

// ---------- the fake upstream: api.blockscout.com (module API), and both direct explorer hosts ----------
const okJson = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function makeFetch(callLog) {
  return async function fetchMock(url, init) {
    const u = new URL(String(url));
    // A queue of failures to hand out before answering normally: a number is an HTTP status to answer with,
    // 0 means the fetch itself throws. Lets a case say "the first two calls are 500s" without knowing the URL.
    if (u.hostname === 'explorer.testnet.chain.robinhood.com' || u.hostname === 'api.blockscout.com') (fetchMock.all = fetchMock.all || []).push(u.hostname);
    if (fetchMock.flaky && fetchMock.flaky.length && (u.hostname === 'api.blockscout.com' || u.hostname === 'explorer.testnet.chain.robinhood.com')) {
      const st = fetchMock.flaky.shift();
      (fetchMock.flakyLog = fetchMock.flakyLog || []).push(st);
      if (st === 0) throw new TypeError('network');
      return new Response(JSON.stringify({ error: 'Internal server error', source: 'upstream' }), { status: st, headers: { 'content-type': 'application/json' } });
    }
    if (u.hostname === 'api.blockscout.com') {
      callLog.push(u.toString());
      (fetchMock.inits = fetchMock.inits || []).push(init || {});
      const mod = u.searchParams.get('module'), action = u.searchParams.get('action');
      if (mod === 'token' && action === 'getTokenHolders') {
        const page = u.searchParams.get('page');
        if (String(u.searchParams.get('contractaddress') || '').toLowerCase() === HOLDERS_NOT_A_TOKEN.toLowerCase()) return okJson({ message: 'OK', result: [], status: '1' });
        const result = page === '2' ? holdersPage2 : holdersPage1;
        return okJson({ status: '1', message: 'OK', result });
      }
      if (mod === 'account' && action === 'tokennfttx') {
        const page = u.searchParams.get('page');
        const who = String(u.searchParams.get('address') || '').toLowerCase();
        const fullPage = (n) => Array.from({ length: 100 }, (_, i) => ({ contractAddress: COLLECTION, tokenID: String(n * 1000 + i), from: ZERO, to: who, hash: '0x' + '77'.repeat(32), blockNumber: String(n * 100 + i) }));
        if (who === WALLET_MIDWALK.toLowerCase()) return page === '1' ? okJson({ status: '1', message: 'OK', result: fullPage(1) }) : okJson({ status: '0', message: 'NOTOK', result: 'Max rate limit reached' });
        if (who === WALLET_CEILING.toLowerCase()) return okJson({ status: '1', message: 'OK', result: fullPage(Number(page)) });
        return okJson({ status: '1', message: 'OK', result: page === '1' ? nftRecords : [] });
      }
      if (mod === 'transaction' && action === 'gettxinfo') {
        const hash = u.searchParams.get('txhash');
        if (hash === TX_NOTFOUND) return okJson({ message: 'Transaction not found', result: null, status: '0' });
        if (hash === TX_REVERTED) return okJson({ status: '1', message: 'OK', result: { success: false, revertReason: 'Ownable: caller is not the owner', from: TX_FROM, to: TX_TO, input: '0xdeadbeef', logs: [] } });
        if (hash === TX_OK) return okJson({ status: '1', message: 'OK', result: { success: true, revertReason: '', from: TX_FROM, to: TX_TO, input: '0x', logs: [] } });
        return okJson({ status: '0', message: 'NOTOK', result: 'not found' });
      }
      if (mod === 'contract' && action === 'getsourcecode') {
        const addr = String(u.searchParams.get('address') || '').toLowerCase();
        if (addr === SC_UNVERIFIED_REAL.toLowerCase()) return okJson({ message: 'OK', result: [{ Address: SC_UNVERIFIED_REAL }], status: '1' });
        if (addr === SC_RATELIMIT.toLowerCase()) return okJson({ status: '0', message: 'NOTOK', result: 'Max rate limit reached' });
        if (addr === SC_BADKEY.toLowerCase()) return okJson({ error: 'Unauthorized' });
        if (addr === SC_VERIFIED.toLowerCase()) return okJson({ status: '1', message: 'OK', result: [{
          ABI: JSON.stringify(VERIFIED_ABI), ContractName: 'Foo', CompilerVersion: 'v0.8.19+commit.7dd6d404',
          OptimizationUsed: '1', Runs: '200', EVMVersion: 'paris', IsProxy: 'false', ImplementationAddress: '',
          SourceCode: 'contract Foo {}',
        }] });
        if (addr === SC_UNVERIFIED.toLowerCase()) return okJson({ status: '1', message: 'OK', result: [{
          ABI: 'Contract source code not verified', ContractName: '', CompilerVersion: '', OptimizationUsed: '0',
          Runs: '0', EVMVersion: '', IsProxy: 'false', ImplementationAddress: '', SourceCode: '',
        }] });
        if (addr === SC_PROXY.toLowerCase()) return okJson({ status: '1', message: 'OK', result: [{
          ABI: '[]', ContractName: 'Proxy', CompilerVersion: 'v0.8.19+commit.7dd6d404', OptimizationUsed: '1',
          EVMVersion: 'paris', IsProxy: 'true', ImplementationAddress: SC_IMPL,
        }] });
        return okJson({ status: '0', message: 'NOTOK', result: 'not found' });
      }
      return okJson({ status: '0', message: 'NOTOK', result: 'unhandled fixture call' });
    }
    if (u.hostname === 'robinhoodchain.blockscout.com') {
      // The real mainnet explorer's managed challenge: never a JSON answer, whatever is asked. Proves the
      // "mainnet without a binding" and "path the translation doesn't know" cases both still degrade to the
      // existing envelope rather than to something new.
      return new Response('<html>Attention Required! | Cloudflare</html>', { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (u.hostname === 'explorer.testnet.chain.robinhood.com') {
      // The testnet explorer answers a browser directly, so the passthrough proves itself by returning
      // exactly what it was given, unmodified -- not a translation of it.
      return okJson({ untouched: true, echoedPath: u.pathname + u.search });
    }
    throw new Error('worker.test.mjs: unexpected fetch to ' + u.toString());
  };
}

// ---------- render the worker exactly as publish.sh would, then load it ----------
// og/touch/trust are optional file paths, passed through to render-worker.py exactly as publish.sh passes
// them: paths it reads and embeds itself, not content this test pre-encodes.
function renderWorker(target, og, touch, trustHtml, trustOg) {
  const dir = mkdtempSync(join(tmpdir(), 'rh-worker-'));
  const src = join(ROOT, target === 'airdrop' ? 'web/index.html' : 'web/check.html');
  const out = join(dir, 'worker.mjs');
  const args = [join(ROOT, 'deploy/render-worker.py'), src, out, target, '', '', 'sha256-test'];
  if (og) args.push(og, touch);
  if (trustHtml) args.push(trustHtml, trustOg);
  execFileSync('python3', args, { cwd: ROOT, stdio: 'inherit' });
  return out;
}

// The Trust Center's policy, written out here rather than read from the page, because the point of the check
// is that this exact string is what the worker sends. A page and a header that agree because both were read
// from the same file would agree just as happily after someone changed it.
const TRUST_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// ---------- tiny valid PNG fixtures for /og.png and /apple-touch-icon.png (not the real files) ----------
// Two different 1x1 RGB PNGs, so a route that accidentally served the other one's bytes would be caught.
const OG_FIXTURE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNYJagEAAJGAN6pm1uMAAAAAElFTkSuQmCC', 'base64');
const TOUCH_FIXTURE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMw3u0CAAJXATP2D68sAAAAAElFTkSuQmCC', 'base64');
function writeFixtures() {
  const dir = mkdtempSync(join(tmpdir(), 'rh-og-fixture-'));
  const og = join(dir, 'og.png'), touch = join(dir, 'touch.png');
  writeFileSync(og, OG_FIXTURE);
  writeFileSync(touch, TOUCH_FIXTURE);
  return { og, touch };
}

// ---------- fixtures for /trust and /trust-og.png (not the real files either) ----------
// A third distinct 1x1 PNG, so a route that served the share card's bytes instead would be caught, and a page
// that is not web/trust.html, so "the body is the file it was given" is a real comparison.
const TRUST_HTML_FIXTURE = '<!doctype html>\n<title>trust fixture</title>\n<p>not the real page</p>\n';
const TRUST_OG_FIXTURE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4b8UAAAOZAWF0/l6bAAAAAElFTkSuQmCC', 'base64');
function writeTrustFixtures() {
  const dir = mkdtempSync(join(tmpdir(), 'rh-trust-fixture-'));
  const html = join(dir, 'trust.html'), og = join(dir, 'og-trust.png');
  writeFileSync(html, TRUST_HTML_FIXTURE);
  writeFileSync(og, TRUST_OG_FIXTURE);
  return { html, og };
}

const mkReq = (pathAndQuery) => ({ url: 'https://rh.gmgnrepeat.com' + pathAndQuery, headers: { get: () => null } });

const KEYED_ENV = { BLOCKSCOUT_KEY: KEY };
const NO_KEY_ENV = {};

const responseHasKey = async (resp) => {
  const text = await resp.clone().text();
  if (text.includes(KEY)) return true;
  for (const [, v] of resp.headers.entries()) if (String(v).includes(KEY)) return true;
  return false;
};

async function run() {
  const airdropWorker = (await import('file://' + renderWorker('airdrop'))).default;
  const checkWorker = (await import('file://' + renderWorker('check'))).default;

  // ---- a bounded retry on an upstream 5xx or a thrown fetch (13 September 2026) ----
  // The gateway answered 500 on about one call in three during a bad hour and the same request correctly a
  // second later. Three attempts at most; a 4xx and every 200 are answers and are never asked again.
  {
    const isEnv = (b) => b && b.error === 'upstream';
    let f = makeFetch([]); f.flaky = [500]; globalThis.fetch = f;
    let r = await airdropWorker.fetch(mkReq(`/x/4663/tokens/${HOLDERS_TOKEN}/holders`), KEYED_ENV); let b = await r.json();
    check('retry: one 500 then an answer is the answer, in two upstream calls', Array.isArray(b.items) && f.all.length === 2 && f.flakyLog.length === 1, JSON.stringify({ items: Array.isArray(b.items), calls: f.all.length }));
    f = makeFetch([]); f.flaky = [500, 500]; globalThis.fetch = f;
    r = await airdropWorker.fetch(mkReq(`/x/4663/tokens/${HOLDERS_TOKEN}/holders`), KEYED_ENV); b = await r.json();
    check('retry: two 500s then an answer is the answer, in three upstream calls', Array.isArray(b.items) && f.all.length === 3, JSON.stringify({ items: Array.isArray(b.items), calls: f.all.length }));
    f = makeFetch([]); f.flaky = [500, 500, 500, 500]; globalThis.fetch = f;
    r = await airdropWorker.fetch(mkReq(`/x/4663/tokens/${HOLDERS_TOKEN}/holders`), KEYED_ENV); b = await r.json();
    check('retry: three 500s is the envelope with status 500, and a fourth call is never made', isEnv(b) && b.status === 500 && f.all.length === 3 && f.flaky.length === 1, JSON.stringify({ b, calls: f.all.length }));
    check('retry: the envelope after three failures still carries no-store', r.headers.get('cache-control') === 'no-store', r.headers.get('cache-control'));
    f = makeFetch([]); f.flaky = [403]; globalThis.fetch = f;
    r = await airdropWorker.fetch(mkReq(`/x/4663/smart-contracts/${SC_VERIFIED}`), KEYED_ENV); b = await r.json();
    check('retry: a 403 is an answer: the envelope with status 403 after exactly one call', isEnv(b) && b.status === 403 && f.all.length === 1, JSON.stringify({ b, calls: f.all.length }));
    f = makeFetch([]); f.flaky = [0]; globalThis.fetch = f;
    r = await airdropWorker.fetch(mkReq(`/x/4663/transactions/${TX_OK}`), KEYED_ENV); b = await r.json();
    check('retry: a fetch that throws once, then answers, is the answer, in two calls', b.status === 'ok' && b.hash === TX_OK && f.all.length === 2 && f.flakyLog.length === 1, JSON.stringify({ b: b.status, calls: f.all.length }));
    f = makeFetch([]); f.flaky = [0, 0, 0]; globalThis.fetch = f;
    r = await airdropWorker.fetch(mkReq(`/x/4663/transactions/${TX_OK}`), KEYED_ENV); b = await r.json();
    check('retry: three throws is the envelope with status 0', isEnv(b) && b.status === 0 && f.flakyLog.length === 3, JSON.stringify(b));
    f = makeFetch([]); f.flaky = [502]; globalThis.fetch = f;
    r = await airdropWorker.fetch(mkReq(`/x/46630/tokens/${HOLDERS_TOKEN}/holders`), KEYED_ENV); b = await r.json();
    check('retry: the testnet passthrough retries a 502 too, and then passes the answer through untouched', b.untouched === true && f.all.length === 2, JSON.stringify({ b, calls: f.all.length }));
    f = makeFetch([]); f.flaky = [500, 500, 500]; globalThis.fetch = f;
    r = await airdropWorker.fetch(mkReq(`/x/46630/tokens/${HOLDERS_TOKEN}/holders`), KEYED_ENV); b = await r.json();
    check('retry: the passthrough after three 500s is the envelope with status 500', isEnv(b) && b.status === 500 && f.all.length === 3, JSON.stringify({ b, calls: f.all.length }));
  }

  // ---- holders: full page carries next_page_params, short page does not ----
  {
    globalThis.fetch = makeFetch([]);
    const r1 = await airdropWorker.fetch(mkReq(`/x/4663/tokens/${HOLDERS_TOKEN}/holders`), KEYED_ENV);
    check('holders page 1 status 200', r1.status === 200, r1.status);
    const b1 = await r1.json();
    const wantItems1 = holdersPage1.map((h) => ({ address: { hash: h.address }, value: h.value }));
    check('holders page 1: items match address.hash/value field by field', deepEqual(b1.items, wantItems1), JSON.stringify(b1.items).slice(0, 200));
    check('holders page 1: next_page_params is {page:2} (a full page came back)', deepEqual(b1.next_page_params, { page: 2 }), JSON.stringify(b1.next_page_params));

    const r2 = await airdropWorker.fetch(mkReq(`/x/4663/tokens/${HOLDERS_TOKEN}/holders?page=2`), KEYED_ENV);
    const b2 = await r2.json();
    const wantItems2 = holdersPage2.map((h) => ({ address: { hash: h.address }, value: h.value }));
    check('holders page 2: items match', deepEqual(b2.items, wantItems2), JSON.stringify(b2.items));
    check('holders page 2: next_page_params is null (a short page came back)', b2.next_page_params === null, b2.next_page_params);
  }

  // ---- NFT inventory: derived from tokennfttx, netted, one item per id still held ----
  {
    globalThis.fetch = makeFetch([]);
    const r = await airdropWorker.fetch(mkReq(`/x/4663/addresses/${WALLET}/nft?type=ERC-721%2CERC-1155`), KEYED_ENV);
    check('nft inventory status 200', r.status === 200, r.status);
    const b = await r.json();
    check('nft inventory: exactly the id still held (mint, out, back in nets to +1)',
      Array.isArray(b.items) && b.items.length === 1 && deepEqual(b.items[0], { token: { address_hash: COLLECTION }, id: NFT_ID_HELD }),
      JSON.stringify(b.items));
    check('nft inventory: the id minted and sent away (net 0) is not in the list',
      !b.items.some((it) => it.id === NFT_ID_NOT_HELD), JSON.stringify(b.items));
    check('nft inventory: next_page_params is null (the whole inventory is one answer)', b.next_page_params === null, b.next_page_params);
    check('nft inventory: truncated is false (well under the 2,000-id cap)', b.truncated === false, b.truncated);
    // ---- round eighteen: an absence is never an answer ----
    {
      globalThis.fetch = makeFetch([]);
      const env18 = KEYED_ENV;
      const isEnvelope = (b) => b && b.error === 'upstream';
      let r = await airdropWorker.fetch(mkReq('/x/4663/smart-contracts/' + SC_UNVERIFIED_REAL), env18); let b = await r.json();
      check('R18 B-1: an unverified contract (verbatim: a record with only its Address) reads is_verified false', b.is_verified === false && b.name === null, JSON.stringify(b).slice(0, 160));
      r = await airdropWorker.fetch(mkReq('/x/4663/smart-contracts/' + SC_RATELIMIT), env18); b = await r.json();
      check('R18 B-1: a rate-limit NOTOK envelope is the upstream-error envelope, not a verified contract', isEnvelope(b), JSON.stringify(b).slice(0, 160));
      r = await airdropWorker.fetch(mkReq('/x/4663/smart-contracts/' + SC_BADKEY), env18); b = await r.json();
      check('R18 B-1: a rejected key ({"error":"Unauthorized"}, no status) is the envelope', isEnvelope(b), JSON.stringify(b).slice(0, 160));
      r = await airdropWorker.fetch(mkReq('/x/4663/transactions/' + TX_NOTFOUND), env18); b = await r.json();
      check('R18 B-2: an unknown transaction is the envelope, not status "error"', isEnvelope(b) && b.status !== 'error', JSON.stringify(b).slice(0, 160));
      r = await airdropWorker.fetch(mkReq('/x/4663/tokens/' + HOLDERS_NOT_A_TOKEN + '/holders'), env18); b = await r.json();
      check('R18 B-2: a real empty holders list (status "1", result []) is an empty page, not the envelope', Array.isArray(b.items) && b.items.length === 0 && b.next_page_params === null, JSON.stringify(b).slice(0, 160));
      r = await airdropWorker.fetch(mkReq('/x/4663/addresses/' + WALLET_MIDWALK + '/nft?type=ERC-721%2CERC-1155'), env18); b = await r.json();
      check('R18 B-3: an upstream error mid-walk is the envelope, never a shorter inventory', isEnvelope(b), JSON.stringify(b).slice(0, 160));
      r = await airdropWorker.fetch(mkReq('/x/4663/addresses/' + WALLET_CEILING + '/nft?type=ERC-721%2CERC-1155'), env18); b = await r.json();
      check('R18 B-3: twenty full pages stops at the ceiling and says truncated', Array.isArray(b.items) && b.truncated === true, JSON.stringify({ n: (b.items || []).length, truncated: b.truncated }));
      const inits = (globalThis.fetch.inits || []);
      check('R18 S-7/S-8: every module subrequest is made with cacheTtl 0 (no edge cache of a keyed URL or of a failure)', inits.length > 0 && inits.every((o) => o && o.cf && o.cf.cacheTtl === 0), JSON.stringify(inits.slice(0, 2)));
    }
  }

  // ---- transactions: revert_reason, and the fields alongside it ----
  {
    globalThis.fetch = makeFetch([]);
    const r = await airdropWorker.fetch(mkReq(`/x/4663/transactions/${TX_REVERTED}`), KEYED_ENV);
    const b = await r.json();
    check('reverted tx: status "error", hash, from/to, revert_reason all present',
      deepEqual(b, { hash: TX_REVERTED, status: 'error', from: { hash: TX_FROM }, to: { hash: TX_TO }, revert_reason: 'Ownable: caller is not the owner' }),
      JSON.stringify(b));

    const r2 = await airdropWorker.fetch(mkReq(`/x/4663/transactions/${TX_OK}`), KEYED_ENV);
    const b2 = await r2.json();
    check('ok tx: status "ok" and revert_reason omitted (empty string, not carried)',
      b2.status === 'ok' && !('revert_reason' in b2), JSON.stringify(b2));
  }

  // ---- smart-contracts: verified, unverified, and a proxy ----
  {
    globalThis.fetch = makeFetch([]);
    const rv = await airdropWorker.fetch(mkReq(`/x/4663/smart-contracts/${SC_VERIFIED}`), KEYED_ENV);
    const bv = await rv.json();
    check('verified contract: every field per the spec table',
      deepEqual(bv, {
        is_verified: true, is_partially_verified: null, name: 'Foo', abi: VERIFIED_ABI,
        compiler_version: 'v0.8.19+commit.7dd6d404', optimization_enabled: true, evm_version: 'paris',
        proxy_type: null, implementations: [], verified_at: null,
      }), JSON.stringify(bv));

    const ru = await airdropWorker.fetch(mkReq(`/x/4663/smart-contracts/${SC_UNVERIFIED}`), KEYED_ENV);
    const bu = await ru.json();
    check('unverified contract: is_verified false, abi [], name/compiler null',
      deepEqual(bu, {
        is_verified: false, is_partially_verified: null, name: null, abi: [],
        compiler_version: null, optimization_enabled: false, evm_version: null,
        proxy_type: null, implementations: [], verified_at: null,
      }), JSON.stringify(bu));

    const rp = await airdropWorker.fetch(mkReq(`/x/4663/smart-contracts/${SC_PROXY}`), KEYED_ENV);
    const bp = await rp.json();
    check('proxy contract: proxy_type "unknown", implementations from ImplementationAddress',
      bp.proxy_type === 'unknown' && deepEqual(bp.implementations, [{ address: SC_IMPL }]), JSON.stringify(bp));
  }

  // ---- no key in any response body or header, across every translated call above ----
  {
    globalThis.fetch = makeFetch([]);
    const paths = [
      `/x/4663/tokens/${HOLDERS_TOKEN}/holders`,
      `/x/4663/addresses/${WALLET}/nft?type=ERC-721%2CERC-1155`,
      `/x/4663/transactions/${TX_REVERTED}`,
      `/x/4663/smart-contracts/${SC_VERIFIED}`,
    ];
    let leaked = false;
    for (const p of paths) {
      const r = await airdropWorker.fetch(mkReq(p), KEYED_ENV);
      if (await responseHasKey(r)) leaked = true;
    }
    check('the key never appears in a response body or header', !leaked);
  }

  // ---- every upstream call carried chain_id=4663 and the key ----
  {
    const calls = [];
    globalThis.fetch = makeFetch(calls);
    await airdropWorker.fetch(mkReq(`/x/4663/tokens/${HOLDERS_TOKEN}/holders`), KEYED_ENV);
    check('every module call carried chain_id=4663 and the bound key',
      calls.length > 0 && calls.every((u) => u.includes('chain_id=4663') && u.includes('apikey=' + encodeURIComponent(KEY))),
      calls.join(' | '));
  }

  // ---- testnet path is untouched: still the direct passthrough, byte for byte ----
  {
    for (const [label, worker, env] of [['airdrop worker', airdropWorker, KEYED_ENV], ['check worker', checkWorker, NO_KEY_ENV]]) {
      globalThis.fetch = makeFetch([]);
      const r = await worker.fetch(mkReq('/x/46630/tokens/' + HOLDERS_TOKEN + '/holders'), env);
      const b = await r.json();
      check(`testnet passthrough untouched (${label})`, b.untouched === true && b.echoedPath === '/api/v2/tokens/' + HOLDERS_TOKEN + '/holders', JSON.stringify(b));
    }
  }

  // ---- mainnet without a binding still returns the {"error":"upstream"} envelope ----
  {
    globalThis.fetch = makeFetch([]);
    const r = await airdropWorker.fetch(mkReq(`/x/4663/tokens/${HOLDERS_TOKEN}/holders`), NO_KEY_ENV);
    const b = await r.json();
    check('mainnet, no BLOCKSCOUT_KEY bound: status 200 wrapping the envelope', r.status === 200, r.status);
    check('mainnet, no BLOCKSCOUT_KEY bound: {"error":"upstream", status:...}', b.error === 'upstream' && typeof b.status === 'number', JSON.stringify(b));
  }

  // ---- a mainnet path the translation does not know, even with the key bound, falls back to the envelope ----
  {
    globalThis.fetch = makeFetch([]);
    const r = await airdropWorker.fetch(mkReq('/x/4663/stats'), KEYED_ENV);
    const b = await r.json();
    check('mainnet, key bound, unmapped path: still the upstream envelope, not a guess', b.error === 'upstream', JSON.stringify(b));
  }

  // ---- twins: the check worker translates the same way as the airdrop worker (docs/readers.md) ----
  {
    globalThis.fetch = makeFetch([]);
    const ra = await airdropWorker.fetch(mkReq(`/x/4663/smart-contracts/${SC_VERIFIED}`), KEYED_ENV);
    globalThis.fetch = makeFetch([]);
    const rc = await checkWorker.fetch(mkReq(`/x/4663/smart-contracts/${SC_VERIFIED}`), KEYED_ENV);
    check('the check worker (Check’s own reader) translates smart-contracts identically to the airdrop worker',
      deepEqual(await ra.json(), await rc.json()));
  }

  // ---- /og.png and /apple-touch-icon.png: the share card and home-screen icon, served from this origin ----
  {
    const { og, touch } = writeFixtures();
    const imgWorker = (await import('file://' + renderWorker('airdrop', og, touch))).default;
    globalThis.fetch = makeFetch([]);

    const rOg = await imgWorker.fetch(mkReq('/og.png'), NO_KEY_ENV);
    check('/og.png answers 200', rOg.status === 200, rOg.status);
    check('/og.png content-type is image/png', rOg.headers.get('content-type') === 'image/png', rOg.headers.get('content-type'));
    check('/og.png cache-control is public, max-age=86400', rOg.headers.get('cache-control') === 'public, max-age=86400', rOg.headers.get('cache-control'));
    const ogBytes = Buffer.from(await rOg.arrayBuffer());
    check('/og.png body bytes equal the fixture passed in', ogBytes.equals(OG_FIXTURE), `${ogBytes.length} vs ${OG_FIXTURE.length}`);

    const rTouch = await imgWorker.fetch(mkReq('/apple-touch-icon.png'), NO_KEY_ENV);
    check('/apple-touch-icon.png answers 200', rTouch.status === 200, rTouch.status);
    check('/apple-touch-icon.png content-type is image/png', rTouch.headers.get('content-type') === 'image/png', rTouch.headers.get('content-type'));
    check('/apple-touch-icon.png cache-control is public, max-age=86400', rTouch.headers.get('cache-control') === 'public, max-age=86400', rTouch.headers.get('cache-control'));
    const touchBytes = Buffer.from(await rTouch.arrayBuffer());
    check('/apple-touch-icon.png body bytes equal the fixture passed in (not og.png’s)', touchBytes.equals(TOUCH_FIXTURE) && !touchBytes.equals(OG_FIXTURE), `${touchBytes.length} vs ${TOUCH_FIXTURE.length}`);

    // responseHasKey clones before reading, but this response's body was already consumed above (arrayBuffer),
    // and a clone taken after that throws. The bytes are already in hand, so the check reads them directly.
    const bodyHasKey = (buf, resp) => buf.toString('latin1').includes(KEY) || Array.from(resp.headers.entries()).some(([, v]) => String(v).includes(KEY));
    check('the key never appears in either image response', !bodyHasKey(ogBytes, rOg) && !bodyHasKey(touchBytes, rTouch));

    // A worker built with no images (the existing 6-argument call, as every other case in this file makes it)
    // must not break: the routes exist but answer 404, never a crash and never someone else's bytes.
    const bareWorker = (await import('file://' + renderWorker('airdrop'))).default;
    globalThis.fetch = makeFetch([]);
    const rNone = await bareWorker.fetch(mkReq('/og.png'), NO_KEY_ENV);
    check('with no image configured, /og.png 404s rather than crashing or guessing', rNone.status === 404, rNone.status);

    // HEAD or an unknown path is unchanged: still the ordinary redirect-to-/ behaviour, not touched by this route.
    const rUnknown = await imgWorker.fetch(mkReq('/some/unknown/path'), NO_KEY_ENV);
    check('an unknown path is still the existing 302-to-/ behaviour, unchanged', rUnknown.status === 302 && rUnknown.headers.get('location') === '/', JSON.stringify([rUnknown.status, rUnknown.headers.get('location')]));
  }

  // ---- /trust and /trust-og.png: the Trust Center, served from the airdrop worker only ----
  {
    const { og, touch } = writeFixtures();
    const trust = writeTrustFixtures();
    const trustWorker = (await import('file://' + renderWorker('airdrop', og, touch, trust.html, trust.og))).default;
    globalThis.fetch = makeFetch([]);

    for (const path of ['/trust', '/trust/']) {
      const r = await trustWorker.fetch(mkReq(path), NO_KEY_ENV);
      check(`${path} answers 200`, r.status === 200, r.status);
      check(`${path} content-type is text/html`, r.headers.get('content-type') === 'text/html; charset=utf-8', r.headers.get('content-type'));
      check(`${path} cache-control is public, max-age=300`, r.headers.get('cache-control') === 'public, max-age=300', r.headers.get('cache-control'));
      check(`${path} sends exactly the Trust Center's own policy as a header`,
        r.headers.get('content-security-policy') === TRUST_CSP, r.headers.get('content-security-policy'));
      check(`${path} sends the hardening headers every response carries`,
        r.headers.get('strict-transport-security') === 'max-age=31536000; includeSubDomains'
        && r.headers.get('x-content-type-options') === 'nosniff', JSON.stringify([r.headers.get('strict-transport-security'), r.headers.get('x-content-type-options')]));
      const body = await r.text();
      check(`${path} body is the file that was passed in, byte for byte`, body === TRUST_HTML_FIXTURE, body.slice(0, 80));
    }

    const rPng = await trustWorker.fetch(mkReq('/trust-og.png'), NO_KEY_ENV);
    check('/trust-og.png answers 200', rPng.status === 200, rPng.status);
    check('/trust-og.png content-type is image/png', rPng.headers.get('content-type') === 'image/png', rPng.headers.get('content-type'));
    check('/trust-og.png cache-control is public, max-age=86400', rPng.headers.get('cache-control') === 'public, max-age=86400', rPng.headers.get('cache-control'));
    const pngBytes = Buffer.from(await rPng.arrayBuffer());
    check('/trust-og.png body bytes equal the fixture passed in (not /og.png’s)',
      pngBytes.equals(TRUST_OG_FIXTURE) && !pngBytes.equals(OG_FIXTURE), `${pngBytes.length} vs ${TRUST_OG_FIXTURE.length}`);

    // The share card and the ordinary page are untouched by the new routes.
    const rOg = await trustWorker.fetch(mkReq('/og.png'), NO_KEY_ENV);
    check('/og.png still serves the share card, not the Trust Center card',
      Buffer.from(await rOg.arrayBuffer()).equals(OG_FIXTURE));
    const rRoot = await trustWorker.fetch(mkReq('/'), NO_KEY_ENV);
    check('/ still serves the airdrop page, not the Trust Center',
      rRoot.status === 200 && !(await rRoot.text()).includes('trust fixture'), rRoot.status);

    // The key never appears in either new response.
    const bodyHasKey = (buf, resp) => buf.toString('latin1').includes(KEY) || Array.from(resp.headers.entries()).some(([, v]) => String(v).includes(KEY));
    const rTrustKeyed = await trustWorker.fetch(mkReq('/trust'), KEYED_ENV);
    const trustBuf = Buffer.from(await rTrustKeyed.arrayBuffer());
    const rPngKeyed = await trustWorker.fetch(mkReq('/trust-og.png'), KEYED_ENV);
    const pngBuf = Buffer.from(await rPngKeyed.arrayBuffer());
    check('the key never appears in the /trust or /trust-og.png response',
      !bodyHasKey(trustBuf, rTrustKeyed) && !bodyHasKey(pngBuf, rPngKeyed));

    // A worker built without them (the 8-argument call publish.sh makes for the Check target, and the
    // 6-argument call every other case in this file makes) must not crash and must not invent a page.
    const bare = (await import('file://' + renderWorker('airdrop', og, touch))).default;
    globalThis.fetch = makeFetch([]);
    const rNone = await bare.fetch(mkReq('/trust'), NO_KEY_ENV);
    check('with no Trust Center configured, /trust 404s rather than crashing or guessing', rNone.status === 404, rNone.status);

    // The Check worker has no Trust Center at all: not a route, not a constant, not a 404 that implies one.
    const checkSrc = readFileSync(renderWorker('check', og, touch), 'utf8');
    check('the check worker carries no /trust route and no TRUST_ constant',
      !checkSrc.includes('/trust') && !checkSrc.includes('TRUST_'),
      checkSrc.split('\n').filter((l) => l.includes('trust')).slice(0, 2).join(' | '));
    const rCheckTrust = await checkWorker.fetch(mkReq('/trust'), NO_KEY_ENV);
    check('the check worker redirects /trust to / like any other unknown path',
      rCheckTrust.status === 302 && rCheckTrust.headers.get('location') === '/',
      JSON.stringify([rCheckTrust.status, rCheckTrust.headers.get('location')]));
  }

  // ---- /art/<chain>/<contract>/<id>: off-chain art fetched by the Worker, never by the visitor (2026-10-19) ----
  {
    globalThis.caches = { default: { match: async () => null, put: async () => {} } };
    const C = addrN(0xa47), seen = [];
    const strHex = (s) => { const b = Buffer.from(s, 'utf8'); return '0x' + (32).toString(16).padStart(64, '0') + b.length.toString(16).padStart(64, '0') + b.toString('hex').padEnd(Math.ceil(b.length / 32) * 64, '0'); };
    const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const world = (o = {}) => async (url, init = {}) => {
      url = String(url); seen.push(url);
      if (init.method === 'POST') { const b = JSON.parse(init.body); return Response.json({ jsonrpc: '2.0', id: b.id, result: strHex(o.uri || 'https://art.example/meta/2') }); }
      if (url.startsWith('https://art.example/meta/')) return new Response(JSON.stringify({ name: 'x', image: o.image || 'https://art.example/img/2.png' }), { headers: { 'content-type': 'application/json' } });
      if (url.startsWith('https://art.example/img/')) return new Response(o.big ? new Uint8Array(4 * 1048576) : PNG, { headers: { 'content-type': o.imgType || 'image/png', ...(o.big ? { 'content-length': String(4 * 1048576) } : {}) } });
      return new Response('nope', { status: 404 });
    };
    const get = async (o, path = '/art/4663/' + C + '/2', method = 'GET') => { seen.length = 0; globalThis.fetch = world(o); return airdropWorker.fetch(new Request('https://rhairdrop.gmgnrepeat.com' + path, { method }), {}); };
    let r = await get({});
    const body = new Uint8Array(await r.arrayBuffer());
    check('art: an https tokenURI gives the picture, fetched by the Worker', r.status === 200 && r.headers.get('content-type') === 'image/png' && body.length === PNG.length, r.status + ' ' + r.headers.get('content-type'));
    check('art: and it is cached a day, with the hardening headers', r.headers.get('cache-control') === 'public, max-age=86400' && /sandbox/.test(r.headers.get('content-security-policy') || ''), r.headers.get('cache-control'));
    check('art: the chain was asked for tokenURI(2), then the JSON, then the image', seen.length === 3 && seen[1] === 'https://art.example/meta/2' && seen[2] === 'https://art.example/img/2.png', seen.join(' | '));
    r = await get({ imgType: 'text/html' }); check('art: a non-image answer is refused', r.status === 404, r.status);
    r = await get({ big: true }); check('art: an image over 3 MB is refused', r.status === 404, r.status);
    r = await get({ image: 'http://art.example/img/2.png' }); check('art: a plain-http image is refused', r.status === 404 && !seen.some((u) => u.startsWith('http://')), seen.join(' | '));
    r = await get({ uri: 'https://127.0.0.1/meta/2' }); check('art: a host given as an address is refused', r.status === 404 && !seen.some((u) => u.includes('127.0.0.1')), seen.join(' | '));
    r = await get({ image: 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E' });
    check('art: an image carried in the JSON as data: is served', r.status === 200 && r.headers.get('content-type') === 'image/svg+xml', r.status + ' ' + r.headers.get('content-type'));
    r = await get({}, '/art/4663/' + C + '/2', 'POST'); check('art: GET only', r.status === 405, r.status);
    r = await get({}, '/art/1/' + C + '/2'); check('art: an unlisted chain is not an art route', r.status === 302, r.status);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { bad('the suite crashed', e && e.stack ? e.stack : e); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
