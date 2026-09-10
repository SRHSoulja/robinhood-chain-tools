// A real airdrop of each of the three standards, all the way through, against the real testnet.
//
//   node test/web/live-send-all.mjs   (needs the network and a funded testnet key; not part of `npm test`)
//
// live-send.mjs proves ERC-721. This proves the other two, and it exists because of what this project is
// for: there was already a bulk sender for ERC-20 on this chain and nothing else, so covering all three to
// the same standard IS the point. A promise demonstrated for NFTs and assumed for editions and tokens is a
// promise half kept, and until this ran, the ERC-1155 and ERC-20 paths through BulkSend v11 had only ever
// met a mock this repository wrote.
//
// The signing key is a testnet-only account holding no mainnet balance, used from node and never handed to
// the page, and deliberately NOT EIP-7702 delegated. That is not a detail: a delegated account has code, so a
// conforming ERC-1155 refuses to mint to it unless its delegate implements onERC1155Received. The first run
// of this file failed on exactly that, using the account delegated for live-wallet-batch.mjs. It is a real
// constraint on upgraded wallets rather than a quirk of the harness, and the page already handles it --
// upgradedWalletsThatCannotReceive probes each recipient's delegate for the receiver hook and holds back the
// ones that would fail. The script refuses to sign unless the chain id is 46630.
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
const KEY = JSON.parse(readFileSync(join(homedir(), '.config/rh-airdrop/testnet-plain.json'), 'utf8'));
const ME = KEY.address;

const cast = (...a) => execFileSync(CAST, [...a, '--rpc-url', RPC], { maxBuffer: 1 << 24 }).toString().trim();
const send = (...a) => execFileSync(CAST, ['send', ...a, '--rpc-url', RPC, '--private-key', KEY.private_key],
  { maxBuffer: 1 << 24 }).toString();
if (Number(cast('chain-id')) !== 46630) { console.error('not testnet; refusing to sign'); process.exit(1); }

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? '  <- ' + d : '')); } };

const stamp = Date.now().toString(16).toLowerCase().padStart(12, '0');
const to = (p, n) => ('0x' + p + stamp + '0'.repeat(40 - 3 - 12 - 1) + n).toLowerCase();

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });

async function drive(label, { token, std, list, before, after }) {
  console.log('\n== ' + label + ' ==');
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  page.on('dialog', (d) => d.accept());
  const signed = [];
  await page.exposeFunction('__sign', (tx) => {
    const args = ['send', tx.to, '--data', tx.data || '0x', '--rpc-url', RPC, '--private-key', KEY.private_key, '--json'];
    const out = JSON.parse(execFileSync(CAST, args, { maxBuffer: 1 << 24 }).toString());
    signed.push({ to: String(tx.to).toLowerCase(), hash: out.transactionHash });
    return out.transactionHash;
  });
  await page.addInitScript((me) => {
    const RPC2 = 'https://rpc.testnet.chain.robinhood.com';
    let id = 1;
    window.ethereum = {
      isMetaMask: true, on() {}, removeListener() {},
      async request({ method, params }) {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [me];
        if (method === 'eth_chainId') return '0xb626';
        if (method === 'net_version') return '46630';
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        if (method === 'wallet_getCapabilities') return {};          // force the BulkSend path
        if (method === 'eth_sendTransaction') return window.__sign((params || [])[0]);
        const r = await fetch(RPC2, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params: params || [] }) });
        const d = await r.json();
        if (d.error) { const e = new Error(d.error.message); e.code = d.error.code; e.data = d.error.data; throw e; }
        return d.result;
      },
    };
  }, ME);

  before();
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('#connect'); await page.waitForTimeout(2500);
  await page.selectOption('#std', std); await page.waitForTimeout(300);
  await page.fill('#token', token); await page.dispatchEvent('#token', 'change');
  await page.waitForTimeout(4000);
  await page.fill('#list', list); await page.click('#parse'); await page.waitForTimeout(4000);

  const note = (await page.textContent('#batchNote')) || '';
  check(label + ': the page measured this token against the live chain',
    /measured rather than assumed/.test(note), note.slice(-110));

  if (!(await page.isDisabled('#approve'))) { await page.click('#approve'); await page.waitForTimeout(9000); }
  const log = async () => ((await page.textContent('#log')) || '').replace(/\s+/g, ' ');
  await page.click('#preflight'); await page.waitForTimeout(12000);
  check(label + ': its own test run says all three would be delivered',
    /3 of 3 would be delivered/.test(await log()), (await log()).slice(-170));

  await page.click('#send');
  for (let i = 0; i < 60 && !/Finished\./.test(await log()); i++) await page.waitForTimeout(2000);
  check(label + ': the send reports finishing', /Finished\. 3 delivered/.test(await log()), (await log()).slice(-200));
  check(label + ': exactly one batch went through BulkSend',
    signed.filter((s) => s.to === D.BulkSend.toLowerCase()).length === 1, JSON.stringify(signed.map((s) => s.to)));
  check(label + ': nothing threw in the page', errs.length === 0, errs.slice(0, 2).join(' | '));
  after();
  for (const s of signed) console.log('       signed ' + s.hash + ' -> ' + s.to);
  await page.close();
}

// ---- ERC-1155: three editions of one id, to three addresses that held none ------------------------------
{
  const R = [to('61e', 1), to('61e', 2), to('61e', 3)];
  const ID = 1;
  await drive('ERC-1155', {
    token: D.OZ1155, std: '1155',
    list: R.map((a) => a + ',' + ID + ',2').join('\n'),
    before() {
      send(D.OZ1155, 'mint(address,uint256,uint256)', ME, String(ID), '100');
      check('ERC-1155: the sender holds enough before the run',
        BigInt(cast('call', D.OZ1155, 'balanceOf(address,uint256)(uint256)', ME, String(ID)).split(' ')[0]) >= 6n);
    },
    after() {
      for (let i = 0; i < 3; i++) {
        const bal = cast('call', D.OZ1155, 'balanceOf(address,uint256)(uint256)', R[i], String(ID)).split(' ')[0];
        check('ERC-1155: recipient ' + (i + 1) + ' really holds 2 of edition ' + ID, BigInt(bal) === 2n, 'balance=' + bal);
      }
    },
  });
}

// ---- ERC-20: a fractional amount, to three addresses that held none --------------------------------------
{
  const R = [to('3ae', 1), to('3ae', 2), to('3ae', 3)];
  const WANT = 1500000000000000000n;   // 1.5 with 18 decimals
  await drive('ERC-20', {
    token: D.OZ20, std: '20',
    list: R.map((a) => a + ',1.5').join('\n'),
    before() {
      send(D.OZ20, 'mint(address,uint256)', ME, '1000000000000000000000');
      check('ERC-20: the sender holds enough before the run',
        BigInt(cast('call', D.OZ20, 'balanceOf(address)(uint256)', ME).split(' ')[0]) >= WANT * 3n);
    },
    after() {
      for (let i = 0; i < 3; i++) {
        const bal = cast('call', D.OZ20, 'balanceOf(address)(uint256)', R[i]).split(' ')[0];
        check('ERC-20: recipient ' + (i + 1) + ' really holds exactly 1.5', BigInt(bal) === WANT, 'balance=' + bal);
      }
    },
  });
}

await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
