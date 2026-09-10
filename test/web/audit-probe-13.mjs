// Thirteenth-round reviewer probes. Same convention as the earlier probe files: each assertion REPRODUCES a
// finding, so an assertion that PASSES ("REPRODUCES") is a defect that is still present.
//
//   node test/web/audit-probe-13.mjs
//
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const AIRDROP = pathToFileURL(new URL('../../web/index.html', import.meta.url).pathname).href;
const CHECK = pathToFileURL(new URL('../../web/check.html', import.meta.url).pathname).href;
const A = (n) => '0x' + n.toString(16).padStart(40, '0');
const NFT = A(0x721), TOK = A(0x20), RUN_ME = A(0xdead);
const BULK = '0xc2e4a9c4c9215600d1b348d02b63c6148d0ef481';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

let demonstrated = 0, notReproduced = 0;
const lines = [];
const probe = (name, reproduced, detail) => {
  if (reproduced) { demonstrated++; lines.push('  REPRODUCES  ' + name + (detail ? '\n                 ' + String(detail).replace(/\s+/g, ' ').slice(0, 320) : '')); }
  else { notReproduced++; lines.push('  fixed       ' + name + (detail ? '\n                 ' + String(detail).replace(/\s+/g, ' ').slice(0, 220) : '')); }
};

const enc = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
const padAddr = (a) => '0x' + a.slice(2).padStart(64, '0');
const strRet = (t) => { const b = Buffer.from(t, 'utf8'); const hex = b.toString('hex');
  return '0x' + (32).toString(16).padStart(64, '0') + BigInt(b.length).toString(16).padStart(64, '0')
    + hex.padEnd(Math.ceil(Math.max(hex.length, 1) / 64) * 64, '0'); };

const HASH = '0x' + 'cd'.repeat(32);
// The BulkSend batch summary the page requires before it will read a receipt at all.
const SUMMARY_TOPIC = { '721': '0x0650ec14a2586ec091c567c013a2e3ee5a6aac789d20c75c67208e1d8c9e69df' };

function airdropAnswer(O) {
  return function (method, params = []) {
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'net_version': return '46630';
      case 'eth_accounts': case 'eth_requestAccounts': return [RUN_ME];
      case 'eth_blockNumber': return '0x1000';
      case 'eth_gasPrice': return '0x989680';
      case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
      case 'wallet_getCapabilities': return {};
      case 'eth_getBlockByNumber': return { number: '0x1000', hash: '0x' + '11'.repeat(32), parentHash: '0x' + '22'.repeat(32), timestamp: '0x1', gasLimit: '0x1', gasUsed: '0x0', miner: A(0), baseFeePerGas: '0x989680', transactions: [] };
      case 'eth_estimateGas': return '0x' + (21000 + 40000).toString(16);
      case 'eth_sendTransaction': return HASH;
      case 'eth_getCode': {
        const a = String(params[0] || '').toLowerCase();
        if (a === NFT.toLowerCase() || a === TOK.toLowerCase() || a === BULK) return '0x60006000';
        return '0x';
      }
      case 'eth_getTransactionByHash': return {
        hash: HASH, blockHash: '0x' + '11'.repeat(32), blockNumber: '0x1000', transactionIndex: '0x0',
        from: RUN_ME, to: BULK, value: '0x0', gas: '0x186a0', gasPrice: '0x989680',
        maxFeePerGas: '0x989680', maxPriorityFeePerGas: '0x0', input: '0x', nonce: '0x1',
        type: '0x2', chainId: '0xb626', accessList: [], v: '0x1', r: '0x' + '11'.repeat(32), s: '0x' + '22'.repeat(32),
      };
      case 'eth_getTransactionReceipt': {
        if (!O.receiptFor) return null;
        return {
          status: '0x1', transactionHash: HASH, transactionIndex: '0x0', blockNumber: '0x1000',
          blockHash: '0x' + '11'.repeat(32), from: RUN_ME, to: BULK, contractAddress: null,
          cumulativeGasUsed: '0x1', gasUsed: '0x1', effectiveGasPrice: '0x989680', type: '0x2',
          logsBloom: '0x' + '00'.repeat(256),
          logs: [
            { address: BULK, topics: [SUMMARY_TOPIC['721'], padAddr(NFT), padAddr(RUN_ME)],
              data: enc(O.receiptFor.length).slice(0, 66) + enc(0).slice(2),
              blockNumber: '0x1000', transactionHash: HASH, transactionIndex: '0x0',
              blockHash: '0x' + '11'.repeat(32), logIndex: '0x0', removed: false },
            ...O.receiptFor.map((r, i) => ({
              address: NFT, topics: [TRANSFER_TOPIC, padAddr(RUN_ME), padAddr(r.to), enc(r.id)], data: '0x',
              blockNumber: '0x1000', transactionHash: HASH, transactionIndex: '0x0',
              blockHash: '0x' + '11'.repeat(32), logIndex: '0x' + (i + 1).toString(16), removed: false })),
          ],
        };
      }
      case 'eth_call': {
        const to = String(params[0].to || '').toLowerCase(), data = String(params[0].data || ''), sel = data.slice(0, 10);
        if (sel === '0x01ffc9a7') return enc(to === NFT.toLowerCase() && data.slice(10, 18) === '80ac58cd' ? 1 : 0);
        if (sel === '0x313ce567') return to === TOK.toLowerCase() ? enc(18) : null;
        if (sel === '0x06fdde03') return strRet('Probe Collection');
        if (sel === '0x95d89b41') return strRet('PRB');
        if (sel === '0x70a08231') return enc(50);
        if (sel === '0xe985e9c5') return enc(1);          // approved
        if (sel === '0x5c975abb') return enc(0);
        if (sel === '0x098144d4') return '0x';
        if (sel === '0x2f745c59') return enc(1 + Number(BigInt('0x' + data.slice(74))));
        if (sel === '0xc87b56dd') return strRet('');
        if (sel === '0x6352211e') return '0x' + String(O.ownerIs || RUN_ME).slice(2).padStart(64, '0');
        // (uint256 sent, uint256 skipped): two words, because that is what every airdrop* entry point
        // returns. Answering with one made every preflight staticCall undecodable, so the page stopped
        // before signing and S13-1 measured an empty localStorage that no send had ever populated.
        if (to === BULK) return enc(1) + (0).toString(16).padStart(64, '0');
        return enc(0);
      }
      default: return null;
    }
  };
}

async function openAirdrop(browser, O = {}, ctx) {
  const ans = airdropAnswer(O);
  const page = ctx ? await ctx.newPage() : await browser.newPage({ viewport: { width: 1200, height: 1800 } });
  page.on('dialog', (d) => (O.acceptDialogs ? d.accept() : d.dismiss()));
  await page.route('**://*/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file://') || url.includes('cdnjs.cloudflare.com')) return route.continue();
    if (url.includes('api.coinbase.com')) return route.fulfill({ contentType: 'application/json', body: '{"data":{"amount":"2500"}}' });
    if (url.includes('/api/v2/')) return route.fulfill({ contentType: 'application/json', body: '{"items":[]}' });
    if (url.includes('rpc.') && req.method() === 'POST') {
      let body; try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
      // Held open on purpose: the wallet has the request and has not answered yet.
      if (O.stall && ((Array.isArray(body) ? body : [body]).some((r) => r.method === O.stall.method))) {
        await new Promise((r) => setTimeout(r, O.stall.ms));
      }
      const one = (r) => { try { return { jsonrpc: '2.0', id: r.id, result: ans(r.method, r.params || []) }; }
                           catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: -32000, message: String(e.message) } }; } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.addInitScript((pre) => {
    const O = JSON.parse(pre);
    for (const [k, v] of Object.entries(O.storage || {})) { try { localStorage.setItem(k, v); } catch (e) {} }
    window.__asked = [];
    window.ethereum = {
      isMetaMask: true,
      on: () => {}, removeListener: () => {},
      request: async ({ method, params }) => {
        window.__asked.push(method);
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
  await page.goto(O.url || AIRDROP, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  return page;
}

const useToken = async (page, addr, std) => {
  await page.selectOption('#std', std);
  await page.fill('#token', addr);
  await page.dispatchEvent('#token', 'change');
  await page.waitForTimeout(1200);
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });

// =========================================================================================================
// S13-2. A file that names its columns has a heading row, and unreadableLinesInBox() calls that heading an
// unreadable line, because addressOn() finds no address on it. Both rewriters of the box -- "Use these" in
// the picker and "Apply to the list" -- therefore refuse every headed CSV, and the refusal tells the user to
// delete the heading. For a file whose address column is not first, deleting the heading is what makes the
// file unreadable: the positional reader then takes column 1, which is a token id.
// =========================================================================================================
{
  const page = await openAirdrop(browser, { acceptDialogs: true });
  await page.click('#connect');
  await page.waitForTimeout(1200);
  await useToken(page, NFT, '721');
  await page.fill('#list', 'address,tokenId\n' + A(0x111) + ',1\n' + A(0x222) + ',2');
  await page.click('#parse');
  await page.waitForTimeout(800);
  const parsed = (await page.textContent('#parseOut')) || '';
  await page.click('#pick');
  await page.waitForTimeout(2500);
  await page.click('#pickAll');
  await page.waitForTimeout(300);
  await page.click('#pickUse');
  await page.waitForTimeout(1200);
  const pickMsg = (await page.textContent('#pickMsg')) || '';
  const box = await page.inputValue('#list');
  probe('S13-2  a valid headed CSV parses, and then "Use these" refuses it because the HEADING row is counted '
      + 'as a line with no wallet address on it, and tells the user to remove it',
    /would go with it/.test(pickMsg) && /line 1/.test(pickMsg),
    'parsed: ' + parsed.replace(/\s+/g, ' ') + ' | pickMsg: ' + pickMsg + ' | box unchanged: ' + (box.startsWith('address,tokenId')));
  await page.close();
}

// =========================================================================================================
// S13-2b. The same refusal blocks "Assign my token ids", which is the workflow the page itself sends people
// to. A file headed `address` with nothing else in it is routed by parseList to offerToAssign(), whose panel
// says "Press \u201cAssign my token ids\u201d and the ones you hold are filled in for you". Assign then
// refuses, because unreadableLinesInBox() counts the heading as a line with no wallet address on it.
// =========================================================================================================
{
  const page = await openAirdrop(browser, { acceptDialogs: true });
  await page.click('#connect');
  await page.waitForTimeout(1200);
  await useToken(page, NFT, '721');
  await page.fill('#list', 'address\n' + A(0x111) + '\n' + A(0x222));
  await page.click('#parse');
  await page.waitForTimeout(900);
  const offer = (await page.textContent('#problems')) || '';
  await page.click('#assign');
  await page.waitForTimeout(1500);
  const msg = (await page.textContent('#msgList')) || '';
  const box = await page.inputValue('#list');
  probe('S13-2b the page tells the user to press "Assign my token ids" for a headed address-only file, and '
      + 'Assign then refuses that exact file because of its heading',
    /Press .Assign my token ids./.test(offer) && /would go with it/.test(msg) && /line 1/.test(msg)
      && box.startsWith('address'),
    'offer: ' + offer.replace(/\s+/g, ' ').slice(0, 90) + ' | assign said: ' + msg);
  await page.close();
}

// =========================================================================================================
// S13-3. deliveriesOn(line, col) takes the column map and never uses it. For a headed file it cuts the line
// positionally, so a heading of `address,tokenId,amount` on an ERC-721 list makes every line count as TWO
// deliveries while parseList reads exactly one row from it. walletsInBox() is what the picker sizes itself
// against, so the two readers of one input disagree about how long the list is.
// =========================================================================================================
{
  const page = await openAirdrop(browser, { acceptDialogs: true });
  await page.click('#connect');
  await page.waitForTimeout(1200);
  await useToken(page, NFT, '721');
  await page.fill('#list', 'address,tokenId,amount\n' + A(0x111) + ',1,1\n' + A(0x222) + ',2,1');
  await page.click('#parse');
  await page.waitForTimeout(800);
  const parsed = (await page.textContent('#parseOut')) || '';
  await page.click('#pick');
  await page.waitForTimeout(2500);
  const count = (await page.textContent('#pickCount')) || '';
  const m = /of (\d+) wallet/.exec(count);
  probe('S13-3  parseList reads 2 recipients from that headed file and the picker sizes itself against '
      + (m ? m[1] : '?') + ' wallets from the same box',
    /2 recipients/.test(parsed) && !!m && m[1] !== '2',
    'parseOut: ' + parsed.replace(/\s+/g, ' ') + ' | pickCount: ' + count);
  await page.close();
}

// =========================================================================================================
// S13-1. Nothing is written down until the wallet has ANSWERED. A tab that dies between the user approving
// in their wallet and the promise resolving in the page leaves a batch on chain with no local record at all,
// so the next visit offers exactly those recipients again. The page's own footer says a batch that was
// "signed but never confirmed here is written down too".
// =========================================================================================================
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1800 } });
  const to1 = A(0x111);
  // The wallet has the request and takes 20 s to answer; the transaction is nonetheless on chain.
  const page = await openAirdrop(browser, { acceptDialogs: true, stall: { method: 'eth_sendTransaction', ms: 20000 },
                                            receiptFor: [{ to: to1, id: 1 }] }, ctx);
  await page.click('#connect');
  await page.waitForTimeout(1200);
  await useToken(page, NFT, '721');
  await page.fill('#list', to1 + ',1');
  await page.click('#parse');
  await page.waitForTimeout(800);
  await page.click('#send');
  // wait until the wallet has actually been handed the transaction
  let asked = false;
  for (let i = 0; i < 60 && !asked; i++) {
    await page.waitForTimeout(500);
    asked = await page.evaluate(() => (window.__asked || []).includes('eth_sendTransaction'));
  }
  const stateAtSigning = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('bulksend:')));
  // The tab dies here: the user is in their wallet app, approves, and never comes back to this tab.
  await page.close();

  const page2 = await openAirdrop(browser, { acceptDialogs: true, receiptFor: [{ to: to1, id: 1 }] }, ctx);
  await page2.click('#connect');
  await page2.waitForTimeout(1500);
  await useToken(page2, NFT, '721');
  await page2.fill('#list', to1 + ',1');
  await page2.click('#parse');
  await page2.waitForTimeout(1000);
  const after = await page2.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('bulksend:')));
  const log2 = (await page2.textContent('#log')) || '';
  const plan2 = (await page2.textContent('#plan')) || '';
  probe('S13-1  a batch handed to the wallet and then lost with the tab leaves NO pending record, so the '
      + 'next visit knows nothing about it and offers the same recipient again'
      + (asked ? '' : '  [INVALID: the wallet was never asked, so this measured nothing]'),
    !stateAtSigning.some((k) => k.startsWith('bulksend:pending:'))
      && !after.some((k) => k.startsWith('bulksend:pending:'))
      && !/held back|already delivered/i.test(log2 + plan2),
    'keys while the wallet held it: ' + JSON.stringify(stateAtSigning) + ' | keys after: ' + JSON.stringify(after)
      + ' | plan: ' + plan2.replace(/\s+/g, ' ').slice(0, 120));
  await page2.close();
  await ctx.close();
}

// =========================================================================================================
// S13-4 (Check page). `simulatable` requires every call to have a readable `to` and says, when one does not,
// that "a verdict with a member missing is not a verdict". It does NOT require the calldata to be readable.
// A call whose calldata could not be read is simulated with `data: "0x"` -- as a plain transfer of ETH -- and
// the sequence card then reports "run in order, every call succeeds", while the card immediately below it
// says of the same call "Nothing has been simulated and nothing is described below".
// =========================================================================================================
{
  function checkAnswer() {
    return function (method, params = []) {
      switch (method) {
        case 'eth_chainId': return '0xb626';
        case 'eth_blockNumber': return '0x1000';
        case 'eth_getBalance': return '0xde0b6b3a7640000';
        case 'eth_getTransactionCount': return '0x5';
        case 'eth_getCode': return String(params[0] || '').toLowerCase() === TOK ? '0x6340c10f1900' : '0x';
        case 'eth_getStorageAt': return '0x' + '0'.repeat(64);
        case 'eth_call': {
          const sel = String(params[0].data || '').slice(0, 10);
          if (sel === '0x01ffc9a7') return enc(0);
          if (sel === '0x313ce567') return enc(18);
          if (sel === '0x06fdde03') return strRet('Test Token');
          if (sel === '0x95d89b41') return strRet('TT');
          if (sel === '0x8da5cb5b') return enc(0x117);
          if (sel === '0x5c975abb') return enc(0);
          return enc(1);
        }
        case 'eth_simulateV1': {
          const calls = (params[0].blockStateCalls[0] || {}).calls || [];
          return [{ calls: calls.map(() => ({ status: '0x1', gasUsed: '0xb8a8', returnData: '0x', logs: [] })) }];
        }
        default: return null;
      }
    };
  }
  const ans = checkAnswer();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1800 } });
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
  await page.waitForTimeout(400);
  // An unlimited approve whose "0x" was lost on the way through a chat window: the exact input this page's
  // own history says produced a green verdict about bytes that were never in the box.
  const approve = '095ea7b3' + '0'.repeat(24) + A(0xb01c).slice(2) + 'f'.repeat(64);
  await page.fill('#input', JSON.stringify({ method: 'eth_sendTransaction', params: [{ to: TOK, data: approve }] }));
  await page.fill('#from', RUN_ME);
  await page.click('#go');
  await page.waitForTimeout(3000);
  const outText = (await page.textContent('#out')) || '';
  probe('S13-4  a transaction whose calldata could not be read is simulated as an empty ETH transfer and the '
      + 'sequence card reports "every call succeeds", beside a card saying nothing was simulated',
    /run in order, every call succeeds/.test(outText) && /Nothing has been simulated/.test(outText),
    outText.replace(/\s+/g, ' ').slice(0, 400));
  await page.close();
}

// =========================================================================================================
// S13-5. Nine of BulkSend's fifteen errors are absent from the page's reason table, including every guard
// added in v11 and v12. They are printed to the user as "reverted with 0x…". Two entries in the `words`
// object next to it (GasOutOfRange, GasIsForLenientOnly) have text written for them and are never reached,
// because the Interface that builds the table does not declare those errors.
// =========================================================================================================
{
  const page = await openAirdrop(browser, {});
  await page.waitForTimeout(300);
  const SELECTORS = {
    'NotAnNft(address)': '0x21443d13',
    'IsAnNft(address)': '0x16102772',
    'DelegatedWallet(address)': '0xc1666f64',
    'SelfRecipient(uint256)': '0x7d797df3',
    'ZeroAmount(uint256)': '0x9af70448',
    'AmbiguousResult(address,uint256)': '0xe387d1d9',
    'GasOutOfRange(uint256,uint256,uint256)': '0x072383b4',
    'GasIsForLenientOnly()': '0x059845fb',
    'Reentered()': '0xb5dfd9e5',
  };
  const said = await page.evaluate((sels) => {
    const out = {};
    for (const [name, sel] of Object.entries(sels)) out[name] = window.__decodeReason(sel + '0'.repeat(64));
    return out;
  }, SELECTORS);
  const raw = Object.entries(said).filter(([, v]) => /^reverted with 0x/.test(v)).map(([k]) => k);
  probe('S13-5  ' + raw.length + ' of BulkSend\u2019s errors are shown to the user as a bare selector, '
      + 'including every guard added in v11 and v12',
    raw.length > 0, raw.join(', ') + '  ||  e.g. IsAnNft -> "' + said['IsAnNft(address)'] + '"');
  await page.close();
}

await browser.close();
console.log('\naudit-probe-13 (thirteenth round)\n');
console.log(lines.join('\n'));
console.log('\n' + demonstrated + ' demonstrated, ' + notReproduced + ' no longer reproduce\n');
