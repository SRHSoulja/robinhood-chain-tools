// The tiny runner behind both browser suites (client.test.mjs and check.test.mjs). It does not decide what a
// check means; that stays in each file's own `check(name, cond, detail)`. What this file adds is a coarser
// unit above the check: a named case, one per bare `{ ... }` block the suites already had, so a run can be
// sliced by area, a single thrown error cannot take the rest of the file down with it, and a filtered run
// can never be mistaken for a full one. See docs/harness.md for why this exists.
//
// ONLY=<regex> (read from the environment once, at import time) runs only the cases whose name matches.

const onlySource = process.env.ONLY || '';
const onlyPattern = onlySource ? new RegExp(onlySource) : null;

// Every case's outcome funnels through the caller's own `check`, so a case failure prints and counts exactly
// the way an ordinary check does: same "  FAIL name  <- detail" line, same pass/fail tally. A case that
// throws did not fail one assertion; it failed to run at all, which is worth its own line distinct from
// whatever checks inside it happened to run first.
export function makeRunner(check) {
  let total = 0;
  let ran = 0;
  // Pages opened through a suite's `open()` register themselves here (see trackPage below). A case that
  // throws before reaching its own `page.close()` leaves its page in this set, and the catch below closes
  // whatever is left -- "the page it opened is closed", on a best-effort basis: a page created some other
  // way (bypassing `open()`) is not tracked and is not this mechanism's job to find.
  const openPages = new Set();

  function trackPage(page) {
    openPages.add(page);
    const realClose = page.close.bind(page);
    page.close = async (...args) => {
      openPages.delete(page);
      return realClose(...args);
    };
  }

  async function closeLeakedPages() {
    const leaked = Array.from(openPages);
    openPages.clear();
    for (const page of leaked) {
      try { await page.close(); } catch (e) { /* the browser may already be gone; nothing more to do */ }
    }
  }

  async function t(name, fn) {
    total++;
    if (onlyPattern && !onlyPattern.test(name)) return;
    ran++;
    try {
      await fn();
    } catch (e) {
      // The error's first line only: a Playwright timeout's stack is mostly noise, and the first line is
      // usually the one sentence that says what actually went wrong.
      const firstLine = String((e && e.stack) || e).split('\n')[0];
      check(name, false, firstLine);
      await closeLeakedPages();
    }
  }

  // Called once, after every case has run, to build the exact line verify.sh greps for. Unfiltered it reads
  // "N passed, M failed"; filtered it names how much of the file that covers, so a partial run is never
  // silently read as a complete one.
  function summaryLine(pass, fail) {
    let line = pass + ' passed, ' + fail + ' failed';
    if (onlyPattern) line += ' (' + ran + ' of ' + total + ' cases run, filter "' + onlySource + '")';
    return line;
  }

  return { t, trackPage, summaryLine };
}
