// The presentation lane's own browser suite: it loads both pages exactly as they sit on disk, with every
// network request the page makes intercepted, and asserts the things a presentation change can break.
//
//   node test/web/presentation.test.mjs        (from the repository root)
//
// It is not a substitute for test/web/client.test.mjs. It is the smallest set of checks that would catch a
// page that a share-metadata, wording or image change had quietly broken: an error on load, a control that
// vanished, a network selector that stopped naming the right contract, a share card pointing at the other
// page's origin, a CSP that no longer names the script it carries. See docs/harness.md, "The presentation
// lane", and ./verify.sh for the gate that still has to pass before a commit.
//
// Every request is answered here. Nothing reaches a network: the only outbound file the pages ask for is the
// pinned ethers bundle, and that is served from a local copy whose sha384 is checked against the integrity
// attribute in the page's own <script> tag. Anything not answered is aborted, and an aborted subresource
// shows up in the console as an error, which fails the no-console-errors assertion rather than passing
// quietly. If the page complains about a stub, the stub is what gets fixed.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { makeRunner } from './lib.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const AIRDROP = join(ROOT, 'web/index.html');
const CHECK = join(ROOT, 'web/check.html');
const AIRDROP_SRC = readFileSync(AIRDROP, 'utf8');
const CHECK_SRC = readFileSync(CHECK, 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  <- ' + String(detail).slice(0, 300) : '')); }
};
const { t, trackPage, summaryLine } = makeRunner(check);

// ---- the one file the pages load from outside themselves -------------------------------------------------
// The page pins the ethers build by sha384 in its own script tag. Serving anything else fails subresource
// integrity, which the browser reports as a console error, so the bytes have to be exactly the pinned ones.
// They are cached under node_modules (ignored by git, excluded from every copy of the tree) and re-verified
// against the page's attribute on every run; the download happens once, on the first run of a clone.
async function ethersBundle() {
  const tag = AIRDROP_SRC.match(/<script src="([^"]+)"[^>]*integrity="sha384-([^"]+)"/);
  if (!tag) throw new Error('web/index.html has no pinned <script src> with an integrity attribute');
  const [, url, want] = tag;
  const cache = join(ROOT, 'node_modules/.cache/rh-presentation', url.split('/').pop());
  const digest = (b) => createHash('sha384').update(b).digest('base64');
  if (existsSync(cache)) {
    const have = readFileSync(cache);
    if (digest(have) === want) return have;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('could not fetch ' + url + ': HTTP ' + res.status);
  const body = Buffer.from(await res.arrayBuffer());
  if (digest(body) !== want) throw new Error(url + ' does not match the integrity attribute in the page');
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, body);
  return body;
}

let ETHERS;
try {
  ETHERS = await ethersBundle();
} catch (e) {
  console.log('  FAIL presentation: the pinned ethers bundle could not be made available  <- ' + e.message);
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}

// ---- the chain, answered by method -----------------------------------------------------------------------
// Which chain an endpoint is on is decided by its host, the way it is in reality, so a page that reads the
// wrong endpoint for the network it is showing gets the wrong answer here too.
const CHAIN_BY_HOST = (host) => (/testnet|sepolia/.test(host) ? 46630 : 4663);
const hex = (n) => '0x' + n.toString(16);

function rpcAnswer(host, req) {
  const id = req.id;
  const chain = CHAIN_BY_HOST(host);
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  switch (req.method) {
    case 'eth_chainId': return ok(hex(chain));                       // 4663 -> 0x1237, 46630 -> 0xb626
    case 'net_version': return ok(String(chain));
    case 'eth_blockNumber': return ok('0x1000');
    case 'eth_gasPrice': return ok('0x989680');
    case 'eth_getBlockByNumber': return ok({
      number: '0x1000', hash: '0x' + '11'.repeat(32), parentHash: '0x' + '22'.repeat(32),
      timestamp: '0x1', gasLimit: '0x1', gasUsed: '0x0', miner: '0x' + '0'.repeat(40),
      baseFeePerGas: '0x989680', transactions: [],
    });
    case 'eth_call': return ok('0x');
    case 'eth_getCode': return ok('0x');
    // Anything else is a method this suite has not thought about. A JSON-RPC error is what a node would send,
    // and it is visible: a page that needed the answer will say so rather than being handed a plausible one.
    default: return { jsonrpc: '2.0', id, error: { code: -32601, message: 'not mocked here: ' + req.method } };
  }
}

const LAUNCH = { headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] };
const browser = await chromium.launch(LAUNCH);

async function open(file) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
  const errs = [], consoleErrs = [], aborted = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200)); });
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith('file://')) return route.continue();
    if (url === AIRDROP_SRC.match(/<script src="([^"]+)"/)[1]) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: ETHERS });
    }
    let host = '';
    try { host = new URL(url).host; } catch (e) { /* not a URL this suite can reason about */ }
    if (req.method() === 'POST') {
      let body; try { body = JSON.parse(req.postData() || '{}'); } catch (e) { body = {}; }
      const out = Array.isArray(body) ? body.map((r) => rpcAnswer(host, r)) : rpcAnswer(host, body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
    }
    // The explorer and the price feed: a 200 with an empty object, which is a real answer with nothing in it.
    if (/blockscout|explorer|coinbase/.test(host)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    aborted.push(req.method() + ' ' + url.slice(0, 120));
    return route.abort();
  });
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  page.__errs = errs;
  page.__consoleErrs = consoleErrs;
  page.__aborted = aborted;
  trackPage(page);
  return page;
}

const quiet = (page) => page.__errs.length === 0 && page.__consoleErrs.length === 0;
const noise = (page) => JSON.stringify({ pageerror: page.__errs, console: page.__consoleErrs, aborted: page.__aborted });

// The CSP hash covers everything between the inline script's tags, the leading newline included.
function inlineScript(src, name) {
  const blocks = [...src.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((m) => !/src=/i.test(m[1]) && m[2].trim()).map((m) => m[2]);
  if (blocks.length !== 1) throw new Error(name + ' has ' + blocks.length + ' inline scripts; expected 1');
  return blocks[0];
}

// ---- 1: the airdrop page loads, and every control it names is there ---------------------------------------
await t('presentation: the airdrop page loads with no errors and still has every control it locks', async () => {
  const page = await open(AIRDROP);
  check('airdrop: the page loads with no pageerror and no console error', quiet(page), noise(page));
  // The page's own list, read out of its bytes, so this cannot drift from what the page believes it has.
  const form = [...new Set((AIRDROP_SRC.match(/const FORM = \[([\s\S]*?)\];/) || [, ''])[1]
    .match(/'[^']+'/g) || [])].map((s) => s.slice(1, -1));
  check('airdrop: the FORM list was read out of the page', form.length > 20, form.length + ' ids');
  // Not in FORM, because the page never disables them, but a presentation change can still delete them.
  const extra = ['log', 'msgTop', 'msgList', 'contractLine', 'support', 'walletBox', 'connectWc'];
  const missing = await page.evaluate((ids) => ids.filter((id) => !document.getElementById(id)), [...form, ...extra]);
  check('airdrop: every id the page names exists in the DOM', missing.length === 0, 'missing: ' + missing.join(', '));
  await page.close();
});

// ---- 2: the network selector, and the contract it names ---------------------------------------------------
await t('presentation: the network selector offers both chains and the contract follows the choice', async () => {
  const MAINNET = '0x904412cfe982f33385f486aaff8c8a4a6f4b5fbf';
  const TESTNET = '0xf2ed6359f5dee0334d68cd21d306d9d3e7a49232';
  const page = await open(AIRDROP);
  const opts = await page.evaluate(() => [...document.querySelectorAll('#net option')]
    .map((o) => ({ value: o.value, label: o.textContent, disabled: o.disabled })));
  check('net: exactly two networks are offered', opts.length === 2, JSON.stringify(opts));
  check('net: mainnet 4663 is first and testnet 46630 is second',
    opts[0] && opts[0].value === '4663' && opts[1] && opts[1].value === '46630', JSON.stringify(opts.map((o) => o.value)));
  check('net: neither option is disabled', opts.every((o) => !o.disabled), JSON.stringify(opts));
  check('net: the labels name mainnet and testnet',
    /mainnet/i.test(opts[0].label) && /testnet/i.test(opts[1].label), JSON.stringify(opts.map((o) => o.label)));

  const line = () => page.evaluate(() => (document.querySelector('#contractLine') || {}).textContent || '');
  const selected = await page.evaluate(() => document.querySelector('#net').value);
  check('net: a fresh visit, with no remembered choice, selects mainnet', selected === '4663', selected);
  let shown = await line();
  check('net: a fresh visit names the mainnet contract',
    shown.toLowerCase().includes(MAINNET) && !shown.toLowerCase().includes(TESTNET), shown);

  await page.selectOption('#net', '46630');
  await page.waitForTimeout(800);
  shown = await line();
  check('net: choosing testnet names the testnet contract and not the mainnet one',
    shown.toLowerCase().includes(TESTNET) && !shown.toLowerCase().includes(MAINNET), shown);

  await page.selectOption('#net', '4663');
  await page.waitForTimeout(800);
  shown = await line();
  check('net: choosing mainnet again restores the mainnet contract',
    shown.toLowerCase().includes(MAINNET) && !shown.toLowerCase().includes(TESTNET), shown);
  check('net: switching networks raised no error', quiet(page), noise(page));
  await page.close();
});

// ---- 3: the icons and the share card ----------------------------------------------------------------------
await t('presentation: the airdrop page names its own icons and share card', async () => {
  const page = await open(AIRDROP);
  const m = await page.evaluate(() => {
    const prop = (p) => (document.querySelector('meta[property="' + p + '"]') || {}).content || null;
    const name = (n) => (document.querySelector('meta[name="' + n + '"]') || {}).content || null;
    const link = (r) => { const el = document.querySelector('link[rel="' + r + '"]'); return el ? el.getAttribute('href') : null; };
    return { icon: link('icon'), touch: link('apple-touch-icon'), ogImage: prop('og:image'),
             twImage: name('twitter:image'), ogTitle: prop('og:title'), twCard: name('twitter:card'),
             title: document.title };
  });
  check('share: the favicon is an inline SVG data URL',
    typeof m.icon === 'string' && m.icon.startsWith('data:image/svg+xml'), String(m.icon).slice(0, 60));
  check('share: the home-screen icon is /apple-touch-icon.png', m.touch === '/apple-touch-icon.png', m.touch);
  check('share: og:image is this page\'s own share card',
    m.ogImage === 'https://rhairdrop.gmgnrepeat.com/og.png', m.ogImage);
  check('share: twitter:image is this page\'s own share card',
    m.twImage === 'https://rhairdrop.gmgnrepeat.com/og.png', m.twImage);
  check('share: og:title is the page title', m.ogTitle === m.title, m.ogTitle + ' vs ' + m.title);
  check('share: twitter:card is summary_large_image', m.twCard === 'summary_large_image', m.twCard);
  await page.close();
});

// ---- 4: the support section --------------------------------------------------------------------------------
await t('presentation: the support section is closed on load and carries the three addresses', async () => {
  const page = await open(AIRDROP);
  const s = await page.evaluate(() => {
    const el = document.querySelector('#support');
    const txt = (id) => { const n = document.querySelector('#' + id); return n ? n.textContent.trim() : null; };
    return { tag: el && el.tagName, open: el ? el.open : null, inside: el ? !!el.querySelector('#tipEvm') : false,
             evm: txt('tipEvm'), sol: txt('tipSol'), btc: txt('tipBtc'),
             copies: document.querySelectorAll('.tipCopy').length };
  });
  check('support: #support is a <details> element', s.tag === 'DETAILS', String(s.tag));
  check('support: it is closed when the page loads', s.open === false, String(s.open));
  check('support: the addresses are inside it', s.inside === true, String(s.inside));
  check('support: the EVM address is exact', s.evm === '0xCb37f365900C7F5d455525ce77b486e81e92e8B7', s.evm);
  check('support: the Solana address is exact', s.sol === '6sb3gUXmTzhsRQVe8RDudm6yEPBknrqNYCVv25PncxbY', s.sol);
  check('support: the Bitcoin address is exact', s.btc === 'bc1q4qndvm4zul3uy70rlw334q5a9clmszfemg3345', s.btc);
  check('support: there are three copy buttons', s.copies === 3, String(s.copies));
  await page.close();
});

// ---- 5: nothing still says mainnet is off --------------------------------------------------------------------
await t('presentation: no visible text still says mainnet is off', async () => {
  const page = await open(AIRDROP);
  // innerText, not textContent: script text is not on the page, and neither is anything display:none.
  const body = await page.evaluate(() => document.body.innerText);
  const stale = body.match(/Testnet only, for now|not live yet|Mainnet is switched off/i);
  check('copy: nothing visible says mainnet is off', stale === null, stale ? stale[0] : '');
  await page.close();
});

// ---- 6: each page's CSP names the script it carries ------------------------------------------------------------
await t('presentation: each page\'s CSP names the sha256 of the script it carries', async () => {
  for (const [name, src] of [['web/index.html', AIRDROP_SRC], ['web/check.html', CHECK_SRC]]) {
    const want = 'sha256-' + createHash('sha256').update(inlineScript(src, name), 'utf8').digest('base64');
    const csp = (src.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1] || '';
    check('csp: ' + name + ' carries a CSP naming its own script', csp.includes("'" + want + "'"),
      'expected ' + want + '; run web/sync.sh');
  }
});

// ---- 7: the Check page ------------------------------------------------------------------------------------------
await t('presentation: the Check page loads and points at its own share card', async () => {
  const page = await open(CHECK);
  check('check-page: the page loads with no pageerror and no console error', quiet(page), noise(page));
  const m = await page.evaluate(() => {
    const prop = (p) => (document.querySelector('meta[property="' + p + '"]') || {}).content || null;
    const name = (n) => (document.querySelector('meta[name="' + n + '"]') || {}).content || null;
    const link = (r) => { const el = document.querySelector('link[rel="' + r + '"]'); return el ? el.getAttribute('href') : null; };
    return { input: !!document.querySelector('#input'), from: !!document.querySelector('#from'),
             go: !!document.querySelector('#go'), out: !!document.querySelector('#out'),
             icon: link('icon'), touch: link('apple-touch-icon'),
             ogImage: prop('og:image'), twImage: name('twitter:image'), twCard: name('twitter:card'),
             ogTitle: prop('og:title'), title: document.title };
  });
  check('check-page: the thing to read, the sender box, the button and the answer are all there',
    m.input && m.from && m.go && m.out, JSON.stringify(m));
  check('check-page: the favicon is an inline SVG data URL',
    typeof m.icon === 'string' && m.icon.startsWith('data:image/svg+xml'), String(m.icon).slice(0, 60));
  check('check-page: the home-screen icon is /apple-touch-icon.png', m.touch === '/apple-touch-icon.png', m.touch);
  check('check-page: og:image is the Check page\'s own share card',
    m.ogImage === 'https://rhcheck.gmgnrepeat.com/og.png', m.ogImage);
  check('check-page: twitter:image is the Check page\'s own share card',
    m.twImage === 'https://rhcheck.gmgnrepeat.com/og.png', m.twImage);
  check('check-page: og:title is the page title', m.ogTitle === m.title, m.ogTitle + ' vs ' + m.title);
  check('check-page: twitter:card is summary_large_image', m.twCard === 'summary_large_image', m.twCard);
  await page.close();
});

await browser.close();
console.log('\n' + summaryLine(pass, fail));
process.exit(fail ? 1 : 0);
