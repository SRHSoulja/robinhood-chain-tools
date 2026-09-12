// Round twenty-one reviewer probes. Same convention as every earlier probe file here: each assertion
// REPRODUCES a finding, so an assertion that PASSES ("REPRODUCES") is a defect that is still present, and
// one that reads "fixed" is a defect that is not.
//
//   node test/web/audit-probe-21.mjs
//
// Nothing here touches a network, signs anything, or needs a key. Every chain and explorer answer is mocked.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { ethers } from 'ethers';

const ROOT = process.env.RH_ROOT ? process.env.RH_ROOT.replace(/\/$/, '') + '/' : new URL('../../', import.meta.url).pathname;
const CHECK = pathToFileURL(ROOT + 'web/check.html').href;
const AIRDROP = pathToFileURL(ROOT + 'web/index.html').href;
const A = (n) => '0x' + n.toString(16).padStart(40, '0');
const NFT = A(0x721), TOKEN20 = A(0x20), IMPL = A(0x1111), PROXY = A(0x9999), WALLET = A(0x7702);
const SPENDER = A(0xbeef), FROM = A(0xcafe);

let demonstrated = 0, notReproduced = 0;
const lines = [];
const probe = (name, reproduced, detail) => {
  if (reproduced) { demonstrated++; lines.push('  REPRODUCES  ' + name + (detail ? '\n                 ' + String(detail).replace(/\s+/g, ' ').slice(0, 420) : '')); }
  else { notReproduced++; lines.push('  fixed       ' + name + (detail ? '\n                 ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : '')); }
};

const word = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
const strRet = (t) => { const b = Buffer.from(t, 'utf8'); return '0x' + (32).toString(16).padStart(64, '0') + BigInt(b.length).toString(16).padStart(64, '0') + b.toString('hex').padEnd(Math.ceil(b.length / 32) * 64, '0'); };
const codeWith = (sels) => '0x' + sels.map((s) => '63' + s.slice(2)).join('') + '00';
const text = (page, sel) => page.$eval(sel, (e) => e.textContent || '').catch(() => '');
const val = (page, sel) => page.$eval(sel, (e) => e.value || '').catch(() => '');
const proxyCode = (impl) => '0x363d3d373d3d3d363d73' + impl.slice(2).toLowerCase() + '5af43d82803e903d91602b57fd5bf3';

// ---------------------------------------------------------------------------- a Check-page run
// `chain` answers eth_*; `docs` maps a lower-cased address to the /smart-contracts/<addr> body, as a STRING,
// so a body that is not a Blockscout record at all can be handed back at HTTP 200 exactly as a gateway does.
async function checkRun(browser, { chain, docs, input, from }) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 2000 } });
  page.on('dialog', (d) => d.dismiss());
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    const m = url.match(/\/smart-contracts\/(0x[0-9a-fA-F]{40})/);
    if (m) {
      const body = docs[m[1].toLowerCase()];
      return body === undefined
        ? route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
        : route.fulfill({ status: 200, contentType: 'application/json', body });
    }
    if (url.includes('/api/v2/') || url.includes('/x/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: '{"data":{"amount":"2500"}}' });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let b; try { b = JSON.parse(req.postData() || '{}'); } catch { b = {}; }
      const one = (r) => {
        if (r.method === 'eth_simulateV1') return { jsonrpc: '2.0', id: r.id, result: [{ calls: [{ status: '0x1', gasUsed: '0x7530', returnData: '0x', logs: [] }] }] };
        try { return { jsonrpc: '2.0', id: r.id, result: chain(r.method, r.params || []) }; }
        catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: -32000, message: String(e.message) } }; }
      };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(b) ? b.map(one) : one(b)) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto(CHECK, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  if (from) await page.fill('#from', from);
  await page.fill('#input', input);
  await page.click('#go');
  await page.waitForTimeout(4000);
  const out = await text(page, '#out');
  await page.close();
  return out;
}

// A chain where PROXY is an EIP-1167 forwarder in front of IMPL, and both are plain contracts.
function proxyChain() {
  return function (method, params = []) {
    const p0 = String((params[0] && params[0].to) || params[0] || '').toLowerCase();
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'eth_blockNumber': return '0x1000';
      case 'eth_getBalance': return '0xde0b6b3a7640000';
      case 'eth_getTransactionCount': return '0x5';
      case 'eth_getCode':
        if (p0 === PROXY.toLowerCase()) return proxyCode(IMPL);
        if (p0 === IMPL.toLowerCase()) return codeWith(['0x40c10f19']);
        return '0x';
      case 'eth_getStorageAt': return '0x' + '0'.repeat(64);
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), data = String(params[0].data || ''), sel = data.slice(0, 10);
        if (sel === '0x01ffc9a7') return word(0);
        if (sel === '0x313ce567') throw new Error('no decimals');
        if (sel === '0x06fdde03') return strRet('Forwarded Thing');
        if (sel === '0x95d89b41') return strRet('FWD');
        if (sel === '0x18160ddd') return word(1000);
        return word(0);
      }
      default: return null;
    }
  };
}

const REAL_RECORD = (over) => JSON.stringify(Object.assign({
  is_verified: true, is_partially_verified: false, name: 'Forwarder', abi: [],
  compiler_version: 'v0.8.24+commit.e11b9ed9', optimization_enabled: true, evm_version: 'cancun',
  proxy_type: null, implementations: [], verified_at: '2026-09-01T00:00:00Z',
}, over || {}));

// P21-1. Round twenty F-2 taught readAddress that a 200 JSON body carrying no `is_verified` boolean is not
// an answer to "is the source published" -- check.js:300. The SAME question is asked again 44 lines below it
// for the code a proxy actually runs, and that consumer was not changed: check.js:344 is still
// `out.proxy.verified = res.ok ? !!(impl && impl.is_verified) : null`. `res.ok` is true for any 200 JSON
// body, and `!!undefined` is `false`, so a rate-limit envelope or a gateway error document turns into the
// definite red sentence "the code it runs has published no source" about code nobody could check.
async function proxyWrongShape(browser) {
  const docs = {};
  docs[PROXY.toLowerCase()] = REAL_RECORD({ name: 'Forwarder' });
  docs[IMPL.toLowerCase()] = JSON.stringify({ error: 'rate limited', retry_after: 30 });
  const out = await checkRun(browser, { chain: proxyChain(), docs, input: PROXY });
  const saysNone = /the code it runs has (no|published no) published? ?source|the code it runs has no published source|the code it runs has published no source/.test(out);
  const saysCouldNot = /could not check (the code it runs|whether that code)/.test(out);
  probe('P21-1 the round-twenty F-2 fix ("a 200 body with no is_verified is not an answer") was applied to the contract itself and not to the code behind a proxy: check.js:344 still reads any 200 JSON body as an answer, so an unreadable reply about the implementation is stated as the definite fact "the code it runs has published no source"',
    saysNone && !saysCouldNot,
    JSON.stringify({ saysNoPublishedSource: saysNone, saysCouldNotCheck: saysCouldNot,
                     pill: (out.match(/the code it runs[^A-Z]{0,60}/) || [''])[0] }));
}

// P21-2. The same line drops the full/partial distinction round twenty F-1 was raised to preserve.
// `out.partial` is computed from the FORWARDER's record and never from the implementation's, and
// `out.proxy.verified` is a bare boolean, so an implementation that the explorer says is only PARTIALLY
// verified is announced in green as "the code it runs has published source" with no caveat anywhere on the
// page -- while the identical record on a non-proxy contract produces "source published, partly matched".
async function proxyPartialLost(browser) {
  const docs = {};
  docs[PROXY.toLowerCase()] = REAL_RECORD({ name: 'Forwarder', is_partially_verified: false });
  docs[IMPL.toLowerCase()] = REAL_RECORD({ name: 'Implementation', is_partially_verified: true,
    abi: [{ type: 'function', name: 'mint', inputs: [{ type: 'address' }, { type: 'uint256' }], stateMutability: 'nonpayable' }] });
  const viaProxy = await checkRun(browser, { chain: proxyChain(), docs, input: PROXY });
  // The control: the very same partially-verified record read directly, with no proxy in front of it.
  const plainDocs = {};
  plainDocs[NFT.toLowerCase()] = docs[IMPL.toLowerCase()];
  const plainChain = function (method, params = []) {
    const p0 = String((params[0] && params[0].to) || params[0] || '').toLowerCase();
    if (method === 'eth_getCode') return p0 === NFT.toLowerCase() ? codeWith(['0x40c10f19']) : '0x';
    return proxyChain()(method, params);
  };
  const direct = await checkRun(browser, { chain: plainChain, docs: plainDocs, input: NFT });
  const proxySaysPublished = /the code it runs has published source/.test(viaProxy);
  const proxyMentionsPartial = /partly matched|partially verified|full or partial/.test(viaProxy);
  const directMentionsPartial = /partly matched|partially verified/.test(direct);
  probe('P21-2 an implementation the explorer reports as only PARTIALLY verified is announced as "the code it runs has published source" with no partial caveat anywhere, because out.partial is read from the forwarder’s record and out.proxy.verified is a bare boolean; the identical record read without a proxy in front of it says "source published, partly matched"',
    proxySaysPublished && !proxyMentionsPartial && directMentionsPartial,
    JSON.stringify({ proxySaysPublished, proxyMentionsPartial, directMentionsPartial,
                     directPill: (direct.match(/source published[^.]{0,50}/) || [''])[0] }));
}

// ---------------------------------------------------------------------------- inner calls
// A chain with an ERC-20 (decimals 18, supply 1e27) and an ERC-721 whose ids are hash-derived, plus a
// wallet-ish contract at WALLET whose `execute(address,uint256,bytes)` carries one call inside it.
function innerChain() {
  return function (method, params = []) {
    const p0 = String((params[0] && params[0].to) || params[0] || '').toLowerCase();
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'eth_blockNumber': return '0x1000';
      case 'eth_getBalance': return '0xde0b6b3a7640000';
      case 'eth_getTransactionCount': return '0x5';
      case 'eth_getCode':
        if (p0 === WALLET.toLowerCase()) return codeWith(['0xb61d27f6']);
        if (p0 === TOKEN20.toLowerCase()) return codeWith(['0x095ea7b3', '0xa9059cbb']);
        if (p0 === NFT.toLowerCase()) return codeWith(['0x095ea7b3']);
        return '0x';
      case 'eth_getStorageAt': return '0x' + '0'.repeat(64);
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), data = String(params[0].data || ''), sel = data.slice(0, 10);
        if (sel === '0x01ffc9a7') return word(to === NFT.toLowerCase() && data.slice(10, 18) === '80ac58cd' ? 1 : 0);
        if (sel === '0x313ce567') { if (to === TOKEN20.toLowerCase()) return word(18); throw new Error('no decimals'); }
        if (sel === '0x06fdde03') return strRet(to === TOKEN20.toLowerCase() ? 'Stable Thing' : 'Hash Collection');
        if (sel === '0x95d89b41') return strRet(to === TOKEN20.toLowerCase() ? 'STB' : 'HSH');
        if (sel === '0x18160ddd') return to === TOKEN20.toLowerCase() ? word(10n ** 27n) : word(100);
        return word(0);
      }
      default: return null;
    }
  };
}
const IFACE = new ethers.Interface([
  'function approve(address spender, uint256 amountOrId)',
  'function execute(address target, uint256 value, bytes data) returns (bytes)',
]);
const approveData = (spender, v) => IFACE.encodeFunctionData('approve', [spender, v]);
const executeData = (target, inner) => IFACE.encodeFunctionData('execute', [target, 0, inner]);

// P21-3. Round twenty F-7 changed unlimitedApproval's second parameter from the token record to the whole
// readAddress record, and updated ONE of its two call sites (check.js:923, callWarnings). The other,
// check.js:603 in renderInner, still hands it `t && t.token`. The consequence at that call site is that
// `target.token` is now undefined, so the supply comparison unlimitedFor exists for never happens and the
// only test left is the 2^128 fallback: an ERC-20 approval a thousand times the entire supply, carried
// inside an `execute`, gets no "This inner call is an unlimited approval" line at all. The identical call
// pasted on its own does get the red warning, from the call site that was updated.
async function innerApprovalMissed(browser) {
  const AMOUNT = 10n ** 30n;               // 1000x the whole supply, and below the 2^128 fallback
  const inner = approveData(SPENDER, AMOUNT);
  const wrapped = await checkRun(browser, { chain: innerChain(), docs: {}, from: FROM,
    input: JSON.stringify({ to: WALLET, data: executeData(TOKEN20, inner), from: FROM }) });
  const bare = await checkRun(browser, { chain: innerChain(), docs: {}, from: FROM,
    input: JSON.stringify({ to: TOKEN20, data: inner, from: FROM }) });
  const innerShown = /Let 0x|spend/.test(wrapped) && /Calls carried inside this one/.test(wrapped);
  const innerWarned = /This inner call is an unlimited approval/.test(wrapped);
  const bareWarned = /This is an unlimited approval/.test(bare);
  probe('P21-3 renderInner (check.js:603) still passes `t.token` to unlimitedApproval, whose second parameter round twenty changed to the whole address record; the supply comparison therefore never runs for a call carried inside another, and an ERC-20 approval of a thousand times the token’s entire supply is rendered inside an `execute` with no unlimited-approval warning, while the same bytes pasted alone are flagged',
    innerShown && !innerWarned && bareWarned,
    JSON.stringify({ innerCallRendered: innerShown, innerWarned, sameCallAloneWarned: bareWarned, amount: String(AMOUNT) }));
}

// P21-4. The same wrong argument loses the ERC-721 exception F-7 added, in the other direction: `t.token`
// has no `.standard`, so `approve(spender, tokenId)` on a collection whose ids are hashes (ENS and every
// other contract that derives an id from a name or a hash) is measured against the 2^128 amount threshold
// and announced, in red, as an unlimited approval of a token that has no allowances at all.
async function innerNftApproveFalseAlarm(browser) {
  const ID = 1n << 200n;                   // an ordinary hash-derived ERC-721 id
  const inner = approveData(SPENDER, ID);
  const wrapped = await checkRun(browser, { chain: innerChain(), docs: {}, from: FROM,
    input: JSON.stringify({ to: WALLET, data: executeData(NFT, inner), from: FROM }) });
  const bare = await checkRun(browser, { chain: innerChain(), docs: {}, from: FROM,
    input: JSON.stringify({ to: NFT, data: inner, from: FROM }) });
  const innerWarned = /This inner call is an unlimited approval/.test(wrapped);
  const bareWarned = /This is an unlimited approval/.test(bare);
  probe('P21-4 the same wrong argument drops F-7’s ERC-721 exception for calls carried inside another: an `approve(spender, tokenId)` with a hash-derived id, wrapped in an `execute`, is announced in red as "This inner call is an unlimited approval" -- the exact false statement F-7 was raised to remove -- while the same bytes pasted alone are described correctly',
    innerWarned && !bareWarned,
    JSON.stringify({ innerWarned, sameCallAloneWarned: bareWarned, id: String(ID) }));
}

// ---------------------------------------------------------------------------- the airdrop page
function airdropAnswer(O) {
  const enc = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
  const ME = O.me;
  return function (method, params = []) {
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'net_version': return '46630';
      case 'eth_accounts': case 'eth_requestAccounts': return [ME];
      case 'eth_blockNumber': return '0x1000';
      case 'eth_gasPrice': return '0x989680';
      case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
      case 'wallet_getCapabilities': return {};
      case 'eth_estimateGas': return '0x' + (21000 + 40000).toString(16);
      case 'eth_getCode': {
        const a = String(params[0] || '').toLowerCase();
        if (a === NFT.toLowerCase() || a === '0xf2ed6359f5dee0334d68cd21d306d9d3e7a49232') return '0x60006000';
        return '0x';
      }
      case 'eth_getTransactionReceipt': return null;
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), data = String(params[0].data || ''), sel = data.slice(0, 10);
        if (sel === '0x01ffc9a7') return enc(to === NFT.toLowerCase() && data.slice(10, 18) === 'd9b67a26' ? 1 : 0);
        if (sel === '0x313ce567') return null;
        if (sel === '0x06fdde03') return strRet('Probe Edition');
        if (sel === '0x95d89b41') return strRet('PED');
        if (sel === '0x70a08231') return enc(9);
        if (sel === '0xe985e9c5') return enc(1);
        if (sel === '0x5c975abb') return enc(0);
        if (sel === '0x56c3e5e9' || sel === '0xdf1c9e47') return enc(400000);
        if (sel === '0x20d2c951') return enc(100000);
        if (sel === '0x5f2a9f41') return enc(5000000);
        return enc(0);
      }
      default: return null;
    }
  };
}

// P21-5. Round twenty F-6 taught "Apply weight" to refuse to eat the token ids in the BARE form this page
// writes for itself. The guard it added is `standard === '721' && ...`. The page writes exactly the same
// bare form for ERC-1155 -- Assign emits `serializeRow([to, id, amount])`, i.e. `0xabc,5,3` -- and for an
// edition the id says WHICH edition. With 1155 selected the guard does not apply, so one click replaces
// every line with `0xabc x3` and both the edition and the per-wallet amount are gone. The confirmation the
// user agrees to counts wallets and never mentions either.
async function weightEats1155Ids(browser) {
  const ME = A(0xdead);
  const ans = airdropAnswer({ me: ME });
  const HOLDERS = { items: [{ address: { hash: A(0x111) }, value: '2' }, { address: { hash: A(0x222) }, value: '1' }], next_page_params: null };
  const page = await browser.newPage({ viewport: { width: 1200, height: 1800 } });
  page.__dialogs = [];
  page.on('dialog', (d) => { page.__dialogs.push(d.message()); return d.accept(); });
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: '{"data":{"amount":"2500"}}' });
    if (url.includes('/holders')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HOLDERS) });
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
  await page.selectOption('#std', '1155');
  await page.fill('#token', NFT);
  await page.dispatchEvent('#token', 'change');
  await page.waitForTimeout(800);
  // The holder read is what reveals the weighting controls, exactly as on the 721 path.
  await page.fill('#snapAddr', NFT);
  await page.click('#snap');
  await page.waitForTimeout(2500);
  const weightVisible = await page.$eval('#weightRow', (e) => getComputedStyle(e).display !== 'none').catch(() => false);
  // The list in the form this page writes for an edition: address, which edition, how many.
  await page.fill('#list', A(0x111) + ',5,3\n' + A(0x222) + ',5,2\n');
  await page.fill('#each', '4');
  page.__dialogs.length = 0;
  await page.click('#applyWeight');
  await page.waitForTimeout(1500);
  const after = await val(page, '#list');
  const msg = await text(page, '#msgList');
  const problems = await text(page, '#problems');
  const keptId = /,\s*5\b/.test(after);
  const warned = page.__dialogs.some((m) => /token id|edition|NFT id/i.test(m)) || /already names/i.test(msg);
  probe('P21-5 round twenty F-6’s guard against "Apply weight" eating the ids in the bare form this page writes for itself is `standard === "721"` only; with ERC-1155 selected the same click replaces `0xabc,5,3` (address, which edition, how many) with `0xabc x4`, destroying both the edition and the per-wallet amount, and the confirmation counts wallets without mentioning either',
    weightVisible && !keptId && !warned,
    JSON.stringify({ weightControlsVisible: weightVisible, after: after.replace(/\n/g, ' | ').slice(0, 120),
                     keptTheEditionId: keptId, dialogs: page.__dialogs.map((d) => d.slice(0, 120)),
                     parseSaid: (msg + ' ' + problems).replace(/\s+/g, ' ').slice(0, 200) }));
  await page.close();
}


// ---------------------------------------------------------------------------- Assign and the send loop
const BULK_SELECTORS = ['0xb097e731', '0x97e763b3', '0xd00a888d', '0x45310558', '0xc0d13d4e', '0xeb0f0b68'];
const BULK_ADDR = '0xf2ed6359f5dee0334d68cd21d306d9d3e7a49232';

// A full airdrop page: connected, ERC-721 selected, the collection loaded, the operator approved. `O.hooks`
// may intercept an answer before the default one; everything else is a working chain.
function sendAnswer(O) {
  const enc = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
  const ME = A(0xdead);
  return function (method, params = [], via) {
    if (O.hooks) { const r = O.hooks(method, params, via); if (r !== undefined) return r; }
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'net_version': return '46630';
      case 'eth_accounts': case 'eth_requestAccounts': return [ME];
      case 'eth_blockNumber': return '0x1000';
      case 'eth_gasPrice': return '0x989680';
      case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
      case 'wallet_getCapabilities': return {};
      case 'eth_estimateGas': return '0x' + (0x186a0).toString(16);
      case 'eth_sendTransaction': return '0x' + 'cd'.repeat(32);
      case 'eth_getTransactionReceipt': return null;
      case 'eth_simulateV1': {
        const calls = params[0].blockStateCalls[0].calls || [];
        return [{ calls: calls.map(() => ({ status: '0x1', gasUsed: '0x1', returnData: '0x', logs: [] })) }];
      }
      case 'eth_getCode': {
        const a = String(params[0] || '').toLowerCase();
        return (a === NFT.toLowerCase() || a === BULK_ADDR) ? '0x60006000' : '0x';
      }
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), data = String(params[0].data || ''), sel = data.slice(0, 10);
        if (sel === '0x01ffc9a7') return enc(to === NFT.toLowerCase() && data.slice(10, 18) === '80ac58cd' ? 1 : 0);
        if (sel === '0x313ce567') return null;
        if (sel === '0x06fdde03') return strRet('Probe Collection');
        if (sel === '0x95d89b41') return strRet('PRB');
        if (sel === '0x2f745c59') { const o = O.owned || []; const i = Number(BigInt('0x' + data.slice(74))); if (i >= o.length) throw new Error('index out of range'); return enc(o[i]); }
        if (sel === '0x70a08231') return enc((O.owned || []).length);
        if (sel === '0xe985e9c5') return enc(1);
        if (sel === '0x5c975abb') return enc(0);
        if (sel === '0x6352211e') return '0x' + ME.slice(2).padStart(64, '0');
        if (sel === '0x56c3e5e9' || sel === '0xdf1c9e47') return enc(400000);
        if (sel === '0x20d2c951') return enc(100000);
        if (sel === '0x5f2a9f41') return enc(5000000);
        if (BULK_SELECTORS.includes(sel)) return enc(1) + enc(0).slice(2);
        return enc(0);
      }
      default: return null;
    }
  };
}

async function sendPage(browser, O) {
  const ans = sendAnswer(O);
  const page = await browser.newPage({ viewport: { width: 1200, height: 1800 } });
  page.__dialogs = [];
  page.on('dialog', (d) => { page.__dialogs.push(d.message()); return O.dismiss ? d.dismiss() : d.accept(); });
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: '{"data":{"amount":"2500"}}' });
    if (url.includes('/nft')) return route.fulfill({ contentType: 'application/json', body: '{"items":[],"next_page_params":null}' });
    if (url.includes('/api/v2/') || url.includes('/x/')) return route.fulfill({ contentType: 'application/json', body: '{"items":[]}' });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let b; try { b = JSON.parse(req.postData() || '{}'); } catch { b = {}; }
      const one = (r) => { try { return { jsonrpc: '2.0', id: r.id, result: ans(r.method, r.params || [], 'http') }; }
                           catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: e.code || -32000, message: String(e.message) } }; } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(b) ? b.map(one) : one(b)) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.exposeFunction('__chain', async (method, params) => {
    try { return { ok: true, result: await ans(method, params, 'wallet') }; }
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
  await page.selectOption('#std', O.std || '721');
  await page.fill('#token', NFT);
  await page.dispatchEvent('#token', 'change');
  await page.waitForTimeout(900);
  return page;
}

// P21-6. Round nineteen F-4 gave the gas-limit failure its own message -- "it was not sent to your wallet at
// all. Those recipients are not held back" -- in an inner catch at index.html:3433. That catch rethrows, and
// the outer catch immediately below it (index.html:3442) has no way to tell where the error came from: for
// anything `isRejection` does not recognise it logs "that batch was handed to your wallet and this page did
// not get an answer. Those recipients are held back". Both lines are printed, about the same batch, one
// after the other, and the second is false: nothing was handed to any wallet and the pending record was
// already dropped.
async function gasEstimateDoubleMessage(browser) {
  let askedWallet = false;
  const page = await sendPage(browser, {
    owned: [71, 72],
    hooks: (method, params, via) => {
      if (method === 'eth_sendTransaction') { askedWallet = true; return undefined; }
      // The page's own RPC cannot work out a gas limit for the BulkSend call. Everything else answers.
      if (method === 'eth_estimateGas' && String((params[0] || {}).to || '').toLowerCase() === BULK_ADDR) {
        const e = new Error('execution reverted'); e.code = -32000; throw e;
      }
      return undefined;
    },
  });
  await page.fill('#list', A(0x111) + ',71\n' + A(0x222) + ',72\n');
  await page.click('#parse'); await page.waitForTimeout(600);
  await page.click('#send');
  await page.waitForFunction(() => /Stopped on error|Finished\./.test(document.querySelector('#log').textContent || ''), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  const log = await text(page, '#log');
  const saidNotSent = /was not sent to your wallet at all\. Those recipients are not held back/.test(log);
  const saidHandedOver = /handed to your wallet and this page did not get an answer/.test(log);
  probe('P21-6 a gas-limit failure prints round nineteen F-4’s correct sentence ("it was not sent to your wallet at all. Those recipients are not held back") and then, from the outer catch it rethrows into, the opposite one ("that batch was handed to your wallet and this page did not get an answer. Those recipients are held back") about the same batch, in the same log',
    saidNotSent && saidHandedOver && !askedWallet,
    JSON.stringify({ walletWasAsked: askedWallet, saidNotSentToWallet: saidNotSent, saidHandedToWallet: saidHandedOver,
                     log: log.replace(/\s+/g, ' ').slice(-420) }));
  await page.close();
}

// P21-7. `requestedNftQuantity` is documented as "the same semantic reader used by list sizing; Assign does
// not keep a parallel rule" (index.html:2177). It is not. `deliveriesOn` reads a NAMED id column holding
// several ids -- `address,tokenIds` with `"1 2 3"` in one cell, the shape parseList documents and supports
// ("A tokenIds column holding '1 2 3' is the same thing one column over") -- as that many deliveries.
// `requestedNftQuantity` has the equivalent rule only for the BARE positional form (round eighteen S-1) and
// falls through to the "how many each" default for the headed one. Assign therefore asks for one NFT per
// wallet for a file the parser and the picker both read as several, and the dialog it shows speaks only of
// pairing.
async function headedMultiIdCell(browser) {
  const page = await sendPage(browser, { owned: [71, 72, 73, 74, 75, 76] });
  const LIST = 'address,tokenIds\n' + A(0x111) + ',"1 2 3"\n' + A(0x222) + ',"4 5"\n';
  await page.fill('#list', LIST);
  await page.click('#parse'); await page.waitForTimeout(700);
  const parsedBefore = await text(page, '#parseOut');
  page.__dialogs.length = 0;
  await page.click('#assign');
  await page.waitForFunction(() => /Assigned|stopped|Could not read/.test(document.querySelector('#log').textContent || ''), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  const after = await val(page, '#list');
  await page.click('#parse'); await page.waitForTimeout(700);
  const parsedAfter = await text(page, '#parseOut');
  const before = Number((parsedBefore.match(/(\d+)\s*recipients?/) || [0, 0])[1]);
  const afterN = Number((parsedAfter.match(/(\d+)\s*recipients?/) || [0, 0])[1]);
  const dialogSaidCount = page.__dialogs.some((m) => /\b5\b|fewer|how many/i.test(m));
  probe('P21-7 Assign’s quantity reader and the recipient parser read the same headed file differently: `address,tokenIds` with several ids in one cell parses as five recipients and the picker sizes for five, and Assign asks for one per wallet and writes two lines, with nothing in the dialog or the log about the three deliveries that went',
    before === 5 && afterN === 2 && !dialogSaidCount,
    JSON.stringify({ recipientsBefore: before, recipientsAfter: afterN, after: after.replace(/\n/g, ' | ').slice(0, 140),
                     dialogs: page.__dialogs.map((d) => d.slice(0, 110)) }));
  await page.close();
}

// P21-8. Round seventeen S-5, which docs/status.md lists as open and PROMPT.md's scope 0 says should close
// in the rewritten pairing block. It does not. A zero-address line is a readable address to `addressOn`, so
// it survives every guard, is paired with one of the sender's NFTs, and is then refused by `recipientProblem`
// inside the round-trip check -- which reports only that the output "did not round-trip through the
// recipient parser". Worse than unnamed: the problems panel is then rewritten by the restored list's own
// parse into "These are wallets with no token ids yet. Press 'Assign my token ids'", which is the button
// that has just refused. There is no way out of that loop from anything the page says.
async function zeroAddressStopsAssign(browser) {
  const page = await sendPage(browser, { owned: [71, 72, 73] });
  await page.fill('#list', A(0x111) + '\n' + '0x' + '0'.repeat(40) + '\n' + A(0x222) + '\n');
  await page.click('#assign');
  await page.waitForFunction(() => /Assigned|stopped|Could not read/.test(document.querySelector('#log').textContent || ''), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  const msg = await text(page, '#msgList');
  const problems = await text(page, '#problems');
  const said = msg + ' ' + problems;
  const namesZero = /zero address|burn/i.test(said);
  const tellsYouToPressAssign = /Press "Assign my token ids"/.test(problems);
  probe('P21-8 (round seventeen S-5, still open) a zero-address line stops Assign with "its output did not round-trip through the recipient parser", never naming the zero address, and the problems panel then tells the user to press the very button that just refused',
    !namesZero && tellsYouToPressAssign,
    JSON.stringify({ namesTheZeroAddress: namesZero, tellsYouToPressAssignAgain: tellsYouToPressAssign,
                     msg: msg.replace(/\s+/g, ' ').slice(0, 200), problems: problems.replace(/\s+/g, ' ').slice(0, 160) }));
  await page.close();
}

const browser = await chromium.launch();
try {
  await proxyWrongShape(browser);
  await proxyPartialLost(browser);
  await innerApprovalMissed(browser);
  await innerNftApproveFalseAlarm(browser);
  await weightEats1155Ids(browser);
  await gasEstimateDoubleMessage(browser);
  await headedMultiIdCell(browser);
  await zeroAddressStopsAssign(browser);
} finally { await browser.close(); }

console.log('\nRound twenty-one probes\n');
for (const l of lines) console.log(l);
console.log('\n' + demonstrated + ' demonstrated, ' + notReproduced + ' not reproduced\n');
