// The page's own pure readers, run in node instead of a browser. These are the functions docs/readers.md
// calls "twins": more than one of them reads the same recipient-box text, and a round after round finding was
// one twin taught something the other was not. This file does not retype any of them. It reads
// web/index.html's own bytes, cuts out each named function by matching braces, and runs the result in a
// node:vm context that supplies only what a reader needs to run outside a browser: the real ethers build, a
// $() stub over a fixture object, and a std() stub that returns the standard the case is testing. If the
// page changes a reader, this file sees the change the next time it runs; nothing here can drift from it.
//
//   node test/readers.test.mjs
//
// Under five seconds. No browser, no network.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as ethers from 'ethers';

const PAGE_PATH = new URL('../web/index.html', import.meta.url);
const HTML = readFileSync(PAGE_PATH, 'utf8');

// ---- pull the inline script out of the page -----------------------------------------------------------
// The same rule client.test.mjs's CSP check uses: any <script> tag, however written, that carries no src=.
function inlineScript(html) {
  const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((m) => !/src=/i.test(m[1]) && m[2].trim()).map((m) => m[2]);
  if (blocks.length !== 1) throw new Error('web/index.html has ' + blocks.length + ' inline scripts; expected exactly 1');
  return blocks[0];
}
const SCRIPT = inlineScript(HTML);

// ---- a brace/paren/bracket matcher that understands the JS it is walking over ----------------------------
// It has to skip the contents of strings, comments, template interpolation and regex literals, or a literal
// character inside one of those -- a '{2,}' quantifier, a comma inside a quoted CSV example -- would be
// counted as real structure and the scan would end in the wrong place. This is the same shape of problem the
// harness's block-wrapping script solved for the two suite files; here it runs over arbitrary JS, not just
// blocks that start a line, so it has to be a real (if small) tokenizer rather than a line convention.
function scanBalanced(src, openIdx) {
  const open = src[openIdx];
  const close = { '{': '}', '(': ')', '[': ']' }[open];
  if (!close) throw new Error('scanBalanced: not an opening bracket at ' + openIdx);
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === open) { depth++; continue; }
    if (c === close) { depth--; if (depth === 0) return i + 1; continue; }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl === -1 ? src.length : nl; continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end === -1 ? src.length : end + 1; continue; }
    if (c === '"' || c === "'") { i = endOfString(src, i, c); continue; }
    if (c === '`') { i = endOfTemplate(src, i); continue; }
    if (c === '/' && isRegexStart(src, i)) { i = endOfRegex(src, i); continue; }
  }
  throw new Error('scanBalanced: unbalanced ' + open + ' starting at ' + openIdx);
}
function endOfString(src, i, quote) {
  i++;
  while (src[i] !== quote) { if (i >= src.length) throw new Error('unterminated string'); if (src[i] === '\\') i++; i++; }
  return i;
}
function endOfTemplate(src, i) {
  i++;
  while (src[i] !== '`') {
    if (i >= src.length) throw new Error('unterminated template literal');
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === '$' && src[i + 1] === '{') { i = scanBalanced(src, i + 1); continue; }
    i++;
  }
  return i;
}
// A '/' is a regex literal unless the token before it is a value (an identifier that is not a keyword, a
// number, a string, or a closing ')' or ']'). Good enough for this file: none of the readers this extracts
// divide anything.
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await']);
function isRegexStart(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  const c = src[j];
  if (/[A-Za-z0-9_$]/.test(c)) {
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k])) k--;
    return KEYWORDS_BEFORE_REGEX.has(src.slice(k + 1, j + 1));
  }
  if (c === ')' || c === ']') return false;
  return true;
}
function endOfRegex(src, i) {
  let inClass = false;
  i++;
  for (;;) {
    if (i >= src.length) throw new Error('unterminated regex literal');
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '[') { inClass = true; i++; continue; }
    if (c === ']') { inClass = false; i++; continue; }
    if (c === '/' && !inClass) { i++; break; }
    i++;
  }
  while (i < src.length && /[a-zA-Z]/.test(src[i])) i++;
  return i - 1;
}

// ---- named extraction, from a start marker through the balanced end of a named function --------------
// Several of the target readers share support code declared between them (a column-name table, a header
// reader, a batch-summary interface). Rather than guess which lines are "the" function and hand-copy the
// rest, each span below is cut from one exact marker already in the page's source through the closing brace
// of the last function the span needs, so everything in between -- support functions this test never calls
// included -- comes along verbatim. A support function that is never invoked cannot fail a case; it is dead
// weight, not a risk.
function sliceThroughFunction(startMarker, endFunctionName) {
  const startIdx = SCRIPT.indexOf(startMarker);
  if (startIdx === -1) throw new Error('extraction start marker not found in web/index.html: ' + startMarker);
  const fnRe = new RegExp('\\bfunction\\s+' + endFunctionName + '\\s*\\(', 'g');
  fnRe.lastIndex = startIdx;
  const m = fnRe.exec(SCRIPT);
  if (!m) throw new Error('extraction end function not found after its marker: ' + endFunctionName);
  const parenOpen = m.index + m[0].length - 1;
  const parenClose = scanBalanced(SCRIPT, parenOpen);
  const braceOpen = SCRIPT.indexOf('{', parenClose);
  const braceClose = scanBalanced(SCRIPT, braceOpen);
  return SCRIPT.slice(startIdx, braceClose);
}
function extractFunction(name) {
  const re = new RegExp('\\bfunction\\s+' + name + '\\s*\\(');
  const m = re.exec(SCRIPT);
  if (!m) throw new Error('function not found in web/index.html: ' + name);
  const parenOpen = m.index + m[0].length - 1;
  const parenClose = scanBalanced(SCRIPT, parenOpen);
  const braceOpen = SCRIPT.indexOf('{', parenClose);
  const braceClose = scanBalanced(SCRIPT, braceOpen);
  return SCRIPT.slice(m.index, braceClose);
}
// `const NAME = (...) => { ... };` -- an arrow whose body is a block, not a bare expression. Both readers
// declared this way (wholeText, shortAddr) have block bodies, so this is the only shape needed here.
function extractArrowConst(name) {
  const re = new RegExp('\\bconst\\s+' + name + '\\s*=\\s*');
  const m = re.exec(SCRIPT);
  if (!m) throw new Error('const not found in web/index.html: ' + name);
  let i = m.index + m[0].length;
  if (SCRIPT[i] !== '(') throw new Error(name + ' is not declared as (params) => { ... }');
  const parenClose = scanBalanced(SCRIPT, i);
  let j = parenClose;
  while (/\s/.test(SCRIPT[j])) j++;
  if (SCRIPT.slice(j, j + 2) !== '=>') throw new Error(name + ' is not an arrow function');
  j += 2;
  while (/\s/.test(SCRIPT[j])) j++;
  if (SCRIPT[j] !== '{') throw new Error(name + ' does not have a block body');
  const braceClose = scanBalanced(SCRIPT, j);
  return SCRIPT.slice(m.index, braceClose) + ';';
}
// `const NAME = [ ... ];`
function extractArrayConst(name) {
  const re = new RegExp('\\bconst\\s+' + name + '\\s*=\\s*\\[');
  const m = re.exec(SCRIPT);
  if (!m) throw new Error('array const not found in web/index.html: ' + name);
  const openIdx = m.index + m[0].length - 1;
  const closeIdx = scanBalanced(SCRIPT, openIdx);
  return SCRIPT.slice(m.index, closeIdx) + ';';
}

// ---- the spans this file needs, each named for what it ends on -------------------------------------------
// Span A: the recipient-box column table and every reader in Input 1 of docs/readers.md except parseList
// itself (parseList's per-line logic is a loop body woven through page state -- $('list'), confirm(), the
// live token standard -- not a separable pure function, so it is exercised through the browser suite only,
// as docs/harness.md allows).
const SPAN_COLUMNS_AND_READERS = sliceThroughFunction('const COLS = {', 'readHeader');
// Span B: how many deliveries a line asks for, and the two box-wide readers built on it.
const SPAN_DELIVERIES_AND_BOX = sliceThroughFunction('function deliveriesOn(', 'unreadableLinesInBox');
// Span C: the batch ABI a receipt is read against.
const SPAN_BULK_ABI = extractArrayConst('BULK_ABI');
// Span D: reading a BulkSend receipt back, keyed to the batch that was actually sent.
const SPAN_READ_BATCH_RECEIPT = sliceThroughFunction('const BULK_IFACE = new ethers.Interface(BULK_ABI);', 'readBatchReceipt');
// Span E: turning an EIP-5792 wallet_getCallsStatus answer into one of five states.
const SPAN_READ_CALLS_STATUS = extractFunction('readCallsStatus');
// Span F: revert reasons in words, and the two functions that turn one into what a person reads.
const SPAN_REVERT_WORDS = sliceThroughFunction('const KNOWN = {', 'explainCallError');
// Span G: shortening an address for display, without merging two different ones into the same head.
const SPAN_SHORT_ADDR = extractArrowConst('shortAddr');

// ---- the vm context: only what these spans use, nothing this page's DOM or network would otherwise supply --
const fixture = { list: '', std: '721' };
const sandbox = {
  ethers,
  // Reads only #list and #std, which is everything any reader on the extraction list touches.
  $: (id) => ({ value: id === 'list' ? fixture.list : id === 'std' ? fixture.std : '' }),
  std: () => fixture.std,
  // decodeReason's "no reason at all" sentence names the gas allowance; nothing in the reader-disagreement
  // cases below exercises that branch, so a fixed default is enough to let the function run.
  customGas: () => null,
  gasBounds: { min: 100000, max: 5000000, def: 400000 },
};
vm.createContext(sandbox);
for (const span of [SPAN_COLUMNS_AND_READERS, SPAN_DELIVERIES_AND_BOX, SPAN_BULK_ABI,
  SPAN_READ_BATCH_RECEIPT, SPAN_READ_CALLS_STATUS, SPAN_REVERT_WORDS, SPAN_SHORT_ADDR]) {
  vm.runInContext(span, sandbox, { filename: 'web/index.html (extracted)' });
}
// `function` declarations attach themselves to the vm context object automatically, the same way they attach
// to `window` in a real page. `const`/`let` do not -- they live in a lexical scope tied to the script that
// declared them, invisible from outside even though every function above can still see them (a closure keeps
// the scope it was defined in, regardless of how this test reaches the function afterward). wholeText and
// shortAddr are declared with const and are called directly by name below, so they need pulling out by hand;
// every other reader in this file is a `function`, and needs no such fix.
vm.runInContext('globalThis.wholeText = wholeText; globalThis.shortAddr = shortAddr;', sandbox);
const R = sandbox; // R.splitRow, R.boxColumns, R.addressOn, ... -- the readers under test

// ---- the tiny check/report machinery, same shape as the browser suites so verify.sh can read it the same --
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  <- ' + String(detail).slice(0, 300) : '')); }
}
// readBatchReceipt's rows carry BigInt ids and amounts, which JSON.stringify refuses outright. This is only
// ever used to print a detail string on a failing check, so turning a BigInt into its decimal text is enough.
const safeJSON = (x) => JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
// Sets the box text and standard every reader in a table call reads through $() and std(), then names one
// case per reader so a single disagreeing reader fails by name instead of the whole table going red.
function withBox(list, std, fn) {
  fixture.list = list; fixture.std = std;
  fn();
}

console.log('=== readers: the page\'s pure functions, extracted from web/index.html and run in node ===');

// ---- one input, one way of cutting it into cells (S-8) ----------------------------------------------------
{
  check('splitRow: a plain comma line splits on every comma', JSON.stringify(R.splitRow('0xabc,1,2')) === JSON.stringify(['0xabc', '1', '2']));
  check('splitRow: a quoted field survives a comma inside it', JSON.stringify(R.splitRow('"0xabc","1,234.5"')) === JSON.stringify(['0xabc', '1,234.5']));
  check('splitRow: a doubled quote inside a quoted field is one literal quote', JSON.stringify(R.splitRow('"a""b",2')) === JSON.stringify(['a"b', '2']));
  check('splitRow: tab, semicolon and = are all separators, like the comma', JSON.stringify(R.splitRow('0xabc\t1')) === JSON.stringify(['0xabc', '1'])
    && JSON.stringify(R.splitRow('0xabc;1')) === JSON.stringify(['0xabc', '1'])
    && JSON.stringify(R.splitRow('0xabc=1')) === JSON.stringify(['0xabc', '1']));
  check('splitRow: disperse.app\'s space-separated pair reads as two cells', JSON.stringify(R.splitRow('0xabc 1.5')) === JSON.stringify(['0xabc', '1.5']));
  check('splitRow: a blank cell keeps its position rather than shifting the next cell left',
    JSON.stringify(R.splitRow('0xabc,,3')) === JSON.stringify(['0xabc', '', '3']));
  check('splitRow: a trailing separator is not read as an extra empty column', JSON.stringify(R.splitRow('0xabc,1,')) === JSON.stringify(['0xabc', '1']));
  check('serializeRow: a comma inside a cell round-trips through splitRow unchanged',
    (() => { const enc = R.serializeRow(['a,b', '1']); return JSON.stringify(R.splitRow(enc)) === JSON.stringify(['a,b', '1']); })());
  check('serializeRow: metadata that itself looks like a CSV cell ("123,456") stays one column',
    (() => { const enc = R.serializeRow(['0xabc', '123,456', '7']); return JSON.stringify(R.splitRow(enc)) === JSON.stringify(['0xabc', '123,456', '7']); })());
}

// ---- whole numbers: what a spreadsheet writes for "1" is still 1, and a truncated one is refused ------------
{
  check('wholeText: "1" is a whole number', R.wholeText('1') === '1');
  check('wholeText: "1.0" is the same whole number a spreadsheet just padded', R.wholeText('1.0') === '1');
  check('wholeText: "1.000" is still 1, however many zeros follow the point', R.wholeText('1.000') === '1');
  check('wholeText: "1.50" is not a whole number -- only zeros may follow the point', R.wholeText('1.50') === null);
  check('wholeText: "0" reads as the text "0", not null -- wholeNumber is what refuses zero, not wholeText', R.wholeText('0') === '0');
  check('wholeNumber: "0" is refused -- a quantity of zero is not a silent one', R.wholeNumber('0') === null);
  check('wholeNumber: "3" is 3', R.wholeNumber('3') === 3);
  check('wholeNumber: "3.0" is also 3', R.wholeNumber('3.0') === 3);
  check('wholeNumber: "1.23457E+11", which is how a spreadsheet writes a truncated id, is refused', R.wholeNumber('1.23457E+11') === null);
  check('wholeNumber: a non-string is refused rather than coerced', R.wholeNumber(3) === null);
}

// ---- headed CSV: the heading row is read by name, not counted as a wallet (round thirteen S-1/S-2) --------
withBox('address,tokenId,amount\n' + '0x1111111111111111111111111111111111111111,1,3\n'
  + '0x2222222222222222222222222222222222222222,2,2\n', '721', () => {
  const col = R.boxColumns();
  check('boxColumns: a named header is read into a column map', col && col.to === 0 && col.id === 1 && col.qty === 2, JSON.stringify(col));
  check('walletsInBox: the heading is not counted as a wallet', R.walletsInBox().length === 2, JSON.stringify(R.walletsInBox()));
  check('unreadableLinesInBox: a well-formed headed file has no unreadable lines', R.unreadableLinesInBox().length === 0, JSON.stringify(R.unreadableLinesInBox()));
  const lines = fixture.list.split('\n');
  check('addressOn: reads the address by column, not by position', R.addressOn(lines[1], col) === ethers.getAddress('0x1111111111111111111111111111111111111111'));
});

// ---- a header naming only the address column is address-only, not zero ids everywhere ---------------------
withBox('address\n0x1111111111111111111111111111111111111111\n0x2222222222222222222222222222222222222222\n', '721', () => {
  const col = R.boxColumns();
  check('boxColumns: an address-only header names no id or amount column', col && col.to === 0 && col.id === undefined && col.qty === undefined, JSON.stringify(col));
  check('walletsInBox: still reads both wallets', R.walletsInBox().length === 2, JSON.stringify(R.walletsInBox()));
});

// ---- a column order no positional reader would guess, read correctly because it is named -------------------
withBox('tokenId,amount,address\n7,1,0x1111111111111111111111111111111111111111\n', '1155', () => {
  const col = R.boxColumns();
  check('boxColumns: "tokenId" does not lend its "to" substring to the address column', col && col.to === 2, JSON.stringify(col));
  const line = fixture.list.split('\n')[1];
  check('addressOn: reads the address from the named column at the end of the line', R.addressOn(line, col) === ethers.getAddress('0x1111111111111111111111111111111111111111'));
});

// ---- quoted tokenIds cell: several ids in one cell, comma-separated inside quotes --------------------------
withBox('address,tokenIds\n0x1111111111111111111111111111111111111111,"251 252 253"\n', '721', () => {
  const col = R.boxColumns();
  const line = fixture.list.split('\n')[1];
  check('splitRow: a quoted tokenIds cell holding several ids stays one cell', R.splitRow(line)[1] === '251 252 253');
  check('addressOn: the address is still read correctly beside a quoted multi-id cell', R.addressOn(line, col) === ethers.getAddress('0x1111111111111111111111111111111111111111'));
});

// ---- x0: a quantity of zero is not silently rounded up to one (requestedNftQuantity / deliveriesOn agree) --
{
  const lineX0 = '0x1111111111111111111111111111111111111111 x0';
  const q = R.requestedNftQuantity(lineX0, null, 1);
  // wholeNumber refuses zero (it requires n > 0), so "x0" is not a request for zero deliveries -- it is an
  // invalid override, the same as any other multiplier wholeNumber cannot parse. n is null, not 0.
  check('requestedNftQuantity: "x0" is refused as an override rather than read as a request for zero', q.n === null, JSON.stringify(q));
  fixture.std = '721';
  check('deliveriesOn: "x0" never delivers zero -- an invalid override falls back to one, the same as no override at all',
    R.deliveriesOn(lineX0, null) === 1, R.deliveriesOn(lineX0, null));
}

// ---- xN shorthand versus a named quantity column: two ways of saying "how many", one reader for both -------
withBox('address,quantity\n0x1111111111111111111111111111111111111111,3\n', '721', () => {
  const col = R.boxColumns();
  const line = fixture.list.split('\n')[1];
  const q = R.requestedNftQuantity(line, col, 1);
  check('requestedNftQuantity: a named quantity column is authoritative', q.n === 3 && q.named === true, JSON.stringify(q));
  check('deliveriesOn: the same named column, the same count', R.deliveriesOn(line, col) === 3, R.deliveriesOn(line, col));
}
);
// The shorthand is a positional-list convention only: typed into a column a header already named "quantity",
// "x3" is not read as the multiplier. A header is authoritative, or it is not a header at all.
withBox('address,quantity\n0x1111111111111111111111111111111111111111,x3\n', '721', () => {
  const col = R.boxColumns();
  const line = fixture.list.split('\n')[1];
  const q = R.requestedNftQuantity(line, col, 1);
  check('requestedNftQuantity: "x3" typed into a named quantity column is refused, not read as the shorthand',
    q.n === null && q.named === true, JSON.stringify(q));
  check('deliveriesOn: the same refused cell falls back to one rather than guessing at the shorthand',
    R.deliveriesOn(line, col) === 1, R.deliveriesOn(line, col));
});
{
  const lineX = '0x1111111111111111111111111111111111111111 x3';
  const q = R.requestedNftQuantity(lineX, null, 1);
  check('requestedNftQuantity: the positional xN shorthand is read when there is no named column', q.n === 3 && q.named === false, JSON.stringify(q));
  fixture.std = '721';
  check('deliveriesOn: the bare xN shorthand reads the same count', R.deliveriesOn(lineX, null) === 3, R.deliveriesOn(lineX, null));
}

// ---- multi-id lines: "0xabc,1,2,3" is three deliveries to every reader that counts them (round 18 S-1) ------
{
  const line = '0x1111111111111111111111111111111111111111,1,2,3';
  fixture.std = '721';
  const q = R.requestedNftQuantity(line, null, 1);
  check('requestedNftQuantity: several bare ids after the address count as that many deliveries', q.n === 3, JSON.stringify(q));
  check('deliveriesOn: the same line, the same count, with no column map', R.deliveriesOn(line, null) === 3, R.deliveriesOn(line, null));
  // Several ids on one line is an ERC-721 reading only: docs/recipient-lists.md refuses it for ERC-1155
  // ("0xabc,1,2,3 cannot say whether 3 is an id or an amount") and it means nothing at all for ERC-20. The
  // same exact text is one delivery, not three, once the standard is not ERC-721 -- deliveriesOn's first line
  // is `if (std() !== '721') return 1`, so this line has to be read differently depending on what else is on
  // the page, not on anything in the line itself.
  fixture.std = '1155';
  check('deliveriesOn: the identical line on ERC-1155 is one delivery, not three (an edition needs an id AND an amount, not several ids)',
    R.deliveriesOn(line, null) === 1, R.deliveriesOn(line, null));
  fixture.std = '20';
  check('deliveriesOn: the identical line on ERC-20 is one delivery too (a token amount, never several ids)',
    R.deliveriesOn(line, null) === 1, R.deliveriesOn(line, null));
  fixture.std = '721';
}
withBox('address,tokenId\n0x1111111111111111111111111111111111111111,1 2 3\n', '721', () => {
  const col = R.boxColumns();
  const line = fixture.list.split('\n')[1];
  check('deliveriesOn: a space-separated multi-id cell under a named tokenId column also counts as three',
    R.deliveriesOn(line, col) === 3, R.deliveriesOn(line, col));
  // Round 21 F-6: requestedNftQuantity (what Assign asks for) had no rule at all for a named id cell holding
  // several ids -- deliveriesOn (what the parser and the picker size for) is the only one of the two readers
  // that had it. Same box, same line: the two must now agree.
  const q = R.requestedNftQuantity(line, col, 1);
  check('requestedNftQuantity: the same space-separated multi-id cell also counts as three, agreeing with deliveriesOn',
    q.n === 3 && q.named === true, JSON.stringify(q));
}
);

// ---- round 21 F-6, second shape: a headed file naming both an id and an amount names an id, not the amount --
withBox('address,tokenId,amount\n0x1111111111111111111111111111111111111111,1,3\n', '721', () => {
  const col = R.boxColumns();
  const line = fixture.list.split('\n')[1];
  const q = R.requestedNftQuantity(line, col, 1);
  check('requestedNftQuantity: a named id column is read before a named amount column that sits beside it, not the amount',
    q.n === 1, JSON.stringify(q));
  check('deliveriesOn: agrees -- one id, not the amount', R.deliveriesOn(line, col) === 1, R.deliveriesOn(line, col));
});

// ---- the zero address is never a readable recipient -------------------------------------------------------
{
  const zero = '0x0000000000000000000000000000000000000000';
  check('addressOn: the zero address is a valid checksum and addressOn returns it (the refusal is elsewhere)',
    R.addressOn(zero + ',1', null) === ethers.getAddress(zero));
  check('ethers.ZeroAddress: the constant every recipient-refusal check compares against matches the literal',
    ethers.ZeroAddress.toLowerCase() === zero);
}

// ---- a checksum failure is reported as a checksum failure, not a generic "not an address" -------------------
{
  // A real checksummed address (Vitalik's, commonly used in examples) with one capital flipped to lowercase.
  // The all-numeric fixture addresses used elsewhere in this file carry no letters at all, so there is no
  // capital to break; this needs an address whose EIP-55 checksum actually depends on which letters are which case.
  const goodChecksum = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const badChecksum = goodChecksum.replace('dA', 'da');
  check('addressOn: a correctly checksummed address is accepted', R.addressOn(goodChecksum + ',1', null) === goodChecksum);
  check('addressOn: the same address with one capital flipped fails its own checksum and is refused',
    R.addressOn(badChecksum + ',1', null) === null);
}

// ---- files from other tools (docs/recipient-lists.md): each header format is read as that page promises ----
const OTHER_TOOLS = [
  { name: 'Etherscan holders (HolderAddress,Balance)', header: 'HolderAddress,Balance', to: 0, qty: 1 },
  { name: 'Blockscout holders (Address,Balance)', header: 'Address,Balance', to: 0, qty: 1 },
  { name: 'thirdweb (address,quantity)', header: 'address,quantity', to: 0, qty: 1 },
  { name: 'Dune (wallet)', header: 'wallet', to: 0 },
  { name: 'Premint (wallet_address)', header: 'wallet_address', to: 0 },
  { name: 'Moralis/Alchemy (owner_address,token_id,amount)', header: 'owner_address,token_id,amount', to: 0, id: 1, qty: 2 },
  { name: 'OpenSea (Owner,Token ID)', header: 'Owner,Token ID', to: 0, id: 1 },
  { name: 'snapshot.org (voter,vp)', header: 'voter,vp', to: 0, qty: 1 },
  // "token_address" contains the word "address" as a fragment, and "receiver" is the real address column.
  // Whole-name matching has to claim "receiver" before word-fragment matching ever looks at "token_address",
  // or a Safe export would have its recipient column stolen by its own token-metadata column.
  { name: 'Safe airdrop app (token_type,token_address,receiver,amount,id)', header: 'token_type,token_address,receiver,amount,id', to: 2, qty: 3, id: 4 },
];
for (const t of OTHER_TOOLS) {
  const col = R.readHeader(t.header);
  const okTo = col && col.to === t.to;
  const okId = t.id === undefined ? col && col.id === undefined : col && col.id === t.id;
  const okQty = t.qty === undefined ? col && col.qty === undefined : col && col.qty === t.qty;
  check('readHeader: ' + t.name + ' is read into the right columns', !!(okTo && okId && okQty), JSON.stringify(col));
}
// disperse.app's two written forms both split into address and amount, through splitRow rather than readHeader
// (disperse files carry no heading row at all).
check('splitRow: disperse.app "0xabc 1.5" reads as [address, amount]',
  JSON.stringify(R.splitRow('0x1111111111111111111111111111111111111111 1.5'))
  === JSON.stringify(['0x1111111111111111111111111111111111111111', '1.5']));
check('splitRow: disperse.app "0xabc=1.5" reads the same way through the = separator',
  JSON.stringify(R.splitRow('0x1111111111111111111111111111111111111111=1.5'))
  === JSON.stringify(['0x1111111111111111111111111111111111111111', '1.5']));

// ---- a data row is never mistaken for a heading, and a heading is never mistaken for data ------------------
check('readHeader: a row containing an address is data, never a heading',
  R.readHeader('0x1111111111111111111111111111111111111111,1') === null);
check('readHeader: a line of unrecognised words is not a heading either (both readings are for the caller, not this function)',
  R.readHeader('foo,bar') === null);

// ---- unreadableLinesInBox: a mistyped line is reported, and the heading itself is never one of them --------
withBox('address,tokenId\n0x1111111111111111111111111111111111111111,1\nnotanaddress,2\n', '721', () => {
  const bad = R.unreadableLinesInBox();
  check('unreadableLinesInBox: the one bad line is named by its line number, and the heading is not among them',
    JSON.stringify(bad) === JSON.stringify([3]), JSON.stringify(bad));
});

// ---- readBatchReceipt: a receipt is read against the batch that was sent, not a form (S-12) -----------------
{
  const NFT = '0x' + '72'.repeat(20).slice(0, 40);
  const ME = '0x' + 'de'.repeat(20).slice(0, 40);
  const OTHER = '0x' + 'fe'.repeat(20).slice(0, 40);
  const BULK = '0x' + 'bb'.repeat(20).slice(0, 40);
  const to = '0x' + 'c9'.repeat(20).slice(0, 40);
  const iface = new ethers.Interface([
    'event Skipped(address indexed token, address indexed to, uint256 id, uint256 amount, bytes reason)',
    'event Airdrop721(address indexed token, address indexed from, uint256 sent, uint256 skipped)',
  ]);
  const skippedLog = iface.encodeEventLog('Skipped', [NFT, to, 7n, 0n, '0x']);
  const summaryLog = (from) => iface.encodeEventLog('Airdrop721', [NFT, from, 0n, 1n]);
  const chunk = [{ to, id: 7n, k: 'x#1' }];
  const asLog = (enc) => ({ address: BULK, topics: enc.topics, data: enc.data });
  const readWith = (fromForSummary, forFrom) => R.readBatchReceipt(
    { logs: [asLog(skippedLog), asLog(summaryLog(fromForSummary))] }, chunk, BULK, NFT, '721', forFrom);
  check('readBatchReceipt: a receipt matching the batch\'s own sender is read cleanly, not ambiguous',
    readWith(ME, ME).ambiguous === false, safeJSON(readWith(ME, ME)));
  check('readBatchReceipt: the same receipt read against a different sender is ambiguous, never silently accepted',
    readWith(ME, OTHER).ambiguous === true, safeJSON(readWith(ME, OTHER)));
  const wrongTokenChunk = chunk;
  const wrongToken = R.readBatchReceipt({ logs: [asLog(skippedLog), asLog(summaryLog(ME))] }, wrongTokenChunk, BULK, OTHER, '721', ME);
  check('readBatchReceipt: an event about a different token than the one that was sent is ambiguous',
    wrongToken.ambiguous === true, safeJSON(wrongToken));
}

// ---- readCallsStatus: the wallet's own claim never overrides a receipt that contradicts it (round eleven B-1) -
{
  const okReceipt = [{ transactionHash: '0x' + 'ab'.repeat(32), status: '0x1' }];
  check('readCallsStatus: a numeric 500 alongside a receipt that succeeded is read as contradicted, not reverted',
    R.readCallsStatus({ status: 500, receipts: okReceipt }).state === 'partial',
    JSON.stringify(R.readCallsStatus({ status: 500, receipts: okReceipt })));
  check('readCallsStatus: the string "FAILED", which no version of EIP-5792 defines, is unknown rather than a release signal',
    R.readCallsStatus({ status: 'FAILED', receipts: [] }).state === 'unknown',
    JSON.stringify(R.readCallsStatus({ status: 'FAILED', receipts: [] })));
  check('readCallsStatus: a real failure with nothing contradicting it still reports failed',
    R.readCallsStatus({ status: 400, receipts: [] }).state === 'failed');
  check('readCallsStatus: 200 with every receipt confirmed is read as confirmed',
    R.readCallsStatus({ status: 200, receipts: okReceipt }).state === 'confirmed');
  check('readCallsStatus: 200 with a failed receipt among them is partial, not confirmed',
    R.readCallsStatus({ status: 200, receipts: [{ transactionHash: '0x1', status: '0x0' }] }).state === 'partial');
}

// ---- decodeReason / explainCallError: a known selector reads in words; an unknown one is not disguised -------
{
  check('decodeReason: a token-declared revert string is quoted and attributed to the contract, not this page',
    /“recipient blocked”/i.test(R.decodeReason('0x08c379a0'
      + ethers.AbiCoder.defaultAbiCoder().encode(['string'], ['recipient blocked']).slice(2))));
  check('decodeReason: a known BulkSend selector reads in words, not as raw hex',
    R.decodeReason('0xea553b34') === 'recipient is the zero address');
  check('decodeReason: an unrecognised selector is shown as what it is, not invented',
    R.decodeReason('0xdeadbeef') === 'reverted with 0xdeadbeef');
  check('explainCallError: a selector written inside free-form error text is not read as the real one (XSS/advice-spoofing guard)',
    !/untick|safe-transfer/i.test(R.explainCallError({ message: 'contact support quoting 0x64a0ae92 for help' })));
}

// ---- shortAddr: both ends are shown, so two addresses sharing a long prefix are not rendered identically ----
{
  const a = '0x1111111111111111111111111111111111111111';
  const b = '0x1111111111111111111111111111111111111112';
  check('shortAddr: a short value is left alone', R.shortAddr('0xabc') === '0xabc');
  check('shortAddr: two addresses sharing a prefix render with different tails', R.shortAddr(a) !== R.shortAddr(b), R.shortAddr(a) + ' vs ' + R.shortAddr(b));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
