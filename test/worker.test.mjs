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
import { mkdtempSync } from 'node:fs';
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

// ---------- the fake upstream: api.blockscout.com (module API), and both direct explorer hosts ----------
const okJson = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function makeFetch(callLog) {
  return async function fetchMock(url) {
    const u = new URL(String(url));
    if (u.hostname === 'api.blockscout.com') {
      callLog.push(u.toString());
      const mod = u.searchParams.get('module'), action = u.searchParams.get('action');
      if (mod === 'token' && action === 'getTokenHolders') {
        const page = u.searchParams.get('page');
        const result = page === '2' ? holdersPage2 : holdersPage1;
        return okJson({ status: '1', message: 'OK', result });
      }
      if (mod === 'account' && action === 'tokennfttx') {
        const page = u.searchParams.get('page');
        return okJson({ status: '1', message: 'OK', result: page === '1' ? nftRecords : [] });
      }
      if (mod === 'transaction' && action === 'gettxinfo') {
        const hash = u.searchParams.get('txhash');
        if (hash === TX_REVERTED) return okJson({ status: '1', message: 'OK', result: { success: false, revertReason: 'Ownable: caller is not the owner', from: TX_FROM, to: TX_TO, input: '0xdeadbeef', logs: [] } });
        if (hash === TX_OK) return okJson({ status: '1', message: 'OK', result: { success: true, revertReason: '', from: TX_FROM, to: TX_TO, input: '0x', logs: [] } });
        return okJson({ status: '0', message: 'NOTOK', result: 'not found' });
      }
      if (mod === 'contract' && action === 'getsourcecode') {
        const addr = String(u.searchParams.get('address') || '').toLowerCase();
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
function renderWorker(target) {
  const dir = mkdtempSync(join(tmpdir(), 'rh-worker-'));
  const src = join(ROOT, target === 'airdrop' ? 'web/index.html' : 'web/check.html');
  const out = join(dir, 'worker.mjs');
  execFileSync('python3', [join(ROOT, 'deploy/render-worker.py'), src, out, target, '', '', 'sha256-test'], { cwd: ROOT, stdio: 'inherit' });
  return out;
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
        is_verified: true, is_partially_verified: false, name: 'Foo', abi: VERIFIED_ABI,
        compiler_version: 'v0.8.19+commit.7dd6d404', optimization_enabled: true, evm_version: 'paris',
        proxy_type: null, implementations: [], verified_at: null,
      }), JSON.stringify(bv));

    const ru = await airdropWorker.fetch(mkReq(`/x/4663/smart-contracts/${SC_UNVERIFIED}`), KEYED_ENV);
    const bu = await ru.json();
    check('unverified contract: is_verified false, abi [], name/compiler null',
      deepEqual(bu, {
        is_verified: false, is_partially_verified: false, name: null, abi: [],
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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { bad('the suite crashed', e && e.stack ? e.stack : e); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
