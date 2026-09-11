// Round-seventeen reviewer probes. (The reviewer named this file audit-probe-14.mjs, as the fourteenth probe file;
// it is kept under the round's number, like the others, so the report's references to `audit-probe-14` mean this file.) Same convention
// as every earlier probe file: each assertion REPRODUCES a finding, so an assertion that PASSES
// ("REPRODUCES") is a defect that is still present, and one that reads "fixed" is a defect that is not.
//
//   node test/web/audit-probe-17.mjs
//
// Every chain, explorer and price answer is mocked; nothing here touches a network or signs anything real.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.RH_ROOT ? process.env.RH_ROOT.replace(/\/$/, '') + '/' : new URL('../../', import.meta.url).pathname;
const AIRDROP = pathToFileURL(ROOT + 'web/index.html').href;
const A = (n) => '0x' + n.toString(16).padStart(40, '0');
const NFT = A(0x721), RUN_ME = A(0xdead), OTHER = A(0xbeef);
const BULK = '0xf2ed6359f5dee0334d68cd21d306d9d3e7a49232';
const ZERO = '0x0000000000000000000000000000000000000000';

let demonstrated = 0, notReproduced = 0;
const lines = [];
const probe = (name, reproduced, detail) => {
  if (reproduced) { demonstrated++; lines.push('  REPRODUCES  ' + name + (detail ? '\n                 ' + String(detail).replace(/\s+/g, ' ').slice(0, 360) : '')); }
  else { notReproduced++; lines.push('  fixed       ' + name + (detail ? '\n                 ' + String(detail).replace(/\s+/g, ' ').slice(0, 240) : '')); }
};

const enc = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
const strRet = (t) => { const b = Buffer.from(t, 'utf8'); const hex = b.toString('hex');
  return '0x' + (32).toString(16).padStart(64, '0') + BigInt(b.length).toString(16).padStart(64, '0')
    + hex.padEnd(Math.ceil(Math.max(hex.length, 1) / 64) * 64, '0'); };
const HASH = '0x' + 'cd'.repeat(32);

// One answerer for the wallet and for the page's own JsonRpcProvider. `O` is live: a probe may change it
// while the page is mid-read, which is the whole point of the Assign probes.
function airdropAnswer(O) {
  return function (method, params = []) {
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'net_version': return '46630';
      case 'eth_accounts': case 'eth_requestAccounts': return [O.account || RUN_ME];
      case 'eth_blockNumber': return '0x1000';
      case 'eth_gasPrice': return '0x989680';
      case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
      case 'wallet_getCapabilities': return {};
      case 'eth_getBlockByNumber': return { number: '0x1000', hash: '0x' + '11'.repeat(32), parentHash: '0x' + '22'.repeat(32), timestamp: '0x1', gasLimit: '0x1', gasUsed: '0x0', miner: A(0), baseFeePerGas: '0x989680', transactions: [] };
      case 'eth_estimateGas': return '0x' + (21000 + 40000).toString(16);
      case 'eth_sendTransaction': { O.sent = (O.sent || 0) + 1; return HASH; }
      case 'eth_getCode': {
        const a = String(params[0] || '').toLowerCase();
        if (a === NFT.toLowerCase() || a === BULK) return '0x60006000';
        return '0x';
      }
      case 'eth_getTransactionByHash': {
        // The wallet broadcast the transaction and then cannot look it up: a relay hiccup, a rate-limited
        // wallet RPC, a node a block behind that answers with an error rather than null.
        if (O.txByHashThrows) { const e = new Error('Internal JSON-RPC error.'); e.code = -32603; throw e; }
        return {
          hash: HASH, blockHash: '0x' + '11'.repeat(32), blockNumber: '0x1000', transactionIndex: '0x0',
          from: RUN_ME, to: BULK, value: '0x0', gas: '0x186a0', gasPrice: '0x989680',
          maxFeePerGas: '0x989680', maxPriorityFeePerGas: '0x0', input: '0x', nonce: '0x1',
          type: '0x2', chainId: '0xb626', accessList: [], v: '0x1', r: '0x' + '11'.repeat(32), s: '0x' + '22'.repeat(32),
        };
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
        if (sel === '0xe985e9c5') return enc(1);          // approved
        if (sel === '0x5c975abb') return enc(0);
        if (sel === '0x098144d4') return '0x';
        if (sel === '0xc87b56dd') return strRet('');
        if (sel === '0x6352211e') return '0x' + RUN_ME.slice(2).padStart(64, '0');
        if (sel === '0x56c3e5e9' || sel === '0xdf1c9e47') return enc(400000);
        if (sel === '0x20d2c951') return enc(100000);
        if (sel === '0x5f2a9f41') return enc(5000000);
        if (to === BULK) return enc(1) + (0).toString(16).padStart(64, '0');   // (sent, skipped)
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
  page.on('dialog', (d) => { page.__dialogs.push(d.message()); return O.acceptDialogs ? d.accept() : d.dismiss(); });
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: '{"data":{"amount":"2500"}}' });
    if (url.includes('/holders')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(O.holders || { items: [] }) });
    if (url.includes('/api/v2/')) return route.fulfill({ contentType: 'application/json', body: '{"items":[]}' });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let body; try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
      // Hold exactly one direct RPC request open, so a probe can move ordinary UI state while Assign is
      // between reading the box and writing it. The same hook the round-sixteen regression uses.
      if (O.delayNextRpcMs) { const ms = O.delayNextRpcMs; O.delayNextRpcMs = 0; await new Promise((r) => setTimeout(r, ms)); }
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
    window.__asked = [];
    const listeners = {};
    window.__emit = (ev, arg) => (listeners[ev] || []).slice().forEach((f) => { try { f(arg); } catch (e) {} });
    window.ethereum = {
      isMetaMask: true,
      on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeListener(ev, fn) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
      async request({ method, params }) {
        window.__asked.push(method);
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
const disabled = (page, sel) => page.$eval(sel, (e) => !!e.disabled).catch(() => null);
async function connectAndLoad(page) {
  await page.click('#connect'); await page.waitForTimeout(600);
  await page.selectOption('#std', '721');
  await page.fill('#token', NFT);
  await page.dispatchEvent('#token', 'change');
  await page.waitForFunction(() => /Probe Collection/.test(document.querySelector('#tokenInfo').textContent || ''), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
}
const pending = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('bulksend:pending:'))
  .map((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }).filter(Boolean));

const browser = await chromium.launch();
try {
  // ---- R17-1: Assign captures the box, token, standard, account, network and pairing setting, and not
  //      "How many each". The value read before the wait is written after it, and Send is armed on it.
  {
    const O = { ownedIds: [71, 72, 73, 74, 75, 76] };
    const page = await openAirdrop(browser, O);
    await connectAndLoad(page);
    await page.fill('#list', A(0x801) + '\n' + A(0x802) + '\n');
    await page.fill('#each', '1');
    O.delayNextRpcMs = 1500;
    await page.click('#assign');
    await page.waitForTimeout(200);
    await page.fill('#each', '3');                  // an ordinary edit to a control Assign read before it waited
    await page.waitForTimeout(3200);
    const box = (await val(page, '#list')).split(/\r?\n/).filter(Boolean);
    const log = await text(page, '#log');
    const sendOn = !(await disabled(page, '#send'));
    probe('R17-1 an Assign completion writes the "how many each" value it read before the wait, not the one now on screen, and arms Send on it',
      box.length === 2 && /Assigned 2 lines/.test(log) && sendOn,
      JSON.stringify({ lines: box.length, each: await val(page, '#each'), sendEnabled: sendOn, log: log.slice(-160) }));
    await page.close();
  }

  // ---- controls for the round-sixteen fix, the inputs it does capture. Expected to read "fixed".
  {
    const O = { ownedIds: [71, 72] };
    const page = await openAirdrop(browser, O);
    await connectAndLoad(page);
    await page.fill('#list', A(0x801) + '\n');
    O.delayNextRpcMs = 1500;
    await page.click('#assign');
    await page.waitForTimeout(200);
    O.account = OTHER;                              // the wallet switches account while holdings are being read
    await page.evaluate((a) => window.__emit('accountsChanged', [a]), OTHER);
    await page.waitForTimeout(3000);
    const box = await val(page, '#list');
    probe('R17-c1 (control) an account change during the wait is accepted and Assign writes the old account’s ids',
      box !== A(0x801) + '\n' || !/connected account/.test(await text(page, '#msgList')),
      JSON.stringify({ box, msg: (await text(page, '#msgList')).slice(0, 120) }));
    await page.close();
  }
  {
    const O = { ownedIds: [71, 72] };
    const page = await openAirdrop(browser, O);
    await connectAndLoad(page);
    await page.fill('#list', A(0x801) + '\n');
    O.delayNextRpcMs = 1500;
    await page.click('#assign');
    await page.waitForTimeout(200);
    await page.uncheck('#rand');
    await page.waitForTimeout(3000);
    const box = await val(page, '#list');
    probe('R17-c2 (control) toggling random pairing during the wait is accepted and Assign writes anyway',
      box !== A(0x801) + '\n' || !/random-pairing/.test(await text(page, '#msgList')),
      JSON.stringify({ box, msg: (await text(page, '#msgList')).slice(0, 120) }));
    await page.close();
  }

  // ---- R17-2: a list that already names an exact id on every line is re-paired by Assign without a word.
  //      Apply Weight refuses the same input ("That file already names the exact NFT id on each line").
  {
    const O = { ownedIds: [41, 42] };
    const page = await openAirdrop(browser, O);
    await connectAndLoad(page);
    await page.uncheck('#rand');
    const before = A(0x111) + ',42\n' + A(0x222) + ',41\n';
    await page.fill('#list', before);
    await page.click('#assign');
    await page.waitForFunction(() => /Assigned/.test(document.querySelector('#log').textContent || ''), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    const after = await val(page, '#list');
    const rePaired = after.toLowerCase().startsWith(A(0x111) + ',41') && after.toLowerCase().includes(A(0x222) + ',42');
    probe('R17-2 Assign silently swaps which wallet gets which id on a list that already named every id, with no confirmation and no refusal',
      rePaired && page.__dialogs.length === 0 && !(await disabled(page, '#send')),
      JSON.stringify({ before, after, dialogs: page.__dialogs.length, sendEnabled: !(await disabled(page, '#send')) }));
    await page.close();
  }

  // ---- R17-3: the holder snapshot's early returns skip re-enabling its button.
  {
    const O = { holders: { items: [] } };
    const page = await openAirdrop(browser, O);
    await connectAndLoad(page);
    await page.fill('#snapAddr', NFT);
    await page.click('#snap');
    await page.waitForTimeout(2500);
    probe('R17-3 after the explorer returns no holders, the Fetch button stays disabled until the page is reloaded',
      (await disabled(page, '#snap')) === true && /no holders/.test(await text(page, '#log')),
      JSON.stringify({ disabled: await disabled(page, '#snap'), log: (await text(page, '#log')).slice(-120) }));
    await page.close();
  }

  // ---- R17-4: the bulk path learns the transaction hash only when the wallet can look the transaction up
  //      afterwards. When it cannot, the send never returns, the form stays locked, and the pending record
  //      keeps hash: null although the wallet has already answered eth_sendTransaction with the hash.
  {
    const O = { ownedIds: [7], txByHashThrows: true, acceptDialogs: true };
    const page = await openAirdrop(browser, O);
    await connectAndLoad(page);
    await page.fill('#list', A(0x41) + ',7\n'); await page.waitForTimeout(200);
    await page.click('#parse'); await page.waitForTimeout(500);
    await page.click('#send');
    for (let i = 0; i < 40 && !(O.sent > 0); i++) await page.waitForTimeout(300);
    await page.waitForTimeout(9000);
    const pend = await pending(page);
    const log = await text(page, '#log');
    probe('R17-4 a wallet that answers eth_sendTransaction but cannot answer eth_getTransactionByHash leaves the send hanging, the form locked, and the pending record without the hash the wallet already returned',
      O.sent === 1 && pend.length === 1 && pend[0].hash === null && !/sent, waiting/.test(log) && (await disabled(page, '#list')) === true,
      JSON.stringify({ sent: O.sent, pending: pend.map((p) => ({ hash: p.hash, rows: (p.rows || []).length })), listLocked: await disabled(page, '#list'), log: log.slice(-200) }));
    await page.close();
  }

  // ---- R17-5: a bare list holding the zero address cannot be Assigned, and the user is told the output
  //      "did not round-trip" and to press Assign again, never which line is the problem.
  {
    const O = { ownedIds: [1, 2] };
    const page = await openAirdrop(browser, O);
    await connectAndLoad(page);
    await page.fill('#list', A(0x111) + '\n' + ZERO + '\n');
    await page.click('#assign');
    await page.waitForFunction(() => /round-trip|Assigned/.test(document.querySelector('#msgList').textContent + (document.querySelector('#log').textContent || '')), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    const msg = await text(page, '#msgList'), problems = await text(page, '#problems');
    probe('R17-5 Assign on a list holding the zero address reports only that its output did not round-trip, and nothing on screen names the zero-address line',
      /round-trip/.test(msg) && !/zero address/.test(problems) && !/zero address/.test(msg),
      JSON.stringify({ msg: msg.slice(0, 160), problems: problems.slice(0, 160) }));
    await page.close();
  }

  // ---- R17-6: "0xA x0" is one delivery to the picker and list sizing, and a refused line to Assign.
  {
    const O = { ownedIds: [5, 6] };
    const page = await openAirdrop(browser, O);
    await connectAndLoad(page);
    await page.fill('#list', A(0x111) + ' x0\n');
    await page.click('#pick'); await page.waitForTimeout(2500);
    const need = await text(page, '#pickNeed');
    await page.click('#pickClose');
    await page.click('#assign'); await page.waitForTimeout(800);
    const msg = await text(page, '#msgList');
    probe('R17-6 the picker counts "x0" as one delivery while Assign refuses the same line: two readers of one quantity disagree',
      need.trim() === '1' && /not a whole number of NFTs/.test(msg),
      JSON.stringify({ pickNeed: need.trim(), assignMsg: msg.slice(0, 120) }));
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(lines.join('\n'));
console.log('\n' + demonstrated + ' demonstrated, ' + notReproduced + ' not reproduced');
process.exit(0);
