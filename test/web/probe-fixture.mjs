// A fixture for the historical reviewer probes, loaded by the runner (verify.sh, quick.sh) through Node's
// --import, never by the probes themselves. Every probe file is the reviewer's evidence, pinned verbatim by
// its sha256 in test/findings-baseline.json, and every one of them was written when the page's first network
// option was testnet: their wallet and RPC mocks answer chain 46630 and never mention another. On 12 September
// 2026 the page's fresh-visit default became mainnet (4663), and the page began remembering the last chosen
// network in localStorage under 'bulksend:net'. Rather than editing eight pieces of evidence, this fixture
// gives every browser context the probes open the one thing a returning tester's browser would have carried:
// that remembered choice, testnet. The probes then run in exactly the environment they were written for, and
// their assertion fingerprints must remain byte-identical to the baseline, which is what proves this fixture
// changed nothing but the starting network. It touches nothing else: no mocks, no timing, no answers.
import { chromium } from 'playwright';
const seed = async (ctx) => { await ctx.addInitScript(() => { try { localStorage.setItem('bulksend:net', '46630'); } catch (e) {} }); };
const proto = Object.getPrototypeOf(chromium);
const launch = proto.launch;
proto.launch = async function (...args) {
  const browser = await launch.apply(this, args);
  const newContext = browser.newContext.bind(browser), newPage = browser.newPage.bind(browser);
  browser.newContext = async (...a) => { const c = await newContext(...a); await seed(c); return c; };
  browser.newPage = async (...a) => { const p = await newPage(...a); await seed(p.context()); return p; };
  return browser;
};
