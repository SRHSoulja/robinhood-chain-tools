// Round-twenty reviewer probes. Same convention as every earlier probe file here: each assertion
// REPRODUCES a finding, so an assertion that PASSES ("REPRODUCES") is a defect that is still present, and
// one that reads "fixed" is a defect that is not.
//
//   node test/web/audit-probe-20.mjs
//
// Nothing here touches a network, signs anything, or needs a key. Every chain and explorer answer is mocked.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.RH_ROOT ? process.env.RH_ROOT.replace(/\/$/, '') + '/' : new URL('../../', import.meta.url).pathname;
const CHECK = pathToFileURL(ROOT + 'web/check.html').href;
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

const word = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
const strRet = (t) => { const b = Buffer.from(t, 'utf8'); return '0x' + (32).toString(16).padStart(64, '0') + BigInt(b.length).toString(16).padStart(64, '0') + b.toString('hex').padEnd(Math.ceil(b.length / 32) * 64, '0'); };
const codeWith = (sels) => '0x' + sels.map((s) => '63' + s.slice(2)).join('') + '00';
const text = (page, sel) => page.$eval(sel, (e) => e.textContent || '').catch(() => '');
const val = (page, sel) => page.$eval(sel, (e) => e.value || '').catch(() => '');

// ---------------------------------------------------------------------------- the Check page
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

// One Check-page lookup of NFT, with /smart-contracts/<addr> answered by `body` at HTTP 200.
async function checkWith(browser, body) {
  const ans = checkAnswer();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
  page.on('dialog', (d) => d.dismiss());
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('/smart-contracts/')) return route.fulfill({ status: 200, contentType: 'application/json', body });
    if (url.includes('/api/v2/') || url.includes('/x/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: '{"data":{"amount":"2500"}}' });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let b; try { b = JSON.parse(req.postData() || '{}'); } catch { b = {}; }
      const one = (r) => { try { return { jsonrpc: '2.0', id: r.id, result: ans(r.method, r.params || []) }; }
                           catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: -32000, message: String(e.message) } }; } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(b) ? b.map(one) : one(b)) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto(CHECK, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.fill('#input', NFT);
  await page.click('#go');
  await page.waitForTimeout(3500);
  const out = await text(page, '#out');
  await page.close();
  return out;
}

// P20-1. deploy/render-worker.py's mainnet translation cannot learn whether a verification is full or
// partial from the module API, and says so in the only honest way available: `is_partially_verified: null`,
// with a comment that calls it "null, not a claim". check.js:302 reads it as `out.partial = !!sc.is_...`,
// which turns "not known" into "not partial", and the pill then states "source published and matched".
// "Matched" is exactly the claim a partial verification does not support.
async function partialProbe(browser) {
  const NULLPARTIAL = JSON.stringify({
    is_verified: true, is_partially_verified: null, name: 'Test Collection', abi: [],
    compiler_version: 'v0.8.24+commit.e11b9ed9', optimization_enabled: true, evm_version: 'cancun',
    proxy_type: null, implementations: [], verified_at: '2026-09-01T00:00:00Z',
  });
  const TRUEPARTIAL = JSON.stringify(Object.assign(JSON.parse(NULLPARTIAL), { is_partially_verified: true }));
  const withNull = await checkWith(browser, NULLPARTIAL);
  const withTrue = await checkWith(browser, TRUEPARTIAL);
  const nullSaysFull = /source published and matched/.test(withNull)
    && !/partly matched|partially verified|not known|could not/.test(withNull);
  const trueSaysPartial = /partly matched|partially verified/.test(withTrue);
  probe('P20-1 the Check page turns the mainnet Worker’s "whether the verification is full or partial is not known" (is_partially_verified: null) into the positive claim "source published and matched", and never shows the partial-verification warning it has for exactly this',
    nullSaysFull && trueSaysPartial,
    JSON.stringify({ withNullPillSaysMatched: /source published and matched/.test(withNull),
                     withNullMentionsPartial: /partly matched|partially verified/.test(withNull),
                     withTrueMentionsPartial: trueSaysPartial }));
}

// P20-2. Round nineteen made explorerJson answer `ok: false` for anything that is not a real answer or a
// real 404. It decides "real answer" by HTTP status and content-type alone: any 200 with a JSON body is
// returned as data, whatever is in it. readAddress then does `out.verified = !!sc.is_verified`, so a body
// that carries no such field at all -- a gateway's own JSON, a cache's error document, an explorer version
// that answers "not found" in the body rather than the status -- becomes the definite sentence "No source
// has been published. ... Nobody outside the people who deployed it knows what this contract does."
async function wrongShapeCheckProbe(browser) {
  const out = await checkWith(browser, JSON.stringify({ error: 'rate limited', retry_after: 30 }));
  probe('P20-2 the Check page reads any 200 JSON body as a real explorer answer, so a body with no is_verified in it at all is stated as the definite fact "no source published" rather than "could not check"',
    /no source published|No source has been published/.test(out) && !/could not check for a published source|the explorer would not answer/.test(out),
    JSON.stringify({ saysNoSource: /no source published/.test(out), saysCouldNotCheck: /could not check for a published source/.test(out) }));
}

// ---------------------------------------------------------------------------- the airdrop page
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

// A connected airdrop page with 721 selected and the collection loaded. `nft` answers /addresses/../nft.
async function airdropPage(browser, O, nft, extra) {
  const ans = airdropAnswer(O);
  const page = await browser.newPage({ viewport: { width: 1200, height: 1800 } });
  page.__dialogs = [];
  page.on('dialog', (d) => { page.__dialogs.push(d.message()); return O.dismiss ? d.dismiss() : d.accept(); });
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: '{"data":{"amount":"2500"}}' });
    if (extra) { const r = extra(url, route); if (r) return r; }
    if (url.includes('/nft')) return nft ? nft(route) : route.fulfill({ contentType: 'application/json', body: '{"items":[],"next_page_params":null}' });
    if (url.includes('/api/v2/') || url.includes('/x/')) return route.fulfill({ contentType: 'application/json', body: '{"items":[]}' });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let b; try { b = JSON.parse(req.postData() || '{}'); } catch { b = {}; }
      const one = (r) => { try { return { jsonrpc: '2.0', id: r.id, result: ans(r.method, r.params || []) }; }
                           catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: e.code || -32000, message: String(e.message) } }; } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(b) ? b.map(one) : one(b)) });
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
  return page;
}

// P20-3. index.html:2258 myTokenIds walks the explorer's NFT inventory. The holder walk two hundred lines
// above it was taught (round nineteen F-2/F-3) that a page which is neither a page of items nor an explicit
// end is a walk cut short, and marks itself `truncated`. This walk was not: it adds `d.items || []`, ends on
// `!d.next_page_params`, and its own page ceiling (`page < 20`) ends it with no mark at all. Assign then
// states a definite shortfall -- "this list asks for 60 NFTs and this wallet holds 50 of them" -- built out
// of a walk that stopped early, and refuses to pair a list the wallet may well have enough for.
async function inventoryWalkProbe(browser, mode) {
  let calls = 0;
  const item = (id) => ({ token: { address_hash: NFT }, id: String(id) });
  const nft = (route) => {
    calls++;
    if (mode === 'wrongshape') {
      // Page one is a real page with more to come; page two is a 200 JSON body that is not a page at all.
      return calls === 1
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: Array.from({ length: 50 }, (_, i) => item(1000 + i)), next_page_params: { page: 2 } }) })
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'Not found' }) });
    }
    // Every page is full and every page says there is another: the walk stops only because it has asked
    // twenty times, which is a limit in this page and not the end of the wallet's inventory.
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [item(2000 + calls)], next_page_params: { page: calls + 1 } }) });
  };
  const page = await airdropPage(browser, { ownedIds: [] }, nft);
  const list = Array.from({ length: 60 }, (_, i) => A(0x30000 + i)).join('\n');
  await page.fill('#list', list);
  await page.click('#assign');
  await page.waitForFunction(() => /Assign stopped|Assigned|Could not read/.test(document.querySelector('#log').textContent || ''), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  const msg = await text(page, '#msgList');
  const log = await text(page, '#log');
  const problems = await text(page, '#problems');
  const said = msg + ' ' + log + ' ' + problems;
  probe('P20-3' + (mode === 'wrongshape' ? 'a' : 'b') + ' myTokenIds ends a cut-short inventory walk as though it were complete ('
      + (mode === 'wrongshape' ? 'a 200 body that is not a page of items' : 'the walk’s own twenty-page ceiling with the explorer still offering a next page')
      + '), and Assign states the resulting count as fact instead of saying the inventory could not be read in full',
    /holds \d+ of them/.test(said) && !/cut short|could not read all|not known/.test(said),
    JSON.stringify({ explorerPages: calls, saidShortfall: /holds \d+ of them/.test(said),
                     saidCutShort: /cut short|could not read all/.test(said), msg: msg.slice(0, 160) }));
  await page.close();
}

// P20-4. Round nineteen F-10 moved Assign's "this list is already paired" test onto the column names when
// the file has a heading. A file headed `address,amount` has no id column at all -- it is the "how many of
// yours each wallet gets" shape the parser explicitly supports and rewrites into `0xabc x3` -- so the test
// falls through to its positional branch, sees a bare whole number after the address, and reports that every
// line already names its token ids. Nothing in the file names an id.
async function alreadyPairedFalsePositive(browser) {
  const page = await airdropPage(browser, { ownedIds: [71, 72, 73, 74, 75, 76], dismiss: true }, null);
  await page.fill('#list', 'address,amount\n' + A(0x111) + ',3\n' + A(0x222) + ',2\n');
  page.__dialogs.length = 0;
  await page.click('#assign');
  await page.waitForTimeout(1500);
  const msg = await text(page, '#msgList');
  const asked = page.__dialogs.some((m) => /already names its token ids/i.test(m));
  probe('P20-4 Assign tells the user that a headed "address,amount" list (the how-many-each shape the parser supports and this page tells people to press Assign for) already names every token id, and refuses to pair it',
    asked && /already names its ids/i.test(msg),
    JSON.stringify({ dialogs: page.__dialogs, msg: msg.slice(0, 140) }));
  await page.close();
}

// P20-5. The same test is an `every()`, so a list where SOME lines name an id is "not paired" and Assign
// replaces all of it without asking. The id the user typed by hand on one line is gone, with no dialog and
// nothing in the log about it.
async function alreadyPairedFalseNegative(browser) {
  const page = await airdropPage(browser, { ownedIds: [71, 72, 73] }, null);
  await page.fill('#list', A(0x111) + ',11\n' + A(0x222) + ' x2\n');
  page.__dialogs.length = 0;
  await page.click('#assign');
  await page.waitForFunction(() => /Assigned|stopped|Could not read/.test(document.querySelector('#log').textContent || ''), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  const after = await val(page, '#list');
  const asked = page.__dialogs.some((m) => /already names its token ids/i.test(m));
  probe('P20-5 a list in which only some lines name an id is read as "not paired", so Assign throws away the ids that were named with no question and no mention of it',
    !asked && !/\b11\b/.test(after) && /7[123]/.test(after),
    JSON.stringify({ dialogs: page.__dialogs, after: after.replace(/\n/g, ' | ').slice(0, 160) }));
  await page.close();
}


// P20-6. "Apply weight" refuses to rewrite a HEADED file that already names an id on each line, in those
// words: "That file already names the exact NFT id on each line ... Nothing has been changed." The guard is
// `acol && acol.id !== undefined`, so it only ever sees a file with a heading. The form this page writes
// itself -- Assign and the picker's "Use these" both emit bare `0xabc,71` lines -- has no heading, so the
// guard never fires, and Apply weight replaces every line with the bare address. The ids are gone. The
// confirmation the user agrees to says nothing about them; it counts wallets.
async function weightEatsIdsProbe(browser) {
  const HOLDERS = { items: [{ address: { hash: A(0x111) }, value: '2' }, { address: { hash: A(0x222) }, value: '1' }], next_page_params: null };
  const page = await airdropPage(browser, { ownedIds: [71, 72, 73] }, null, (url, route) => {
    if (url.includes('/holders')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HOLDERS) });
    return null;
  });
  // A holder snapshot is what reveals the weighting controls, and it is the ordinary way into this screen.
  await page.fill('#snapAddr', NFT);
  await page.click('#snap');
  await page.waitForTimeout(2500);
  // Then the ids are assigned, which is what the page tells the user to do next.
  await page.click('#assign');
  await page.waitForFunction(() => /Assigned|stopped|Could not read/.test(document.querySelector('#log').textContent || ''), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const paired = await val(page, '#list');
  const weightVisible = await page.$eval('#weightRow', (e) => getComputedStyle(e).display !== 'none').catch(() => false);
  page.__dialogs.length = 0;
  await page.click('#applyWeight');
  await page.waitForTimeout(1200);
  const after = await val(page, '#list');
  const hadIds = /,\s*7[123]/.test(paired);
  const keptIds = /,\s*7[123]/.test(after);
  const warned = page.__dialogs.some((m) => /id|NFT id/i.test(m)) || /already names the exact NFT id/.test(await text(page, '#msgList'));
  probe('P20-6 "Apply weight" refuses to eat the token ids in a HEADED file and says so, but silently eats them in the bare `address,id` form this page itself writes: after Assign, one click replaces every paired line with a bare address and the confirmation never mentions the ids',
    weightVisible && hadIds && !keptIds && !warned,
    JSON.stringify({ weightControlsVisible: weightVisible, before: paired.replace(/\n/g, ' | ').slice(0, 120),
                     after: after.replace(/\n/g, ' | ').slice(0, 120), dialogs: page.__dialogs.map((d) => d.slice(0, 90)) }));
  await page.close();
}


// P20-7. `unlimitedFor` compares the number in an approval against the token's own totalSupply and calls
// anything at or above it "unlimited". For an ERC-20 that is the right comparison and is why it was written.
// `approve(address,uint256)` is the SAME selector on ERC-721, where the number is a token id and not an
// amount, and `unlimitedApproval` never asks which standard it is looking at. Ids are not dense: a collection
// that has burned some, or that numbers from a serial rather than from zero, routinely has live ids above its
// totalSupply. The page then prints its own single-NFT sentence and, directly underneath, a red box that
// contradicts it.
async function nftApproveProbe(browser) {
  const SPENDER = A(0xbeef);
  const data = '0x095ea7b3' + SPENDER.slice(2).padStart(64, '0') + (500).toString(16).padStart(64, '0');
  const ans = (function () {
    return function (method, params = []) {
      const p0 = String((params[0] && params[0].to) || params[0] || '').toLowerCase();
      switch (method) {
        case 'eth_chainId': return '0xb626';
        case 'eth_blockNumber': return '0x1000';
        case 'eth_getBalance': return '0xde0b6b3a7640000';
        case 'eth_getTransactionCount': return '0x5';
        case 'eth_getCode': return p0 === NFT.toLowerCase() ? codeWith(['0x095ea7b3']) : '0x';
        case 'eth_getStorageAt': return '0x' + '0'.repeat(64);
        case 'eth_call': {
          const to = String(params[0].to || '').toLowerCase(), d = String(params[0].data || ''), sel = d.slice(0, 10);
          if (sel === '0x01ffc9a7') return word(to === NFT.toLowerCase() && d.slice(10, 18) === '80ac58cd' ? 1 : 0);
          if (sel === '0x313ce567') throw new Error('no decimals');       // not an ERC-20
          if (sel === '0x06fdde03') return strRet('Serial Collection');
          if (sel === '0x95d89b41') return strRet('SER');
          if (sel === '0x18160ddd') return word(100);                     // 100 minted; ids are not dense
          return word(0);
        }
        default: return null;
      }
    };
  })();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
  page.on('dialog', (d) => d.dismiss());
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('/api/v2/') || url.includes('/x/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: '{"data":{"amount":"2500"}}' });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let b; try { b = JSON.parse(req.postData() || '{}'); } catch { b = {}; }
      const one = (r) => {
        if (r.method === 'eth_simulateV1') return { jsonrpc: '2.0', id: r.id, result: [{ calls: [{ status: '0x1', gasUsed: '0x7530', returnData: '0x', logs: [] }] }] };
        try { return { jsonrpc: '2.0', id: r.id, result: ans(r.method, r.params || []) }; }
        catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: -32000, message: String(e.message) } }; }
      };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(b) ? b.map(one) : one(b)) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto(CHECK, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.fill('#from', A(0xcafe));
  await page.fill('#input', JSON.stringify({ to: NFT, data, from: A(0xcafe) }));
  await page.click('#go');
  await page.waitForTimeout(3500);
  const out = await text(page, '#out');
  await page.close();
  const saysOneNft = /Let .* move Serial Collection #500/.test(out);
  const saysUnlimited = /This is an unlimited approval/.test(out) && /in any amount/.test(out);
  probe('P20-7 the Check page reads an ERC-721 approve(spender, tokenId) as an ERC-20 allowance whenever the id is at or above the collection\u2019s totalSupply, so a single-NFT approval is described correctly in the sentence and contradicted directly underneath by a red "this is an unlimited approval ... in any amount" box',
    saysOneNft && saysUnlimited,
    JSON.stringify({ sentenceSaysOneNft: saysOneNft, redBoxSaysUnlimited: saysUnlimited,
                     excerpt: (out.match(/This is an unlimited approval[^.]*\./) || [''])[0].slice(0, 160) }));
}


// P20-8. The holder walk DOES set `truncated` when a page comes back that is not a page of items -- that was
// round nineteen F-2. But the two checks that follow it run in the wrong order: `if (!uniq.length)` is
// tested first and returns, so the truncated branch is unreachable whenever the FIRST page is the unreadable
// one. The page then states "The explorer returned no holders for that address", which is a fact about the
// collection, derived from an answer nobody could read.
async function firstPageUnreadableProbe(browser) {
  let calls = 0;
  const page = await airdropPage(browser, { ownedIds: [] }, null, (url, route) => {
    if (url.includes('/holders')) { calls++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'Not found' }) }); }
    return null;
  });
  await page.fill('#snapAddr', NFT);
  await page.click('#snap');
  await page.waitForTimeout(2500);
  const log = await text(page, '#log');
  const msg = await text(page, '#msgList');
  const said = log + ' ' + msg;
  probe('P20-8 when the FIRST page of the holder walk is a 200 body that is not a page of items, the walk marks itself cut short and then never says so: the empty-list check returns first, and the page states "The explorer returned no holders for that address" as a fact about the collection',
    calls >= 1 && /returned no holders/.test(said) && !/cut short|incomplete|Stopped after/.test(said),
    JSON.stringify({ holdersRequests: calls, saysNoHolders: /returned no holders/.test(said),
                     saysCutShort: /cut short|incomplete|Stopped after/.test(said), tail: log.slice(-160) }));
  await page.close();
}

const browser = await chromium.launch();
try {
  await partialProbe(browser);
  await wrongShapeCheckProbe(browser);
  await inventoryWalkProbe(browser, 'wrongshape');
  await inventoryWalkProbe(browser, 'ceiling');
  await alreadyPairedFalsePositive(browser);
  await alreadyPairedFalseNegative(browser);
  await weightEatsIdsProbe(browser);
  await nftApproveProbe(browser);
  await firstPageUnreadableProbe(browser);
} finally {
  await browser.close();
}

console.log(lines.join('\n'));
console.log('\n' + demonstrated + ' demonstrated, ' + notReproduced + ' not reproduced');
process.exit(0);
