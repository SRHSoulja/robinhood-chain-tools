// A real airdrop, all the way through, against the real testnet.
//
//   node test/web/live-send.mjs        (needs the network and a funded testnet key; not part of `npm test`)
//
// The mocked suite proves the page's logic. It cannot prove that a wallet, a node and a deployed contract
// agree with that logic. This drives the actual page: connect, load the token, read a list, let it measure
// the gas, approve, run its own test run, sign, send, and then ask the chain who owns what afterwards.
//
// The signing key is a testnet-only account created for this and deliberately holding no mainnet balance,
// and it is used from node, never handed to the page. The deployer key is not used here at all.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PAGE = pathToFileURL(new URL('../../web/index.html', import.meta.url).pathname).href;
const RPC = 'https://rpc.testnet.chain.robinhood.com';
const CAST = join(homedir(), '.foundry/bin/cast');
const D = JSON.parse(readFileSync(new URL('../../deployments.testnet.json', import.meta.url), 'utf8'));
const KEY = JSON.parse(readFileSync(join(homedir(), '.config/rh-airdrop/testnet-sender.json'), 'utf8'));
const ME = KEY.address;

if (Number(execFileSync(CAST, ['chain-id', '--rpc-url', RPC]).toString().trim()) !== 46630) {
  console.error('that RPC is not Robinhood Chain testnet; refusing to sign anything'); process.exit(1);
}

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  <- ' + detail : '')); }
};
const call = (to, sig, ...args) =>
  execFileSync(CAST, ['call', to, sig, ...args.map(String), '--rpc-url', RPC]).toString().trim();

// three recipients that have never held anything, so every cost is the real cold-write cost
// All lower case on purpose. Mixing cases makes it a checksummed address, and the page is right to refuse
// one whose checksum does not hold: the first version of this test generated exactly that and was rejected.
const stamp = Date.now().toString(16).toLowerCase().padStart(12, '0');
const to = (n) => ('0x' + '51e' + stamp + '0'.repeat(40 - 3 - 12 - 1) + n).toLowerCase();
// Monotonic, and its own decade. `Date.now() % 100000` cycled every hundred seconds, so two runs a hundred
// seconds apart picked the same ids, and both live scripts drew from overlapping ranges. That was survivable
// -- minting an id that already exists reverts, so a collision fails the mint rather than moving somebody
// else's token -- but it fails as a confusing broken test, and this collection is shared: the maintainer also
// mints into it for an unrelated game. Milliseconds never repeat, and the leading 7 separates this script
// from the other one, so a run here can never land on an id anything else created.
const base = 7_000_000_000_000 + Date.now();
execFileSync(CAST, ['send', D.OZ721, 'mintMany(address,uint256,uint256)', ME, String(base), '3',
  '--rpc-url', RPC, '--private-key', KEY.private_key], { maxBuffer: 1 << 24 });
const IDS = [base, base + 1, base + 2];
const RECIPIENTS = [to(1), to(2), to(3)];

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
page.on('dialog', (d) => d.accept());

// Signing lives out here. The page asks; node decides and broadcasts.
const signed = [];
await page.exposeFunction('__sign', (tx) => {
  const args = ['send', tx.to, '--data', tx.data || '0x', '--rpc-url', RPC, '--private-key', KEY.private_key, '--json'];
  if (tx.value && tx.value !== '0x0') args.push('--value', BigInt(tx.value).toString());
  const out = JSON.parse(execFileSync(CAST, args, { maxBuffer: 1 << 24 }).toString());
  signed.push({ to: tx.to, hash: out.transactionHash, status: out.status });
  return out.transactionHash;
});
await page.addInitScript((me) => {
  const RPC = 'https://rpc.testnet.chain.robinhood.com';
  let id = 1;
  window.ethereum = {
    isMetaMask: true, on() {}, removeListener() {},
    async request({ method, params }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [me];
      if (method === 'eth_chainId') return '0xb626';
      if (method === 'net_version') return '46630';
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      if (method === 'wallet_getCapabilities') return {};                 // force the BulkSend path
      if (method === 'eth_sendTransaction') return window.__sign((params || [])[0]);
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params: params || [] }) });
      const d = await r.json();
      if (d.error) { const e = new Error(d.error.message); e.code = d.error.code; e.data = d.error.data; throw e; }
      return d.result;
    },
  };
}, ME);

const log = () => page.textContent('#log').then((t) => (t || '').replace(/\s+/g, ' '));

await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForTimeout(800);
await page.click('#connect'); await page.waitForTimeout(2500);
await page.selectOption('#std', '721'); await page.waitForTimeout(300);
await page.fill('#token', D.OZ721); await page.dispatchEvent('#token', 'change');
await page.waitForTimeout(4000);
await page.fill('#list', RECIPIENTS.map((a, i) => a + ',' + IDS[i]).join('\n'));
await page.click('#parse'); await page.waitForTimeout(4000);

const note = (await page.textContent('#batchNote')) || '';
check('the page measured this collection against the live chain',
  /measured rather than assumed: about ([\d,]+) gas/.test(note), note.slice(-120));

// the page's own approval step, really signed
if (!(await page.isDisabled('#approve'))) { await page.click('#approve'); await page.waitForTimeout(9000); }
check('BulkSend is approved for this collection afterwards',
  call(D.OZ721, 'isApprovedForAll(address,address)(bool)', ME, D.BulkSend) === 'true');

const why = (await page.textContent('#whyDisabled')) || '';
const listMsg = (await page.textContent('#msgList')) || '';
check('the list was accepted and the send is unblocked', !(await page.isDisabled('#preflight')),
  'whyDisabled: ' + why + ' | list: ' + listMsg.slice(0, 120));
if (await page.isDisabled('#preflight')) { await browser.close(); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
await page.click('#preflight'); await page.waitForTimeout(12000);
check('its own test run says all three would be delivered',
  /3 of 3 would be delivered/.test(await log()), (await log()).slice(-160));

await page.click('#send');
for (let i = 0; i < 60 && !/Finished\./.test(await log()); i++) await page.waitForTimeout(2000);
const finalLog = await log();
check('the send reports finishing', /Finished\. 3 delivered/.test(finalLog), finalLog.slice(-200));
check('it signed exactly one batch transaction', signed.filter((s) => s.to.toLowerCase() === D.BulkSend.toLowerCase()).length === 1,
  JSON.stringify(signed.map((s) => s.to)));

// the only answer that counts
for (let i = 0; i < 3; i++) {
  check('recipient ' + (i + 1) + ' really owns token ' + IDS[i] + ' on the chain',
    call(D.OZ721, 'ownerOf(uint256)(address)', IDS[i]).toLowerCase() === RECIPIENTS[i].toLowerCase(),
    call(D.OZ721, 'ownerOf(uint256)(address)', IDS[i]));
}
check('nothing threw in the page', errs.length === 0, errs.slice(0, 2).join(' | '));

for (const s of signed) console.log('       signed ' + s.hash + ' -> ' + s.to);
await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
