// The no-approval path, against the real mechanism rather than a mock of it.
//
//   node test/web/live-wallet-batch.mjs   (needs the network and a delegated testnet key; not in `npm test`)
//
// When a wallet can batch, the page skips BulkSend entirely and asks the wallet to make the transfers as
// itself, so no approval is ever granted to anything. That is EIP-5792 on top of EIP-7702, and until now it
// had only ever been exercised against a mock that answered whatever the tests wanted. A mock cannot tell you
// that a delegated account really executes a batch atomically, or that `transferFrom(msg.sender, ...)` really
// succeeds without an allowance, because a mock has no chain underneath it.
//
// So the test account here is genuinely delegated under EIP-7702 (its code is 0xef0100 || Batch7702), and this
// harness is a real 5792 wallet over it: `wallet_sendCalls` encodes the calls into `Batch7702.execute` and
// signs one transaction from the account to itself, which is precisely what a production wallet does.
//
// Signing happens in node. The key is testnet-only and holds no mainnet balance. Nothing here touches mainnet.
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
const SEVEN = JSON.parse(readFileSync(join(homedir(), '.config/rh-airdrop/testnet-7702.json'), 'utf8'));
const ME = KEY.address;

const cast = (...a) => execFileSync(CAST, [...a, '--rpc-url', RPC], { maxBuffer: 1 << 24 }).toString().trim();
if (Number(cast('chain-id')) !== 46630) { console.error('not testnet; refusing to sign'); process.exit(1); }

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? '  <- ' + d : '')); } };

// The delegation is the whole premise, so assert it rather than assume it.
const code = cast('code', ME).toLowerCase();
const want = '0xef0100' + SEVEN.batch7702.slice(2).toLowerCase();
check('the account is really delegated under EIP-7702', code === want, code + ' vs ' + want);
if (code !== want) { console.log('\nrun the delegation first; see the notes in this file'); process.exit(1); }

const stamp = Date.now().toString(16).toLowerCase().padStart(12, '0');
const to = (n) => ('0x' + '51f' + stamp + '0'.repeat(40 - 3 - 12 - 1) + n).toLowerCase();
const RECIPIENTS = [to(1), to(2), to(3)];

// fresh ids this account owns, minted for this run
// Monotonic, and its own decade. `Date.now() % 100000` cycled every hundred seconds, so two runs a hundred
// seconds apart picked the same ids, and both live scripts drew from overlapping ranges. That was survivable
// -- minting an id that already exists reverts, so a collision fails the mint rather than moving somebody
// else's token -- but it fails as a confusing broken test, and this collection is shared: the maintainer also
// mints into it for an unrelated game. Milliseconds never repeat, and the leading 8 separates this script
// from the other one, so a run here can never land on an id anything else created.
const base = 8_000_000_000_000 + Date.now();
execFileSync(CAST, ['send', D.OZ721, 'mintMany(address,uint256,uint256)', ME, String(base), '3',
  '--rpc-url', RPC, '--private-key', KEY.private_key], { maxBuffer: 1 << 24 });
const IDS = [base, base + 1, base + 2];
check('this account owns the three tokens before the run',
  IDS.every((i) => cast('call', D.OZ721, 'ownerOf(uint256)(address)', String(i)).toLowerCase() === ME.toLowerCase()));
// The claim under test is that no approval is needed at all, so start from none. An earlier live test on
// this same account approved BulkSend, and the first version of this file simply assumed it had not, which
// would have let the assertion pass for the wrong reason on a fresh account and fail on a used one.
if (cast('call', D.OZ721, 'isApprovedForAll(address,address)(bool)', ME, D.BulkSend) === 'true') {
  execFileSync(CAST, ['send', D.OZ721, 'setApprovalForAll(address,bool)', D.BulkSend, 'false',
    '--rpc-url', RPC, '--private-key', KEY.private_key], { maxBuffer: 1 << 24 });
}
check('BulkSend holds no approval on this collection before the run',
  cast('call', D.OZ721, 'isApprovedForAll(address,address)(bool)', ME, D.BulkSend) === 'false');

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
page.on('dialog', (d) => d.accept());

const batches = [];
// A real 5792 wallet: one signed transaction, from the account to itself, running every call atomically.
await page.exposeFunction('__sendCalls', (req) => {
  const tuple = '[' + (req.calls || []).map((c) => '(' + c.to + ',' + (c.value ? BigInt(c.value).toString() : '0') + ',' + (c.data || '0x') + ')').join(',') + ']';
  const data = execFileSync(CAST, [ 'calldata', 'execute((address,uint256,bytes)[])', tuple ]).toString().trim();
  const out = JSON.parse(execFileSync(CAST, ['send', ME, '--data', data, '--gas-limit', '30000000',
    '--rpc-url', RPC, '--private-key', KEY.private_key, '--json'], { maxBuffer: 1 << 24 }).toString());
  batches.push({ hash: out.transactionHash, status: out.status, calls: (req.calls || []).length });
  return out.transactionHash;
});
await page.exposeFunction('__callsStatus', (id) => {
  const r = JSON.parse(execFileSync(CAST, ['receipt', id, '--json', '--rpc-url', RPC], { maxBuffer: 1 << 24 }).toString());
  return { version: '2.0.0', id, chainId: '0xb626', status: 200, atomic: true, receipts: [r] };
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
      // what a wallet that has already upgraded this account reports
      if (method === 'wallet_getCapabilities') return { '0xb626': { atomic: { status: 'supported' } } };
      if (method === 'wallet_sendCalls') return window.__sendCalls((params || [])[0]);
      if (method === 'wallet_getCallsStatus') return window.__callsStatus((params || [])[0]);
      if (method === 'eth_sendTransaction') throw new Error('this path must never fall back to a plain send');
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
await page.click('#connect'); await page.waitForTimeout(3000);
await page.selectOption('#std', '721'); await page.waitForTimeout(300);
await page.fill('#token', D.OZ721); await page.dispatchEvent('#token', 'change');
await page.waitForTimeout(4000);
await page.fill('#list', RECIPIENTS.map((a, i) => a + ',' + IDS[i]).join('\n'));
await page.click('#parse'); await page.waitForTimeout(4000);

const plan = ((await page.textContent('#plan')) || '').replace(/\s+/g, ' ');
check('the page chose the wallet, not the contract', /sent by\s*your wallet, as itself \(no approval\)/.test(plan), plan.slice(0, 140));

await page.click('#preflight'); await page.waitForTimeout(15000);
check('its test run simulates the whole batch in order and holds',
  /every transfer holds|3 of 3 would be delivered/.test(await log()), (await log()).slice(-200));

await page.click('#send');
for (let i = 0; i < 90 && !/Finished\./.test(await log()); i++) await page.waitForTimeout(2000);
const finalLog = await log();
check('the send reports finishing', /Finished\. 3 delivered/.test(finalLog), finalLog.slice(-220));
check('exactly one batch reached the wallet, carrying all three transfers',
  batches.length === 1 && batches[0].calls === 3, JSON.stringify(batches));

for (let i = 0; i < 3; i++) {
  check('recipient ' + (i + 1) + ' really owns token ' + IDS[i],
    cast('call', D.OZ721, 'ownerOf(uint256)(address)', String(IDS[i])).toLowerCase() === RECIPIENTS[i].toLowerCase(),
    cast('call', D.OZ721, 'ownerOf(uint256)(address)', String(IDS[i])));
}
check('and BulkSend still holds no approval afterwards: the tokens moved without one existing',
  cast('call', D.OZ721, 'isApprovedForAll(address,address)(bool)', ME, D.BulkSend) === 'false');
check('nothing threw in the page', errs.length === 0, errs.slice(0, 2).join(' | '));

for (const b of batches) console.log('       one signed batch ' + b.hash + ' carrying ' + b.calls + ' transfers');
await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
