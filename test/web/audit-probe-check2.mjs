import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
const PAGE = pathToFileURL(new URL('../../web/check.html', import.meta.url).pathname).href;
const A = (n) => '0x' + n.toString(16).padStart(40, '0');
const QUIET = A(0xc0ffee), NFT = A(0x721), TOK = A(0x20); const ME = A(0xdead);
const word = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
const strRet = (t) => { const b = Buffer.from(t, 'utf8'); return '0x' + (32).toString(16).padStart(64, '0') + BigInt(b.length).toString(16).padStart(64, '0') + b.toString('hex').padEnd(Math.ceil(b.length / 32) * 64, '0'); };
let pass = 0, fail = 0; const results = [];
const check = (n, c, d) => { if (c) { pass++; results.push('  DEMONSTRATED  ' + n); } else { fail++; results.push('  not shown     ' + n + (d ? '  <- ' + String(d).slice(0, 400) : '')); } };
function answer(O) {
  return function (method, params = []) {
    const p0 = String((params[0] && params[0].to) || params[0] || '').toLowerCase();
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'eth_blockNumber': return '0x1000';
      case 'eth_getBalance': return '0xde0b6b3a7640000';
      case 'eth_getTransactionCount': return '0x5';
      case 'eth_getCode': return (p0 === QUIET || p0 === NFT || p0 === TOK) ? '0x6080604052' : '0x';
      case 'eth_getStorageAt': return '0x' + '0'.repeat(64);
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), sel = String(params[0].data || '').slice(0, 10);
        if (sel === '0x01ffc9a7') return word(0);
        if (sel === '0x313ce567') return word(18);
        if (sel === '0x06fdde03') return strRet('Quiet Token');
        if (sel === '0x95d89b41') return strRet('QT');
        if (sel === '0x18160ddd') return word(1000);
        if (sel === '0x8da5cb5b') return '0x' + '0'.repeat(64);          // owner() == address(0)
        if (sel === '0x5c975abb') return word(0);
        return null;                                                      // everything else reverts
      }
      case 'eth_simulateV1': {
        const calls = (params[0].blockStateCalls[0] || {}).calls || [];
        return [{ calls: calls.map(() => ({ status: '0x1', gasUsed: '0xb8a8', returnData: '0x', logs: [] })) }];
      }
      default: return null;
    }
  };
}
async function open(browser, opts = {}) {
  const ans = answer(opts);
  const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
  page.on('dialog', (d) => d.dismiss());
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('/api/v2/smart-contracts/') || url.includes('/x/')) {
      const addr = url.split('/').pop().toLowerCase();
      const body = opts.verified && opts.verified[addr];
      if (!body) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: '{"data":{"amount":"2500"}}' });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let body; try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
      const one = (r) => { try { return { jsonrpc: '2.0', id: r.id, result: ans(r.method, r.params || []) }; }
                           catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: -32000, message: String(e.message) } }; } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  return page;
}
const ask = async (page, q, from, ms) => { await page.fill('#input', q); if (from) await page.fill('#from', from); await page.click('#go'); await page.waitForTimeout(ms || 3000); return (await page.textContent('#out')) || ''; };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const show = (l, t) => { if (process.env.VERBOSE) console.log('\n---- ' + l + ' ----\n' + t.slice(0, 1600)); };

// F8b: a verified contract whose function names match nothing, with owner() == 0.
{
  const verified = {};
  verified[QUIET] = { is_verified: true, name: 'Quiet', compiler_version: 'v0.8.24', abi: [
    { type: 'function', name: 'rebalance', stateMutability: 'nonpayable', inputs: [{ name: 'victim', type: 'address' }, { name: 'amount', type: 'uint256' }] },
    { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }] },
  ] };
  const page = await open(browser, { verified });
  const t = await ask(page, QUIET, null, 4000);
  show('F8b', t);
  check('F8b owner()==0 is stated as fact: "nobody: ownership has been given up"', /nobody: ownership has been given up/.test(t), t.slice(0, 400));
  check('F8b and the "roles" hedge is NOT rendered, because no power name matched',
    !/plenty of contracts gate privileged functions on roles/.test(t), t.slice(0, 800));
  check('F8b so the page reads as "nothing matched" + "nobody owns it"', /No function name in the published source matched/.test(t), t.slice(0, 800));
  await page.close();
}

// F11: a wallet_sendCalls whose call uses `input` instead of `data` still earns the green all-calls verdict.
{
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify({ method: 'wallet_sendCalls', params: [{ version: '2.0.0', chainId: '0xb626',
    from: ME, atomicRequired: true, calls: [
      { to: QUIET, data: '0x06fdde03' },
      { to: QUIET, input: '0x095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + 'f'.repeat(64) }] }] }), ME, 6000);
  show('F11', t);
  check('F11 a call whose calldata was dropped still gets "run in order, every call succeeds"',
    /run in order, every call succeeds/.test(t) && !/as read here/.test(t), t.slice(0, 700));
  check('F11 and that call is described as a plain transfer of ETH', /A plain transfer of ETH/.test(t), t.slice(0, 900));
  await page.close();
}

// F12: the same, one level lower -- an inner call with unlimited increaseAllowance in a multicall.
{
  const page = await open(browser, {});
  const d = await page.evaluate(() => {
    const i = new window.ethers.Interface(['function increaseAllowance(address,uint256)', 'function multicall(bytes[])']);
    return i.encodeFunctionData('multicall', [[i.encodeFunctionData('increaseAllowance', ['0x1111111111111111111111111111111111111111', (1n << 256n) - 1n])]]);
  });
  const t = await ask(page, JSON.stringify({ to: QUIET, data: d }), ME, 5000);
  show('F12', t);
  check('F12 an unlimited increaseAllowance inside a multicall gets no inner-call warning',
    /Calls carried inside this one/.test(t) && !/inner call is an unlimited approval/.test(t), t.slice(0, 800));
  await page.close();
}

await browser.close();
console.log(results.join('\n'));
console.log('\n' + pass + ' demonstrated, ' + fail + ' not shown');
