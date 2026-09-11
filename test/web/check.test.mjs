// Deterministic browser tests for web/check.html. Every chain and explorer answer is mocked, so a failure
// here is the page's fault and nothing else.
//
//   npm install && node test/web/check.test.mjs        (from the repository root)
//
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { makeRunner } from './lib.mjs';

const PAGE = pathToFileURL(new URL('../../web/check.html', import.meta.url).pathname).href;
const A = (n) => '0x' + n.toString(16).padStart(40, '0');
const NFT = A(0x721), TOK = A(0x20), PROXY = A(0x9), IMPL = A(0x99), WALLET = A(0xeee), NASTY = A(0xbad)
const MYSTERY = A(0x5150);   // a contract whose standard cannot be settled: no supportsInterface, no decimals
const ME = A(0xdead);

let pass = 0, fail = 0;
// Streamed as it happens rather than buffered into an array printed once at the end.
const check = (name, cond, detail) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '  <- ' + String(detail).slice(0, 200) : '')); } };
// The case runner: named cases, ONLY=<regex> filtering, one throw fails its own case and nothing else.
// See test/web/lib.mjs and docs/harness.md.
const { t, trackPage, summaryLine } = makeRunner(check);

const word = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
const strRet = (t) => { const b = Buffer.from(t, 'utf8'); return '0x' + (32).toString(16).padStart(64, '0') + BigInt(b.length).toString(16).padStart(64, '0') + b.toString('hex').padEnd(Math.ceil(b.length / 32) * 64, '0'); };
const topicAddr = (a) => '0x' + a.slice(2).padStart(64, '0');
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVAL = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

// runtime bytecode that dispatches on the selectors we want the page to notice
const codeWith = (sels) => '0x' + sels.map((s) => '63' + s.slice(2)).join('') + '00';
const SEL = { mint: '0x40c10f19', pause: '0x8456cb59', setFee: '0x69fe0e2d', blacklist: '0xf9f92be4' };

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
        if (p0 === NFT || p0 === TOK) return codeWith([SEL.mint, SEL.pause]);
        if (p0 === MYSTERY) return codeWith([SEL.mint]);
        if (p0 === NASTY) return codeWith([SEL.mint, SEL.blacklist, SEL.setFee]);
        if (p0 === PROXY) return '0x363d3d373d3d3d363d73' + IMPL.slice(2) + '5af43d82803e903d91602b57fd5bf3';
        if (p0 === IMPL) return codeWith([SEL.mint]);
        if (p0 === WALLET) return '0xef0100' + IMPL.slice(2);
        return '0x';
      }
      case 'eth_getStorageAt': {
        const slot = String(params[1] || '').toLowerCase();
        if (O.beaconProxy && slot === '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50')
          return '0x' + O.beaconProxy.slice(2).padStart(64, '0');
        return '0x' + '0'.repeat(64);
      }
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), data = String(params[0].data || ''), sel = data.slice(0, 10);
        if (sel === '0x01ffc9a7') { const id = data.slice(10, 18);
          if (to === NFT || to === NASTY) return word(id === '80ac58cd' ? 1 : 0);
          return word(0); }
        if (sel === '0x313ce567') return to === TOK ? word(18) : null;
        if (sel === '0x06fdde03') return strRet(to === NASTY ? '<img src=x onerror=alert(1)>' : to === NFT ? 'Test Collection' : 'Test Token');
        if (sel === '0x95d89b41') return strRet(to === NFT ? 'TC' : 'TT');
        if (sel === '0x18160ddd') return word(1000);
        if (sel === '0x8da5cb5b') return O.owner === null ? null : '0x' + (O.owner || A(0x0117)).slice(2).padStart(64, '0');
        if (sel === '0x5c975abb') return word(O.paused ? 1 : 0);
        if (sel === '0x5c60da1b') { if (O.beaconSilent) throw new Error('beacon will not say'); return word(0); }
        if (sel === '0xa2b4bdcb') return O.validator ? '0x' + O.validator.slice(2).padStart(64, '0') : null;
        return word(1);
      }
      case 'eth_simulateV1': {
        O.__simBatches = (O.__simBatches || []).concat([((params[0].blockStateCalls[0] || {}).calls || []).length]);
        O.__senders = (O.__senders || []).concat(((params[0].blockStateCalls[0] || {}).calls || []).map((c) => c.from));
        // Answers for every call in the request, in order, so an ordered batch simulation can be tested.
        const calls = (params[0].blockStateCalls[0] || {}).calls || [];
        const one = (i) => (O.sequenceFailsAt === i
          ? { status: '0x0', gasUsed: '0x1', returnData: '0x', logs: [], error: { message: 'execution reverted', data: '0x7e273289' + (99).toString(16).padStart(64, '0') } }
          : { status: '0x1', gasUsed: '0xb8a8', returnData: '0x', logs: O.simLogs || [] });
        if (O.simRevert) return [{ calls: calls.map(() => ({ status: '0x0', gasUsed: '0x7639', returnData: '0x', logs: [], error: { message: 'execution reverted', code: -32000, data: O.simRevert } })) }];
        return [{ calls: calls.map((c, i) => one(i)) }];
      }
      case 'eth_getTransactionByHash': return O.tx || null;
      case 'eth_getTransactionReceipt': return O.receipt || null;
      default: return null;
    }
  };
}

async function open(_stale, opts = {}) {
  const ans = answer(opts);
  await freshBrowser();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  page.on('dialog', (d) => (opts.promptWith ? d.accept(opts.promptWith) : d.dismiss()));
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('/api/v2/smart-contracts/') || url.includes('/x/')) {
      if (opts.slowFor && url.toLowerCase().includes(opts.slowFor.toLowerCase().slice(2))) await new Promise((r) => setTimeout(r, opts.slowMs || 3000));
      if (opts.explorerSick) return route.fulfill({ status: 500, contentType: 'text/html', body: 'upstream is unwell' });
      const addr = url.split('/').pop().toLowerCase();
      const body = opts.verified && opts.verified[addr];
      if (!body) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (url.includes('/api/v2/transactions/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(opts.exTx || {}) });
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { amount: '2500' } }) });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let body; try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
      // A mock that throws stands for a node that will not answer, which is a case the page has to handle.
      const one = (r) => { try { return { jsonrpc: '2.0', id: r.id, result: ans(r.method, r.params || []) }; }
                           catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: -32000, message: String(e.message || 'node error') } }; } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  page.__errs = errs;
  trackPage(page);   // so a case that throws before its own page.close() still gets one
  return page;
}
const ask = async (page, q, from, waitMs) => {
  await page.fill('#input', q);
  if (from) await page.fill('#from', from);
  await page.click('#go');
  await page.waitForTimeout(waitMs || 2500);
  return (await page.textContent('#out')) || '';
};


// ---- the page has to be one the browser will actually run -----------------------------------------------
// Each page's CSP names the SHA-256 of the inline script it carries. Edit that script and forget to run
// web/sync.sh and the browser silently refuses to execute any of it. Nothing throws, nothing reaches
// pageerror, and every test after that fails as a timeout waiting for an element that was never going to
// appear, which reads like a broken test or a slow machine rather than the real cause. It cost fifteen
// minutes once. Checking it here costs a millisecond and turns it into one line.
const CSP_PAGES = [['../../web/check.html', '../../web/check.js']];
await t("csp: the page has to be one the browser will actually run", async () => {
  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const die = (m) => { console.error('\n' + m + '\nRun web/sync.sh and try again.\n'); process.exit(1); };
  const inlineScript = (src, name) => {
    // Any inline script, however its tag is written. Matching the literal "<script>" made
    // `<script type="module">` invisible to every layer that used it, so a second inline script passed the
    // count and was never hashed. A tag carrying src= is external, not inline.
    const blocks = [...src.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter((m) => !/src=/i.test(m[1]) && m[2].trim()).map((m) => m[2]);
    if (blocks.length !== 1) die(name + ' has ' + blocks.length + ' inline scripts; expected exactly 1.');
    return blocks[0];
  };
  for (const [rel, source] of CSP_PAGES) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    const block = inlineScript(src, rel);
    // check.html carries a copy of check.js. A stale copy hashes correctly against itself, so the hash alone
    // would not notice that the page is running last week's script.
    if (source) {
      const js = readFileSync(new URL(source, import.meta.url), 'utf8');
      if (block !== '\n' + js) die(rel + ' does not carry the current ' + source + '.');
    }
    const want = 'sha256-' + createHash('sha256').update(block, 'utf8').digest('base64');
    const csp = (src.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1] || '';
    if (!csp.includes("'" + want + "'")) die(rel + ': its CSP does not name the script it carries, so the browser will refuse to run it. Expected ' + want);
  }
});

// One browser for fifty pages is more than this machine will reliably carry: a headless Chromium does not
// hand everything back when a page closes, and somewhere past the fortieth the next newPage cannot be
// allocated and the whole run dies with an error that names whichever test happened to be next. That reads
// like a broken test rather than an exhausted browser, and it cost most of an evening. So the browser is
// recycled every so often. Nothing about what is under test changes; only how much is asked of one process.
const LAUNCH = { headless: true, args: ['--no-sandbox'] };
let browser = await chromium.launch(LAUNCH);
let pagesOpened = 0;
async function freshBrowser() {
  if (++pagesOpened % 10) return;
  try { await browser.close(); } catch (e) {}
  browser = await chromium.launch(LAUNCH);
}

// ---- what was pasted -------------------------------------------------------
await t("check-page: what was pasted", async () => {
  const page = await open(browser, {});
  const kinds = await page.evaluate((addr) => {
    const r = window.__check.readInput;
    return {
      hash: r('0x' + 'ab'.repeat(32)).kind,
      addr: r(addr).kind,
      data: r('0x095ea7b3' + '00'.repeat(64)).kind,
      json: r(JSON.stringify({ to: addr, data: '0x095ea7b3' })).kind,
      url: r('https://explorer.testnet.chain.robinhood.com/tx/0x' + 'cd'.repeat(32)).kind,
      spaced: r('  0x' + 'ab'.repeat(32) + '  ').kind,
      junk: r('hello').kind,
      empty: r('').kind,
    };
  }, NFT);
  check('a transaction hash is recognised', kinds.hash === 'tx', kinds.hash);
  check('an address is recognised', kinds.addr === 'address', kinds.addr);
  check('bare calldata is recognised', kinds.data === 'data', kinds.data);
  check('the JSON a wallet shows is recognised', kinds.json === 'call', kinds.json);
  check('an explorer link is recognised', kinds.url === 'tx', kinds.url);
  check('whitespace around a hash does not matter', kinds.spaced === 'tx', kinds.spaced);
  check('anything else is refused rather than guessed at', kinds.junk === 'bad', kinds.junk);
  await page.close();
});

// ---- the warning that matters most -----------------------------------------
await t("check-page: the warning that matters most", async () => {
  const page = await open(browser, { simLogs: [{ address: TOK, topics: [APPROVAL, '0x' + ME.slice(2).padStart(64, '0'), '0x' + A(0x1111).slice(2).padStart(64, '0')], data: '0x' + 'f'.repeat(64) }] });
  const t = await ask(page, JSON.stringify({ to: TOK, data: '0x095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + 'f'.repeat(64) }), ME);
  check('an unlimited approval is called unlimited', t.includes('unlimited'), t.slice(0, 200));
  check('and is spelled out as a standing permission', /at any point in the future/.test(t), t.slice(0, 300));
  check('and the approval it would grant is listed as a movement', /lets .* spend/.test(t), t.slice(0, 400));
  await page.close();
});

// ---- approving a whole collection ------------------------------------------
await t("check-page: approving a whole collection", async () => {
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify({ to: NFT, data: '0xa22cb465' + A(0x1111).slice(2).padStart(64, '0') + (1).toString().padStart(64, '0') }), ME);
  check('setApprovalForAll says it is the whole collection', /every one you hold now and every one you ever hold/.test(t), t.slice(0, 300));
  await page.close();
});

// ---- a call that would fail ------------------------------------------------
await t("check-page: a call that would fail", async () => {
  const page = await open(browser, { simRevert: '0x7e273289' + (12345).toString(16).padStart(64, '0') });
  const t = await ask(page, JSON.stringify({ to: NFT, data: '0x23b872dd' + ME.slice(2).padStart(64, '0') + A(0x2222).slice(2).padStart(64, '0') + (12345).toString(16).padStart(64, '0') }), ME);
  check('a call that would fail says so before it is signed', t.includes('would fail'), t.slice(0, 200));
  check('and gives the contract’s own reason in words', t.includes('that token id does not exist'), t.slice(0, 400));
  check('and carries the argument the contract complained about', t.includes('12345'), t.slice(0, 400));
  await page.close();
});

// ---- the contract's newest refusals are named, not shown as selectors (round thirteen S-7, twin reader) ----
await t("check-page: the contract's newest refusals are named, not shown as selectors (round thirteen S-7, twin reader)", async () => {
  // selectors from `cast sig`, so the test does not depend on the page's own library to name them
  const cases = [
    ['0x16102772' + NFT.slice(2).padStart(64, '0'), 'NFT collection', 'IsAnNft'],            // IsAnNft(address)
    ['0x21443d13' + TOK.slice(2).padStart(64, '0'), 'does not answer as an NFT collection', 'NotAnNft'],   // NotAnNft(address)
    ['0xb5dfd9e5', 'called BulkSend again', 'Reentered'],                                    // Reentered()
  ];
  for (const [data, words, name] of cases) {
    const page = await open(browser, { simRevert: data });
    const t = await ask(page, JSON.stringify({ to: NFT, data: '0x23b872dd' + ME.slice(2).padStart(64, '0') + A(0x2222).slice(2).padStart(64, '0') + (7).toString(16).padStart(64, '0') }), ME);
    check(name + ' is explained in words', t.includes(words), t.slice(0, 400));
    check(name + ' is not shown as a bare selector', !t.includes(data.slice(0, 10)), t.slice(0, 400));
    await page.close();
  }
});

// ---- powers, read from bytecode when there is no source ---------------------
await t("check-page: powers, read from bytecode when there is no source", async () => {
  const page = await open(browser, {});
  const t = await ask(page, NASTY);
  check('an unverified contract is not treated as unknowable', t.includes('bytecode'), t.slice(0, 200));
  check('a mint function is found in the bytecode', /create new tokens/.test(t), t.slice(0, 400));
  check('so is a blacklist', /block a chosen wallet/.test(t), t.slice(0, 400));
  check('so is a fee setter', /change the fee/.test(t), t.slice(0, 400));
  check('and the page says the source was never published', t.includes('No source has been published'), t.slice(-300));
  await page.close();
});

// ---- a name from a contract is text, never markup ---------------------------
await t("check-page: a name from a contract is text, never markup", async () => {
  const page = await open(browser, {});
  await ask(page, NASTY);
  const html = await page.evaluate(() => document.querySelector('#out').innerHTML);
  check('a token name that looks like markup is rendered as text',
    !html.includes('<img') && html.includes('&lt;img'), html.slice(0, 200));
  await page.close();
});

// ---- a proxy is not the code it runs ----------------------------------------
await t("check-page: a proxy is not the code it runs", async () => {
  const page = await open(browser, {});
  const t = await ask(page, PROXY);
  check('a minimal proxy is flagged as replaceable code', t.includes('proxy'), t.slice(0, 200));
  check('and names the contract it forwards to', t.toLowerCase().includes(IMPL.slice(2, 10).toLowerCase()), t.slice(0, 300));
  await page.close();
});

// ---- a delegated wallet is still a wallet ------------------------------------
await t("check-page: a delegated wallet is still a wallet", async () => {
  const page = await open(browser, {});
  const t = await ask(page, WALLET);
  check('an EIP-7702 wallet is called a wallet, not a contract', t.includes('wallet running delegated code'), t.slice(0, 200));
  await page.close();
});

// ---- a verified contract reads from its source -------------------------------
await t("check-page: a verified contract reads from its source", async () => {
  const verified = {};
  verified[NFT] = { is_verified: true, name: 'Test Collection', compiler_version: 'v0.8.24', optimization_enabled: true, abi: [
    { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'id', type: 'uint256' }] },
    { type: 'function', name: 'transferFrom', stateMutability: 'nonpayable', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'tokenId', type: 'uint256' }] },
    { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }] },
  ] };
  const page = await open(browser, { verified });
  const t = await ask(page, NFT);
  check('a verified contract says its source is published', t.includes('source published'), t.slice(0, 200));
  check('and its powers are read from that source', t.includes('the published source'), t.slice(0, 400));
  check('while a read-only function is not called a power', !/balanceOf/.test(t), t.slice(0, 400));
  await page.close();
});

// ---- an ordinary transaction reads back as English ---------------------------
await t("check-page: an ordinary transaction reads back as English", async () => {
  const tx = { hash: '0x' + 'cd'.repeat(32), from: ME, to: NFT, input: '0x23b872dd' + ME.slice(2).padStart(64, '0') + A(0x2222).slice(2).padStart(64, '0') + (7).toString(16).padStart(64, '0'), value: '0x0', gas: '0x5208', gasPrice: '0x989680', nonce: '0x1', blockHash: '0x' + '11'.repeat(32), blockNumber: '0x1000', transactionIndex: '0x0', type: '0x2', chainId: '0xb626', maxFeePerGas: '0x989680', maxPriorityFeePerGas: '0x0', accessList: [], v: '0x1', r: '0x' + '11'.repeat(32), s: '0x' + '22'.repeat(32) };
  const receipt = { transactionHash: tx.hash, transactionIndex: '0x0', blockHash: tx.blockHash, blockNumber: '0x1000', from: ME, to: NFT, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x989680', contractAddress: null, logsBloom: '0x' + '00'.repeat(256), status: '0x1', type: '0x2',
    logs: [{ address: NFT, topics: [TRANSFER, topicAddr(ME), topicAddr(A(0x2222)), word(7)], data: '0x', blockNumber: '0x1000', transactionHash: tx.hash, transactionIndex: '0x0', blockHash: tx.blockHash, logIndex: '0x0', removed: false }] };
  const page = await open(browser, { tx, receipt });
  const t = await ask(page, tx.hash, ME);
  check('a sent transaction is described in a sentence', /Move Test Collection #7 from/.test(t), t.slice(0, 200));
  check('and what moved is read out of the receipt', /TC #7 goes from/.test(t), t.slice(0, 400));
  check('and it is marked as leaving the reader’s wallet', t.includes('out of your wallet'), t.slice(0, 400));
  check('and the gas actually paid is shown', /Gas paid/.test(t), t.slice(0, 500));
  await page.close();
});

// ---- an explorer that will not answer is not a contract without a source ----
await t("check-page: an explorer that will not answer is not a contract without a source", async () => {
  const page = await open(browser, { explorerSick: true });
  const t = await ask(page, NFT, null, 9000);
  check('an unreachable explorer is never reported as "no source published"',
    !t.includes('no source published') && !t.includes('No source has been published'), t.slice(0, 260));
  check('and the page says plainly that it could not check',
    t.includes('could not check for a published source'), t.slice(0, 260));
  check('while everything readable from the chain is still shown', t.includes('Code size'), t.slice(0, 400));
  await page.close();
});

// ---- H-02: a name is not a behaviour, and no match proves nothing ----------------
await t("check-page: H-02: a name is not a behaviour, and no match proves nothing", async () => {
  const verified = {};
  verified[NASTY] = { is_verified: true, name: 'Quiet', compiler_version: 'v0.8.24', abi: [
    { type: 'function', name: 'rebalance', stateMutability: 'nonpayable', inputs: [{ name: 'victim', type: 'address' }, { name: 'amount', type: 'uint256' }] },
    { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }] },
  ] };
  const page = await open(browser, { verified });
  const t = await ask(page, NASTY);
  check('H-02 the page never claims a contract cannot mint, pause, block or be replaced',
    !/Nothing in .* lets anyone/.test(t), t.slice(0, 300));
  check('H-02 it says what the section actually is', t.includes('What this section is, and is not'), t.slice(0, 400));
  check('H-02 and that nothing matching is not the same as nothing to find',
    /not that there is nothing to find/.test(t), t.slice(0, 500));
  await page.close();
});

// ---- H-02: behind a proxy, the code that runs is what gets read ------------------
await t("check-page: H-02: behind a proxy, the code that runs is what gets read", async () => {
  const verified = {};
  verified[PROXY] = { is_verified: true, name: 'Forwarder', abi: [
    { type: 'function', name: 'harmless', stateMutability: 'view', inputs: [] },
  ] };
  verified[IMPL] = { is_verified: true, name: 'TheRealCode', abi: [
    { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'id', type: 'uint256' }] },
  ] };
  const page = await open(browser, { verified });
  const t = await ask(page, PROXY);
  check('H-02 a proxy is read through to the implementation, not stopped at the forwarder',
    /create new tokens/.test(t), t.slice(0, 400));
  check('H-02 and the page says where it read from', t.includes('implementation'), t.slice(0, 400));
  await page.close();
});

// ---- H-02: partial verification is incomplete evidence ---------------------------
await t("check-page: H-02: partial verification is incomplete evidence", async () => {
  const verified = {};
  verified[NFT] = { is_verified: true, is_partially_verified: true, name: 'Partly', abi: [{ type: 'function', name: 'harmless', stateMutability: 'view', inputs: [] }] };
  const page = await open(browser, { verified });
  const t = await ask(page, NFT);
  check('H-02 partial verification is called out as incomplete', /only partially verified/.test(t), t.slice(0, 400));
  await page.close();
});

// ---- H-03: silence is not proof that nothing moved -------------------------------
await t("check-page: H-03: silence is not proof that nothing moved", async () => {
  const page = await open(browser, { simLogs: [] });
  const t = await ask(page, JSON.stringify({ to: NFT, data: '0x23b872dd' + ME.slice(2).padStart(64, '0') + A(0x2222).slice(2).padStart(64, '0') + (7).toString(16).padStart(64, '0') }), ME);
  check('H-03 an empty log set is never reported as "nothing moves"', !/No tokens and no ETH move/.test(t), t.slice(0, 300));
  check('H-03 and the page says a token could move without announcing it',
    /without announcing it/.test(t), t.slice(0, 500));
  await page.close();
});

// ---- H-03: what is shown is what the contract announced --------------------------
await t("check-page: H-03: what is shown is what the contract announced", async () => {
  const page = await open(browser, { simLogs: [{ address: TOK, topics: [TRANSFER, topicAddr(ME), topicAddr(A(0x2222))], data: word(100) }] });
  const t = await ask(page, JSON.stringify({ to: TOK, data: '0xa9059cbb' + A(0x2222).slice(2).padStart(64, '0') + word(100).slice(2) }), ME);
  check('H-03 the movement section is named for what it holds: announcements',
    /announce moving/.test(t), t.slice(0, 300));
  await page.close();
});

// ---- M-05: a transaction with no receipt has unknown movements -------------------
await t("check-page: M-05: a transaction with no receipt has unknown movements", async () => {
  const tx = { hash: '0x' + 'cd'.repeat(32), from: ME, to: NFT, input: '0x23b872dd' + ME.slice(2).padStart(64, '0') + A(0x2222).slice(2).padStart(64, '0') + (7).toString(16).padStart(64, '0'), value: '0x0', gas: '0x5208', gasPrice: '0x989680', nonce: '0x1', blockHash: null, blockNumber: null, transactionIndex: null, type: '0x2', chainId: '0xb626', maxFeePerGas: '0x989680', maxPriorityFeePerGas: '0x0', accessList: [], v: '0x1', r: '0x' + '11'.repeat(32), s: '0x' + '22'.repeat(32) };
  const page = await open(browser, { tx, receipt: null });
  const t = await ask(page, tx.hash, ME);
  check('M-05 a pending transaction is not described as having moved nothing',
    !/No tokens and no ETH move/.test(t) && !/No standard transfer or approval events/.test(t), t.slice(0, 300));
  check('M-05 it says the movements are unknown until it is mined',
    /has not been mined/.test(t), t.slice(0, 400));
  await page.close();
});

// ---- M-01: a slow answer never lands on top of a newer question ------------------
await t("check-page: M-01: a slow answer never lands on top of a newer question", async () => {
  const verified = {};
  verified[NASTY] = { is_verified: true, name: 'SlowOne', abi: [{ type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }] }] };
  verified[WALLET] = { is_verified: false };
  const page = await open(browser, { verified, slowFor: NASTY, slowMs: 4000 });
  await page.fill('#input', NASTY);
  await page.click('#go');
  await page.waitForTimeout(400);
  await page.fill('#input', TOK);
  await page.evaluate(() => { const b = document.querySelector('#go'); b.disabled = false; b.click(); });
  await page.waitForTimeout(7000);
  const t = (await page.textContent('#out')) || '';
  check('M-01 the answer on screen belongs to the question in the box',
    !t.includes('SlowOne') && t.toLowerCase().includes(TOK.slice(-6).toLowerCase()) && !t.toLowerCase().includes(NASTY.slice(-6).toLowerCase()),
    t.slice(0, 300));
  await page.close();
});

// ---- T-H-03: a batch is a batch, and the dangerous call is rarely the first -----
await t("check-page: T-H-03: a batch is a batch, and the dangerous call is rarely the first", async () => {
  const page = await open(browser, {});
  const approval = '0x095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + 'f'.repeat(64);
  const t = await ask(page, JSON.stringify([
    { to: NFT, data: '0x06fdde03' },
    { to: TOK, data: approval },
  ]), ME, 6000);
  check('T-H-03 every call in a pasted batch is read, not just the first',
    /call 2 of 2/i.test(t), t.slice(0, 300));
  check('T-H-03 and the unlimited approval hiding in the second one is called out',
    /unlimited approval/i.test(t), t.slice(0, 500));
  check('T-H-03 with the batch itself named as a batch', /2 calls, not one/.test(t), t.slice(0, 200));
  await page.close();
});

// ---- T-H-03: bytes nobody is shown -----------------------------------------------
await t("check-page: T-H-03: bytes nobody is shown", async () => {
  const page = await open(browser, {});
  const approval = '0x095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + word(5).slice(2);
  const t = await ask(page, JSON.stringify({ to: TOK, data: approval + word(999).slice(2) }), ME, 6000);
  check('T-H-03 trailing bytes beyond the decoded arguments are reported',
    /32 bytes nobody is shown/.test(t), t.slice(0, 400));
  check('T-H-03 and the raw call is always available', /raw call, exactly as it would be sent/.test(t), t.slice(0, 500));
  await page.close();
});

// ---- T-H-03: calls carried inside calls ------------------------------------------
await t("check-page: T-H-03: calls carried inside calls", async () => {
  const page = await open(browser, {});
  const inner = await page.evaluate(([spender]) => {
    const iface = new window.ethers.Interface(['function approve(address,uint256)', 'function multicall(bytes[])']);
    const a = iface.encodeFunctionData('approve', [spender, (1n << 256n) - 1n]);
    return iface.encodeFunctionData('multicall', [[a]]);
  }, [A(0x1111)]);
  const t = await ask(page, JSON.stringify({ to: TOK, data: inner }), ME, 6000);
  check('T-H-03 a call carried inside a multicall is decoded, not shown as hex',
    /Calls carried inside this one/.test(t), t.slice(0, 300));
  check('T-H-03 and an unlimited approval one level down still gets its warning',
    /inner call is an unlimited approval/.test(t), t.slice(0, 600));
  await page.close();
});

// ---- H-04: a read that failed is not a read that came back empty -----------------
await t("check-page: H-04: a read that failed is not a read that came back empty", async () => {
  const page = await open(browser, { codeUnreadable: [NASTY] });
  const t = await ask(page, NASTY, null, 5000);
  check('H-04 an unreadable code read is never called an ordinary wallet', !/ordinary wallet/.test(t), t.slice(0, 260));
  check('H-04 it says the chain would not answer', /could not read the code/.test(t), t.slice(0, 300));
  await page.close();
});

// ---- H-04: and the same on a call, where the wrong answer is an all-clear --------
await t("check-page: H-04: and the same on a call, where the wrong answer is an all-clear", async () => {
  const page = await open(browser, { codeUnreadable: [NASTY] });
  const t = await ask(page, JSON.stringify({ to: NASTY, data: '0x095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + 'f'.repeat(64) }), ME, 6000);
  check('H-04 a call to an unreadable address is not described as doing nothing',
    !/There is no contract at that address/.test(t), t.slice(0, 300));
  check('H-04 and the unknown is stated where the answer is', /could not be read/.test(t), t.slice(0, 400));
  await page.close();
});

// ---- H-05: a limit that hides things has to say so ------------------------------
await t("check-page: H-05: a limit that hides things has to say so", async () => {
  const page = await open(browser, {});
  const deep = await page.evaluate(([spender]) => {
    const iface = new window.ethers.Interface(['function approve(address,uint256)', 'function multicall(bytes[])']);
    let d = iface.encodeFunctionData('approve', [spender, (1n << 256n) - 1n]);
    for (let i = 0; i < 8; i++) d = iface.encodeFunctionData('multicall', [[d]]);
    return d;
  }, [A(0x1111)]);
  const t = await ask(page, JSON.stringify({ to: TOK, data: deep }), ME, 10000);
  check('H-05 calls nested past the limit are reported as not shown, never dropped', /are NOT shown/.test(t), t.slice(0, 400));
  await page.close();
});

// ---- H-05: an entry with no destination is still part of the request -------------
await t("check-page: H-05: an entry with no destination is still part of the request", async () => {
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify([{ to: NFT, data: '0x06fdde03' }, { input: '0x60806040', value: '0x0' }]), ME, 6000);
  check('H-05 a request entry with no destination is shown, not silently dropped',
    /2 calls, not one/.test(t) && /no destination this page can read/.test(t), t.slice(0, 400));
  await page.close();
});

// ---- M-01: the sentence says what it is a reading of ----------------------------
await t("check-page: M-01: the sentence says what it is a reading of", async () => {
  const verified = {};
  verified[NFT] = { is_verified: true, name: 'Test Collection', abi: [
    { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'tokenId', type: 'uint256' }] },
  ] };
  const page = await open(browser, { verified });
  const t = await ask(page, JSON.stringify({ to: NFT, data: '0x095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + word(1).slice(2) }), ME, 6000);
  check('M-01 the plain-English sentence is labelled as a convention, next to itself', /conventionally mean/.test(t), t.slice(0, 400));
  check('M-01 and the page does not claim to have read the code', !/decoded from the contract/.test(t), t.slice(0, 400));
  await page.close();
});

// ---- M-02: a proxy is not decoded against the forwarder's ABI -------------------
await t("check-page: M-02: a proxy is not decoded against the forwarder's ABI", async () => {
  const verified = {};
  verified[PROXY] = { is_verified: true, name: 'Forwarder', abi: [
    { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }] },
  ] };
  const page = await open(browser, { verified });   // the implementation has no explorer entry, so no ABI
  const t = await ask(page, PROXY, null, 6000);
  check('M-02 a proxy whose implementation published nothing does not borrow the forwarder source',
    /the code it runs has published no source/.test(t) && !/source published and matched/.test(t), t.slice(0, 500));
  await page.close();
});

// ---- H-05: the shape a wallet actually shows you --------------------------------
await t("check-page: H-05: the shape a wallet actually shows you", async () => {
  const page = await open(browser, {});
  const approval = '0x095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + 'f'.repeat(64);
  const t = await ask(page, JSON.stringify({
    method: 'wallet_sendCalls',
    params: [{ version: '2.0.0', chainId: '0xb626', from: ME, atomicRequired: true,
               calls: [{ to: NFT, data: '0x06fdde03' }, { to: TOK, data: approval }] }],
  }), ME, 7000);
  check('H-05 a canonical wallet_sendCalls request is read as the batch it is',
    /2 calls, not one/.test(t), t.slice(0, 300));
  check('H-05 and the approval buried in its second call is found',
    /unlimited approval/i.test(t), t.slice(0, 600));
  await page.close();
});

// ---- M-01: a call in a batch is disclosed like a call on its own -----------------
await t("check-page: M-01: a call in a batch is disclosed like a call on its own", async () => {
  const page = await open(browser, { codeUnreadable: [NASTY] });
  const t = await ask(page, JSON.stringify([{ to: NFT, data: '0x06fdde03' }, { to: NASTY, data: '0x095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + 'f'.repeat(64) }]), ME, 8000);
  check('M-01 an unreadable destination inside a batch is reported there too',
    /could not be read/.test(t), t.slice(0, 500));
  check('M-01 and the raw call is available for every element', /raw call/.test(t), t.slice(0, 500));
  await page.close();
});

// ---- M-02: a beacon that will not answer is not the implementation ---------------
await t("check-page: M-02: a beacon that will not answer is not the implementation", async () => {
  const beacon = A(0xbea);
  const page = await open(browser, { beaconProxy: beacon, beaconSilent: true });
  const t = await ask(page, NASTY, null, 6000);
  check('M-02 a silent beacon leaves the implementation unknown rather than standing in for it',
    /beacon would not name the code/.test(t), t.slice(0, 500));
  await page.close();
});

// ---- B-03: a request naming another chain is refused, not answered about this one ----
await t("check-page: B-03: a request naming another chain is refused, not answered about this one", async () => {
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify({
    method: 'wallet_sendCalls',
    params: [{ version: '2.0.0', chainId: '0x1237', from: ME, atomicRequired: true,
               calls: [{ to: NFT, data: '0x06fdde03' }] }],
  }), ME, 5000);
  check('B-03 a request for another chain is refused rather than answered from this one',
    /for a different network/.test(t), t.slice(0, 300));
  check('B-03 and nothing about the address is presented', !/Test Collection/.test(t), t.slice(0, 300));
  await page.close();
});

// ---- B-03/B-04: on the right chain it runs, in order, and says which -------------
await t("check-page: B-03/B-04: on the right chain it runs, in order, and says which", async () => {
  const page = await open(browser, { sequenceFailsAt: 1 });
  const t = await ask(page, JSON.stringify({
    method: 'wallet_sendCalls',
    params: [{ version: '2.0.0', chainId: '0xb626', from: ME, atomicRequired: true,
               calls: [{ to: NFT, data: '0x06fdde03' }, { to: TOK, data: '0x06fdde03' }] }],
  }), ME, 7000);
  check('B-04 a batch is run in order and a call that only fails in sequence is caught',
    /run in order, call 2 fails/i.test(t), t.slice(0, 400));
  check('B-04 and all-or-nothing is spelled out', /none of it would happen/i.test(t), t.slice(0, 500));
  await page.close();
});

// ---- B-02: two requests, two chains, judged separately ---------------------------
await t("check-page: B-02: two requests, two chains, judged separately", async () => {
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify([
    { method: 'wallet_sendCalls', params: [{ chainId: '0x1237', from: A(0x1111), atomicRequired: true, calls: [{ to: NFT, data: '0x06fdde03' }] }] },
    { method: 'wallet_sendCalls', params: [{ chainId: '0xb626', from: A(0x2222), atomicRequired: false, calls: [{ to: TOK, data: '0x06fdde03' }] }] },
  ]), ME, 8000);
  check('B-02 two requests are not merged into one', /2 separate requests/.test(t), t.slice(0, 300));
  check('B-02 the one for another chain is refused on its own terms',
    /Request 1 of 2: this request is for a different network/.test(t), t.slice(0, 500));
  check('B-02 while the one for this chain is still read', /Request 2 of 2/.test(t), t.slice(0, 600));
  await page.close();
});

// ---- B-03: the sender that is simulated is the sender that is described ----------
await t("check-page: B-03: the sender that is simulated is the sender that is described", async () => {
  // the mock records every `from` the page asks the node to simulate as, on this object
  const seen = {};
  const page = await open(browser, seen);
  await page.fill('#input', JSON.stringify([{ to: NFT, data: '0x06fdde03' }, { to: TOK, data: '0x06fdde03' }]));
  await page.fill('#from', ME);
  await page.click('#go'); await page.waitForTimeout(7000);
  const senders = seen.__senders || [];
  check('B-03 the ordered simulation is run as the sender in the box',
    senders.length > 0 && senders.every((f) => String(f).toLowerCase() === '0x000000000000000000000000000000000000dead'),
    JSON.stringify(senders.slice(0, 4)));
  await page.close();
});

// ---- B-04: no all-calls verdict when a call could not be included ----------------
await t("check-page: B-04: no all-calls verdict when a call could not be included", async () => {
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify([{ to: NFT, data: '0x06fdde03' }, { input: '0x60806040', value: '0x0' }]), ME, 7000);
  check('B-04 an unsimulatable entry withholds the all-calls verdict',
    !/every call succeeds/i.test(t), t.slice(0, 400));
  check('B-04 and says why the sequence cannot be judged',
    /cannot be checked as a sequence/.test(t), t.slice(0, 400));
  await page.close();
});

// ---- B-01: a call cannot name its own sender in a wallet_sendCalls request -------
await t("check-page: B-01: a call cannot name its own sender in a wallet_sendCalls request", async () => {
  const seen = {};
  const page = await open(browser, seen);
  await page.fill('#input', JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'wallet_sendCalls',
    params: [{ chainId: '0xb626', from: A(0x1111), calls: [{ to: NFT, from: A(0x2222), data: '0x06fdde03' }] }],
  }));
  await page.click('#go'); await page.waitForTimeout(7000);
  const senders = (seen.__senders || []).map((x) => String(x).toLowerCase());
  check('B-01 the request\'s sender is used, not the one written on the call',
    senders.length > 0 && senders.every((f) => f === A(0x1111).toLowerCase()), JSON.stringify(senders.slice(0, 3)));
  check('B-01 and the contradiction is pointed out',
    /contradicts itself about who sends it/.test(await page.textContent('#out')), (await page.textContent('#out')).slice(0, 300));
  await page.close();
});

// ---- round 14 B-03: an unread top-level request taints the whole pasted set -------
await t("check-page: round 14 B-03: an unread top-level request taints the whole pasted set", async () => {
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify([
    { jsonrpc: '2.0', id: 1, method: 'personal_sign', params: ['0xdead', ME] },
    { jsonrpc: '2.0', id: 2, method: 'wallet_sendCalls', params: [{ version: '2.0.0', chainId: '0xb626',
      from: ME, atomicRequired: true, calls: [{ to: NFT, data: '0x06fdde03' }] }] },
  ]), ME, 7000);
  check('round-14 B-03 the unsupported first request is preserved at its original position',
    /Request 1 of 2: `personal_sign` is a method this page does not read/.test(t), t.slice(0, 600));
  check('round-14 B-03 the accepted second request keeps its original numbering',
    /Request 2 of 2:/.test(t), t.slice(0, 700));
  check('round-14 B-03 the accepted subset is qualified and the pasted set gets no green verdict',
    /Request 2 of 2: run in order, every call succeeds — as read here/.test(t)
      && /no result below is a verdict on the pasted set/.test(t), t.slice(0, 1000));
  await page.close();
});

// ---- round 15 B-03: one JSON-RPC transaction keeps its own sender ----------------
await t("check-page: round 15 B-03: one JSON-RPC transaction keeps its own sender", async () => {
  const seen = {};
  const page = await open(browser, seen);
  const declared = A(0x1111), ui = A(0x2222);
  const t = await ask(page, JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'eth_sendTransaction',
    params: [{ from: declared, to: NFT, data: '0x06fdde03' }],
  }), ui, 7000);
  const senders = (seen.__senders || []).map((x) => String(x).toLowerCase());
  check('round-15 B-03 a single transaction is simulated as its declared sender',
    senders.length > 0 && senders.every((x) => x === declared.toLowerCase()), JSON.stringify(senders));
  check('round-15 B-03 the single transaction surfaces the sender mismatch and says the request wins',
    /request names a different sender than the box/.test(t) && /request wins/.test(t), t.slice(0, 800));
  await page.close();
});
await t("check-page: round-15 B-03 an unreadable explicit sender is surfaced for a single transaction", async () => {
  const seen = {};
  const page = await open(browser, seen);
  const t = await ask(page, JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'eth_sendTransaction',
    params: [{ from: 'not-an-address', to: NFT, data: '0x06fdde03' }],
  }), ME, 7000);
  check('round-15 B-03 an unreadable explicit sender is surfaced for a single transaction',
    /names a sender that is not an address/.test(t), t.slice(0, 700));
  check('round-15 B-03 an unreadable explicit sender receives no unqualified favorable verdict',
    // No trailing \b: adjacent spans flatten to 'would succeedabout …', which a word boundary never matches, so
    // the negative check passed even with the pill present (round sixteen S-01).
    !/would succeed/.test(t) && !/run in order, every call succeeds(?! — as read here)/.test(t), t.slice(0, 900));
  await page.close();
});

// ---- B-02: separate transactions are not one sequence ---------------------------
await t("check-page: B-02: separate transactions are not one sequence", async () => {
  const seen = {};
  const page = await open(browser, seen);
  await page.fill('#input', JSON.stringify([
    { jsonrpc: '2.0', id: 1, method: 'eth_sendTransaction', params: [{ from: A(0x1111), to: NFT, data: '0x06fdde03' }] },
    { jsonrpc: '2.0', id: 2, method: 'eth_sendTransaction', params: [{ from: A(0x2222), to: TOK, data: '0x06fdde03' }] },
  ]));
  await page.click('#go'); await page.waitForTimeout(8000);
  const t = await page.textContent('#out');
  check('B-02 two separate transactions are read as two, not as one sequence',
    /2 separate requests/.test(t), t.slice(0, 300));
  const together = (seen.__simBatches || []).some((n) => n > 1);
  check('B-02 and they are never simulated together', !together, JSON.stringify(seen.__simBatches));
  await page.close();
});

// ---- B-03: not required to be atomic is not a promise that earlier calls survive --
await t("check-page: B-03: not required to be atomic is not a promise that earlier calls survive", async () => {
  const page = await open(browser, { sequenceFailsAt: 1 });
  const t = await ask(page, JSON.stringify({
    method: 'wallet_sendCalls',
    params: [{ chainId: '0xb626', from: ME, atomicRequired: false, calls: [{ to: NFT, data: '0x06fdde03' }, { to: TOK, data: '0x06fdde03' }] }],
  }), ME, 8000);
  check('B-03 a non-atomic batch does not promise the earlier calls happen',
    !/would still happen/.test(t), t.slice(0, 400));
  check('B-03 it states the range instead', /is not settled/.test(t), t.slice(0, 500));
  await page.close();
});

// ---- S-03: a chain id that cannot be read is not "no chain named" ----------------
await t("check-page: S-03: a chain id that cannot be read is not \"no chain named\"", async () => {
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify({
    method: 'wallet_sendCalls',
    params: [{ chainId: 'not-a-number', from: ME, calls: [{ to: NFT, data: '0x06fdde03' }] }],
  }), ME, 6000);
  check('S-03 an unreadable chain id refuses rather than defaulting to this page\'s network',
    /names a network that cannot be read/.test(t), t.slice(0, 300));
  await page.close();
});

// ---- S-01: a near-miss request is not tidied into a clean answer -----------------
// A wallet may refuse anything that does not match the EIP-5792 schema, so a page that coerces the value into
// something readable is describing a request that will not necessarily run, in the voice it uses for ones
// that will. Each of these is the auditor's own input.
await t("check-page: S-01: a near-miss request is not tidied into a clean answer", async () => {
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify({
    method: 'wallet_sendCalls',
    params: [{ version: '2.0.0', chainId: '0xb626', from: ME, atomicRequired: 'false',
               calls: [{ to: NFT, data: '0x06fdde03' }, { to: TOK, data: '0x06fdde03' }] }],
  }), ME, 7000);
  check('S-01 atomicRequired as the string "false" is not read as true',
    /does not say whether this is all-or-nothing/.test(t) && !/all of it, or none of it/.test(t), t.slice(0, 500));
  check('S-01 and the request is named as one a wallet may refuse',
    /not a valid wallet_sendCalls request/.test(t), t.slice(0, 400));
  await page.close();
});
await t("check-page: S-01 a numeric chainId is not accepted in place of the required hex string", async () => {
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify({
    method: 'wallet_sendCalls',
    params: [{ chainId: 46630, from: ME, atomicRequired: true, calls: [{ to: NFT, data: '0x06fdde03' }] }],
  }), ME, 6000);
  check('S-01 a numeric chainId is not accepted in place of the required hex string',
    /names a network that cannot be read/.test(t), t.slice(0, 400));
  check('S-01 and nothing about the destination is presented',
    !/Test/.test(t), t.slice(0, 400));
  await page.close();
});
await t("check-page: S-01 a broken member of a pasted list is named by its position, not skipped", async () => {
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify([{ to: NFT, data: '0x06fdde03' }, null, 'junk']), ME, 7000);
  check('S-01 a broken member of a pasted list is named by its position, not skipped',
    /Entry 2 of that JSON is null/.test(t) && /Entry 3 of that JSON is the text "junk"/.test(t), t.slice(0, 500));
  check('S-01 and the page says what is shown is not all of what was pasted',
    /not the whole of what was pasted/.test(t), t.slice(0, 500));
  await page.close();
});
await t("check-page: the same thing one level down, where the list is the request's own calls array", async () => {
  // the same thing one level down, where the list is the request's own calls array
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify({
    method: 'wallet_sendCalls',
    params: [{ version: '2.0.0', chainId: '0xb626', from: ME, atomicRequired: true,
               calls: [{ to: NFT, data: '0x06fdde03' }, null, 'junk'] }],
  }), ME, 7000);
  check('S-01 a broken call is kept at its own index inside a request',
    /3 calls, not one/.test(t) && /call 2 of 3/.test(t) && /call 3 of 3/.test(t), t.slice(0, 600));
  check('S-01 and it says what each one was instead of a call',
    /could not be read as a call/.test(t) && /Entry 2 is null, not a call/.test(t), t.slice(0, 1200));
  check('S-01 so no verdict is offered for the sequence',
    !/every call succeeds/.test(t) && /cannot be checked as a sequence/.test(t), t.slice(0, 900));
  await page.close();
});

// ---- B-03 (round ten): a request is not read until every normative field is read ---------------
// The round-nine schema check was partial, which is worse than absent: it made the page look like it had read
// a request it had only skimmed. This is the auditor's exact input.
await t("check-page: B-03 (round ten): a request is not read until every normative field is read", async () => {
  const page = await open(browser, {});
  const r = await page.evaluate(() => {
    const j = { method: 'wallet_sendCalls', params: [{ chainId: '0xb626', atomicRequired: true, id: 7,
      capabilities: 'not-an-object', calls: [{ to: '0x1111111111111111111111111111111111111111',
      data: '0x', value: '1', capabilities: 'not-an-object' }] }] };
    const o = window.__check.readInput(JSON.stringify(j));
    const q = (o.requests || [])[0] || {};
    return { problems: q.schemaProblems || [], caps: q.capabilities, id: q.requestId,
             value: (q.calls || [{}])[0].value, callCaps: (q.calls || [{}])[0].capabilities };
  });
  const all = r.problems.join(' | ');
  check('B-03 a missing version is a missing required field', /names no version/.test(all), all.slice(0, 200));
  check('B-03 an id that is not a string is reported', /id is 7 rather than a string/.test(all), all.slice(0, 200));
  check('B-03 request capabilities that are not an object are reported',
    /capabilities is the text "not-an-object"/.test(all), all.slice(0, 240));
  check('B-03 a decimal value is not read as a hex quantity',
    /value of the text "1"/.test(all) && r.value === undefined, all.slice(0, 240) + ' value=' + r.value);
  check('B-03 call capabilities that are not an object are reported',
    /Call 1 has capabilities/.test(all), all.slice(0, 240));
  check('B-03 capabilities are kept for display, not silently dropped',
    r.caps === 'not-an-object' && r.callCaps === 'not-an-object', JSON.stringify([r.caps, r.callCaps]));
  check('B-03 and the id is kept too', r.id === 7, JSON.stringify(r.id));
  await page.close();
});
// ---- and a request carrying capabilities gets no whole-request verdict ------------------------
await t("check-page: and a request carrying capabilities gets no whole-request verdict", async () => {
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify({ method: 'wallet_sendCalls', params: [{ version: '2.0.0',
    chainId: '0xb626', from: ME, atomicRequired: true, capabilities: { paymasterService: { url: 'https://x' } },
    calls: [{ to: NFT, data: '0x06fdde03' }, { to: TOK, data: '0x06fdde03' }] }] }), ME, 8000);
  check('a capability this page cannot read is named rather than ignored',
    /capabilities this page does not read/.test(t) && /paymasterService/.test(t), t.slice(0, 400));
  check('and it says what a capability can change',
    /permitted to do something other than the ordinary thing/.test(t), t.slice(0, 500));
  check('the all-calls verdict is withheld while part of the request is unread',
    !/^.*run in order, every call succeeds(?!.*as read here)/.test(t) || /as read here/.test(t), t.slice(0, 500));
  check('and it says plainly that this is not a verdict on the request',
    !/every call succeeds/.test(t) || /not a verdict on the request/.test(t), t.slice(0, 600));
  await page.close();
});

// ---- round eleven, the four blocking findings on this page ---------------------------------------------
// Each of these was answered confidently and wrongly, in the sentence a non-technical reader actually reads.
await t("check-page: round eleven, the four blocking findings on this page", async () => {
  const MAXW = 'f'.repeat(64);
  const approveMax = '095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + MAXW;

  // B-2: an unlimited approve that lost its 0x was answered "No calldata: this is a plain transfer of ETH",
  // in green. `data` was replaced with '0x' and the page simulated bytes that were never in the box.
  {
    const page = await open(browser, {});
    const t = await ask(page, JSON.stringify({ to: TOK, data: approveMax }), ME, 3500);
    check('B-2 calldata that is not readable hex is never reported as no calldata',
      !/No calldata: this is a plain transfer of ETH/.test(t), t.slice(0, 200));
    check('B-2 and it gets no verdict, because nothing was simulated', !/would succeed/.test(t), t.slice(0, 200));
    check('B-2 and the page says what is wrong with it',
      /not whole bytes of hex/.test(t), t.slice(0, 300));
    await page.close();
  }

  // B-4: the chain a request names is part of what it means. It was listed as a field the page knows and
  // then read by nobody, so a request for chain 1 was answered in full against 46630.
  {
    const page = await open(browser, {});
    const t = await ask(page, JSON.stringify({ method: 'eth_sendTransaction',
      params: [{ from: ME, to: TOK, data: '0x' + approveMax, chainId: '0x1' }] }), ME, 3500);
    check('B-4 a request naming another chain is refused, not answered', !/would succeed/.test(t), t.slice(0, 200));
    check('B-4 and the refusal names the chainId it carried and the one this page is set to',
      /different network/.test(t) && /0x1\b/.test(t) && /46630/.test(t), t.slice(0, 320));
    await page.close();
  }

  // B-3: a node that returns the receipt but not the transaction. `{empty:true}` is this page's word for
  // "carried no calldata", and it was being used for "could not be read", which is the opposite.
  {
    const h3 = '0x' + 'ab'.repeat(32);
    const page = await open(browser, { tx: null, receipt: {
      transactionHash: h3, transactionIndex: '0x0', blockHash: '0x' + '11'.repeat(32), blockNumber: '0x1000',
      from: ME, to: TOK, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x989680',
      contractAddress: null, logsBloom: '0x' + '00'.repeat(256), status: '0x1', type: '0x2', logs: [] } });
    const t = await ask(page, h3, ME, 3500);
    check('B-3 the page answers at all, rather than throwing and rendering nothing', t.length > 40, JSON.stringify(t.slice(0, 80)));
    check('B-3 a transaction whose body could not be read is never called a plain transfer of ETH',
      !/plain transfer of ETH/.test(t), t.slice(0, 300));
    check('B-3 and the page says the body is what is missing',
      /receipt for that transaction but not the transaction itself/.test(t), t.slice(0, 300));
    check('B-3 and it does not invent a destination it never read', !/a new contract/.test(t), t.slice(0, 300));
    check('B-3 and the verdict narrows to what a receipt can prove',
      !/succeeded/.test(t) || /executed without reverting/.test(t), t.slice(0, 300));
    await page.close();
  }

  // B-5: three states reduced to two. `standard` is null when supportsInterface and decimals both go
  // unanswered, and null was folded in with "not an NFT", so the ERC-20 sentence got written for a contract
  // nobody had established was one -- while the argument labels beside it said "token id or amount".
  {
    const page = await open(browser, {});
    const t = await ask(page, JSON.stringify({ to: MYSTERY,
      data: '0x095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + '1'.padStart(64, '0') }), ME, 3500);
    const lede = t.split('The arguments')[0] || t;
    check('B-5 an unsettled standard is not written up as an ERC-20 allowance',
      !/spend 1 of your/.test(lede), lede.slice(0, 260));
    check('B-5 and the sentence uses the same words its own argument labels use',
      /token id or amount/.test(lede), lede.slice(0, 260));
    await page.close();
  }
  {
    const page = await open(browser, {});
    const t = await ask(page, JSON.stringify({ to: MYSTERY, data: '0x23b872dd'
      + ME.slice(2).padStart(64, '0') + A(0x2222).slice(2).padStart(64, '0') + '7'.padStart(64, '0') }), ME, 3500);
    check('B-5 and a transferFrom on one is not read as an amount either',
      /token id or amount/.test(t.split('The arguments')[0] || t), t.slice(0, 260));
    await page.close();
  }
});

await browser.close();
console.log('\n' + summaryLine(pass, fail));
process.exit(fail ? 1 : 0);
