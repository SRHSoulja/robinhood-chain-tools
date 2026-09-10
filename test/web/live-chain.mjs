// The one check the mocked suite cannot make.
//
//   node test/web/live-chain.mjs        (needs the network; not part of `npm test`)
//
// Every assertion in client.test.mjs answers its own questions: the RPC is a mock, so the gas probe is
// handed a number this repository chose. That proves the arithmetic and proves nothing about whether the
// chain will answer the question at all, or answer it with something sane. Ten adversarial reviews of this
// project missed every defect a real user hit in two days, and this is the shape of that gap.
//
// Point the real page at the real testnet with real deployed tokens. No mock RPC: every call the page makes
// goes to rpc.testnet.chain.robinhood.com and is answered by the chain. The wallet is the only thing faked,
// and only enough to say "this account is connected"; every read it is asked for is forwarded to the chain
// as well. Nothing signs and nothing is sent.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const PAGE = pathToFileURL(new URL('../../web/index.html', import.meta.url).pathname).href;
const RPC = 'https://rpc.testnet.chain.robinhood.com';
const ME = '0xcc6eB67bdDb5Ec3e8D3EcB18ea7C8C5668790322';
const D = JSON.parse(await (await import('node:fs')).promises.readFile(new URL('../../deployments.testnet.json', import.meta.url), 'utf8'));

const CASES = [
  { std: '721', token: D.OZ721, label: 'OZ721 (plain OpenZeppelin)', list: '0x51D7000000000000000000000000000000000001,200000' },
  { std: '721', token: D.A721, label: 'A721 (lazily minted, ERC721A)', list: '0x51D7000000000000000000000000000000000002,300' },
  { std: '1155', token: D.OZ1155, label: 'OZ1155', list: '0x51D7000000000000000000000000000000000003,1,1' },
  { std: '20', token: D.OZ20, label: 'OZ20', list: '0x51D7000000000000000000000000000000000004,1' },
];

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
let bad = 0;

for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  page.on('dialog', (d) => d.dismiss());
  await page.addInitScript((me) => {
    const RPC = 'https://rpc.testnet.chain.robinhood.com';
    let id = 1;
    window.ethereum = {
      isMetaMask: true,
      on() {}, removeListener() {},
      async request({ method, params }) {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [me];
        if (method === 'eth_chainId') return '0xb626';
        if (method === 'net_version') return '46630';
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        if (method === 'wallet_getCapabilities') return {};
        if (method === 'eth_sendTransaction' || method === 'wallet_sendCalls') throw new Error('this run signs nothing');
        const r = await fetch(RPC, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params: params || [] }),
        });
        const d = await r.json();
        if (d.error) { const e = new Error(d.error.message); e.code = d.error.code; e.data = d.error.data; throw e; }
        return d.result;
      },
    };
  }, ME);

  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('#connect'); await page.waitForTimeout(2500);
  await page.selectOption('#std', c.std); await page.waitForTimeout(300);
  await page.fill('#token', c.token); await page.dispatchEvent('#token', 'change');
  await page.waitForTimeout(4000);
  await page.fill('#list', c.list); await page.waitForTimeout(300);
  await page.click('#parse'); await page.waitForTimeout(4000);

  const note = (await page.textContent('#batchNote')) || '';
  const cap = await page.getAttribute('#batch', 'max');
  const plan = ((await page.textContent('#plan')) || '').replace(/\s+/g, ' ').trim();
  const measured = /measured rather than assumed: about ([\d,]+) gas/.exec(note);
  const ok = !!measured;
  if (!ok) bad++;
  const pad = (t, n) => (t + ' '.repeat(n)).slice(0, n);
  console.log((ok ? '  ok   ' : '  FAIL ') + pad(c.label, 32) + ' cap=' + pad(String(cap), 5)
    + (measured ? 'measured ' + measured[1] + ' gas a wallet' : 'NOT MEASURED: ' + note.slice(-110)));
  if (errs.length) console.log('         page errors: ' + errs.slice(0, 2).join(' | '));
  await page.close();
}

await browser.close();
console.log(bad ? '\n' + bad + ' of ' + CASES.length + ' did not measure against the real chain' : '\nall ' + CASES.length + ' measured against the real chain');
process.exit(bad ? 1 : 0);
