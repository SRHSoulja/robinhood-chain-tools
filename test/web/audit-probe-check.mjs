// Standalone demonstrations for the Check page audit. Harness copied from test/web/check.test.mjs.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const PAGE = pathToFileURL(new URL('../../web/check.html', import.meta.url).pathname).href;
const A = (n) => '0x' + n.toString(16).padStart(40, '0');
const NFT = A(0x721), TOK = A(0x20), MYSTERY = A(0x55), PROXY = A(0x9), IMPL = A(0x99), NASTY = A(0xbad);
const ME = A(0xdead);
const word = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
const strRet = (t) => { const b = Buffer.from(t, 'utf8'); return '0x' + (32).toString(16).padStart(64, '0') + BigInt(b.length).toString(16).padStart(64, '0') + b.toString('hex').padEnd(Math.ceil(b.length / 32) * 64, '0'); };
const topicAddr = (a) => '0x' + a.slice(2).padStart(64, '0');
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVAL = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const codeWith = (sels) => '0x' + sels.map((s) => '63' + s.slice(2)).join('') + '00';
const SEL = { mint: '0x40c10f19', pause: '0x8456cb59' };
const MAX = (1n << 256n) - 1n;

let pass = 0, fail = 0; const results = [];
const check = (name, cond, detail) => { if (cond) { pass++; results.push('  DEMONSTRATED  ' + name); } else { fail++; results.push('  not shown     ' + name + (detail ? '  <- ' + String(detail).slice(0, 300) : '')); } };

function answer(O) {
  return function (method, params = []) {
    const p0 = String((params[0] && params[0].to) || params[0] || '').toLowerCase();
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'eth_blockNumber': return '0x1000';
      case 'eth_getBalance': return '0xde0b6b3a7640000';
      case 'eth_getTransactionCount': return '0x5';
      case 'eth_getCode': {
        if ((O.codeUnreadable || []).map((x) => x.toLowerCase()).includes(p0)) throw new Error('node unavailable');
        if (p0 === NFT || p0 === TOK || p0 === MYSTERY) return codeWith([SEL.mint, SEL.pause]);
        if (p0 === NASTY) return codeWith([SEL.mint]);
        return '0x';
      }
      case 'eth_getStorageAt': return '0x' + '0'.repeat(64);
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), data = String(params[0].data || ''), sel = data.slice(0, 10);
        // MYSTERY: an ERC-721 that does not answer supportsInterface and has no decimals().
        if (sel === '0x01ffc9a7') { const id = data.slice(10, 18);
          if (to === MYSTERY) throw new Error('no answer');
          if (to === NFT) return word(id === '80ac58cd' ? 1 : 0);
          return word(0); }
        if (sel === '0x313ce567') return to === TOK ? word(18) : null;
        if (sel === '0x06fdde03') return strRet(to === NFT ? 'Test Collection' : to === MYSTERY ? 'Mystery Punks' : 'Test Token');
        if (sel === '0x95d89b41') return strRet(to === NFT ? 'TC' : to === MYSTERY ? 'MP' : 'TT');
        if (sel === '0x18160ddd') return word(1000);
        if (sel === '0x8da5cb5b') return O.owner === null ? null : '0x' + (O.owner || A(0x0117)).slice(2).padStart(64, '0');
        if (sel === '0x5c975abb') return word(0);
        if (sel === '0xa2b4bdcb') return null;
        return word(1);
      }
      case 'eth_simulateV1': {
        const calls = (params[0].blockStateCalls[0] || {}).calls || [];
        O.__simCalls = (O.__simCalls || []).concat(calls.map((c) => ({ to: c.to, data: c.data, value: c.value, from: c.from })));
        return [{ calls: calls.map(() => ({ status: '0x1', gasUsed: '0xb8a8', returnData: '0x', logs: O.simLogs || [] })) }];
      }
      case 'eth_getTransactionByHash': { if (O.txUnreadable) throw new Error('node unavailable'); return O.tx || null; }
      case 'eth_getTransactionReceipt': return O.receipt || null;
      default: return null;
    }
  };
}

async function open(browser, opts = {}) {
  const ans = answer(opts);
  const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  page.on('dialog', (d) => (opts.promptWith ? d.accept(opts.promptWith) : d.dismiss()));
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('/api/v2/smart-contracts/') || url.includes('/x/')) {
      const addr = url.split('/').pop().toLowerCase();
      const body = opts.verified && opts.verified[addr];
      if (!body) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (url.includes('/api/v2/transactions/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(opts.exTx || {}) });
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { amount: '2500' } }) });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let body; try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
      const one = (r) => { try { return { jsonrpc: '2.0', id: r.id, result: ans(r.method, r.params || []) }; }
                           catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: -32000, message: String(e.message || 'node error') } }; } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  page.__errs = errs;
  return page;
}
const ask = async (page, q, from, waitMs) => {
  await page.fill('#input', q);
  if (from) await page.fill('#from', from);
  await page.click('#go');
  await page.waitForTimeout(waitMs || 3000);
  return (await page.textContent('#out')) || '';
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const show = (label, t) => { if (process.env.VERBOSE) console.log('\n----- ' + label + ' -----\n' + t.slice(0, 1400)); };

// F1 -- getTransaction fails, receipt survives: an approval is announced as a plain ETH transfer.
{
  const approveData = '0x095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + 'f'.repeat(64);
  const hash = '0x' + 'cd'.repeat(32);
  const receipt = { transactionHash: hash, transactionIndex: '0x0', blockHash: '0x' + '11'.repeat(32), blockNumber: '0x1000',
    from: ME, to: TOK, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x989680', contractAddress: null,
    logsBloom: '0x' + '00'.repeat(256), status: '0x1', type: '0x2',
    logs: [{ address: TOK, topics: [APPROVAL, topicAddr(ME), topicAddr(A(0x1111))], data: word(MAX), blockNumber: '0x1000',
             transactionHash: hash, transactionIndex: '0x0', blockHash: '0x' + '11'.repeat(32), logIndex: '0x0', removed: false }] };
  const page = await open(browser, { txUnreadable: true, receipt });
  const t = await ask(page, hash, ME, 4000);
  show('F1 tx unreadable', t);
  check('F1  a swallowed getTransaction error turns an unlimited approval into "a plain transfer of ETH"',
    /A plain transfer of ETH, with no contract call/.test(t), t.slice(0, 300));
  check('F1  and the same failure makes the page say the transaction created a new contract',
    /a new contract/.test(t), t.slice(0, 400));
  check('F1  and it is still labelled "succeeded"', /succeeded/.test(t), t.slice(0, 200));
  await page.close();
}

// F2 -- calldata that is not 0x-prefixed hex is silently replaced by empty calldata.
{
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify({ to: TOK, data: '095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + 'f'.repeat(64) }), ME, 4000);
  show('F2 unprefixed data', t);
  check('F2  calldata without the 0x prefix is read as no calldata at all: "a plain transfer of ETH"',
    /No calldata: this is a plain transfer of ETH/.test(t), t.slice(0, 300));
  check('F2  and the page says it would succeed', /would succeed/.test(t), t.slice(0, 300));
  check('F2  with no note anywhere that the calldata could not be read',
    !/not whole bytes of hex/.test(t) && !/could not be read/.test(t), t.slice(0, 600));
  await page.close();
}

// F3 -- eth_sendTransaction chainId is ignored entirely.
{
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify({ method: 'eth_sendTransaction', params: [{ from: ME, to: NFT,
    data: '0x095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + 'f'.repeat(64), chainId: '0x1' }] }), ME, 4000);
  show('F3 wrong chain eth_sendTransaction', t);
  check('F3  an eth_sendTransaction for chain 0x1 is answered against Robinhood Chain testnet',
    !/different network/.test(t) && /would succeed/.test(t), t.slice(0, 400));
  check('F3  with no mention at all that the request named another chain',
    !/0x1\b.*chain/i.test(t) && !/chainId/.test(t), t.slice(0, 400));
  await page.close();
}

// F4 -- eth_sendTransaction `value` is never schema-checked as a hex quantity.
{
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify({ to: NFT, data: '0x', value: '1000000000000000000' }), ME, 4000);
  show('F4 decimal value', t);
  check('F4  a decimal string in `value` is read as wei and stated as an exact ETH amount',
    /1\.0 ETH attached/.test(t), t.slice(0, 300));
  check('F4  with no note that this field is a hex quantity',
    !/hex quantity/.test(t), t.slice(0, 400));
  const sent = (await page.evaluate(() => 1), null);
  await page.close();
}

// F5 -- increaseAllowance / permit with an unlimited value get no red warning.
{
  const page = await open(browser, {});
  const data = await page.evaluate(() => new window.ethers.Interface(['function increaseAllowance(address,uint256)'])
    .encodeFunctionData('increaseAllowance', ['0x1111111111111111111111111111111111111111', (1n << 256n) - 1n]));
  const t = await ask(page, JSON.stringify({ to: TOK, data }), ME, 4000);
  show('F5 increaseAllowance', t);
  check('F5  increaseAllowance(spender, 2^256-1) gets no "This is an unlimited approval" box',
    !/This is an unlimited approval/.test(t), t.slice(0, 500));
  check('F5  and none of the standing-permission language approve() gets',
    !/at any point in the future/.test(t), t.slice(0, 500));
  const pdata = await page.evaluate(() => new window.ethers.Interface(['function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)'])
    .encodeFunctionData('permit', ['0x' + 'de'.repeat(20), '0x1111111111111111111111111111111111111111', (1n << 256n) - 1n, 99999999999n, 27, '0x' + '11'.repeat(32), '0x' + '22'.repeat(32)]));
  const t2 = await ask(page, JSON.stringify({ to: TOK, data: pdata }), ME, 4000);
  show('F5 permit', t2);
  check('F5  permit() granting an unlimited allowance gets no red warning either',
    !/This is an unlimited approval/.test(t2), t2.slice(0, 500));
  await page.close();
}

// F6 -- a token whose standard cannot be settled is described with the ERC-20 reading, silently.
{
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify({ to: MYSTERY, data: '0x095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + word(1).slice(2) }), ME, 4000);
  show('F6 unknown standard approve', t);
  check('F6  approve(spender,1) on a contract of unsettled standard is read as an ERC-20 allowance',
    /spend 1 of your Mystery Punks/.test(t), t.slice(0, 400));
  check('F6  with no statement anywhere that the standard could not be settled',
    !/token id or amount/.test(t.split('The arguments')[0] || t), t.slice(0, 500));
  const t2 = await ask(page, JSON.stringify({ to: MYSTERY, data: '0x23b872dd' + ME.slice(2).padStart(64, '0') + A(0x2222).slice(2).padStart(64, '0') + word(7).slice(2) }), ME, 4000);
  show('F6 unknown standard transferFrom', t2);
  check('F6  and transferFrom(a,b,7) is read as "Move 7" (an amount), not "#7" (an id)',
    /Move 7 from/.test(t2), t2.slice(0, 300));
  await page.close();
}

// F7 -- a refused method leaves the previous answer on screen.
{
  const page = await open(browser, {});
  const t1 = await ask(page, JSON.stringify({ to: NFT, data: '0x06fdde03' }), ME, 4000);
  await page.fill('#input', JSON.stringify({ method: 'personal_sign', params: ['0xdeadbeef', ME] }));
  await page.click('#go');
  await page.waitForTimeout(1200);
  const t2 = (await page.textContent('#out')) || '';
  const msg = (await page.textContent('#msg')) || '';
  show('F7 stale output', 'MSG: ' + msg + '\nOUT: ' + t2);
  check('F7  a refused method leaves the previous request\'s full answer rendered on screen',
    t2.length > 100 && t2 === t1, 'msg=' + msg + ' outlen=' + t2.length);
  await page.close();
}

// F8 -- owner() == 0 is stated as a fact when no power name matched.
{
  const page = await open(browser, { owner: A(0) });
  const t = await ask(page, NASTY, null, 4000);
  show('F8 zero owner', t);
  check('F8  owner()==0 is stated flatly as "ownership has been given up"',
    /ownership has been given up/.test(t), t.slice(0, 400));
  check('F8  and the hedge about roles is not rendered when no power name matched',
    !/plenty of contracts gate privileged functions on roles/.test(t), t.slice(0, 600));
  await page.close();
}

// F9 -- data and input both present and different: one is picked, silently.
{
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify({ to: TOK, data: '0x06fdde03',
    input: '0x095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + 'f'.repeat(64) }), ME, 4000);
  show('F9 data+input', t);
  check('F9  when `data` and `input` disagree the page picks `data` and never mentions the other',
    !/unlimited/i.test(t) && !/input/.test(t), t.slice(0, 400));
  await page.close();
}

// F10 -- a wallet_sendCalls chainId of "0x01" (the EIP-5792 example) is refused as unreadable.
{
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify({ method: 'wallet_sendCalls', params: [{ version: '2.0.0',
    chainId: '0x0b626', from: ME, atomicRequired: true, calls: [{ to: NFT, data: '0x06fdde03' }] }] }), ME, 4000);
  show('F10 leading-zero chainId', t);
  check('F10  a chainId with a leading zero ("0x0b626") is refused as "cannot be read"',
    /names a network that cannot be read/.test(t), t.slice(0, 400));
  await page.close();
}

await browser.close();
console.log(results.join('\n'));
console.log('\n' + pass + ' demonstrated, ' + fail + ' not shown');
