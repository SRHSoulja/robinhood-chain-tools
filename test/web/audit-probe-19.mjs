// Round-nineteen reviewer probes. Same convention as every earlier probe file in this repository: each
// assertion REPRODUCES a finding, so an assertion that PASSES ("REPRODUCES") is a defect that is still
// present, and one that reads "fixed" is a defect that is not.
//
//   node test/web/audit-probe-19.mjs
//
// Nothing here touches a network, signs anything, or needs a key. Both sections drive a page in a browser
// with every chain and explorer answer mocked.
//
// The subject of both is one body: {"error":"upstream","status":N} returned with HTTP 200 and
// content-type application/json. That is not a hypothetical shape -- it is what deploy/render-worker.py
// returns from EVERY failing /x/ path (`upstreamFail`), and test/worker.test.mjs asserts that it does.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.RH_ROOT ? process.env.RH_ROOT.replace(/\/$/, '') + '/' : new URL('../../', import.meta.url).pathname;
const CHECK = pathToFileURL(ROOT + 'web/check.html').href;
const AIRDROP = pathToFileURL(ROOT + 'web/index.html').href;
const A = (n) => '0x' + n.toString(16).padStart(40, '0');
const NFT = A(0x721), RUN_ME = A(0xdead);
const BULK = '0xf2ed6359f5dee0334d68cd21d306d9d3e7a49232';
const ENVELOPE = JSON.stringify({ error: 'upstream', status: 502 });

let demonstrated = 0, notReproduced = 0;
const lines = [];
const probe = (name, reproduced, detail) => {
  if (reproduced) { demonstrated++; lines.push('  REPRODUCES  ' + name + (detail ? '\n                 ' + String(detail).replace(/\s+/g, ' ').slice(0, 360) : '')); }
  else { notReproduced++; lines.push('  fixed       ' + name + (detail ? '\n                 ' + String(detail).replace(/\s+/g, ' ').slice(0, 240) : '')); }
};

const word = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
const strRet = (t) => { const b = Buffer.from(t, 'utf8'); return '0x' + (32).toString(16).padStart(64, '0') + BigInt(b.length).toString(16).padStart(64, '0') + b.toString('hex').padEnd(Math.ceil(b.length / 32) * 64, '0'); };
const codeWith = (sels) => '0x' + sels.map((s) => '63' + s.slice(2)).join('') + '00';
const text = (page, sel) => page.$eval(sel, (e) => e.textContent || '').catch(() => '');
const val = (page, sel) => page.$eval(sel, (e) => e.value || '').catch(() => '');

// ---------------------------------------------------------------- R19-1: the Check page
// web/check.js:225 explorerJson is written around three outcomes and says so in its own comment: it
// answered, it answered "no such thing", or it would not answer at all. Its final line is
// `return { ok: reached, data: null }`, and `reached` is true at that point in exactly one case -- the
// third one. So "it would not answer" is handed to readAddress as a definite answer, and readAddress's
// `else if (!sc) { out.verified = false }` turns it into "no source published".
function checkAnswer() {
  return function (method, params = []) {
    const p0 = String((params[0] && params[0].to) || params[0] || '').toLowerCase();
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'eth_blockNumber': return '0x1000';
      case 'eth_getBalance': return '0xde0b6b3a7640000';
      case 'eth_getTransactionCount': return '0x5';
      case 'eth_getCode': return p0 === NFT.toLowerCase() ? codeWith(['0x40c10f19']) : '0x';
      case 'eth_getStorageAt': return '0x' + '0'.repeat(64);
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), data = String(params[0].data || ''), sel = data.slice(0, 10);
        if (sel === '0x01ffc9a7') return word(to === NFT.toLowerCase() && data.slice(10, 18) === '80ac58cd' ? 1 : 0);
        if (sel === '0x313ce567') return null;
        if (sel === '0x06fdde03') return strRet('Test Collection');
        if (sel === '0x95d89b41') return strRet('TC');
        if (sel === '0x18160ddd') return word(1000);
        return word(1);
      }
      default: return null;
    }
  };
}

async function checkProbe(browser) {
  const ans = checkAnswer();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
  page.on('dialog', (d) => d.dismiss());
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    // Every explorer lookup, direct route or /x/ passthrough, answers with the Worker's own failure body.
    if (url.includes('/api/v2/') || url.includes('/x/'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: ENVELOPE });
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: '{"data":{"amount":"2500"}}' });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let body; try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
      const one = (r) => { try { return { jsonrpc: '2.0', id: r.id, result: ans(r.method, r.params || []) }; }
                           catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: -32000, message: String(e.message) } }; } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto(CHECK, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.fill('#input', NFT);
  await page.click('#go');
  await page.waitForTimeout(4000);
  const out = await text(page, '#out');
  probe('R19-1 the Check page reads the Worker’s own {"error":"upstream"} envelope as a definite answer and states that the contract has published no source, instead of "could not check"',
    /no source published|No source has been published/.test(out) && !/could not check for a published source|the explorer would not answer/.test(out),
    JSON.stringify({ saysNoSource: /no source published|No source has been published/.test(out),
                     saysCouldNotCheck: /could not check for a published source/.test(out),
                     explorerPill: /the explorer would not answer/.test(out) }));
  await page.close();
}

// ---------------------------------------------------------------- R19-2: the airdrop page's holder walk
// web/index.html:1894 walks the holders endpoint page by page. It ends the walk on `!d.next_page_params`
// and adds `d.items || []`. A body that is neither a page of holders nor an error it recognises -- the
// envelope above is exactly one -- is therefore indistinguishable from "that was the last page", and
// `truncated` is left false, so the guard at index.html:1913 does not fire and a partial holder list is
// written into the recipient box as if it were the whole collection.
function airdropAnswer(O) {
  const enc = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
  return function (method, params = []) {
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'net_version': return '46630';
      case 'eth_accounts': case 'eth_requestAccounts': return [RUN_ME];
      case 'eth_blockNumber': return '0x1000';
      case 'eth_gasPrice': return '0x989680';
      case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
      case 'wallet_getCapabilities': return {};
      case 'eth_estimateGas': return '0x' + (21000 + 40000).toString(16);
      case 'eth_getCode': {
        const a = String(params[0] || '').toLowerCase();
        if (a === NFT.toLowerCase() || a === BULK) return '0x60006000';
        return '0x';
      }
      case 'eth_getTransactionReceipt': return null;
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), data = String(params[0].data || ''), sel = data.slice(0, 10);
        if (sel === '0x01ffc9a7') return enc(to === NFT.toLowerCase() && data.slice(10, 18) === '80ac58cd' ? 1 : 0);
        if (sel === '0x313ce567') return null;
        if (sel === '0x06fdde03') return strRet('Probe Collection');
        if (sel === '0x95d89b41') return strRet('PRB');
        if (sel === '0x70a08231') return enc((O.ownedIds || []).length);
        if (sel === '0x2f745c59') { const owned = O.ownedIds || []; const i = Number(BigInt('0x' + data.slice(74))); if (i >= owned.length) throw new Error('index out of range'); return enc(owned[i]); }
        if (sel === '0xe985e9c5') return enc(1);
        if (sel === '0x5c975abb') return enc(0);
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

async function holderWalkProbe(browser) {
  const O = {};
  const ans = airdropAnswer(O);
  const page = await browser.newPage({ viewport: { width: 1200, height: 1800 } });
  page.__dialogs = [];
  page.on('dialog', (d) => { page.__dialogs.push(d.message()); return d.accept(); });
  let holdersCalls = 0;
  // Page one is a full page of 100 holders with next_page_params, exactly as the Worker's translation
  // builds it. Page two is the Worker's failure envelope: a rate limit, a 5xx, a timeout or an unbound key
  // all produce it, and the free PRO tier this walk is built on is five requests a second.
  const PAGE1 = { items: Array.from({ length: 100 }, (_, i) => ({ address: { hash: A(0x9000 + i) }, value: '1' })), next_page_params: { page: 2 } };
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: '{"data":{"amount":"2500"}}' });
    if (url.includes('/holders')) {
      holdersCalls++;
      return holdersCalls === 1
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAGE1) })
        : route.fulfill({ status: 200, contentType: 'application/json', body: ENVELOPE });
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
  await page.click('#connect'); await page.waitForTimeout(600);
  await page.selectOption('#std', '721');
  await page.fill('#token', NFT);
  await page.dispatchEvent('#token', 'change');
  await page.waitForTimeout(800);
  await page.fill('#snapAddr', NFT);
  await page.click('#snap');
  await page.waitForTimeout(4000);
  const box = (await val(page, '#list')).split(/\r?\n/).filter(Boolean);
  const log = await text(page, '#log');
  const msg = await text(page, '#msgList');
  probe('R19-2 an unreadable answer part way through the holder walk ends the walk as if it were the last page: a hundred of the collection’s holders are loaded as the whole list, with nothing said about it being cut short',
    box.length === 100 && holdersCalls >= 2 && !/cut short|incomplete|Stopped after/.test(log + msg),
    JSON.stringify({ holdersRequests: holdersCalls, linesLoaded: box.length,
                     saysIncomplete: /cut short|incomplete|Stopped after/.test(log + msg), tail: (log || '').slice(-180) }));
  await page.close();
}

// ---------------------------------------------------------------- R19-3: Assign's "already paired" guard
// Round eighteen's S-6 added a confirmation before Assign throws away a list that already names every id.
// That guard reads the line POSITIONALLY -- `splitRow(l).slice(1)`, everything after the first cell -- while
// every other reader in the box (boxColumns/addressOn/deliveriesOn/requestedNftQuantity/parseList) reads it
// by column name. web/index.html's own comment says column names are supported exactly so that a file headed
// `label,address` is not misread. Give the file a leading column that is not the address and the guard sees
// a non-numeric cell, concludes the list is not paired, and Assign re-pairs it with no question asked.
async function alreadyPairedProbe(browser) {
  const O = { ownedIds: [71, 72] };
  const ans = airdropAnswer(O);
  const page = await browser.newPage({ viewport: { width: 1200, height: 1800 } });
  page.__dialogs = [];
  page.on('dialog', (d) => { page.__dialogs.push(d.message()); return d.accept(); });
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: '{"data":{"amount":"2500"}}' });
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
  await page.click('#connect'); await page.waitForTimeout(600);
  await page.selectOption('#std', '721');
  await page.fill('#token', NFT);
  await page.dispatchEvent('#token', 'change');
  await page.waitForTimeout(800);

  // Every line names its wallet AND the exact id that wallet is to receive. The only difference from the
  // file the round-eighteen guard was written for is a leading column the page's own header reader supports.
  const PAIRED = 'label,address,tokenId\nfounder,' + A(0x111) + ',11\nartist,' + A(0x222) + ',12\n';
  await page.fill('#list', PAIRED);
  await page.click('#parse'); await page.waitForTimeout(600);
  const parsed = await text(page, '#parseOut');
  page.__dialogs.length = 0;
  await page.click('#assign');
  await page.waitForFunction(() => /Assigned|stopped/.test(document.querySelector('#log').textContent || ''), null, { timeout: 9000 }).catch(() => {});
  await page.waitForTimeout(600);
  const after = await val(page, '#list');
  const asked = page.__dialogs.some((m) => /already names its token ids/i.test(m));
  probe('R19-3 Assign\u2019s "this list is already paired" confirmation reads the line positionally while everything else reads it by column name, so a headed file with a leading label column has its pairings replaced at random with no question asked',
    !asked && /11/.test(PAIRED) && !/\b11\b/.test(after) && !/\b12\b/.test(after) && /71|72/.test(after),
    JSON.stringify({ parsedSummary: parsed.slice(0, 80), dialogs: page.__dialogs, after: after.replace(/\n/g, ' | '), log: (await text(page, '#log')).slice(-140), msg: (await text(page, '#msgList')).slice(0, 100) }));
  await page.close();
}

const browser = await chromium.launch();
try {
  await checkProbe(browser);
  await holderWalkProbe(browser);
  await alreadyPairedProbe(browser);
} finally {
  await browser.close();
}

console.log(lines.join('\n'));
console.log('\n' + demonstrated + ' demonstrated, ' + notReproduced + ' not reproduced');
process.exit(0);
