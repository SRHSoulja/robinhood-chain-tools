// Renders web/og-trust.png, the Trust Center's 1200x630 share card.
//
//     node deploy/render-trust-card.mjs        (from the repository root)
//
// Every figure on the card is read from docs/trust/data.json, which deploy/build-trust.py wrote from the
// files in this repository. So the card and the page cannot disagree: there is one source for both, and this
// script has no numbers of its own. Run the generator first; if data.json is missing or older than the page,
// this refuses rather than rendering a card that says something the page does not.
//
// The palette is web/og-airdrop.png's: the dark ground the pages use in dark mode, the same green accent, and
// a mono face for anything that is a figure. The URL is printed TOP-RIGHT on purpose: X overlays its own
// title chip across the bottom-left of a shared card, so nothing that has to be read goes there.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = join(ROOT, 'docs/trust/data.json');
const OUT = join(ROOT, 'web/og-trust.png');

if (!existsSync(DATA)) {
  console.error('render-trust-card: ' + DATA + ' is missing. Run python3 deploy/build-trust.py first.');
  process.exit(1);
}
const data = JSON.parse(readFileSync(DATA, 'utf8'));
const g = data.glance, f = data.figures;
for (const key of ['critical', 'high', 'medium', 'rounds', 'rounds_without_blocker', 'checks', 'live_mainnet']) {
  if (g[key] === undefined) {
    console.error('render-trust-card: docs/trust/data.json has no glance.' + key);
    process.exit(1);
  }
}
if (g.live_mainnet !== 'PASS') {
  console.error('render-trust-card: glance.live_mainnet is ' + g.live_mainnet + ', so the card would claim a '
    + 'verified runtime that the recorded run does not support.');
  process.exit(1);
}

const addr = data.provenance.mainnet.BulkSend;
const short = addr.slice(0, 10) + '…' + addr.slice(-8);
const url = 'rhairdrop.gmgnrepeat.com/trust';

const FIGURES = [
  [`${g.critical} / ${g.high} / ${g.medium}`, 'critical / high / medium'],
  [`${g.rounds}`, `review rounds, ${g.rounds_without_blocker} with no blocker`],
  [f.checks_total, 'passing checks'],
  ['verified', 'live mainnet runtime'],
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const card = `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  html,body{width:1200px;height:630px}
  body{
    background:#101412;color:#e8ede9;
    font:16px/1.4 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    position:relative;overflow:hidden;
  }
  .glow{position:absolute;inset:0;
    background:radial-gradient(760px 420px at 86% 8%, rgba(63,191,127,.20), rgba(16,20,18,0) 68%);}
  .grid{position:absolute;inset:0;opacity:.5;
    background-image:linear-gradient(rgba(63,191,127,.055) 1px, transparent 1px),
                     linear-gradient(90deg, rgba(63,191,127,.055) 1px, transparent 1px);
    background-size:60px 60px;}
  .frame{position:relative;height:100%;padding:56px 72px;display:flex;flex-direction:column}
  .url{position:absolute;top:46px;right:72px;font-family:var(--mono);font-size:22px;color:#3fbf7f;letter-spacing:.2px}
  :root{--mono:"IBM Plex Mono",ui-monospace,"DejaVu Sans Mono",SFMono-Regular,Menlo,monospace}
  h1{font-size:64px;line-height:1.04;font-weight:800;letter-spacing:-1.2px}
  h1 span{color:#3fbf7f}
  .sub{margin-top:14px;font-size:23px;color:#9aa69f;max-width:660px;line-height:1.35}
  .figs{margin-top:auto;display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
  .fig{border:1px solid #27302b;border-radius:12px;padding:18px 20px;background:rgba(23,29,25,.72)}
  .fig .v{font-family:var(--mono);font-size:40px;font-weight:600;color:#3fbf7f;letter-spacing:-.5px;white-space:nowrap}
  .fig .k{margin-top:8px;font-size:15px;color:#9aa69f;line-height:1.3}
  .foot{margin-top:26px;display:flex;justify-content:space-between;align-items:baseline;
    font-family:var(--mono);font-size:19px;color:#9aa69f}
  .foot b{color:#e8ede9;font-weight:400}
</style>
<div class="glow"></div><div class="grid"></div>
<div class="frame">
  <div class="url">${esc(url)}</div>
  <h1>BulkSend<br><span>Trust Center</span></h1>
  <div class="sub">What has been reviewed, measured and verified, from the files in the repository.</div>
  <div class="figs">
    ${FIGURES.map(([v, k]) => `<div class="fig"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`).join('')}
  </div>
  <div class="foot"><span><b>${esc(short)}</b> on Robinhood Chain mainnet</span><span>open source · MIT</span></div>
</div>`;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(card, { waitUntil: 'load' });
await page.screenshot({ path: OUT, type: 'png' });
await browser.close();

// Read it back. A share card nobody looked at is how a blank 1200x630 rectangle gets published: the file
// exists, the publisher accepts it, and the first person to see it is whoever shares the link.
const check = execFileSync('python3', ['-c', `
import struct, sys, zlib
path = sys.argv[1]
data = open(path, 'rb').read()
assert data[:8] == b'\\x89PNG\\r\\n\\x1a\\n', 'not a PNG: the 8-byte signature is wrong'
assert data[12:16] == b'IHDR', 'no IHDR chunk where a PNG must have one'
w, h, depth, colour = struct.unpack('>IIBB', data[16:26])
assert (w, h) == (1200, 630), 'the card is %dx%d, and it has to be 1200x630' % (w, h)
# Non-blank: decompress the image data and count distinct byte values. A card that failed to render is one
# colour from edge to edge, and that is exactly what a dimension check cannot see.
idat = b''
i = 8
while i < len(data):
    n = struct.unpack('>I', data[i:i+4])[0]
    tag = data[i+4:i+8]
    if tag == b'IDAT':
        idat += data[i+8:i+8+n]
    i += 12 + n
raw = zlib.decompress(idat)
distinct = len(set(raw))
assert distinct > 24, 'the card has only %d distinct byte values, so it rendered blank' % distinct
print('%dx%d, %d bit depth, colour type %d, %d distinct byte values, %d bytes'
      % (w, h, depth, colour, distinct, len(data)))
`, OUT], { encoding: 'utf8' }).trim();

console.log('  wrote web/og-trust.png  (' + check + ')');
console.log('  figures from docs/trust/data.json: ' + FIGURES.map(([v]) => v).join(' | ') + ' | ' + short);
