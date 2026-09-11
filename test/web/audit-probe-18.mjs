// Round-eighteen reviewer probes. Same convention as every earlier probe file in this repository: each
// assertion REPRODUCES a finding, so an assertion that PASSES ("REPRODUCES") is a defect that is still
// present, and one that reads "fixed" is a defect that is not.
//
//   node test/web/audit-probe-18.mjs
//
// Nothing here touches a network, signs anything, or needs a key. The Worker sections render the worker the
// way deploy/publish.sh does, through deploy/render-worker.py, and answer its upstream from a fixture. The
// page sections drive web/index.html in a browser with every chain, explorer and price answer mocked.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.env.RH_ROOT ? process.env.RH_ROOT.replace(/\/$/, '') + '/' : new URL('../../', import.meta.url).pathname;
const AIRDROP = pathToFileURL(ROOT + 'web/index.html').href;
const A = (n) => '0x' + n.toString(16).padStart(40, '0');
const NFT = A(0x721), RUN_ME = A(0xdead);
const BULK = '0xf2ed6359f5dee0334d68cd21d306d9d3e7a49232';

let demonstrated = 0, notReproduced = 0;
const lines = [];
const probe = (name, reproduced, detail) => {
  if (reproduced) { demonstrated++; lines.push('  REPRODUCES  ' + name + (detail ? '\n                 ' + String(detail).replace(/\s+/g, ' ').slice(0, 360) : '')); }
  else { notReproduced++; lines.push('  fixed       ' + name + (detail ? '\n                 ' + String(detail).replace(/\s+/g, ' ').slice(0, 240) : '')); }
};

// ---------------------------------------------------------------- the Worker's mainnet translation
// Blockscout's module API answers HTTP 200 with content-type json and a `result` that is NOT the expected
// array whenever the call did not succeed: an unverified contract, a rejected key, a rate limit. This is the
// single upstream every one of the four translated paths is given below.
function renderWorker(target) {
  const dir = mkdtempSync(join(tmpdir(), 'rh-probe18-'));
  const src = join(ROOT, target === 'airdrop' ? 'web/index.html' : 'web/check.html');
  const out = join(dir, 'worker.mjs');
  execFileSync('python3', [join(ROOT, 'deploy/render-worker.py'), src, out, target, '', '', 'sha256-probe'], { cwd: ROOT, stdio: 'inherit' });
  return out;
}
const mkReq = (p) => ({ url: 'https://rhcheck.gmgnrepeat.com' + p, headers: { get: () => null } });

async function workerProbes() {
  const worker = (await import('file://' + renderWorker('check'))).default;
  const notOk = { status: '0', message: 'NOTOK', result: 'Max rate limit reached' };
  const notVerified = { status: '0', message: 'Contract source code not verified', result: null };
  const ask = async (path, upstream) => {
    globalThis.fetch = async () => new Response(JSON.stringify(upstream), { status: 200, headers: { 'content-type': 'application/json' } });
    const r = await worker.fetch(mkReq(path), { BLOCKSCOUT_KEY: 'probe-key' });
    return r.json();
  };

  {
    const b = await ask('/x/4663/smart-contracts/' + A(0x11), notVerified);
    probe('R18-1 an upstream that says the contract source is NOT verified is translated into is_verified: true',
      b.is_verified === true,
      JSON.stringify(b).slice(0, 240));
  }
  {
    const b = await ask('/x/4663/smart-contracts/' + A(0x11), notOk);
    probe('R18-2 an upstream rate-limit envelope is translated into is_verified: true rather than the {"error":"upstream"} envelope',
      b.is_verified === true && b.error === undefined,
      JSON.stringify(b).slice(0, 240));
  }
  {
    const b = await ask('/x/4663/transactions/0x' + 'aa'.repeat(32), notOk);
    probe('R18-3 a transaction lookup that failed upstream is reported as status "error" with invented null from/to, not as an upstream failure',
      b.status === 'error' && b.from && b.from.hash === null && b.error === undefined,
      JSON.stringify(b).slice(0, 240));
  }
  {
    const b = await ask('/x/4663/tokens/' + A(0x22) + '/holders', notOk);
    probe('R18-4 a holders lookup that failed upstream is reported as an empty holders page, not as an upstream failure',
      Array.isArray(b.items) && b.items.length === 0 && b.next_page_params === null && b.error === undefined,
      JSON.stringify(b).slice(0, 240));
  }
  {
    const b = await ask('/x/4663/addresses/' + A(0x33) + '/nft', notOk);
    probe('R18-5 an NFT-inventory page that failed upstream ends the derivation early and is reported as a complete inventory with truncated: false',
      Array.isArray(b.items) && b.items.length === 0 && b.truncated === false && b.next_page_params === null && b.error === undefined,
      JSON.stringify(b).slice(0, 240));
  }
}

// ---------------------------------------------------------------- the page
const enc = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
const strRet = (t) => { const b = Buffer.from(t, 'utf8'); const hex = b.toString('hex');
  return '0x' + (32).toString(16).padStart(64, '0') + BigInt(b.length).toString(16).padStart(64, '0')
    + hex.padEnd(Math.ceil(Math.max(hex.length, 1) / 64) * 64, '0'); };

function airdropAnswer(O) {
  return function (method, params = []) {
    switch (method) {
      case 'eth_chainId': return O.chainHex || '0xb626';
      case 'net_version': return '46630';
      case 'eth_accounts': case 'eth_requestAccounts': return [O.account || RUN_ME];
      case 'eth_blockNumber': return '0x1000';
      case 'eth_gasPrice': return '0x989680';
      case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
      case 'wallet_getCapabilities': return {};
      case 'eth_getBlockByNumber': return { number: '0x1000', hash: '0x' + '11'.repeat(32), parentHash: '0x' + '22'.repeat(32), timestamp: '0x1', gasLimit: '0x1', gasUsed: '0x0', miner: A(0), baseFeePerGas: '0x989680', transactions: [] };
      case 'eth_estimateGas': return '0x' + (21000 + 40000).toString(16);
      case 'eth_getCode': {
        const a = String(params[0] || '').toLowerCase();
        if (a === NFT.toLowerCase() || a === BULK) return '0x60006000';
        return '0x';
      }
      case 'eth_getTransactionReceipt': return null;
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), data = String(params[0].data || ''), sel = data.slice(0, 10);
        const owned = O.ownedIds || [];
        if (sel === '0x01ffc9a7') return enc(to === NFT.toLowerCase() && data.slice(10, 18) === '80ac58cd' ? 1 : 0);
        if (sel === '0x313ce567') return null;
        if (sel === '0x06fdde03') return strRet('Probe Collection');
        if (sel === '0x95d89b41') return strRet('PRB');
        if (sel === '0x70a08231') return enc(owned.length);
        if (sel === '0x2f745c59') { const i = Number(BigInt('0x' + data.slice(74))); if (i >= owned.length) throw new Error('index out of range'); return enc(owned[i]); }
        if (sel === '0xe985e9c5') return enc(1);
        if (sel === '0x5c975abb') return enc(0);
        if (sel === '0x098144d4') return '0x';
        if (sel === '0xc87b56dd') return strRet('');
        if (sel === '0x6352211e') return '0x' + RUN_ME.slice(2).padStart(64, '0');
        if (sel === '0x56c3e5e9' || sel === '0xdf1c9e47') return enc(400000);
        if (sel === '0x20d2c951') return enc(100000);
        if (sel === '0x5f2a9f41') return enc(5000000);
        if (to === BULK) return enc(1) + (0).toString(16).padStart(64, '0');
        return enc(0);
      }
      default: return null;
    }
  };
}

async function openAirdrop(browser, O = {}) {
  const ans = airdropAnswer(O);
  const page = await browser.newPage({ viewport: { width: 1200, height: 1800 } });
  page.__dialogs = [];
  page.on('dialog', (d) => { page.__dialogs.push(d.message()); return O.acceptDialogs === false ? d.dismiss() : d.accept(); });
  O.explorerHosts = [];
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: '{"data":{"amount":"2500"}}' });
    if (url.includes('/holders')) {
      // One holders page per call, so a probe can act while the reader is between pages.
      const host = new URL(url).host;
      O.explorerHosts.push(host);
      const n = O.explorerHosts.length;
      if (O.holdersDelayMs && n === (O.holdersDelayAfter || 1)) { const ms = O.holdersDelayMs; O.holdersDelayMs = 0; await new Promise((r) => setTimeout(r, ms)); }
      const pages = O.holderPages || [{ items: [] }];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(pages[Math.min(n - 1, pages.length - 1)]) });
    }
    if (url.includes('/api/v2/') || url.includes('/x/')) return route.fulfill({ contentType: 'application/json', body: '{"items":[]}' });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let body; try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
      const one = (r) => { try { return { jsonrpc: '2.0', id: r.id, result: ans(r.method, r.params || []) }; }
                           catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: e.code || -32000, message: String(e.message) } }; } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.exposeFunction('__chain', async (method, params) => {
    try { return { ok: true, result: await ans(method, params) }; }
    catch (e) { return { ok: false, code: e.code || 3, message: String(e.message || e) }; }
  });
  await page.addInitScript(() => {
    const listeners = {};
    window.__emit = (ev, arg) => (listeners[ev] || []).slice().forEach((f) => { try { f(arg); } catch (e) {} });
    window.ethereum = {
      isMetaMask: true,
      on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeListener(ev, fn) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
      async request({ method, params }) {
        const r = await window.__chain(method, params || []);
        if (r && r.ok) return r.result;
        const err = new Error((r && r.message) || 'failed'); err.code = r && r.code; throw err;
      },
    };
  });
  await page.goto(AIRDROP, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  return page;
}
const text = (page, sel) => page.$eval(sel, (e) => e.textContent || '').catch(() => '');
const val = (page, sel) => page.$eval(sel, (e) => e.value || '').catch(() => '');
async function connectAndLoad(page) {
  await page.click('#connect'); await page.waitForTimeout(600);
  await page.selectOption('#std', '721');
  await page.fill('#token', NFT);
  await page.dispatchEvent('#token', 'change');
  await page.waitForFunction(() => /Probe Collection/.test(document.querySelector('#tokenInfo').textContent || ''), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
}

const browser = await chromium.launch();
try {
  await workerProbes();

  // ---- R18-6: one box, two quantity readers. A bare line carrying several token ids is N deliveries to
  //      walletsInBox/deliveriesOn (the picker and the list sizing) and ONE delivery to
  //      requestedNftQuantity (Assign), so pressing Assign drops the extra allocations without a word.
  {
    const O = { ownedIds: [71, 72, 73, 74, 75, 76] };
    const page = await openAirdrop(browser, O);
    await connectAndLoad(page);
    await page.fill('#list', A(0x111) + ',11,12,13\n' + A(0x222) + ',21,22\n');
    await page.click('#parse'); await page.waitForTimeout(600);
    const parsed = await text(page, '#parseOut');
    await page.click('#pick'); await page.waitForTimeout(2500);
    const need = (await text(page, '#pickNeed')).trim();
    await page.click('#pickClose');
    await page.fill('#each', '1');
    await page.click('#assign');
    await page.waitForFunction(() => /Assigned|stopped/.test(document.querySelector('#log').textContent || ''), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    const after = (await val(page, '#list')).split(/\r?\n/).filter(Boolean);
    const log = await text(page, '#log');
    probe('R18-6 a bare list naming several ids on one line is five deliveries to the picker and two to Assign: Assign rewrites it to one id per wallet and says nothing about the three it dropped',
      need === '5' && after.length === 2 && /Assigned 2 lines/.test(log) && !/drop|fewer|less|3 /.test(log.split('Assigned')[1] || ''),
      JSON.stringify({ parsed: parsed.slice(0, 80), pickNeed: need, linesAfterAssign: after.length, after: after.join(' | '), tail: log.slice(-140) }));
    await page.close();
  }

  // ---- R18-7: the holder snapshot reads page after page through EXPLORER_API(), which resolves the chain
  //      LIVE on every call, and never rechecks the network it started on. Switching the network dropdown
  //      mid-read sends the remaining pages to the other chain's explorer and concatenates both answers into
  //      one list, with nothing said.
  //
  //      The shipped page carries `disabled` on the mainnet <option>, so a user cannot reach this today; the
  //      probe takes that attribute off, which is exactly the edit that enables mainnet. This is therefore a
  //      demonstration of what the snapshot reader does on the day mainnet is switched on, not of what it
  //      does now. Nothing else in the probe is changed.
  {
    const H1 = A(0xaaa1), H2 = A(0xbbb2);
    const O = {
      ownedIds: [1],
      holderPages: [
        { items: [{ address: { hash: H1 }, value: '1' }], next_page_params: { page: 2 } },
        { items: [{ address: { hash: H2 }, value: '1' }], next_page_params: null },
      ],
      holdersDelayMs: 2500, holdersDelayAfter: 1,
    };
    const page = await openAirdrop(browser, O);
    await connectAndLoad(page);
    await page.fill('#snapAddr', NFT);
    await page.click('#snap');
    await page.waitForTimeout(700);
    await page.evaluate(() => { document.querySelector('#net option[value="4663"]').disabled = false; });
    await page.selectOption('#net', '4663');     // an ordinary network change while the read is in flight
    await page.waitForTimeout(6000);
    const box = (await val(page, '#list')).split(/\r?\n/).filter(Boolean).map((s) => s.toLowerCase());
    const hosts = [...new Set(O.explorerHosts)];
    const log = await text(page, '#log');
    probe('R18-7 (with the mainnet option enabled, as it will be) the holder snapshot pages through two different chains’ explorers when the network changes mid-read, and concatenates both answers into one list without saying so',
      hosts.length > 1 && box.includes(H1.toLowerCase()) && box.includes(H2.toLowerCase()) && !/network changed while|different network/.test(log),
      JSON.stringify({ hosts, box, tail: log.slice(-200) }));
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(lines.join('\n'));
console.log('\n' + demonstrated + ' demonstrated, ' + notReproduced + ' not reproduced');
process.exit(0);
