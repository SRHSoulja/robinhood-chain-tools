# The test harness: a fast inner loop under the same outer gate

## Why this exists

Every change to this repository, however small, has cost the same 35-minute `./verify.sh`, because the browser
suite is one 3,000-line file of 362 checks in 110 unnamed blocks that only runs whole, with no faster layer
under it. A one-line fix and a redesign cost the same to prove; a single thrown error kills every check and
the results are held until the end; nothing can be run by area. Over a week of review rounds that was the
dominant cost, and it was paid per fix. The maintainer, 12 September 2026: "still not understanding how there
are no shorter tests to properly test things".

This is not a shortcut. Nothing here removes a check, weakens the fingerprint gate, or skips the full verify
before a commit. It adds a fast loop for development under the gate that already exists.

## The four changes

### 1. Named cases, runnable by area, isolated, streaming

`test/web/client.test.mjs` and `test/web/check.test.mjs` keep every check, verbatim, under the same names.
Each bare `{ ... }` block becomes `await t('<area>: <what the block is about>', async () => { ... })` where
`t` is a tiny runner in a new `test/web/lib.mjs`:

- it prints each check as it happens (`  ok   ...` / `  FAIL ...`), not at the end;
- a thrown error inside one case fails that case with the error's first line and continues with the next,
  and the page it opened is closed;
- `ONLY=<regex>` (environment) runs only the cases whose name matches; the summary line then says
  `N passed, M failed (K of 110 cases run, filter "...")`, so a filtered run can never be mistaken for a full one;
- `verify.sh` keeps calling the suites unfiltered; it must refuse to count a filtered run (it greps the
  summary line for `of ... cases run` and fails if present).

Area prefixes, chosen from the section comments already in the file: `parse`, `assign`, `picker`, `snapshot`,
`send`, `ledger`, `wallet`, `wc`, `gas`, `check-page`, `csp`, `probe-pins`. A case's name is the section
comment's first sentence, unchanged in meaning.

### 2. The page's pure readers, in node, in seconds

These functions in `web/index.html` read text and return values, touch nothing on screen, and are the twins
`docs/readers.md` is about: `splitRow`, `boxColumns`, `addressOn`, `deliveriesOn`, `walletsInBox`,
`unreadableLinesInBox`, `requestedNftQuantity`, `wholeText`, `wholeNumber`, `serializeRow`, `parseList`'s
line-level core if it can be separated without changing it, `readBatchReceipt`, `readCallsStatus`,
`decodeReason`, `explainCallError`, `shortAddr`.

A new `test/readers.test.mjs` loads them **from the page's own bytes**: it reads `web/index.html`, takes the
inline script, extracts each named function by balanced braces, and evaluates them in a `node:vm` context
that supplies only what they use (`ethers` from the pinned build already in `node_modules` or vendored for
the test, a `$()` stub returning elements with `value`, `std()` returning the standard under test, and the
constants they reference). No reader is copied into the test file: if the page changes, the test sees the
change. If a reader cannot be extracted without editing the page, the page may be edited to make the
function self-contained, and that edit goes through the full verify like any page change.

Cases: every disagreement the rounds found (rounds 13 to 18: headed CSV, quoted fields, `x0`, multi-id lines,
zero address, the `xN` shorthand versus a named quantity column, files from other tools in
`docs/recipient-lists.md`), asserted across every reader that consumes the same input in one table, so a
reader that disagrees fails by name.

### 3. `test/quick.sh`

Under two minutes for a targeted change, and honest about what it did not run:

    ./test/quick.sh                       # node layers: readers, worker, csp-gate, forge (ordinary files)
    ./test/quick.sh assign snapshot       # plus the browser cases in those areas
    ./test/quick.sh --probes 17 18        # plus the named probe files

It prints what it ran and ends with one line: `quick: N passed, M failed; NOT a commit gate, run ./verify.sh`.

### 4. The gate, unchanged

`./verify.sh` runs everything unfiltered and compares against `test/findings-baseline.json` exactly as today.
The suite-file fingerprints change once, in the commit that lands this, with this file named as the reason.
`.githooks/pre-commit` stays `preflight.sh`; CI stays `preflight`, `verify`, connector, bytecode.

## Rules for the implementer

- No check is removed, renamed in meaning, or weakened. Count before and after: 362 airdrop, 129 Check.
- Probe files (`test/Audit*.t.sol`, `test/web/audit-probe*.mjs`) are not touched.
- `web/index.html` is edited only if a reader must be made self-contained, and then minimally.
- Comments say why, in plain sentences. No em dashes.
- Work on a branch from the current commit. Run `./test/quick.sh` as you go; run `./verify.sh` once at the end
  and report its summary; do not publish, do not commit to `main`.

## Done when

- `ONLY=assign node test/web/client.test.mjs` runs the Assign cases in under three minutes and says how many
  of 110 it ran.
- `node test/readers.test.mjs` runs in under five seconds and covers every round's reader finding.
- `./test/quick.sh` completes in under two minutes with no arguments.
- `./verify.sh` is green with the same 362 and 129, on the updated fingerprints, and refuses a filtered run.
- One thrown error in a browser case fails that case alone; proven by a deliberately throwing scratch case.

## The probe fixture (12 September 2026)

The page's fresh-visit default is mainnet, and it remembers the last chosen network in `localStorage`
(`bulksend:net`). Every reviewer probe under `test/web/audit-probe*.mjs` was written when the first option was
testnet, with mocks that answer chain 46630 and nothing else. Those files are evidence, pinned verbatim by
sha256, so they are not edited to follow the page. Instead `test/web/probe-fixture.mjs` is loaded by the runner
(`verify.sh` and `quick.sh`, through `NODE_OPTIONS=--import`) and seeds that one remembered choice into every
browser context a probe opens, the way a returning tester's browser would carry it. It changes nothing else, and
the proof that it changes nothing else is that every probe's assertion fingerprint stayed byte-identical to the
baseline across the default-network change. The client suite does the same for itself inside `open()`; a case
that wants a genuinely fresh visit passes `network: null`.

