// Deterministic browser tests for web/index.html. No network, no testnet: every chain answer is mocked, so a
// failure here is the page's fault and nothing else. Each test names the audit finding it guards.
//
//   npm install && node test/web/client.test.mjs        (from the repository root)
//
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const PAGE = pathToFileURL(new URL('../../web/index.html', import.meta.url).pathname).href;
const NFT = '0x1111111111111111111111111111111111111111';
const TOK = '0x2222222222222222222222222222222222222222';
const ED  = '0x3333333333333333333333333333333333333333';
const ME  = '0x00000000000000000000000000000000000000Me'.slice(0, 42);
const A = (n) => '0x' + n.toString(16).padStart(40, '0');
// the three airdrop entry points and their …WithGas twins, so the mock can answer a simulated batch
const BULK_SELECTORS = ['0xb097e731', '0x97e763b3', '0xd00a888d', '0x45310558', '0xc0d13d4e', '0xeb0f0b68'];
const bulkAddress = (page) => page.evaluate(() => {
  const a = document.querySelector('#contractLine a');
  return a ? a.textContent.trim() : null;
});
const RUN_ME = A(0xdead);

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
      case 'wallet_getCallsStatus': return O.callsStatus || { status: 200, receipts: [{ transactionHash: '0x' + 'ab'.repeat(32), status: '0x1', logs: [] }] };
      case 'eth_sendTransaction': return '0x' + 'cd'.repeat(32);
      case 'eth_getTransactionReceipt': {
        if (O.noReceipt) return null;
        const h = String(params[0] || '0x' + 'cd'.repeat(32));
        // the whole shape ethers expects, so a receipt read back later parses the same as a live one
        return {
          status: '0x1', transactionHash: h, transactionIndex: '0x0', blockNumber: '0x1000',
          blockHash: '0x' + '11'.repeat(32), from: me, to: A(0xb01c), contractAddress: null,
          cumulativeGasUsed: '0x1', gasUsed: '0x1', effectiveGasPrice: '0x989680', type: '0x2',
          logsBloom: '0x' + '00'.repeat(256), logs: O.receiptLogs || [],
        };
      }
      case 'eth_estimateGas': return '0x186a0';
      case 'eth_getCode': {
        const a = String(params[0] || '').toLowerCase();
        if ([NFT, TOK, ED].includes(a)) return '0x60006000';
        if ((O.delegated || []).map((x) => x.toLowerCase()).includes(a)) return '0xef0100' + (O.delegate || A(0xde1)).slice(2);
        return (O.contractHolders || []).map((x) => x.toLowerCase()).includes(a) ? '0x60006000' : '0x';
      }
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), data = String(params[0].data || ''), sel = data.slice(0, 10);
        if (sel === '0x2f745c59' && O.ownedIds) {                      // tokenOfOwnerByIndex
          const i = Number(BigInt('0x' + data.slice(74)));
          return i < O.ownedIds.length ? enc(O.ownedIds[i]) : null;
        }
        if (sel === '0x70a08231' && O.ownedIds) return enc(O.ownedIds.length);
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
        // the receive hooks, asked of a delegate directly
        if (sel === '0x150b7a02' || sel === '0xf23a6e61') {
          if (O.delegateAccepts) return sel + '0'.repeat(56);
          const e = new Error('execution reverted'); e.revertData = '0x'; throw e;
        }
        // BulkSend itself: its published bounds, and (sent, skipped) for a simulated batch
        if (sel === '0x56c3e5e9' || sel === '0xdf1c9e47') return enc(400000);
        if (sel === '0x20d2c951') return enc(100000);
        if (sel === '0x5f2a9f41') return enc(5000000);
        if (BULK_SELECTORS.includes(sel)) return enc(O.willDeliver ?? 1) + enc(0).slice(2);
        if (O.callFails) { const e = new Error('execution reverted'); e.revertData = '0x7e273289'; throw e; }
        return enc(1);
      }
      default: return null;
    }
  };
}

async function open(browser, opts = {}) {
  const answer = chainAnswer(opts);
  // Web Locks are shared between the tabs of one browser profile, not between browser contexts. A test that
  // wants two tabs has to put them in one context; two contexts are two profiles and share nothing.
  const page = opts.ctx ? await opts.ctx.newPage() : await browser.newPage({ viewport: { width: 1200, height: 1400 } });
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
  if (opts.noLocks) await page.addInitScript(() => { Object.defineProperty(navigator, 'locks', { get: () => undefined, configurable: true }); });
  if (opts.brokenStorage) await page.addInitScript(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('bulksend:')) throw new Error('quota'); return real.call(this, k, v); };
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

// ---- L-02: the gas allowance is the caller's, inside the contract's bounds -----
{
  const page = await open(browser, { approved: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, A(0x71) + ',1\n' + A(0x72) + ',2\n');
  const shown = () => page.evaluate(() => document.querySelector('#gasRow').style.display !== 'none');
  check('L-02 the gas allowance is offered where skipping is allowed', await shown());
  check('L-02 and the contract\'s own bounds are what the page shows',
    (await text(page, '#gasBounds')).includes('100,000') && (await text(page, '#gasBounds')).includes('5,000,000'),
    await text(page, '#gasBounds'));
  await page.selectOption('#mode', 'strict'); await page.waitForTimeout(300);
  check('L-02 and is hidden for all-or-nothing, which forwards everything', !(await shown()));
  await page.selectOption('#mode', 'lenient'); await page.waitForTimeout(300);

  await page.fill('#gasPer', '50000'); await page.waitForTimeout(400);
  check('L-02 an allowance under the contract minimum blocks the send',
    await page.evaluate(() => document.querySelector('#send').disabled), 'send was enabled');
  check('L-02 and says what the contract accepts', (await text(page, '#whyDisabled')).includes('100,000'), await text(page, '#whyDisabled'));

  await page.fill('#gasPer', '900000'); await page.waitForTimeout(400);
  check('L-02 a valid allowance unblocks the send', !(await page.evaluate(() => document.querySelector('#send').disabled)), await text(page, '#whyDisabled'));
  await page.click('#send'); await page.waitForTimeout(5000);
  const data = await page.evaluate(() => (window.__sent[0] || {}).data || '');
  check('L-02 a chosen allowance goes out through the WithGas entry point', data.startsWith('0x45310558'), data.slice(0, 10));
  check('L-02 carrying the number that was asked for', data.toLowerCase().includes((900000).toString(16).padStart(64, '0')), data.slice(-64));
  await page.close();
}

// ---- L-02: the default is left alone when nothing is typed --------------------
{
  const page = await open(browser, { approved: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, A(0x73) + ',3\n');
  await page.click('#send'); await page.waitForTimeout(5000);
  const data = await page.evaluate(() => (window.__sent[0] || {}).data || '');
  check('L-02 no allowance typed means the plain entry point and the contract default', data.startsWith('0xb097e731'), data.slice(0, 10));
  await page.close();
}

// ---- L-01: a connection is a state you can leave ------------------------------
{
  const page = await open(browser, {});
  await page.click('#connect'); await page.waitForTimeout(700);
  const before = await page.evaluate(() => [...document.querySelectorAll('#walletBox button')].map((b) => b.textContent.trim()));
  check('L-01 a connected page offers a way to change wallet', before.includes('Change wallet'), before.join(','));
  await page.click('text=Change wallet'); await page.waitForTimeout(500);
  const after = await page.evaluate(() => [...document.querySelectorAll('#walletBox button')].map((b) => b.textContent.trim()));
  check('L-01 and leaving it puts the connect buttons back', after.includes('Connect wallet') && after.includes('Phone wallet'), after.join(','));
  await page.close();
}

// ---- M-01: two identical rows are two payments --------------------------------
{
  const page = await open(browser, { approved: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, TOK, '20');
  const dup = A(0x81) + ',1\n' + A(0x81) + ',1\n';
  await setList(page, dup);
  // the first of the two has been delivered before; the second has not
  await page.evaluate(([acct, tok]) => {
    const key = 'bulksend:46630:' + acct.toLowerCase() + ':' + tok.toLowerCase() + ':20';
    const row = '0x0000000000000000000000000000000000000081::1000000000000000000#1';
    localStorage.setItem(key, JSON.stringify([row]));
  }, [RUN_ME, TOK]);
  await page.click('#send'); await page.waitForTimeout(5000);
  const logText = await text(page, '#log');
  check('M-01 one of two identical rows counts as already delivered, not both',
    logText.includes('1 of these were already delivered'), logText.slice(-200));
  const sentCount = await page.evaluate(() => window.__sent.length);
  check('M-01 and the other one is still sent', sentCount === 1, 'batches: ' + sentCount);
  await page.close();
}

// ---- M-01: a batch this browser cannot account for holds its rows back --------
{
  const page = await open(browser, { approved: true, noReceipt: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, TOK, '20');
  await setList(page, A(0x91) + ',1\n' + A(0x92) + ',2\n');
  await page.evaluate(([acct, tok]) => {
    const run = 'bulksend:46630:' + acct.toLowerCase() + ':' + tok.toLowerCase() + ':20';
    localStorage.setItem('bulksend:pending', JSON.stringify([{
      pid: 'p1', run, chain: 46630, bulk: '0xc6ae3189edae544ed60adf5ec057e338ce224f74',
      hash: '0x' + 'ef'.repeat(32), at: Date.now() - 60000, via: 'bulk',
      rows: [{ to: '0x0000000000000000000000000000000000000091', id: null, amount: '1000000000000000000', k: '0x0000000000000000000000000000000000000091::1000000000000000000#1' }],
    }]));
  }, [RUN_ME, TOK]);
  await page.click('#send'); await page.waitForTimeout(6000);
  const logText = await text(page, '#log');
  check('M-01 an unread batch is reported rather than silently ignored', logText.includes('is not on the chain'), logText.slice(0, 220));
  check('M-01 and its recipients are held back instead of being sent again', logText.includes('held back'), logText.slice(-260));
  await page.close();
}

// ---- M-01: and is recorded once the chain can be read ------------------------
{
  const page = await open(browser, { approved: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  await page.evaluate(([acct, tok]) => {
    const run = 'bulksend:46630:' + acct.toLowerCase() + ':' + tok.toLowerCase() + ':20';
    localStorage.setItem('bulksend:pending', JSON.stringify([{
      pid: 'p2', run, chain: 46630, bulk: null, hash: '0x' + 'ab'.repeat(32), at: Date.now() - 60000, via: 'wallet',
      rows: [{ to: '0x0000000000000000000000000000000000000093', id: null, amount: '1000000000000000000', k: '0x0000000000000000000000000000000000000093::1000000000000000000#1' }],
    }]));
  }, [RUN_ME, TOK]);
  await useToken(page, TOK, '20');
  await setList(page, A(0x93) + ',1\n' + A(0x94) + ',2\n');
  await page.click('#send'); await page.waitForTimeout(6000);
  const logText = await text(page, '#log');
  check('M-01 a batch that did land is caught up and recorded', logText.includes('Caught up'), logText.slice(0, 240));
  check('M-01 so its recipients are not paid twice', logText.includes('already delivered'), logText.slice(-240));
  await page.close();
}

// ---- L-03: the exact list, and where the transactions divide it ---------------
{
  const page = await open(browser, { approved: true, willDeliver: 6 });
  const dialogs = [];
  page.on('dialog', (d) => dialogs.push(d.message()));
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, Array.from({ length: 6 }, (_, i) => A(0xa1 + i) + ',' + (i + 1)).join('\n'));
  await page.fill('#batch', '2'); await page.waitForTimeout(300);
  await page.click('#send'); await page.waitForTimeout(6000);
  const logText = await text(page, '#log');
  check('L-03 every transaction boundary is shown before anything is signed',
    logText.includes('transaction 1:') && logText.includes('transaction 3:'), logText.slice(0, 300));
  const msg = dialogs.join(' ');
  check('L-03 and the confirmation says who a partial run favours', /lower token ids are the ones that were paid/.test(msg), msg.slice(0, 300));
  check('L-03 the exact list can be downloaded', !(await page.evaluate(() => document.querySelector('#manifest').disabled)));
  await page.close();
}

// ---- H-01: an address that can never give the token back is not a recipient ------
{
  const page = await open(browser, { walletBatch: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  const BULK = await bulkAddress(page);
  check('H-01 the page names the contract it would use', !!BULK && BULK.startsWith('0x'), String(BULK));
  await setList(page, BULK + ',7\n');
  check('H-01 the BulkSend contract is refused as a recipient', (await text(page, '#problems')).includes('stuck there for good'), await text(page, '#problems'));
  check('H-01 and nothing is left to send', (await text(page, '#parseOut')).includes('0 recipients') || await page.evaluate(() => document.querySelector('#send').disabled), await text(page, '#parseOut'));
  await setList(page, NFT + ',8\n');
  check('H-01 the token\'s own contract is refused too', (await text(page, '#problems')).includes('own contract address'), await text(page, '#problems'));
  await page.close();
}

// ---- H-05: a blank cell is a position, not an absence ---------------------------
{
  const page = await open(browser, { ownedIds: [11, 12, 13] });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, 'address,tokenId,quantity\n' + A(0x14) + ',,10\n');
  const list = await val(page, '#list');
  const parseOut = await text(page, '#parseOut');
  check('H-05 a blank token id never becomes the quantity', !parseOut.includes('1 recipient') || !list.includes(',10'), parseOut + ' | ' + list.slice(0, 80));
  const shown = (await text(page, '#problems')) + (await text(page, '#msgList')) + (await text(page, '#log'));
  check('H-05 and the file is either refused or read as how-many-each', /empty|how many|assign/i.test(shown), shown.slice(0, 200));
  await page.close();
}

// ---- H-04: the cross-tab lock fails closed --------------------------------------
{
  const page = await open(browser, { walletBatch: true, noLocks: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, A(0xb1) + ',1\n');
  await page.click('#send'); await page.waitForTimeout(4000);
  check('H-04 a browser with no Web Locks is refused, not waved through',
    (await text(page, '#log')).includes('does not support the lock'), (await text(page, '#log')).slice(0, 160));
  check('H-04 and nothing was sent', (await page.evaluate(() => window.__sent.length)) === 0);
  await page.close();
}

// ---- H-04: an unwritable ledger fails closed ------------------------------------
{
  const page = await open(browser, { walletBatch: true, brokenStorage: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, A(0xb2) + ',1\n');
  await page.click('#send'); await page.waitForTimeout(4000);
  check('H-04 a browser that will not store anything is refused before signing',
    (await text(page, '#log')).includes('will not let this page store'), (await text(page, '#log')).slice(0, 200));
  check('H-04 and nothing was sent', (await page.evaluate(() => window.__sent.length)) === 0);
  await page.close();
}

// ---- H-04: two real tabs, one lock ----------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1400 } });
  const one = await open(browser, { walletBatch: true, ctx });
  const two = await open(browser, { walletBatch: true, ctx });
  for (const p of [one, two]) {
    await p.click('#connect'); await p.waitForTimeout(500);
    await useToken(p, NFT, '721');
    await setList(p, A(0xb3) + ',1\n');
  }
  await Promise.all([one.click('#send'), two.click('#send')]);
  await one.waitForTimeout(6000);
  const sent = (await one.evaluate(() => window.__sent.length)) + (await two.evaluate(() => window.__sent.length));
  check('H-04 two tabs sending the same list produce one batch, not two', sent <= 1, 'batches sent: ' + sent);
  await one.close(); await two.close(); await ctx.close();
}

// ---- M-02: a wallet batch with no transaction hash is resolved by its calls id ---
{
  const page = await open(browser, { walletBatch: true, approved: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  await page.evaluate(([acct, nft]) => {
    const run = 'bulksend:46630:' + acct.toLowerCase() + ':' + nft.toLowerCase() + ':721';
    localStorage.setItem('bulksend:pending', JSON.stringify([{
      pid: 'w1', run, chain: 46630, bulk: null, hash: null, callsId: '0xbatch', at: Date.now() - 60000, via: 'wallet',
      rows: [{ to: '0x00000000000000000000000000000000000000c1', id: '5', amount: null, k: '0x00000000000000000000000000000000000000c1:5:#1' }],
    }]));
  }, [A(0xdead), NFT]);
  await useToken(page, NFT, '721');
  await setList(page, A(0xc1) + ',5\n' + A(0xc2) + ',6\n');
  await page.click('#send'); await page.waitForTimeout(6000);
  const logText = await text(page, '#log');
  check('M-02 a hashless wallet batch is resolved by asking the wallet', logText.includes('Caught up'), logText.slice(0, 240));
  await page.close();
}

// ---- M-04: an allocation that cannot be filled is not quietly shrunk -------------
{
  const page = await open(browser, { ownedIds: [21, 22, 23] });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  const before = A(0xd1) + ' x2\n' + A(0xd2) + ' x2\n';
  await page.fill('#list', before); await page.waitForTimeout(200);
  await page.click('#assign'); await page.waitForTimeout(3500);
  check('M-04 assign refuses when the wallet holds fewer than the list asks for',
    (await text(page, '#msgList')).includes('Nothing has been changed'), await text(page, '#msgList'));
  check('M-04 and the list is left exactly as it was', (await val(page, '#list')) === before, (await val(page, '#list')).slice(0, 80));
  await page.close();
}

// ---- M-03: the delivered ledger is never silently trimmed ------------------------
{
  const page = await open(browser, { walletBatch: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, A(0xe1) + ',1\n');
  await page.evaluate(([acct, nft]) => {
    const run = 'bulksend:46630:' + acct.toLowerCase() + ':' + nft.toLowerCase() + ':721';
    const filler = []; for (let i = 0; i < 20000; i++) filler.push('x' + i);
    localStorage.setItem(run, JSON.stringify(filler));
  }, [A(0xdead), NFT]);
  await page.click('#send'); await page.waitForTimeout(6000);
  check('M-03 a full ledger stops the run instead of forgetting its oldest rows',
    (await text(page, '#log')).includes('is full'), (await text(page, '#log')).slice(-220));
  await page.close();
}

// ---- an upgraded wallet is a wallet, and the page has to say so -----------------
{
  const upgraded = A(0xf1);
  const page = await open(browser, { delegated: [upgraded], delegateAccepts: false });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, upgraded + ',1\n' + A(0xf2) + ',2\n');
  await page.click('#preflight'); await page.waitForTimeout(5000);
  const logText = await text(page, '#log');
  check('EIP-7702 an upgraded wallet that cannot take a safe transfer is named before signing',
    /upgraded \(EIP-7702\)/.test(logText), logText.slice(0, 300));
  check('EIP-7702 and is called a wallet, not a contract', /real wallets, not contracts/.test(logText), logText.slice(0, 300));
  check('EIP-7702 with the fix that actually works for an NFT', /unticking/.test(logText), logText.slice(0, 400));
  await page.close();
}

// ---- and the same wallet is fine once safe mode is off --------------------------
{
  const upgraded = A(0xf3);
  const page = await open(browser, { delegated: [upgraded], delegateAccepts: false });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, upgraded + ',1\n');
  await page.uncheck('#safe'); await page.waitForTimeout(300);
  await page.click('#preflight'); await page.waitForTimeout(5000);
  check('EIP-7702 a plain transfer to an upgraded wallet raises no warning',
    !/upgraded \(EIP-7702\)/.test(await text(page, '#log')), (await text(page, '#log')).slice(0, 200));
  await page.close();
}

// ---- an edition cannot reach one at all, and the page says that plainly ----------
{
  const upgraded = A(0xf4);
  const page = await open(browser, { delegated: [upgraded], delegateAccepts: false });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, ED, '1155');
  await setList(page, upgraded + ',5,2\n');
  await page.click('#preflight'); await page.waitForTimeout(5000);
  check('EIP-7702 an edition to an upgraded wallet is called impossible, not user error',
    /cannot receive one from anybody/.test(await text(page, '#log')), (await text(page, '#log')).slice(0, 400));
  await page.close();
}

await browser.close();
console.log(results.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
