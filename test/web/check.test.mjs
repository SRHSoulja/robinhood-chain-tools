// Deterministic browser tests for web/check.html. Every chain and explorer answer is mocked, so a failure
// here is the page's fault and nothing else.
//
//   cd /mnt/c/GMGNRepeat/baby-bananza-grand-prix && node /home/arson/rh-airdrop/test/web/check.test.mjs
//
const { chromium } = await import('/mnt/c/GMGNRepeat/baby-bananza-grand-prix/node_modules/playwright/index.mjs')
  .catch(() => import('playwright'));

const PAGE = 'file:///home/arson/rh-airdrop/web/check.html';
const A = (n) => '0x' + n.toString(16).padStart(40, '0');
const NFT = A(0x721), TOK = A(0x20), PROXY = A(0x9), IMPL = A(0x99), WALLET = A(0xeee), NASTY = A(0xbad);
const ME = A(0xdead);

let pass = 0, fail = 0; const results = [];
const check = (name, cond, detail) => { if (cond) { pass++; results.push('  ok   ' + name); } else { fail++; results.push('  FAIL ' + name + (detail ? '  <- ' + String(detail).slice(0, 200) : '')); } };

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
        if (p0 === NFT || p0 === TOK) return codeWith([SEL.mint, SEL.pause]);
        if (p0 === NASTY) return codeWith([SEL.mint, SEL.blacklist, SEL.setFee]);
        if (p0 === PROXY) return '0x363d3d373d3d3d363d73' + IMPL.slice(2) + '5af43d82803e903d91602b57fd5bf3';
        if (p0 === IMPL) return codeWith([SEL.mint]);
        if (p0 === WALLET) return '0xef0100' + IMPL.slice(2);
        return '0x';
      }
      case 'eth_getStorageAt': return '0x' + '0'.repeat(64);
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
        if (sel === '0xa2b4bdcb') return O.validator ? '0x' + O.validator.slice(2).padStart(64, '0') : null;
        return word(1);
      }
      case 'eth_simulateV1': {
        const call = params[0].blockStateCalls[0].calls[0];
        if (O.simRevert) return [{ calls: [{ status: '0x0', gasUsed: '0x7639', returnData: '0x', logs: [], error: { message: 'execution reverted', code: -32000, data: O.simRevert } }] }];
        return [{ calls: [{ status: '0x1', gasUsed: '0xb8a8', returnData: '0x', logs: O.simLogs || [] }] }];
      }
      case 'eth_getTransactionByHash': return O.tx || null;
      case 'eth_getTransactionReceipt': return O.receipt || null;
      default: return null;
    }
  };
}

async function open(browser, opts = {}) {
  const ans = answer(opts);
  const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  page.on('dialog', (d) => (opts.promptWith ? d.accept(opts.promptWith) : d.dismiss()));
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('/api/v2/smart-contracts/') || url.includes('/x/')) {
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
      const one = (r) => ({ jsonrpc: '2.0', id: r.id, result: ans(r.method, r.params || []) });
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
  await page.waitForTimeout(waitMs || 2500);
  return (await page.textContent('#out')) || '';
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

// ---- what was pasted -------------------------------------------------------
{
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
}

// ---- the warning that matters most -----------------------------------------
{
  const page = await open(browser, { simLogs: [{ address: TOK, topics: [APPROVAL, '0x' + ME.slice(2).padStart(64, '0'), '0x' + A(0x1111).slice(2).padStart(64, '0')], data: '0x' + 'f'.repeat(64) }] });
  const t = await ask(page, JSON.stringify({ to: TOK, data: '0x095ea7b3' + A(0x1111).slice(2).padStart(64, '0') + 'f'.repeat(64) }), ME);
  check('an unlimited approval is called unlimited', t.includes('unlimited'), t.slice(0, 200));
  check('and is spelled out as a standing permission', /at any point in the future/.test(t), t.slice(0, 300));
  check('and the approval it would grant is listed as a movement', /lets .* spend/.test(t), t.slice(0, 400));
  await page.close();
}

// ---- approving a whole collection ------------------------------------------
{
  const page = await open(browser, {});
  const t = await ask(page, JSON.stringify({ to: NFT, data: '0xa22cb465' + A(0x1111).slice(2).padStart(64, '0') + (1).toString().padStart(64, '0') }), ME);
  check('setApprovalForAll says it is the whole collection', /every one you hold now and every one you ever hold/.test(t), t.slice(0, 300));
  await page.close();
}

// ---- a call that would fail ------------------------------------------------
{
  const page = await open(browser, { simRevert: '0x7e273289' + (12345).toString(16).padStart(64, '0') });
  const t = await ask(page, JSON.stringify({ to: NFT, data: '0x23b872dd' + ME.slice(2).padStart(64, '0') + A(0x2222).slice(2).padStart(64, '0') + (12345).toString(16).padStart(64, '0') }), ME);
  check('a call that would fail says so before it is signed', t.includes('would fail'), t.slice(0, 200));
  check('and gives the contract’s own reason in words', t.includes('that token id does not exist'), t.slice(0, 400));
  check('and carries the argument the contract complained about', t.includes('12345'), t.slice(0, 400));
  await page.close();
}

// ---- powers, read from bytecode when there is no source ---------------------
{
  const page = await open(browser, {});
  const t = await ask(page, NASTY);
  check('an unverified contract is not treated as unknowable', t.includes('bytecode'), t.slice(0, 200));
  check('a mint function is found in the bytecode', /create new tokens/.test(t), t.slice(0, 400));
  check('so is a blacklist', /block a chosen wallet/.test(t), t.slice(0, 400));
  check('so is a fee setter', /change the fee/.test(t), t.slice(0, 400));
  check('and the page says the source was never published', t.includes('No source has been published'), t.slice(-300));
  await page.close();
}

// ---- a name from a contract is text, never markup ---------------------------
{
  const page = await open(browser, {});
  await ask(page, NASTY);
  const html = await page.evaluate(() => document.querySelector('#out').innerHTML);
  check('a token name that looks like markup is rendered as text',
    !html.includes('<img') && html.includes('&lt;img'), html.slice(0, 200));
  await page.close();
}

// ---- a proxy is not the code it runs ----------------------------------------
{
  const page = await open(browser, {});
  const t = await ask(page, PROXY);
  check('a minimal proxy is flagged as replaceable code', t.includes('proxy'), t.slice(0, 200));
  check('and names the contract it forwards to', t.toLowerCase().includes(IMPL.slice(2, 10).toLowerCase()), t.slice(0, 300));
  await page.close();
}

// ---- a delegated wallet is still a wallet ------------------------------------
{
  const page = await open(browser, {});
  const t = await ask(page, WALLET);
  check('an EIP-7702 wallet is called a wallet, not a contract', t.includes('wallet running delegated code'), t.slice(0, 200));
  await page.close();
}

// ---- a verified contract reads from its source -------------------------------
{
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
}

// ---- an ordinary transaction reads back as English ---------------------------
{
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
}

// ---- an explorer that will not answer is not a contract without a source ----
{
  const page = await open(browser, { explorerSick: true });
  const t = await ask(page, NFT, null, 9000);
  check('an unreachable explorer is never reported as "no source published"',
    !t.includes('no source published') && !t.includes('No source has been published'), t.slice(0, 260));
  check('and the page says plainly that it could not check',
    t.includes('could not check for a published source'), t.slice(0, 260));
  check('while everything readable from the chain is still shown', t.includes('Code size'), t.slice(0, 400));
  await page.close();
}

await browser.close();
console.log(results.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
