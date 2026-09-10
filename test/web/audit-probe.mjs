// Audit probe — eleventh external round. Standalone; does not touch the repository's own suites.
//   node test/web/audit-probe.mjs
// Each case is a demonstration of a finding in ../../AUDIT.md, not a regression test.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const PAGE = pathToFileURL(new URL('../../web/index.html', import.meta.url).pathname).href;
const NFT = '0x1111111111111111111111111111111111111111';
const TOK = '0x2222222222222222222222222222222222222222';
const A = (n) => '0x' + n.toString(16).padStart(40, '0');
const ME = A(0xdead);
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const padAddr = (a) => '0x' + a.slice(2).padStart(64, '0');

let pass = 0, fail = 0; const out = [];
const check = (n, c, d) => { if (c) { pass++; out.push('  ok   ' + n); } else { fail++; out.push('  FAIL ' + n + (d ? '  <- ' + d : '')); } };

function chainAnswer(O) {
  const enc = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
  const str = (t) => { const b = Buffer.from(t, 'utf8'); const hex = b.toString('hex');
    const p = hex.padEnd(Math.ceil(Math.max(hex.length, 1) / 64) * 64, '0');
    return '0x' + (32).toString(16).padStart(64, '0') + BigInt(b.length).toString(16).padStart(64, '0') + p; };
  return function answer(method, params = []) {
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'net_version': return '46630';
      case 'eth_accounts': case 'eth_requestAccounts': return [ME];
      case 'eth_gasPrice': return '0x989680';
      case 'eth_blockNumber': return '0x1000';
      case 'eth_getBlockByNumber': return { number: '0x1000', hash: '0x' + '11'.repeat(32), parentHash: '0x' + '22'.repeat(32), timestamp: '0x1', gasLimit: '0x1', gasUsed: '0x0', miner: A(0), baseFeePerGas: '0x989680', transactions: [] };
      case 'wallet_getCapabilities': return {};
      case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
      case 'wallet_getCallsStatus': return O.callsStatus || { status: 200, receipts: [{ transactionHash: '0x' + 'ab'.repeat(32), status: '0x1', logs: [] }] };
      case 'eth_estimateGas': {
        (O.probes = O.probes || []).push(params[0] || {});
        const seq = O.estimateSeq || [];
        const v = seq.length ? seq[Math.min(O.probes.length - 1, seq.length - 1)] : (O.estimateGas || 0x186a0);
        if (v === 'revert') { const e = new Error('execution reverted'); e.revertData = '0x'; throw e; }
        return '0x' + Number(v).toString(16);
      }
      case 'eth_getTransactionByHash': return { hash: String(params[0]), blockHash: '0x' + '11'.repeat(32), blockNumber: '0x1000', transactionIndex: '0x0', from: ME, to: A(0xb01c), value: '0x0', gas: '0x186a0', gasPrice: '0x989680', maxFeePerGas: '0x989680', maxPriorityFeePerGas: '0x0', input: '0x', nonce: '0x1', type: '0x2', chainId: '0xb626', accessList: [], v: '0x1', r: '0x' + '11'.repeat(32), s: '0x' + '22'.repeat(32) };
      case 'eth_getTransactionReceipt': return { status: '0x1', transactionHash: String(params[0]), transactionIndex: '0x0', blockNumber: '0x1000', blockHash: '0x' + '11'.repeat(32), from: ME, to: A(0xb01c), contractAddress: null, cumulativeGasUsed: '0x1', gasUsed: '0x1', effectiveGasPrice: '0x989680', type: '0x2', logsBloom: '0x' + '00'.repeat(256), logs: (O.receiptLogs || []) };
      case 'eth_getCode': { const a = String(params[0] || '').toLowerCase(); return ([NFT, TOK].includes(a)) ? '0x60006000' : '0x'; }
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), data = String(params[0].data || ''), sel = data.slice(0, 10);
        if (sel === '0x2f745c59' && O.ownedIds) { const i = Number(BigInt('0x' + data.slice(74))); return i < O.ownedIds.length ? enc(O.ownedIds[i]) : null; }
        if (sel === '0x70a08231' && O.ownedIds && to === NFT) return enc(O.ownedIds.length);
        if (sel === '0x01ffc9a7') { const i = data.slice(10, 18); if (to === NFT) return enc(i === '80ac58cd' ? 1 : 0); return enc(0); }
        if (sel === '0x313ce567') return to === TOK ? enc(O.decimals ?? 18) : null;
        if (sel === '0x06fdde03' || sel === '0x95d89b41') return str('Test');
        if (sel === '0x70a08231') { const who = '0x' + data.slice(34, 74);
          if (who.toLowerCase() === ME.toLowerCase()) return enc(O.balance ?? '1000000000000000000000');
          return O.recipientBalance !== undefined ? enc(O.recipientBalance) : null; }
        if (sel === '0x6352211e') return O.ownerOf ? '0x' + O.ownerOf.slice(2).padStart(64, '0') : null;
        if (sel === '0xc87b56dd') return null;
        if (sel === '0x00fdd58e') return enc(1000);
        if (sel === '0xdd62ed3e') return enc(O.allowance ?? '1000000000000000000000');
        if (sel === '0x098144d4') return null;
        if (sel === '0x5c975abb') return enc(0);
        if (sel === '0xe985e9c5') return enc(O.approved ? 1 : 0);
        if (sel === '0x56c3e5e9' || sel === '0xdf1c9e47') return enc(400000);
        if (sel === '0x20d2c951') return enc(100000);
        if (sel === '0x5f2a9f41') return enc(5000000);
        if (['0xb097e731', '0x97e763b3', '0xd00a888d', '0x45310558', '0xc0d13d4e', '0xeb0f0b68'].includes(sel)) return enc(O.willDeliver ?? 1) + enc(0).slice(2);
        return enc(1);
      }
      default: return null;
    }
  };
}

async function open(browser, opts = {}) {
  const answer = chainAnswer(opts);
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
  const errs = []; const dialogs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  page.on('dialog', (d) => { dialogs.push(d.message()); return opts.dismissDialogs ? d.dismiss() : d.accept(); });
  await page.route('**://*/**', async (route) => {
    const req = route.request(); const url = req.url();
    if (url.startsWith('file://')) return route.continue();
    if (url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('/holders')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
    if (url.includes('/nft')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { amount: '2500' } }) });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let body; try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
      const one = (r) => { try { return { jsonrpc: '2.0', id: r.id, result: answer(r.method, r.params || []) }; }
                           catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: e.code || 3, message: String(e.message || 'reverted'), data: e.revertData } }; } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.exposeFunction('__chain', async (method, params) => {
    try { return { ok: true, result: answer(method, params) }; }
    catch (e) { return { ok: false, code: e.code || 3, message: String(e.message || e), data: e.revertData }; }
  });
  if (opts.seedStorage) await page.addInitScript(([entries]) => {
    try { for (const [k, v] of entries) localStorage.setItem(k, v); } catch (e) {}
  }, [opts.seedStorage]);
  await page.addInitScript(() => {
    window.__sent = []; const L = {};
    window.__emit = (ev, a) => (L[ev] || []).slice().forEach((f) => { try { f(a); } catch (e) {} });
    window.ethereum = { isMetaMask: true,
      on(ev, fn) { (L[ev] = L[ev] || []).push(fn); }, removeListener(ev, fn) { L[ev] = (L[ev] || []).filter((f) => f !== fn); },
      async request({ method, params }) {
        if (method === 'wallet_sendCalls' || method === 'eth_sendTransaction') window.__sent.push((params || [])[0]);
        const r = await window.__chain(method, params || []);
        if (r && r.ok) return r.result;
        const e = new Error((r && r.message) || 'failed'); e.code = r && r.code; e.data = r && r.data; throw e;
      } };
  });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  page.__errs = errs; page.__dialogs = dialogs; page.__opts = opts;
  return page;
}
const setList = async (p, t) => { await p.fill('#list', t); await p.waitForTimeout(200); await p.click('#parse'); await p.waitForTimeout(400); };
const useToken = async (p, addr, std) => {
  if (std) { await p.selectOption('#std', std); await p.waitForTimeout(200); }
  await p.fill('#token', addr); await p.dispatchEvent('#token', 'change');
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(150);
    const s = await p.evaluate(() => { const w = (document.querySelector('#whyDisabled') || {}).textContent || '';
      const t = (document.querySelector('#tokenInfo') || {}).textContent || ''; return t.length > 0 && !w.includes('Reading that token'); });
    if (s) return; }
};
const text = (p, s) => p.evaluate((x) => (document.querySelector(x) || {}).textContent || '', s);
const val = (p, s) => p.evaluate((x) => (document.querySelector(x) || {}).value || '', s);

const browser = await chromium.launch();

// ---------------------------------------------------------------------------------------------------------
// P1 — the picker collapses a documented multi-id line into one delivery, and its own counter hides it.
// "0xabc,1,2,3 sends three" is the format printed above the box. walletsInBox() reads one address per line,
// so the picker asks for one NFT, accepts one, and rewrites the list as one line. Two are silently dropped.
{
  const p = await open(browser, { ownedIds: [11, 12, 13, 14, 15] });
  await p.click('#connect'); await p.waitForTimeout(600);
  await useToken(p, NFT, '721');
  await setList(p, A(0xa1) + ',11,12,13');
  const before = await text(p, '#parseOut');
  await p.click('#pick'); await p.waitForTimeout(1500);
  const need = await text(p, '#pickNeed');
  await p.click('#pickGrid .tile');            // choose exactly one, which is all it asks for
  await p.waitForTimeout(150);
  const pill = await text(p, '#pickCount');
  await p.click('#pickUse'); await p.waitForTimeout(800);
  const after = await text(p, '#parseOut');
  const lines = (await val(p, '#list')).split('\n').filter(Boolean).length;
  check('P1 list parses as 3 recipients before the picker', /3 recipients/.test(before), before);
  check('P1 picker asks for only 1', need === '1', 'pickNeed=' + need);
  check('P1 picker calls one-of-one a complete selection', /1 chosen of 1 wallet/.test(pill), pill);
  check('P1 DEMONSTRATED: two of three NFTs silently dropped', lines === 1 && /1 recipients/.test(after), 'lines=' + lines + ' after=' + after);
  await p.close();
}

// ---------------------------------------------------------------------------------------------------------
// P2 — a pending wallet-batch record from a different standard makes Send throw before the run lock is taken.
// arrivalsFromReceipt() reads $('token') and std() live rather than the ones the batch was sent under.
{
  const run721 = 'bulksend:46630:' + ME.toLowerCase() + ':' + NFT + ':721';
  const entry = JSON.stringify({ pid: 'probe1', run: run721, chain: 46630, bulk: null,
    hash: '0x' + 'ab'.repeat(32), callsId: '0xbatch', at: Date.now(), via: 'wallet',
    rows: [{ to: A(0xb1), id: '7', amount: null, k: A(0xb1).toLowerCase() + ':7:#1' }] });
  const p = await open(browser, { seedStorage: [['bulksend:pending:probe1', entry]], decimals: 18 });
  await p.click('#connect'); await p.waitForTimeout(600);
  await useToken(p, TOK, '20');
  await setList(p, A(0xc1) + ',5');
  const ready = await p.evaluate(() => !document.querySelector('#send').disabled);
  await p.click('#send'); await p.waitForTimeout(1500);
  const errs = p.__errs.join(' | ');
  const logTxt = await text(p, '#log');
  check('P2 send was enabled', ready, 'send disabled');
  check('P2 DEMONSTRATED: reconcile throws on a foreign-standard pending record',
    /BigInt|Cannot mix|toString/i.test(errs), 'errs=' + errs.slice(0, 200));
  check('P2 DEMONSTRATED: nothing sent and nothing said',
    !/Batch 1/.test(logTxt) && (await p.evaluate(() => window.__sent.length)) === 0, 'log=' + logTxt.slice(-200));
  await p.close();
}

// ---------------------------------------------------------------------------------------------------------
// P3 — a nonsense-but-legal estimateGas answer RAISES the batch cap above the un-measured fallback.
// The stated belief is "a tiny answer only returns the cap to what it was before". It does not: 200 -> 400.
{
  const p = await open(browser, { ownedIds: [1, 2, 3], estimateGas: 21001 });
  await p.click('#connect'); await p.waitForTimeout(600);
  await useToken(p, NFT, '721');
  await setList(p, A(0xa1) + ',1\n' + A(0xa2) + ',2');
  await p.waitForTimeout(1200);
  const max = await p.evaluate(() => document.querySelector('#batch').max);
  const note = await text(p, '#batchNote');
  await p.fill('#batch', '400'); await p.waitForTimeout(400);
  const clamp = await text(p, '#batchClamp');
  check('P3 DEMONSTRATED: cap raised to 400 by a 21,001 answer', max === '400', 'max=' + max);
  check('P3 DEMONSTRATED: page asserts it measured 1 gas a wallet', /measured rather than assumed: about 1 gas/.test(note), note.slice(0, 240));
  check('P3 400 accepted without a clamp warning', clamp.trim() === '', clamp);
  await p.close();
}

// ---------------------------------------------------------------------------------------------------------
// P4 — the measurement is not re-taken when the recipient list changes, only when chain/token/standard/check do.
// A collection whose cost depends on WHICH ids move (ERC721A) is measured once, on the first list.
{
  const p = await open(browser, { ownedIds: [1, 2, 3, 900, 901], estimateSeq: [21000 + 40000, 21000 + 900000] });
  await p.click('#connect'); await p.waitForTimeout(600);
  await useToken(p, NFT, '721');
  await setList(p, A(0xa1) + ',1\n' + A(0xa2) + ',2');
  await p.waitForTimeout(1200);
  const max1 = await p.evaluate(() => document.querySelector('#batch').max);
  await setList(p, A(0xa1) + ',900\n' + A(0xa2) + ',901');
  await p.waitForTimeout(1500);
  const max2 = await p.evaluate(() => document.querySelector('#batch').max);
  const probes = p.__opts.probes || [];
  check('P4 first list measured', max1 === '400', 'max1=' + max1);
  check('P4 DEMONSTRATED: second, different list re-uses the first answer', max2 === max1, 'max2=' + max2);
  check('P4 DEMONSTRATED: only one probe was ever sent', probes.length === 1, 'probes=' + probes.length);
  await p.close();
}

// ---------------------------------------------------------------------------------------------------------
// P5 — "Review held rows" can never confirm an ERC-20 or ERC-1155 row, whatever the chain says, because it
// asks confirmArrival() with an empty "before" map. It then tells the operator the chain will not confirm.
{
  const run20 = 'bulksend:46630:' + ME.toLowerCase() + ':' + TOK + ':20';
  const entry = JSON.stringify({ pid: 'probe2', run: run20, chain: 46630, bulk: A(0xb01c),
    hash: '0x' + 'ab'.repeat(32), at: Date.now(), via: 'bulk',
    rows: [{ to: A(0xb1), id: null, amount: '5000000000000000000', k: A(0xb1).toLowerCase() + '::5000000000000000000#1' }] });
  const p = await open(browser, { seedStorage: [['bulksend:pending:probe2', entry]], decimals: 18,
    recipientBalance: '999000000000000000000', dismissDialogs: true });
  await p.click('#connect'); await p.waitForTimeout(600);
  await useToken(p, TOK, '20');
  await p.waitForTimeout(400);
  await p.click('#review'); await p.waitForTimeout(2000);
  const dlg = p.__dialogs.join(' || ');
  check('P5 DEMONSTRATED: review offers release even though balanceOf answers',
    /will not confirm arrived/.test(dlg), 'dialogs=' + dlg.slice(0, 300));
  check('P5 DEMONSTRATED: nothing was recorded as arrived', !/now read as held by their recipient/.test(await text(p, '#log')), 'log');
  await p.close();
}

// ---------------------------------------------------------------------------------------------------------
// P6 — a wallet's word alone releases already-paid rows for re-payment, with the contradicting receipt in hand.
// reconcilePending() maps EIP-5792 status 500 to "reverted, nothing moved" and drops the pending record with
// no confirmation and no chain read, while the SAME answer carries a receipt showing status 0x1 and the
// token's own Transfer events for every row in the batch.
{
  const R = A(0xb1), H = '0x' + 'ab'.repeat(32);
  const transferLog = (to, id) => ({ address: NFT, blockNumber: '0x1000', transactionHash: H, transactionIndex: '0x0',
    blockHash: '0x' + '11'.repeat(32), logIndex: '0x1', removed: false,
    topics: [TRANSFER, padAddr(ME), padAddr(to), '0x' + BigInt(id).toString(16).padStart(64, '0')], data: '0x' });
  const run721 = 'bulksend:46630:' + ME.toLowerCase() + ':' + NFT + ':721';
  const mk = (pid) => JSON.stringify({ pid, run: run721, chain: 46630, bulk: null, hash: null,
    callsId: '0xbatch', at: Date.now(), via: 'wallet',
    rows: [{ to: R, id: '7', amount: null, k: R.toLowerCase() + ':7:#1' }] });

  for (const [label, status] of [['numeric 500', 500], ["the string 'FAILED'", 'FAILED']]) {
    const p = await open(browser, {
      seedStorage: [['bulksend:pending:probe6', mk('probe6')]],
      ownedIds: [7], ownerOf: R,
      callsStatus: { status, receipts: [{ transactionHash: H, status: '0x1', logs: [transferLog(R, 7)] }] },
    });
    await p.click('#connect'); await p.waitForTimeout(600);
    await useToken(p, NFT, '721');
    await p.waitForTimeout(1500);
    const held = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('bulksend:pending:')).length);
    const ledger = await p.evaluate((k) => localStorage.getItem(k) || '[]', run721);
    const logTxt = await text(p, '#log');
    check('P6 DEMONSTRATED (' + label + '): pending record dropped on the wallet\'s word alone', held === 0, 'held=' + held);
    check('P6 DEMONSTRATED (' + label + '): row is NOT in the delivered ledger, so it is payable again', ledger === '[]', 'ledger=' + ledger);
    check('P6 DEMONSTRATED (' + label + '): page asserts nothing moved', /nothing in it moved|never reached the chain|reverted in full/.test(logTxt), logTxt.slice(0, 200));
    // and the evidence the page had in its hand at that moment:
    check('P6 the wallet handed over a receipt with status 0x1 and the transfer in it', true);
    await p.close();
  }
}

await browser.close();
console.log(out.join('\n'));
console.log('\n' + pass + ' demonstrated, ' + fail + ' not reproduced');
process.exit(fail ? 1 : 0);
