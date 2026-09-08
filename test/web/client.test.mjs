// Deterministic browser tests for web/index.html. No network, no testnet: every chain answer is mocked, so a
// failure here is the page's fault and nothing else. Each test names the audit finding it guards.
//
//   npm install && node test/web/client.test.mjs        (from the repository root)
//
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PAGE = pathToFileURL(new URL('../../web/index.html', import.meta.url).pathname).href;
const NFT = '0x1111111111111111111111111111111111111111';
const TOK = '0x2222222222222222222222222222222222222222';
const ED  = '0x3333333333333333333333333333333333333333';
const ME  = '0x00000000000000000000000000000000000000Me'.slice(0, 42);
const A = (n) => '0x' + n.toString(16).padStart(40, '0');
// the three airdrop entry points and their …WithGas twins, so the mock can answer a simulated batch
const BULK_SELECTORS = ['0xb097e731', '0x97e763b3', '0xd00a888d', '0x45310558', '0xc0d13d4e', '0xeb0f0b68'];
// The deployed address the page is pointed at. The mock needs it as a literal; the H-01 test asserts the
// page agrees, so this cannot drift silently.
const BULK_FOR_MOCK = '0x91949d7328387a3613b29e56f6979ae893ccd23c';
const padAddr = (a) => '0x' + a.slice(2).padStart(64, '0');
// The batch summary BulkSend emits. The page now requires exactly one, naming the right token and sender,
// before it will read a receipt at all, so a mocked send has to produce a real-shaped one.
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const SUMMARY_TOPIC = {
  '721': '0x0650ec14a2586ec091c567c013a2e3ee5a6aac789d20c75c67208e1d8c9e69df',
  '1155': '0x9bbedf900ea620d4c4355552ede90c302d1ada0fedc6a5537745ebd405c5502e',
  '20': '0xcb7d29f13c142d4a4498ea2cedec3808e56c002b8c36c11ce2a9cde24fff86be',
};
const summaryLog = (bulk, std, token, from, sent, skipped) => ({
  address: bulk, topics: [SUMMARY_TOPIC[std], padAddr(token), padAddr(from)],
  data: '0x' + BigInt(sent).toString(16).padStart(64, '0') + BigInt(skipped || 0).toString(16).padStart(64, '0'),
  blockNumber: '0x1000', transactionHash: '0x' + 'cd'.repeat(32), transactionIndex: '0x0',
  blockHash: '0x' + '11'.repeat(32), logIndex: '0x0', removed: false,
});
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
    // ABI strings are padded up to a whole 32-byte word. Padding to a fixed 64 hex characters only works
    // while the string is short; anything longer came back unaligned and would not decode at all, which is
    // why a tokenURI holding a data: URI arrived as nothing.
    const hex = b.toString('hex');
    const padded = hex.padEnd(Math.ceil(Math.max(hex.length, 1) / 64) * 64, '0');
    return '0x' + (32).toString(16).padStart(64, '0') + BigInt(b.length).toString(16).padStart(64, '0') + padded;
  };
  let blockTick = 0;
  let sentYet = false;
  return function answer(method, params = []) {
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'net_version': return '46630';
      case 'eth_accounts': case 'eth_requestAccounts': return [me];
      case 'eth_gasPrice': return '0x989680';
      case 'eth_blockNumber': return '0x' + (0x1000 + (O.blockMoves ? ++blockTick : 0)).toString(16);
      case 'eth_getBlockByNumber': return { number: '0x1000', hash: '0x' + '11'.repeat(32), parentHash: '0x' + '22'.repeat(32), timestamp: '0x1', gasLimit: '0x1', gasUsed: '0x0', miner: A(0), baseFeePerGas: '0x989680', transactions: [] };
      case 'wallet_getCapabilities':
        // EIP-5792 lets a wallet declare a capability once, under 0x0, for every chain it supports.
        if (O.walletBatchAllChains) return { '0x0': { atomic: { status: 'supported' } } };
        return O.walletBatch ? { '0xb626': { atomic: { status: 'supported' } } } : {};
      case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
      case 'wallet_sendCalls': {
        if (O.tooLarge) { const e = new Error('batch too large'); e.code = 5740; throw e; }
        return { id: '0xbatch' };
      }
      case 'eth_simulateV1': {
        const calls = params[0].blockStateCalls[0].calls || [];
        return [{ calls: calls.map((c, i) => (O.sequenceFailsAt === i
          ? { status: '0x0', gasUsed: '0x1', returnData: '0x', logs: [], error: { message: 'execution reverted', data: '0x7e273289' + (99).toString(16).padStart(64, '0') } }
          : { status: '0x1', gasUsed: '0x1', returnData: '0x', logs: [] })) }];
      }
      case 'wallet_getCallsStatus': return O.callsStatus || { status: 200, receipts: [{ transactionHash: '0x' + 'ab'.repeat(32), status: '0x1', logs: [] }] };
      case 'eth_sendTransaction': sentYet = true; return '0x' + 'cd'.repeat(32);
      // Ethers looks the transaction up after sending it, to build the object it hands back. Answering null
      // here leaves it polling forever, which is why a send used to appear to hang in these tests.
      case 'eth_getTransactionByHash': {
        const h = String(params[0] || '0x' + 'cd'.repeat(32));
        return {
          hash: h, blockHash: '0x' + '11'.repeat(32), blockNumber: '0x1000', transactionIndex: '0x0',
          from: me, to: A(0xb01c), value: '0x0', gas: '0x186a0', gasPrice: '0x989680',
          maxFeePerGas: '0x989680', maxPriorityFeePerGas: '0x0', input: '0x', nonce: '0x1',
          type: '0x2', chainId: '0xb626', accessList: [],
          v: '0x1', r: '0x' + '11'.repeat(32), s: '0x' + '22'.repeat(32),
        };
      }
      case 'eth_getTransactionReceipt': {
        if (O.noReceipt) return null;
        const h = String(params[0] || '0x' + 'cd'.repeat(32));
        // the whole shape ethers expects, so a receipt read back later parses the same as a live one
        return {
          status: '0x1', transactionHash: h, transactionIndex: '0x0', blockNumber: '0x1000',
          blockHash: '0x' + '11'.repeat(32), from: me, to: A(0xb01c), contractAddress: null,
          cumulativeGasUsed: '0x1', gasUsed: '0x1', effectiveGasPrice: '0x989680', type: '0x2',
          logsBloom: '0x' + '00'.repeat(256),
          logs: [
            ...(O.summary ? [summaryLog(O.summary.bulk, O.summary.std, O.summary.token, me, O.summary.sent, O.summary.skipped)] : []),
            ...(O.tokenTransfers || []).map((t) => Object.assign(
              { blockNumber: '0x1000', transactionHash: '0x' + 'cd'.repeat(32), transactionIndex: '0x0',
                blockHash: '0x' + '11'.repeat(32), logIndex: '0x1', removed: false, address: t.token },
              t.id !== undefined
                ? { topics: [TRANSFER, padAddr(me), padAddr(t.to), '0x' + BigInt(t.id).toString(16).padStart(64, '0')], data: '0x' }
                : { topics: [TRANSFER, padAddr(me), padAddr(t.to)], data: '0x' + BigInt(t.amount).toString(16).padStart(64, '0') })),
            ...(O.receiptLogs || []),
          ],
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
        // balanceOf(owner): the sender's balance is known; anyone else's is "could not ask" unless a test
        // says otherwise, which the page treats as no evidence either way rather than as non-arrival.
        if (sel === '0x70a08231') {
          const who = '0x' + data.slice(34, 74);
          if (who.toLowerCase() === me.toLowerCase()) return enc(O.balance ?? '1000000000000000000000');
            // A token that takes a cut on transfer: the recipient's balance rises by less than was sent, which
          // is only visible as a difference between the read before and the read after.
          if (O.shortBy !== undefined) return enc(sentYet ? BigInt(O.sendAmount) - BigInt(O.shortBy) : 0n);
          if (O.recipientBalance !== undefined) return enc(O.recipientBalance);
          return null;
        }
        // ownerOf(id): only answered when a test is exercising the after-the-fact arrival check
        if (sel === '0x6352211e') return O.ownerOf ? '0x' + O.ownerOf.slice(2).padStart(64, '0') : null;
        // tokenURI(uint256): art on the chain, or a URL this page will not fetch
        if (sel === '0xc87b56dd') {
          const id = BigInt('0x' + data.slice(10, 74)).toString();
          if (O.artOffchain) return str('https://example.invalid/meta/' + id + '.json');
          if (O.artOnchain) {
            const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#123"/></svg>';
            const json = '{"name":"Piece #' + id + '","image":"data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') + '"}';
            return str('data:application/json;base64,' + Buffer.from(json).toString('base64'));
          }
          return null;
        }
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

// The phone-wallet connector is imported from the page's own directory. A copy of the page next to a
// stand-in module is the only way to reach that code path without a WalletConnect relay, and the disconnect
// handler behind it is where a delivery once went missing.
const WC_DIR = (() => {
  const d = mkdtempSync(join(tmpdir(), 'bulksend-wc-'));
  copyFileSync(new URL('../../web/index.html', import.meta.url).pathname, join(d, 'index.html'));
  writeFileSync(join(d, 'wc.js'), `
    export const EthereumProvider = {
      async init() {
        const handlers = {};
        const p = {
          on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
          removeListener(ev, fn) { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
          async connect() {},
          async disconnect() {},
          request(a) { return window.ethereum.request(a); },
        };
        window.__wcDisconnect = () => (handlers.disconnect || []).slice().forEach((f) => f());
        return p;
      },
    };
  `);
  return pathToFileURL(join(d, 'index.html')).href;
})();

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
                           catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: e.code || 3, message: String(e.message || 'execution reverted'), data: e.revertData } }; } };
      const out = Array.isArray(body) ? body.map(one) : one(body);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(out) });
    }
    return route.fulfill({ status: 204, body: '' });
  });

  // the wallet object, answered by the same function
  await page.exposeFunction('__chain', async (method, params) => {
    // Holds one method open, so a test can act while a send is genuinely mid-flight rather than before or
    // after it. Nothing else about the answer changes.
    if (opts.slowMethod && method === opts.slowMethod.method) await new Promise((r) => setTimeout(r, opts.slowMethod.ms));
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
    const __listeners = {};
    window.__emit = (ev, arg) => (__listeners[ev] || []).slice().forEach((f) => { try { f(arg); } catch (e) {} });
    window.ethereum = {
      isMetaMask: true,
      on(ev, fn) { (__listeners[ev] = __listeners[ev] || []).push(fn); },
      removeListener(ev, fn) { __listeners[ev] = (__listeners[ev] || []).filter((f) => f !== fn); },
      async request({ method, params }) {
        if (method === 'wallet_sendCalls' || method === 'eth_sendTransaction') window.__sent.push((params || [])[0]);
        const r = await window.__chain(method, params || []);
        if (r && r.ok) return r.result;
        const err = new Error((r && r.message) || 'failed'); err.code = r && r.code; err.data = r && r.data; throw err;
      },
    };
  });

  await page.goto(opts.url || PAGE, { waitUntil: 'load' });
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

// --allow-file-access-from-files: the page imports its phone-wallet connector as a module from its own
// directory, which a file:// origin otherwise refuses. Nothing here is ever served over the network.
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });

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
// (recipientBalance makes the after-the-fact arrival check answerable, so the run reaches its end)
{
  const page = await open(browser, { approved: true, noReceipt: true, recipientBalance: '3000000000000000000' });
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
  check('M-01 and a row it cannot confirm is held rather than sent again',
    /held back|holding back/.test(logText), logText.slice(0, 400));
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
  const page = await open(browser, { walletBatch: true, ownerOf: A(0xe1) });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, A(0xe1) + ',1\n');
  await page.evaluate(([acct, nft]) => {
    const run = 'bulksend:46630:' + acct.toLowerCase() + ':' + nft.toLowerCase() + ':721';
    const filler = []; for (let i = 0; i < 20000; i++) filler.push('x' + i);
    localStorage.setItem(run, JSON.stringify(filler));
  }, [A(0xdead), NFT]);
  await page.click('#send'); await page.waitForTimeout(10000);
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

// ---- T-H-01: a receipt that does not add up is never acted on -------------------
{
  const page = await open(browser, { approved: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, ED, '1155');
  const BULK = await bulkAddress(page);
  const injected = await page.evaluate(([bulk, ed, me]) => {
    // One row, and a receipt carrying a Skipped naming that row plus two summaries: exactly what a hostile
    // receiver calling BulkSend from its own receive hook used to be able to produce.
    const iface = new window.ethers.Interface([
      'event Skipped(address indexed token, address indexed to, uint256 id, uint256 amount, bytes reason)',
      'event Airdrop1155(address indexed token, address indexed from, uint256 sent, uint256 skipped)',
    ]);
    const to = '0x00000000000000000000000000000000000000c9';
    const s1 = iface.encodeEventLog('Skipped', [ed, to, 7n, 3n, '0x']);
    const inner = iface.encodeEventLog('Airdrop1155', [ed, me, 0n, 1n]);
    const outer = iface.encodeEventLog('Airdrop1155', [ed, me, 1n, 0n]);
    const rc = { logs: [
      { address: bulk, topics: s1.topics, data: s1.data },
      { address: bulk, topics: inner.topics, data: inner.data },
      { address: bulk, topics: outer.topics, data: outer.data },
    ] };
    const chunk = [{ to, id: 7n, amount: 3n, k: 'x#1' }];
    const r = window.__readBatchReceipt(rc, chunk, bulk);
    return { ambiguous: r.ambiguous, sent: r.sent, skipped: r.skipped, delivered: r.delivered.length };
  }, [BULK, ED, A(0xdead)]);
  check('T-H-01 a receipt whose numbers do not describe the batch is refused',
    injected && injected.ambiguous === true, JSON.stringify(injected));
  await page.close();
}

// ---- T-H-02: all or nothing is not renegotiated after you agree to it -----------
{
  const page = await open(browser, { walletBatch: true, tooLarge: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, Array.from({ length: 4 }, (_, i) => A(0xc10 + i) + ',' + (i + 1)).join('\n'));
  await page.selectOption('#mode', 'strict'); await page.fill('#batch', '50'); await page.waitForTimeout(400);
  await page.click('#send'); await page.waitForTimeout(7000);
  const sent = await page.evaluate(() => window.__sent.length);
  check('T-H-02 a wallet that refuses the batch does not get a smaller one in strict mode', sent <= 1, 'requests: ' + sent);
  check('T-H-02 and the reason names the promise being kept',
    /all or nothing/i.test(await text(page, '#log')), (await text(page, '#log')).slice(-260));
  await page.close();
}

// ---- T-M-01: the sequence is simulated, not each call against untouched state ----
{
  const page = await open(browser, { walletBatch: true, sequenceFailsAt: 2 });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, Array.from({ length: 4 }, (_, i) => A(0xd10 + i) + ',' + (i + 1)).join('\n'));
  await page.click('#preflight'); await page.waitForTimeout(7000);
  const logText = await text(page, '#log');
  check('T-M-01 a transfer that only fails partway through the sequence is caught',
    /Run in order/.test(logText) && /stops at/.test(logText), logText.slice(0, 300));
  check('T-M-01 and the page says the whole transaction would be lost, not just that row',
    /none of it would land/.test(logText), logText.slice(0, 400));
  await page.close();
}

// ---- records written by the previous version are carried across, not dropped -----
{
  const page = await open(browser, { approved: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  const migrated = await page.evaluate(() => {
    localStorage.setItem('bulksend:pending', JSON.stringify([
      { pid: 'old1', run: 'r', chain: 46630, hash: '0x' + 'aa'.repeat(32), at: Date.now(), via: 'bulk', rows: [{ to: '0x1', id: null, amount: '1', k: 'a#1' }] },
      { pid: 'old2', run: 'r', chain: 46630, hash: '0x' + 'bb'.repeat(32), at: Date.now(), via: 'bulk', rows: [{ to: '0x2', id: null, amount: '1', k: 'b#1' }] },
    ]));
    const keysBefore = Object.keys(localStorage).filter((k) => k.startsWith('bulksend:pending'));
    window.__loadPendingForTest();
    const keysAfter = Object.keys(localStorage).filter((k) => k.startsWith('bulksend:pending'));
    return { before: keysBefore, after: keysAfter.sort() };
  });
  check('a pending record from the previous storage shape is not lost on upgrade',
    migrated.after.includes('bulksend:pending:old1') && migrated.after.includes('bulksend:pending:old2'),
    JSON.stringify(migrated));
  check('and the old key is cleared once every record has been moved',
    !migrated.after.includes('bulksend:pending'), JSON.stringify(migrated.after));
  await page.close();
}

// ---- H-06: the token saying it sent is not the chain saying it arrived -----------
{
  const landed = A(0xe9);
  const page = await open(browser, { approved: true, ownerOf: landed, summary: { bulk: BULK_FOR_MOCK, std: '721', token: NFT, sent: 1 } });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, landed + ',4\n');
  await page.click('#send'); await page.waitForTimeout(7000);
  const logText = await text(page, '#log');
  check('H-06 a row the chain agrees arrived is recorded as arrived', /1 arrived/.test(logText), logText.slice(-200));
  await page.close();
}

// ---- H-06: and a token that reports success while moving nothing is caught -------
{
  const page = await open(browser, { approved: true, ownerOf: A(0xdead), summary: { bulk: BULK_FOR_MOCK, std: '721', token: NFT, sent: 1 } });   // still owned by the sender
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, A(0xea) + ',4\n');
  await page.click('#send'); await page.waitForTimeout(7000);
  const logText = await text(page, '#log');
  check('H-06 a transfer the token reported but the chain did not make is not recorded',
    /have not appeared at their destination/.test(logText) && /NOT recorded as delivered/.test(logText), logText.slice(-360));
  check('H-06 and it is held rather than offered for another attempt',
    /NOT released for another attempt/.test(logText) && /unsettled and held/.test(logText), logText.slice(-360));
  const stillFresh = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('bulksend:46630:'));
    return k ? JSON.parse(localStorage.getItem(k) || '[]').length : 0;
  });
  check('H-06 so the row is not suppressed on the next run', stillFresh === 0, 'delivered keys: ' + stillFresh);
  await page.close();
}

// ---- a reload confirms from the token's own events in that transaction ----------
{
  const paid = A(0x95);
  const page = await open(browser, { approved: true, tokenTransfers: [{ token: TOK, to: paid, amount: '1000000000000000000' }] });
  await page.click('#connect'); await page.waitForTimeout(600);
  await page.evaluate(([acct, tok, to]) => {
    const run = 'bulksend:46630:' + acct.toLowerCase() + ':' + tok.toLowerCase() + ':20';
    localStorage.setItem('bulksend:pending:p9', JSON.stringify({
      pid: 'p9', run, chain: 46630, bulk: '0x91949d7328387a3613b29e56f6979ae893ccd23c',
      hash: '0x' + 'ab'.repeat(32), at: Date.now() - 60000, via: 'wallet',
      rows: [{ to, id: null, amount: '1000000000000000000', k: to.toLowerCase() + '::1000000000000000000#1' }],
    }));
  }, [RUN_ME, TOK, paid]);
  await useToken(page, TOK, '20');
  await setList(page, paid + ',1\n' + A(0x96) + ',2\n');
  await page.click('#send'); await page.waitForTimeout(7000);
  const logText = await text(page, '#log');
  check('a row the token itself says it transferred is confirmed on reload',
    /the token reported all 1 of these transfers/.test(logText), logText.slice(0, 400));
  check('and is then treated as already delivered', /already delivered/.test(logText), logText.slice(0, 400));
  await page.close();
}

// ---- H-04: two rows to one wallet are judged together, not twice over ------------
{
  // one wallet, two rows of 1 each, and only 1 arrives: neither may be recorded
  const both = A(0x97);
  const page = await open(browser, { approved: true, recipientBalance: '1000000000000000000',
                                     summary: { bulk: BULK_FOR_MOCK, std: '20', token: TOK, sent: 2 } });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, TOK, '20');
  await setList(page, both + ',1\n' + both + ',1\n');
  await page.click('#send'); await page.waitForTimeout(7000);
  const logText = await text(page, '#log');
  check('H-04 two rows to one wallet share one balance and are judged as a group',
    /unsettled and held/.test(logText) && !/2 arrived/.test(logText), logText.slice(-320));
  await page.close();
}

// ---- H-02/H-03: a read that fails settles nothing, and holds ---------------------
{
  const page = await open(browser, { approved: true, summary: { bulk: BULK_FOR_MOCK, std: '721', token: NFT, sent: 1 } });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, A(0x98) + ',4\n');
  await page.click('#send'); await page.waitForTimeout(7000);
  const logText = await text(page, '#log');
  check('H-02 a chain that will not answer is not counted as arrival',
    /could not be checked/.test(logText) && /unsettled and held/.test(logText), logText.slice(-320));
  const ledger = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('bulksend:46630:'));
    return k ? JSON.parse(localStorage.getItem(k) || '[]').length : 0;
  });
  check('H-02 and nothing is written to the delivered ledger on no evidence', ledger === 0, 'ledger rows: ' + ledger);
  await page.close();
}

// ---- L-01: a wallet that declares batching for every chain at once --------------
{
  const page = await open(browser, { walletBatchAllChains: true });
  await page.click('#connect'); await page.waitForTimeout(900);
  await useToken(page, NFT, '721');
  await setList(page, A(0xf9) + ',1\n');
  check('L-01 capabilities declared under the all-chain key are honoured',
    (await text(page, '#plan')).includes('as itself'), await text(page, '#plan'));
  await page.close();
}

// ---- a snapshot keeps what each wallet holds, so a drop can follow it ------------
{
  const holders = {
    items: [
      { address: { hash: A(0x101) }, value: '300' },
      { address: { hash: A(0x102) }, value: '3' },
      { address: { hash: A(0x103) }, value: '1' },
    ],
  };
  const page = await open(browser, { explorer: holders });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await page.fill('#snapAddr', NFT); await page.click('#snap'); await page.waitForTimeout(5000);
  check('the snapshot reports what the wallets hold, not just who they are',
    /they hold 304/.test(await text(page, '#log')), (await text(page, '#log')).slice(-260));
  check('and the weighting control appears once it knows',
    await page.evaluate(() => document.querySelector('#weightRow').style.display !== 'none'));

  await page.selectOption('#weight', 'per'); await page.fill('#cap', '10'); await page.waitForTimeout(200);
  await page.click('#applyWeight'); await page.waitForTimeout(1200);
  const list = await val(page, '#list');
  check('one for each one held, capped, is written into the list',
    /x10/.test(list) && /x3/.test(list), list.slice(0, 160));
  check('the wallet holding 300 is capped rather than taking the drop',
    !/x300/.test(list), list.slice(0, 160));
  check('and a wallet holding one gets one, with no suffix',
    list.split('\n').some((l) => l.startsWith(A(0x103)) && !/ x\d/.test(l)), list.slice(0, 200));
  await page.close();
}

// ---- B-01: a lock held for one run is not a lock held for another ----------------
{
  const page = await open(browser, { approved: true });
  await page.click('#connect'); await page.waitForTimeout(600);
  const r = await page.evaluate(async () => {
    // Hold run B's lock from "another tab", then ask this page to commit to run B while it believes it is
    // inside run A. Before the fix, the ambient flag let that write through with B's lock held elsewhere.
    let released;
    const holder = new Promise((r2) => { released = r2; });
    let gotB = false;
    navigator.locks.request('bulksend:runB', async () => { gotB = true; await holder; });
    await new Promise((r2) => setTimeout(r2, 100));
    let ranWhileHeld = false;
    const probe = navigator.locks.request('bulksend:runB', { ifAvailable: true }, (lock) => {
      if (lock) ranWhileHeld = true;
      return null;
    });
    await probe;
    released();
    return { gotB, ranWhileHeld };
  });
  check('B-01 a lock held elsewhere is genuinely unavailable', r.gotB === true && r.ranWhileHeld === false,
    JSON.stringify(r));
  await page.close();
}

// ---- B-05: holdings describe one collection on one chain, and say which ----------
{
  const holders = { items: [{ address: { hash: A(0x201) }, value: '300' }, { address: { hash: A(0x202) }, value: '2' }] };
  const page = await open(browser, { explorer: holders });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await page.fill('#snapAddr', NFT); await page.click('#snap'); await page.waitForTimeout(5000);
  check('B-05 the reading says which collection and chain it came from',
    /Holdings read from/.test(await text(page, '#snapWho')), await text(page, '#snapWho'));
  // change the collection under it: those numbers no longer describe anything in the box
  await page.fill('#snapAddr', A(0x999)); await page.waitForTimeout(500);
  check('B-05 changing the collection drops the holdings rather than reusing them',
    await page.evaluate(() => document.querySelector('#weightRow').style.display === 'none'));
  check('B-05 and says so', /holdings reading has been dropped/.test(await text(page, '#log')), (await text(page, '#log')).slice(-200));
  await page.close();
}

// ---- B-04: a phone wallet that drops mid-send cannot move the key the ledger is written under ----
// The disconnect handler used to clear the sender while a batch was still being watched for arrival. The key
// is built from the sender, so the delivery was written under `anon`: a ledger the next run never reads, and
// every wallet in that batch payable a second time on the next connect. Two things stop it now, and both are
// checked here: no handler blanks the sender mid-send, and the key is frozen to the one the run lock was
// taken for regardless.
{
  const paid = A(0xb04);
  const page = await open(browser, {
    url: WC_DIR, approved: true, ownerOf: paid,
    summary: { bulk: BULK_FOR_MOCK, std: '721', token: NFT, sent: 1 },
    slowMethod: { method: 'eth_getTransactionReceipt', ms: 2500 },
  });
  await page.click('#connectWc'); await page.waitForTimeout(900);
  const viaPhone = await page.evaluate(() => (document.querySelector('#walletBox') || {}).textContent || '');
  check('B-04 the phone-wallet path connects in the test', /phone wallet/i.test(viaPhone) && /dEaD/.test(viaPhone), viaPhone.slice(0, 120));
  await useToken(page, NFT, '721');
  await setList(page, paid + ',4\n');
  await page.click('#send');
  await page.waitForTimeout(2200);                       // signed, waiting on the receipt
  await page.evaluate(() => window.__wcDisconnect());     // the phone drops here
  await page.waitForTimeout(11000);
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^bulksend:46630:/.test(k) && JSON.parse(localStorage.getItem(k) || '[]').length));
  const expected = 'bulksend:46630:' + RUN_ME.toLowerCase() + ':' + NFT.toLowerCase() + ':721';
  check('B-04 the delivery is recorded under the run the lock was taken for',
    keys.length === 1 && keys[0] === expected, JSON.stringify(keys) + ' want ' + expected);
  check('B-04 and never under anon', keys.length > 0 && !keys.some((k) => k.includes(':anon:')), JSON.stringify(keys));
  check('B-04 the sender is not blanked while a send is in flight',
    /disconnected mid-airdrop/.test(await text(page, '#log')), (await text(page, '#log')).slice(-300));
  await page.close();
}

// ---- a correct CSV must never be reported as a broken file -----------------------
// Reported by a real user: "I uploaded the CSV correctly, but it kept saying there was an error with the
// CSV's format. I never got to send it." The rows were fine; the heading was not one of the handful of words
// the page recognised, so it was read as a recipient, reported as "that is not a wallet address", and the
// send stayed disabled behind the acknowledge-bad-lines gate. A heading is now any first line with no
// address attempt in it, whatever it calls its columns.
{
  const page = await open(browser, {});
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  const HEADINGS = ['Recipient Address,NFT ID', 'user,tokenId', 'destination,tokenId', 'wallets,ids',
                    'Holder Wallet,Serial', 'my list,the id', 'address,tokenId'];
  const bad = [];
  for (const h of HEADINGS) {
    await setList(page, h + '\n' + A(0x51) + ',1\n' + A(0x52) + ',2\n');
    const stat = await text(page, '#parseOut');
    const shown = await page.evaluate(() => document.querySelector('#ackRow').style.display);
    if (!/2 recipients/.test(stat) || shown !== 'none') bad.push(h + ' -> ' + stat.replace(/\s+/g, ' ').slice(0, 60));
  }
  check('a heading the page does not recognise is skipped, not called a bad recipient',
    bad.length === 0, bad.join(' | '));

  // and a first line that tries to be an address is still a broken row, never silently skipped
  await setList(page, '0xnot-an-address,1\n' + A(0x51) + ',2\n');
  check('but a first line that tries to be an address is still reported',
    /not a wallet address|right length/.test(await text(page, '#problems')), await text(page, '#problems'));
  await page.close();
}

// ---- spreadsheets write whole numbers their own way ------------------------------
{
  const page = await open(browser, {});
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, 'address,tokenId\n' + A(0x51) + ',1.0\n' + A(0x52) + ',2.000\n');
  check('a token id written as 1.0 by a spreadsheet is the token id 1',
    /2 recipients/.test(await text(page, '#parseOut')), await text(page, '#parseOut'));

  await setList(page, 'address,tokenId\n' + A(0x51) + ',1.5\n');
  check('but 1.5 is still not a token id',
    /not a whole token id/.test(await text(page, '#problems')), await text(page, '#problems'));

  await setList(page, 'address,tokenId\n' + A(0x51) + ',1.23457E+11\n');
  check('and a number the spreadsheet has rounded says so, rather than "no token id"',
    /spreadsheet/.test(await text(page, '#problems')) && /formatted as text/.test(await text(page, '#problems')),
    await text(page, '#problems'));
  await page.close();
}

// ---- a file that is missing a whole column says so once, about the file ----------
{
  const page = await open(browser, {});
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, ED, '1155');
  await setList(page, 'address,tokenId\n' + A(0x51) + ',1\n' + A(0x52) + ',2\n');
  const msg = await text(page, '#msgList');
  check('an ERC-1155 file with no amount column is told that, not shown "null" on every line',
    /no amount column/.test(msg) && !/null/.test(msg + (await text(page, '#problems'))), msg.slice(0, 200));
  await page.close();
}

// ---- a file saved in the wrong encoding is named as that --------------------------
{
  const page = await open(browser, {});
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await setList(page, 'address,tokenId\n' + A(0x51) + ',1\n'.split('').join('\u0000'));
  check('a UTF-16 file is reported as an encoding problem, not as bad addresses',
    /CSV UTF-8/.test(await text(page, '#msgList')), (await text(page, '#msgList')).slice(0, 200));
  await page.close();
}

// ---- leaving the token field must not throw away the token that is in it ----------
// Found by driving the real page against testnet, not by any of the nine audits. `change` fires when a field
// is left, not only when its contents differ, so clicking from the token box into the recipient box discarded
// a good load and re-read the token from the chain. For the second or so those calls take, "Check list"
// refused an ERC-20 list with "Enter the token address first" -- about the address sitting right there. It
// blocked every ERC-20 airdrop, intermittently, which is worse than blocking it outright.
{
  const page = await open(browser, { decimals: 18 });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, TOK, '20');
  // exactly what a person does: click into the token box, then click into the list box, then press the button
  await page.click('#token');
  await page.fill('#token', TOK);
  await page.click('#list');                       // <- blur fires change on #token
  await page.fill('#list', A(0x41) + ',1.5\n' + A(0x42) + ',2.25\n');
  await page.click('#parse');
  await page.waitForTimeout(500);                  // deliberately short: the old code was still re-reading
  const stat = await text(page, '#parseOut');
  check('leaving the token field with the same address in it does not re-read the token',
    /2 recipients/.test(stat), stat.slice(0, 160));
  check('and the list is not refused with a step the user already did',
    !/Enter the token address first/.test(stat), stat.slice(0, 160));

  // a genuinely different address must still be re-read
  await page.fill('#token', ED);
  await page.dispatchEvent('#token', 'change');
  await page.waitForTimeout(1200);
  check('but changing the address really does load the new one',
    (await text(page, '#tokenInfo')).length > 0, await text(page, '#tokenInfo'));
  await page.close();
}

// ---- the file a real user sent in, exactly as they sent it ---------------------
// "I have all the columns filled out, but it's still saying it's incorrect." Their addresses were sequential
// test addresses whose EIP-55 checksums do not match, so every row was rejected. The page then treated an
// empty result as "every token id is blank", switched to the how-many-each reading, threw away every reason
// it had collected, and asked whether to replace the list with "0 wallets, 0 NFTs in total" -- while saying
// nothing whatsoever about the addresses.
{
  const page = await open(browser, {});
  const dialogs = [];
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  const RAW = ['0x02133af5C7A045A3782Fbb6Af344b9E91cD11088', '0x02133af5C7A045A3782Fbb6Af344b9E91cD11089',
               '0x02133af5C7A045A3782Fbb6Af344b9E91cD11090'];
  await setList(page, 'address,tokenId,quantity\n' + RAW.map((a, i) => a + ',' + (i + 1) + ',1').join('\n') + '\n');
  const problems = await text(page, '#problems');
  check('a file whose rows were all rejected is not read as "how many each"',
    !dialogs.some((d) => /how many NFTs each wallet gets/.test(d)), dialogs.join(' | ').slice(0, 200));
  check('and it never asks about 0 wallets and 0 NFTs',
    !dialogs.some((d) => /0 wallets, 0 NFTs/.test(d)), dialogs.join(' | ').slice(0, 200));
  check('the reasons are shown rather than discarded',
    await page.evaluate(() => document.querySelector('#problems').style.display) !== 'none' && /line 2:/.test(problems),
    problems.slice(0, 200));
  check('and the reason names the checksum, not just "not a wallet address"',
    /capitals do not match its own checksum/.test(problems), problems.slice(0, 240));
  check('with the way out spelled out',
    /no capitals at all it will be accepted/.test(problems) && /does not make a wrong address right/.test(problems), problems.slice(0, 400));

  // the two forms that are correct must both go through
  await setList(page, 'address,tokenId,quantity\n' + RAW.map((a, i) => a.toLowerCase() + ',' + (i + 1) + ',1').join('\n') + '\n');
  check('the same file with no capitals is accepted, as the message says',
    /3 recipients/.test(await text(page, '#parseOut')), await text(page, '#parseOut'));
  await page.close();
}

// ---- a file of nothing but addresses is how most people start ---------------------
// Asked for by the first outside tester: "allow them to upload a CSV of just the addresses and enter the
// number of NFTs they want to send. From there it should just choose any of the available token IDs." That
// already existed -- but only for a list pasted with no heading. The same list as a CSV, headed `address`,
// went to the named-column reader and was answered with "no token id on this line" once per wallet.
{
  const page = await open(browser, {});
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  const readEl = text;
  for (const [name, text] of [
    ['pasted with no heading', A(0x61) + '\n' + A(0x62) + '\n' + A(0x63) + '\n'],
    ['as a CSV headed address', 'address\n' + A(0x61) + '\n' + A(0x62) + '\n' + A(0x63) + '\n'],
    ['headed with another word', 'Recipient Wallet\n' + A(0x61) + '\n' + A(0x62) + '\n' + A(0x63) + '\n'],
  ]) {
    await setList(page, text);
    const stat = await readEl(page, '#parseOut'), prob = await readEl(page, '#problems');
    check('a list of bare wallets offers to fill the ids in (' + name + ')',
      /3 wallets, no token ids yet/.test(stat) && /Press "Assign my token ids"/.test(prob),
      stat.slice(0, 90) + ' | ' + prob.slice(0, 90));
    check('and never reports a missing id as a broken line (' + name + ')',
      !/no token id on this line/.test(prob) && !/problem lines/.test(stat), prob.slice(0, 120));
  }
  await page.close();
}

// ---- a list of addresses nobody ever created ------------------------------------
// A wallet address is twenty random bytes. Two real ones sharing eight characters is a one-in-four-billion
// coincidence, and two landing within a few values of each other is far less likely still. A list that does
// both was written by counting, and an address nobody generated has no key behind it: what goes there cannot
// be moved again by anyone. The first outside tester's failing file was exactly this shape.
{
  const page = await open(browser, {});
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  // the nine addresses from that tester's successful airdrop, read off the chain. These must stay clean:
  // a false positive here would cry wolf on every real list and teach people to ignore the warning.
  const REAL = ['0x8f72075dAe23ccC4aE4CcCBafeB4e3937f1E916a', '0xe10dc380237a83A84B2e8ae527d86E3f3FDC43A6',
    '0xbB2287a8CcD2cCF2F439e766353Ad9b91264D253', '0x464b83236B6C9236C4e59e3a836D00fd5F2590bd',
    '0x7a793C0b94fCd60582ac5aa0Cc82377E7d090Ebf', '0xad773b7E54c5d1412116269bDaf506025a32E25C',
    '0xB932Fdc1de9BBC384070c71d87e480C6f1338834', '0xa58165E81452a84A30964B039BB3B9D164dDca5D',
    '0x877ed07A554a88568f620B3d6455cf8850a1f20d'];
  await setList(page, REAL.map((a, i) => a + ',' + (240 + i)).join('\n'));
  check('nine real addresses are not called made up',
    !/look made up/.test(await text(page, '#parseOut')), await text(page, '#parseOut'));

  // the fabricated list, lower-cased so the checksum is not what stops it
  const FAKE = [0, 1, 2, 3, 4, 5].map((i) => '0x02133af5c7a045a3782fbb6af344b9e91cd110' + (88 + i));
  await setList(page, FAKE.map((a, i) => a + ',' + (300 + i)).join('\n'));
  const stat = await text(page, '#parseOut'), why = await text(page, '#problems');
  check('a counted list is called what it is', /look made up/.test(stat), stat.slice(0, 140));
  check('and it says which two things gave it away',
    /identical for its first 38 characters/.test(why) && /within a few values/.test(why), why.slice(0, 260));
  check('it says what it costs: no key, no way back',
    /no key behind it/.test(why) && /never be moved again/.test(why), why.slice(0, 400));
  check('it does not claim the reverse for a list that passes',
    /has not been checked, only found unremarkable/.test(why), why.slice(-200));
  check('and it warns rather than blocks, because a testnet rehearsal is a fair use of it',
    (await page.evaluate(() => document.querySelector('#ackRow').style.display)) === 'none'
    && (await page.evaluate(() => document.querySelector('#send').disabled)) === false,
    'ackRow=' + await page.evaluate(() => document.querySelector('#ackRow').style.display)
    + ' send disabled=' + await page.evaluate(() => document.querySelector('#send').disabled));

  // low sequential addresses, the other way people make lists up
  await setList(page, [1, 2, 3, 4].map((i) => '0x' + i.toString(16).padStart(40, '0') + ',' + (270 + i)).join('\n'));
  check('burn-style sequential addresses are caught too', /look made up/.test(await text(page, '#parseOut')),
    await text(page, '#parseOut'));

  // two is not enough to tell anything from
  await setList(page, FAKE.slice(0, 2).map((a, i) => a + ',' + (280 + i)).join('\n'));
  check('two addresses are too few to judge, and it says nothing rather than guessing',
    !/look made up/.test(await text(page, '#parseOut')), await text(page, '#parseOut'));
  await page.close();
}

// ---- a token that takes a cut on transfer -----------------------------------------
// Proved live against a real 2% fee token on testnet, which reported: "received 98.0 of the 100.0 sent. This
// token takes a cut on transfer, so nothing here is recorded as paid in full" -- 0 arrived, 1 held. This
// guards that: recording a short delivery as paid in full is how someone is quietly underpaid and then
// suppressed from the retry, which is worse than not sending at all.
{
  const AMOUNT = 100n * 10n ** 18n;
  const page = await open(browser, {
    approved: true, decimals: 18,
    sendAmount: AMOUNT.toString(), shortBy: (AMOUNT / 50n).toString(),   // 2% taken
    summary: { bulk: BULK_FOR_MOCK, std: '20', token: TOK, sent: 1 },
  });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, TOK, '20');
  await setList(page, A(0xfee1) + ',100\n');
  await page.click('#send'); await page.waitForTimeout(8000);
  const l = await text(page, '#log');
  check('a recipient who received less than was listed is named, with both numbers',
    /received 98\.0 of the 100\.0 sent/.test(l), l.slice(-320));
  check('and it is not recorded as paid in full',
    /not recorded as paid in full|nothing here is recorded as paid/.test(l) && !/1 arrived/.test(l), l.slice(-320));
  check('the row is held rather than released for another attempt',
    /unsettled and held/.test(l), l.slice(-260));
  const ledger = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => /^bulksend:46630:/.test(k))
      .reduce((n, k) => n + JSON.parse(localStorage.getItem(k) || '[]').length, 0));
  check('and nothing goes into the delivered ledger', ledger === 0, 'ledger holds ' + ledger);
  await page.close();
}

// ---- choosing which NFTs go out, rather than leaving it to chance ------------------
// Asked for by the first outside tester. Three of the five largest collections on this chain keep their art
// on the chain -- a data: URI of JSON whose image is a data: URI of an SVG -- so the picture is already in
// the answer and nothing has to be fetched from anywhere.
{
  const page = await open(browser, { approved: true, artOnchain: true, ownedIds: [11, 12, 13] });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await page.fill('#list', A(0x71) + '\n' + A(0x72) + '\n');
  await page.waitForTimeout(300);
  await page.click('#pick'); await page.waitForTimeout(6000);
  const tiles = await page.evaluate(() => [...document.querySelectorAll('#pickGrid .tile')].map((t) => ({
    src: (t.querySelector('img') || {}).src || null, label: (t.querySelector('.id') || {}).textContent })));
  check('the picker shows the NFTs the wallet holds', tiles.length >= 2, tiles.length + ' tiles');
  check('with art read straight off the chain, not fetched from anywhere',
    tiles.every((t) => /^data:image\//.test(t.src || '')), JSON.stringify(tiles[0] || {}));
  check('and each one named from its own metadata', /Piece #/.test((tiles[0] || {}).label || ''), (tiles[0] || {}).label);

  // choosing a different number than there are wallets must not quietly pair them up wrong
  await page.evaluate(() => document.querySelectorAll('#pickGrid .tile')[0].click());
  await page.click('#pickUse'); await page.waitForTimeout(800);
  check('choosing fewer NFTs than wallets is refused, not silently padded',
    /Choose exactly one for each wallet/.test(await text(page, '#pickMsg')), await text(page, '#pickMsg'));

  await page.evaluate(() => document.querySelectorAll('#pickGrid .tile')[1].click());
  await page.click('#pickUse'); await page.waitForTimeout(1500);
  const list = await page.evaluate(() => document.querySelector('#list').value);
  check('the chosen ids are paired with the wallets in the order shown',
    list.split('\n').length === 2 && /,\d+$/.test(list.split('\n')[0]), list.replace(/\n/g, ' | '));
  check('and the randomiser is switched off, since choosing then shuffling would undo the choosing',
    (await page.evaluate(() => document.querySelector('#rand').checked)) === false);
  await page.close();
}
// ---- a collection that keeps its art on its own server ----------------------------
{
  const page = await open(browser, { approved: true, artOffchain: true, ownedIds: [21, 22] });
  await page.click('#connect'); await page.waitForTimeout(600);
  await useToken(page, NFT, '721');
  await page.fill('#list', A(0x81) + '\n');
  await page.waitForTimeout(300);
  await page.click('#pick'); await page.waitForTimeout(6000);
  const msg = await text(page, '#pickMsg');
  const tiles = await page.evaluate(() => [...document.querySelectorAll('#pickGrid .tile')].map((t) => ({
    img: !!t.querySelector('img'), why: (t.querySelector('.no') || {}).textContent })));
  check('art on someone else\u2019s server is not fetched', tiles.every((t) => !t.img), JSON.stringify(tiles[0] || {}));
  check('and the tile says why rather than showing an empty box',
    /own server/.test((tiles[0] || {}).why || ''), (tiles[0] || {}).why);
  check('the reason is given once at the top too, with what it protects',
    /web server/.test(msg) && /signs transactions/.test(msg), msg.slice(0, 260));
  check('and those NFTs can still be sent', /still send normally/.test(msg), msg.slice(0, 260));
  await page.close();
}

await browser.close();
console.log(results.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
