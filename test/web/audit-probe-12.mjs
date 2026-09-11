// Twelfth-round reviewer probes. Same convention as the earlier probe files: each assertion REPRODUCES a
// finding, so an assertion that PASSES ("REPRODUCES") is a defect that is still present.
//
//   node test/web/audit-probe-12.mjs
//
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const CHECK = pathToFileURL(new URL('../../web/check.html', import.meta.url).pathname).href;
const AIRDROP = pathToFileURL(new URL('../../web/index.html', import.meta.url).pathname).href;
const A = (n) => '0x' + n.toString(16).padStart(40, '0');
const TOK = A(0x20), ME = A(0xdead);

let demonstrated = 0, notReproduced = 0;
const lines = [];
const probe = (name, reproduced, detail) => {
  if (reproduced) { demonstrated++; lines.push('  REPRODUCES  ' + name + (detail ? '\n                 ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : '')); }
  else { notReproduced++; lines.push('  fixed       ' + name + (detail ? '\n                 ' + String(detail).replace(/\s+/g, ' ').slice(0, 200) : '')); }
};

const word = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
const strRet = (t) => { const b = Buffer.from(t, 'utf8'); const hex = b.toString('hex');
  return '0x' + (32).toString(16).padStart(64, '0') + BigInt(b.length).toString(16).padStart(64, '0')
    + hex.padEnd(Math.ceil(Math.max(hex.length, 1) / 64) * 64, '0'); };

// =========================================================================================================
// The Check page
// =========================================================================================================
function checkAnswer() {
  return function (method, params = []) {
    const p0 = String((params[0] && params[0].to) || params[0] || '').toLowerCase();
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'eth_blockNumber': return '0x1000';
      case 'eth_getBalance': return '0xde0b6b3a7640000';
      case 'eth_getTransactionCount': return '0x5';
      case 'eth_getCode': return p0 === TOK ? '0x6340c10f1900' : '0x';
      case 'eth_getStorageAt': return '0x' + '0'.repeat(64);
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), data = String(params[0].data || ''), sel = data.slice(0, 10);
        if (sel === '0x01ffc9a7') return word(0);
        if (sel === '0x313ce567') return to === TOK ? word(18) : null;
        if (sel === '0x06fdde03') return strRet('Test Token');
        if (sel === '0x95d89b41') return strRet('TT');
        if (sel === '0x18160ddd') return word(1000);
        if (sel === '0x8da5cb5b') return word(0x117);
        if (sel === '0x5c975abb') return word(0);
        return word(1);
      }
      case 'eth_simulateV1': {
        const calls = (params[0].blockStateCalls[0] || {}).calls || [];
        return [{ calls: calls.map(() => ({ status: '0x1', gasUsed: '0xb8a8', returnData: '0x', logs: [] })) }];
      }
      default: return null;
    }
  };
}

async function openCheck(browser) {
  const ans = checkAnswer();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
  page.on('dialog', (d) => d.dismiss());
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: '{"data":{"amount":"2500"}}' });
    if (url.includes('/api/v2/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let body; try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
      const one = (r) => { try { return { jsonrpc: '2.0', id: r.id, result: ans(r.method, r.params || []) }; }
                           catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: -32000, message: String(e.message) } }; } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto(CHECK, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  return page;
}
const ask = async (page, q, from) => {
  await page.fill('#input', q);
  if (from) await page.fill('#from', from);
  await page.click('#go');
  await page.waitForTimeout(2500);
  return (await page.textContent('#out')) || '';
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

// ---------------------------------------------------------------------------------------------------------
// C-1. round eleven's B-4 on the other reader. `eth_sendTransaction`'s chainId is read only on the
// single-call path. Two pasted requests, or one carrying any field that produces a note, send the same
// transaction through the batch renderer, where `env` is null and nothing looks at chainId at all.
{
  const page = await openCheck(browser);
  const approve = '0x095ea7b3' + '1'.repeat(40).padStart(64, '0') + 'f'.repeat(64);
  const two = JSON.stringify([
    { method: 'eth_sendTransaction', params: [{ to: TOK, data: approve, chainId: '0x1' }] },
    { method: 'eth_sendTransaction', params: [{ to: TOK, data: approve }] },
  ]);
  const out = await ask(page, two, ME);
  probe('C-1a  two pasted eth_sendTransaction: chainId 0x1 (Ethereum) raises no network warning, and the '
      + 'call is described and simulated against Robinhood Chain',
    !/different network|network this page cannot read|names a network/i.test(out) && /would succeed/i.test(out), out.slice(0, 240));

  const oneWithNote = JSON.stringify({ method: 'eth_sendTransaction',
    params: [{ to: TOK, data: approve, chainId: '0x1', calls: [] }] });
  const out2 = await ask(page, oneWithNote, ME);
  probe('C-1b  one eth_sendTransaction carrying any unrecognised field: same, chainId 0x1 unread',
    !/different network|network this page cannot read|names a network/i.test(out2) && /would succeed/i.test(out2), out2.slice(0, 240));

  const single = JSON.stringify({ method: 'eth_sendTransaction', params: [{ to: TOK, data: approve, chainId: '0x1' }] });
  const out3 = await ask(page, single, ME);
  probe('C-1c  control: on the single-call path the SAME chainId is refused (expected to read "fixed")',
    !/different network/i.test(out3), out3.slice(0, 160));
  await page.close();
}

// ---------------------------------------------------------------------------------------------------------
// C-2. readTransaction validates neither `to` nor `from`, where readEnvelope validates both. The renderer
// catches an unreadable `to` afterwards and calls it "a contract being created", which is a statement about
// the input that is not true of it. An unreadable `from` silently replaces the address in the box.
{
  const page = await openCheck(browser);
  const out = await ask(page, JSON.stringify([
    { method: 'eth_sendTransaction', params: [{ to: '0x1234', data: '0x' }] },
    { method: 'eth_sendTransaction', params: [{ to: TOK, data: '0x' }] },
  ]), ME);
  probe('C-2a  a malformed `to` ("0x1234") is reported as a contract being created',
    /contract being created/i.test(out), out.slice(0, 240));

  const out2 = await ask(page, JSON.stringify([
    { method: 'eth_sendTransaction', params: [{ to: TOK, from: 'nonsense', data: '0x' }] },
    { method: 'eth_sendTransaction', params: [{ to: TOK, data: '0x' }] },
  ]), ME);
  probe('C-2b  a `from` that is not an address replaces the sender in the box, unvalidated and unannounced',
    /as nonsense/i.test(out2) || (!/sender/i.test(out2.split('Request 2')[0] || '') && /nonsense/i.test(out2)), out2.slice(0, 300));

  const other = A(0xfeed);
  const out3 = await ask(page, JSON.stringify([
    { method: 'eth_sendTransaction', params: [{ to: TOK, from: other, data: '0x' }] },
    { method: 'eth_sendTransaction', params: [{ to: TOK, data: '0x' }] },
  ]), ME);
  probe('C-2c  an eth_sendTransaction whose `from` differs from the box says nothing about the difference '
      + '(wallet_sendCalls does)',
    !/names a different sender than the box/i.test(out3), out3.slice(0, 240));
  await page.close();
}

// =========================================================================================================
// The airdrop page
// =========================================================================================================
const NFT = '0x1111111111111111111111111111111111111111';
const RUN_ME = A(0xdead);
const BULK = '0xf2ed6359f5dee0334d68cd21d306d9d3e7a49232';
const padAddr = (a) => '0x' + a.slice(2).padStart(64, '0');
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function airdropAnswer(O) {
  const enc = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
  return function answer(method, params = []) {
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'net_version': return '46630';
      case 'eth_accounts': case 'eth_requestAccounts': return [RUN_ME];
      case 'eth_gasPrice': return '0x989680';
      case 'eth_blockNumber': return '0x1000';
      case 'wallet_getCapabilities': return {};
      case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
      case 'eth_estimateGas': return '0x' + (21000 + 40000).toString(16);
      case 'eth_getCode': {
        const a = String(params[0] || '').toLowerCase();
        if (a === NFT.toLowerCase() || a === BULK) return '0x60006000';
        return '0x';
      }
      case 'eth_getTransactionReceipt': return O.receipt || null;
      case 'eth_getTransactionByHash': return O.tx || null;
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), data = String(params[0].data || ''), sel = data.slice(0, 10);
        if (sel === '0x01ffc9a7') return enc(data.slice(10, 18) === '80ac58cd' ? 1 : 0);
        if (sel === '0x06fdde03') return strRet('Probe Collection');
        if (sel === '0x95d89b41') return strRet('PRB');
        if (sel === '0x70a08231') return enc(50);
        if (sel === '0xe985e9c5') return enc(1);
        if (sel === '0x5c975abb') return enc(0);
        if (sel === '0x098144d4') return '0x';
        if (sel === '0x2f745c59') return enc(1 + Number(BigInt('0x' + data.slice(74))));
        if (sel === '0xc87b56dd') return strRet('');
        if (sel === '0x6352211e') return '0x' + String(O.ownerIs || RUN_ME).slice(2).padStart(64, '0');
        if (to === BULK) return enc(400000);
        return enc(0);
      }
      default: return null;
    }
  };
}

async function openAirdrop(browser, O = {}) {
  const ans = airdropAnswer(O);
  const page = await browser.newPage({ viewport: { width: 1200, height: 1800 } });
  page.on('dialog', (d) => (O.acceptDialogs ? d.accept() : d.dismiss()));
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: '{"data":{"amount":"2500"}}' });
    if (url.includes('/api/v2/')) return route.fulfill({ contentType: 'application/json', body: '{"items":[]}' });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let body; try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
      const one = (r) => { try { return { jsonrpc: '2.0', id: r.id, result: ans(r.method, r.params || []) }; }
                           catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: -32000, message: String(e.message) } }; } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.addInitScript((pre) => {
    const O = JSON.parse(pre);
    for (const [k, v] of Object.entries(O.storage || {})) { try { localStorage.setItem(k, v); } catch (e) {} }
    window.ethereum = {
      isMetaMask: true,
      on: () => {}, removeListener: () => {},
      request: async ({ method, params }) => {
        const r = await fetch('https://rpc.testnet.chain.robinhood.com', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }),
        });
        const j = await r.json();
        if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e; }
        return j.result;
      },
    };
  }, JSON.stringify(O));
  await page.goto(AIRDROP, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  return page;
}

// ---------------------------------------------------------------------------------------------------------
// A-1. `arrivalsFromReceipt` reads the LIVE `me` for the sender filter, although the token and the standard
// it reads were fixed last round for exactly this reason. On page load nothing is connected, so `me` is null,
// every log is filtered out, and every pending batch is reported as "the token reported 0 transfers in that
// transaction ... N it did not report, which stay held back", which the receipt contradicts.
{
  const to1 = A(0x111), to2 = A(0x222);
  const rows = [{ to: to1, id: '1', amount: null, k: to1.toLowerCase() + ':1:#1' },
                { to: to2, id: '2', amount: null, k: to2.toLowerCase() + ':2:#1' }];
  const hash = '0x' + 'ab'.repeat(32);
  const run = 'bulksend:46630:' + RUN_ME.toLowerCase() + ':' + NFT.toLowerCase() + ':721';
  const pending = { pid: 'probe12', run, chain: 46630, bulk: null, hash, at: Date.now() - 60000,
                    rows, via: 'wallet', token: NFT, std: '721' };
  const receipt = {
    status: '0x1', transactionHash: hash, blockNumber: '0x1000', gasUsed: '0x1000',
    cumulativeGasUsed: '0x1000', effectiveGasPrice: '0x989680', logsBloom: '0x' + '0'.repeat(512),
    type: '0x2', contractAddress: null, root: null,
    blockHash: '0x' + '11'.repeat(32), transactionIndex: '0x0', from: RUN_ME, to: NFT, logs: [
      { address: NFT, topics: [TRANSFER_TOPIC, padAddr(RUN_ME), padAddr(to1), word(1)], data: '0x',
        blockNumber: '0x1000', transactionHash: hash, transactionIndex: '0x0', blockHash: '0x' + '11'.repeat(32), logIndex: '0x0', removed: false },
      { address: NFT, topics: [TRANSFER_TOPIC, padAddr(RUN_ME), padAddr(to2), word(2)], data: '0x',
        blockNumber: '0x1000', transactionHash: hash, transactionIndex: '0x0', blockHash: '0x' + '11'.repeat(32), logIndex: '0x1', removed: false },
    ],
  };
  const page = await openAirdrop(browser, { receipt, storage: { ['bulksend:pending:probe12']: JSON.stringify(pending) } });
  await page.waitForTimeout(1500);
  const logText = (await page.textContent('#log')) || '';
  probe('A-1a  on load, with the receipt in front of it, a pending batch is reported as 0 transfers reported '
      + 'by the token and every row held back',
    /reported 0 transfer/i.test(logText) || /it did not report/i.test(logText), logText.slice(0, 300));

  // The same page, the same receipt, after connecting the account that sent it: now it reads correctly.
  await page.click('#connect').catch(() => {});
  await page.waitForTimeout(2000);
  const after = (await page.textContent('#log')) || '';
  probe('A-1b  control: connecting the sending account makes the identical receipt read correctly '
      + '(expected to read "fixed")',
    !/reported all 2 of these transfers|reported 2 transfers?/i.test(after), after.slice(-300));
  await page.close();
}

// ---------------------------------------------------------------------------------------------------------
// A-2. "Use these" in the NFT picker rewrites the box from walletsInBox(), which silently drops any line
// whose address it cannot read. A list of three where one address has a broken checksum comes back as two,
// with no message about the third, and Check list then reports no problems at all.
{
  const page = await openAirdrop(browser, { acceptDialogs: true });
  await page.click('#connect');
  await page.waitForTimeout(1200);
  await page.fill('#token', NFT);
  await page.dispatchEvent('#token', 'change');
  await page.waitForTimeout(1200);
  const badChecksum = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01';   // right length, wrong capitals
  const listed = [A(0x111), badChecksum, A(0x222)].join('\n');
  await page.fill('#list', listed);
  await page.click('#pick');
  await page.waitForTimeout(2500);
  await page.click('#pickAll');
  await page.waitForTimeout(300);
  await page.click('#pickUse');
  await page.waitForTimeout(1500);
  const box = await page.inputValue('#list');
  const msg = (await page.textContent('#msgList')) || '';
  const problems = (await page.textContent('#problems')) || '';
  const kept = box.split('\n').filter(Boolean).length;
  probe('A-2   "Use these" rewrote a 3-line list as ' + kept + ' lines; the line with the broken checksum is '
      + 'gone and nothing says so',
    kept === 2 && !/checksum|could not be read|0xAbCdEf/i.test(msg + problems),
    'box now: ' + JSON.stringify(box) + ' | msg: ' + msg.slice(0, 120));
  await page.close();
}

// ---------------------------------------------------------------------------------------------------------
// A-3. The cost line is built from the raw measured per-recipient figure, with none of the 1.35 margin the
// same measurement gets before it decides the batch cap. The page's own comment says the probe runs 12-25%
// light against an operator-path collection, so the figure shown to the sender is the low one.
{
  const page = await openAirdrop(browser);
  await page.click('#connect');
  await page.waitForTimeout(1200);
  await page.fill('#token', NFT);
  await page.dispatchEvent('#token', 'change');
  await page.waitForTimeout(1200);
  await page.fill('#list', [A(0x111) + ',1', A(0x222) + ',2'].join('\n'));
  await page.click('#parse');
  await page.waitForTimeout(2000);
  const numbers = await page.evaluate(() => {
    const t = document.getElementById('batchNote').textContent || '';
    const m = t.match(/about ([\d,]+) gas a wallet/);
    return { note: t.slice(0, 200), per: m ? m[1] : null, plan: document.getElementById('plan').textContent };
  });
  // the mock answers eth_estimateGas with 61,000, so the measured per-recipient is 40,000
  probe('A-3   the per-recipient figure quoted to the sender carries no margin (' + numbers.per
      + ' from a 61,000 estimate), while the cap divides the same number by 1.35',
    numbers.per === '40,000', numbers.plan);
  await page.close();
}

await browser.close();
console.log('\naudit-probe-12 (twelfth round)\n');
console.log(lines.join('\n'));
console.log('\n' + demonstrated + ' demonstrated, ' + notReproduced + ' no longer reproduce\n');
