// Deterministic browser tests for web/index.html. No network, no testnet: every chain answer is mocked, so a
// failure here is the page's fault and nothing else. Each test names the audit finding it guards.
//
//   cd /mnt/c/GMGNRepeat/baby-bananza-grand-prix && node /home/arson/rh-airdrop/test/web/client.test.mjs
//
// playwright lives in the bbgp checkout on this machine; resolve it from there so this file can sit in the repo
const { chromium } = await import('/mnt/c/GMGNRepeat/baby-bananza-grand-prix/node_modules/playwright/index.mjs')
  .catch(() => import('playwright'));

const PAGE = 'file:///home/arson/rh-airdrop/web/index.html';
const NFT = '0x1111111111111111111111111111111111111111';
const TOK = '0x2222222222222222222222222222222222222222';
const ED  = '0x3333333333333333333333333333333333333333';
const ME  = '0x00000000000000000000000000000000000000Me'.slice(0, 42);
const A = (n) => '0x' + n.toString(16).padStart(40, '0');

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { pass++; results.push('  ok   ' + name); }
  else { fail++; results.push('  FAIL ' + name + (detail ? '  <- ' + detail : '')); }
}

// One place that answers for the chain. Both the wallet object in the page and the direct HTTP calls the page
// makes are routed here, so a test controls every answer and nothing touches a real network.
function chainAnswer(O) {
  const me = A(0xdead);
  const enc = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
  const str = (t) => {
    const b = Buffer.from(t, 'utf8');
    return '0x' + (32).toString(16).padStart(64, '0') + BigInt(b.length).toString(16).padStart(64, '0') + b.toString('hex').padEnd(64, '0');
  };
  let blockTick = 0;
  return function answer(method, params = []) {
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'net_version': return '46630';
      case 'eth_accounts': case 'eth_requestAccounts': return [me];
      case 'eth_gasPrice': return '0x989680';
      case 'eth_blockNumber': return '0x' + (0x1000 + (O.blockMoves ? ++blockTick : 0)).toString(16);
      case 'eth_getBlockByNumber': return { number: '0x1000', hash: '0x' + '11'.repeat(32), parentHash: '0x' + '22'.repeat(32), timestamp: '0x1', gasLimit: '0x1', gasUsed: '0x0', miner: A(0), baseFeePerGas: '0x989680', transactions: [] };
      case 'wallet_getCapabilities': return O.walletBatch ? { '0xb626': { atomic: { status: 'supported' } } } : {};
      case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
      case 'wallet_sendCalls': return { id: '0xbatch' };
      case 'wallet_getCallsStatus': return { status: 200, receipts: [{ transactionHash: '0x' + 'ab'.repeat(32), status: '0x1', logs: [] }] };
      case 'eth_sendTransaction': return '0x' + 'cd'.repeat(32);
      case 'eth_getTransactionReceipt': return { status: '0x1', transactionHash: '0x' + 'cd'.repeat(32), blockNumber: '0x1000', logs: [], gasUsed: '0x1' };
      case 'eth_estimateGas': return '0x186a0';
      case 'eth_getCode': {
        const a = String(params[0] || '').toLowerCase();
        if ([NFT, TOK, ED].includes(a)) return '0x60006000';
        return (O.contractHolders || []).map((x) => x.toLowerCase()).includes(a) ? '0x60006000' : '0x';
      }
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), data = String(params[0].data || ''), sel = data.slice(0, 10);
        if (sel === '0x01ffc9a7') { const iface = data.slice(10, 18);
          if (to === NFT) return enc(iface === '80ac58cd' ? 1 : 0);
          if (to === ED) return enc(iface === 'd9b67a26' ? 1 : 0);
          return enc(0); }
        if (sel === '0x313ce567') return to === TOK ? enc(O.decimals ?? 18) : null;
        if (sel === '0x06fdde03' || sel === '0x95d89b41') return str('Test');
        if (sel === '0x70a08231') return enc(O.balance ?? '1000000000000000000000');
        if (sel === '0x00fdd58e') return enc(O.balance1155 ?? 1000);
        if (sel === '0xdd62ed3e') return enc(O.allowance ?? '1000000000000000000000');
        if (sel === '0x098144d4') return O.gated ? enc(BigInt('0xA000027A9B2802E1ddf7000061001e5c005A0000')) : null;
        if (sel === '0x5c975abb') return enc(0);
        if (sel === '0xe985e9c5') return enc(O.approved ? 1 : 0);
        if (O.callFails) { const e = new Error('execution reverted'); e.revertData = '0x7e273289'; throw e; }
        return enc(1);
      }
      default: return null;
    }
  };
}

async function open(browser, opts = {}) {
  const answer = chainAnswer(opts);
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  page.on('dialog', (d) => (opts.dismissDialogs ? d.dismiss() : d.accept()));

  // every outbound request the page makes, answered here
  await page.route('**://*/**', async (route) => {
    const req = route.request(); const url = req.url();
    if (url.startsWith('file://')) return route.continue();
    if (url.includes('cdnjs.cloudflare.com')) return route.continue();   // the real ethers build
    if (url.includes('/holders')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(opts.explorer || { items: [] }) });
    if (url.includes('/nft')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(opts.ownedNfts || { items: [] }) });
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { amount: '2500' } }) });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let body; try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
      const one = (r) => { try { const result = answer(r.method, r.params || []); return { jsonrpc: '2.0', id: r.id, result }; }
                           catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: 3, message: 'execution reverted', data: e.revertData } }; } };
      const out = Array.isArray(body) ? body.map(one) : one(body);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(out) });
    }
    return route.fulfill({ status: 204, body: '' });
  });

  // the wallet object, answered by the same function
  await page.exposeFunction('__chain', (method, params) => {
    try { return { ok: true, result: answer(method, params) }; }
    catch (e) { return { ok: false, code: e.code || 3, message: String(e.message || e), data: e.revertData }; }
  });
  await page.addInitScript(() => {
    window.__sent = [];
    window.ethereum = {
      isMetaMask: true, on() {}, removeListener() {},
      async request({ method, params }) {
        if (method === 'wallet_sendCalls' || method === 'eth_sendTransaction') window.__sent.push((params || [])[0]);
        const r = await window.__chain(method, params || []);
        if (r && r.ok) return r.result;
        const err = new Error((r && r.message) || 'failed'); err.code = r && r.code; err.data = r && r.data; throw err;
      },
    };
  });

  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  page.__errs = errs;
  return page;
}

const setList = async (page, text) => { await page.fill('#list', text); await page.waitForTimeout(250); await page.click('#parse'); await page.waitForTimeout(400); };
const useToken = async (page, addr, std) => {
  if (std) { await page.selectOption('#std', std); await page.waitForTimeout(200); }
  await page.fill('#token', addr); await page.dispatchEvent('#token', 'change');
  // the lookup is asynchronous and may correct the token type and start again, so wait for it to settle
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const settled = await page.evaluate(() => {
      const why = (document.querySelector('#whyDisabled') || {}).textContent || '';
      const info = (document.querySelector('#tokenInfo') || {}).textContent || '';
      return info.length > 0 && !why.includes('Reading that token');
    });
    if (settled) return;
  }
};
const text = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).textContent || '', sel);
const val = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).value || '', sel);

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

// ---- H-04: a real CSV reader ------------------------------------------------
{
  const page = await open(browser, {});
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, TOK, '20');
  await setList(page, 'address,quantity\n"' + A(0x11) + '","1,234.5"\n');
  // The quoted cell stays one value rather than splitting into 1 and 234.5. It is then refused, because
  // silently reading a formatted number as a different amount is exactly what must not happen.
  check('H-04 a quoted formatted number is one value and is refused, not reinterpreted',
    (await text(page, '#problems')).includes('without separators'), await text(page, '#problems'));
  await setList(page, 'address,quantity\n"' + A(0x11) + '","1234.5"\n');
  check('H-04 the same amount written plainly is accepted', (await text(page, '#parseOut')).includes('1 recipient'), await text(page, '#parseOut'));

  await setList(page, 'address,quantity\n' + A(0x12) + ',0\n');
  check('H-04 an amount of zero is refused', (await text(page, '#problems')).includes('zero'), await text(page, '#problems'));

  await useToken(page, NFT, '721');
  await setList(page, 'address,quantity\n' + A(0x13) + ',2.9\n' + A(0x14) + ',garbage\n');
  check('H-04 a fractional or unreadable NFT count stops, it does not become 1',
    (await text(page, '#msgList')).includes('not a whole number'), await text(page, '#msgList'));
  check('H-04 the list is left untouched when the file is bad', (await val(page, '#list')).includes('garbage'));
  await page.close();
}

// ---- H-02: tokens never go out through a raw wallet batch --------------------
{
  const page = await open(browser, { walletBatch: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, TOK, '20');
  await setList(page, A(0x21) + ',1\n');
  check('H-02 an ERC-20 goes through the contract even when the wallet can batch',
    (await text(page, '#plan')).includes('BulkSend'), await text(page, '#plan'));
  await useToken(page, NFT, '721');
  await setList(page, A(0x22) + ',7\n');
  check('H-02 an NFT still uses the wallet path when it can batch',
    (await text(page, '#plan')).includes('as itself'), await text(page, '#plan'));
  await page.close();
}

// ---- H-03: all or nothing means one transaction ------------------------------
{
  const page = await open(browser, { walletBatch: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, Array.from({ length: 6 }, (_, i) => A(0x31 + i) + ',' + (i + 1)).join('\n'));
  await page.selectOption('#mode', 'strict'); await page.fill('#batch', '2'); await page.waitForTimeout(400);
  check('H-03 strict mode refuses to split across transactions',
    await page.evaluate(() => document.querySelector('#send').disabled), 'send was enabled');
  check('H-03 and says why', (await text(page, '#whyDisabled')).includes('one transaction'), await text(page, '#whyDisabled'));
  await page.fill('#batch', '50'); await page.waitForTimeout(400);
  check('H-03 strict is allowed once it fits in one transaction',
    !(await page.evaluate(() => document.querySelector('#send').disabled)));
  await page.close();
}

// ---- H-08: changing network clears the parsed list ---------------------------
{
  const page = await open(browser, {});
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, TOK, '20');
  await setList(page, A(0x41) + ',1\n' + A(0x42) + ',2\n');
  check('H-08 a list parses to begin with', (await text(page, '#parseOut')).includes('2 recipients'));
  await page.selectOption('#net', '4663').catch(() => {});
  await page.evaluate(() => { const s = document.querySelector('#net'); s.value = '4663'; s.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(900);
  check('H-08 changing network drops the parsed rows', !(await text(page, '#parseOut')).includes('2 recipients'), await text(page, '#parseOut'));
  await page.close();
}

// ---- L-01: a phone wallet stays reachable with extensions installed ----------
{
  const page = await open(browser, {});
  await page.evaluate(() => {
    for (const [name, rdns] of [['One', 'io.one'], ['Two', 'io.two']]) {
      const detail = Object.freeze({ info: { uuid: rdns + '-uuid', name, icon: 'data:,', rdns }, provider: window.ethereum });
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
    }
  });
  await page.waitForTimeout(400);
  const names = await page.evaluate(() => [...document.querySelectorAll('#walletBox button')].map((b) => b.textContent.trim()));
  check('L-01 two extensions do not remove the phone wallet option', names.includes('Phone wallet'), names.join(','));
  await page.close();
}

// ---- M-03: an incomplete holder read is not used ----------------------------
{
  const many = { items: Array.from({ length: 50 }, (_, i) => ({ address: { hash: A(0x1000 + i) } })), next_page_params: { page: 2 } };
  const page = await open(browser, { explorer: many });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await page.fill('#snapAddr', NFT); await page.click('#snap');
  await page.waitForTimeout(4000);
  check('M-03 a holder read that never ends is refused rather than silently truncated',
    (await text(page, '#msgList')).includes('incomplete') || (await text(page, '#log')).includes('cut short'),
    (await text(page, '#msgList')) + ' | ' + (await text(page, '#log')).slice(-120));
  await page.close();
}

// ---- unreadable lines still gate the send -----------------------------------
{
  const page = await open(browser, {});
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, A(0x51) + ',1\nnot-a-wallet,2\n');
  check('a bad line blocks the send until acknowledged', await page.evaluate(() => document.querySelector('#send').disabled));
  await page.check('#ack'); await page.waitForTimeout(300);
  check('and is allowed once acknowledged', !(await page.evaluate(() => document.querySelector('#send').disabled)));
  await page.close();
}

// ---- the send is not re-entrant ---------------------------------------------
{
  const page = await open(browser, { walletBatch: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, Array.from({ length: 3 }, (_, i) => A(0x61 + i) + ',' + (i + 1)).join('\n'));
  await page.evaluate(() => { const b = document.querySelector('#send'); b.click(); b.click(); b.click(); });
  await page.waitForTimeout(6000);
  const sent = await page.evaluate(() => window.__sent.length);
  check('three clicks on Send produce one batch', sent <= 1, 'batches sent: ' + sent);
  await page.close();
}

await browser.close();
console.log(results.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
