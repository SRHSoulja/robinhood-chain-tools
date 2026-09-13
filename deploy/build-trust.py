#!/usr/bin/env python3
"""Builds the BulkSend Trust Center from the files in this repository.

    python3 deploy/build-trust.py

It writes two files and reads a dozen:

    docs/trust/data.json   every figure the page shows, normalized, with the file each section came from
    web/trust.html         the page, with the charts drawn as inline SVG from that same data

The rule this file exists to enforce: **a figure on that page comes from a file here, through this script.**
Nothing is typed into the page by hand, nothing is rounded into a nicer number, and a figure that is not in a
file is not on the page. So this script parses the audit report's own markdown tables rather than restating
them, cross-checks them against the raw benchmark CSV, and refuses to write anything when a parse fails, a
file is missing, or an arithmetic identity does not hold. A generator that guesses when its input has moved
is worse than no generator: the page would still look authoritative.

The three hand-written inputs are docs/trust/rounds.json (the review history), docs/trust/findings.json (one
plain-English sentence per finding, keyed on the report's own text) and docs/trust/faq.json (the questions).
They hold words, not figures: a figure inside an FAQ answer is written as {a_name} and substituted here.

Running it twice produces identical bytes. Adding a round: edit docs/trust/rounds.json, drop the report in
docs/, run this, then `node deploy/render-trust-card.mjs`, then the presentation lane.
"""
import csv
import html as htmllib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

AUDIT = "audit/2026-09-13"
REPORT_MD = AUDIT + "/REPORT.md"
BENCH_CSV = AUDIT + "/benchmarks.csv"
RESULTS_JSON = AUDIT + "/results.json"
PROVENANCE_JSON = AUDIT + "/provenance.json"
BUNDLE = "docs/verification-2026-09-13"
FINAL_JSON = BUNDLE + "/final-results.json"
MAINNET_JSON = "deployments.mainnet.json"
TESTNET_JSON = "deployments.testnet.json"
STATUS_MD = "docs/status.md"
ROUNDS_JSON = "docs/trust/rounds.json"
FINDINGS_JSON = "docs/trust/findings.json"
FAQ_JSON = "docs/trust/faq.json"
OUT_DATA = "docs/trust/data.json"
OUT_HTML = "web/trust.html"

REPO = "https://github.com/SRHSoulja/robinhood-chain-tools"
BLOB = REPO + "/blob/main/"
TREE = REPO + "/tree/main/"
SITE = "https://rhairdrop.gmgnrepeat.com"
EXPLORER = "https://robinhoodchain.blockscout.com"

# The policy this page is published with, and the exact string deploy/render-worker.py sends as a header for
# the /trust route. Three files name it (here, the worker template, and the check in deploy/publish.sh) and
# they are checked against each other by test/presentation.sh and the classifier, because a meta tag and a
# header that disagree mean one of them is doing nothing.
TRUST_CSP = ("default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; "
             "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")


# ---------------------------------------------------------------------------- reading, and refusing to guess

def die(msg):
    sys.stderr.write("build-trust: " + msg + "\n")
    sys.exit(1)


def read(path):
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        die("%s is missing, and every figure it holds would have to be invented without it." % path)
    with open(full, encoding="utf-8") as fh:
        return fh.read()


def read_json(path):
    try:
        return json.loads(read(path))
    except ValueError as exc:
        die("%s is not readable as JSON: %s" % (path, exc))


def section(md, letter, name):
    """The text of one lettered section of the report, from its heading to the next one."""
    head = re.search(r"^## %s\. %s\s*$" % (re.escape(letter), re.escape(name)), md, re.M)
    if not head:
        die("%s has no section '%s. %s'. The report's shape has changed, so nothing below it can be "
            "trusted to mean what this script thinks it means." % (REPORT_MD, letter, name))
    nxt = re.search(r"^## ", md[head.end():], re.M)
    return md[head.end(): head.end() + nxt.start()] if nxt else md[head.end():]


def tables(text):
    """Every pipe table in a block of markdown, as lists of stripped cells, separator rows dropped."""
    out, cur = [], []
    for line in text.split("\n"):
        s = line.strip()
        if s.startswith("|") and s.endswith("|"):
            cells = [c.strip() for c in s[1:-1].split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                continue
            cur.append(cells)
        elif cur:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def table_with_header(text, first_cell, where):
    for t in tables(text):
        if t and t[0] and t[0][0] == first_cell:
            return t
    die("no table headed %r in %s. The report's tables are the only source of those figures, so this stops "
        "rather than filling them in from somewhere else." % (first_cell, where))


def verbatim(text, sentence, where):
    """The report's own words, required to still be there. Used where the page quotes the report."""
    if sentence not in text:
        die("%s no longer contains this sentence, which the page quotes as the report's own words:\n  %s\n"
            "Either the report changed or the page is about to state something the report does not say."
            % (where, sentence))
    return sentence


def num(cell, where):
    """A number out of a report cell: 2,817,477 or 0.84% or -0.24%."""
    s = cell.replace(",", "").replace("%", "").replace("−", "-").strip()
    s = s.strip("*` ")
    try:
        return float(s)
    except ValueError:
        die("could not read a number from %r in %s" % (cell, where))


def close(a, b, tol, what):
    if abs(a - b) > tol:
        die("%s does not reconcile: %s against %s (difference %s, tolerance %s). One of the sources moved "
            "and the page would print two figures that contradict each other." % (what, a, b, abs(a - b), tol))


def commas(n):
    return "{:,}".format(int(round(n)))


def pct(x, dp=2):
    return ("{:." + str(dp) + "f}%").format(x)


# ---------------------------------------------------------------------------- the sources

md = read(REPORT_MD)
sec_a = section(md, "A", "Executive verdict")
sec_b = section(md, "B", "Security and correctness")
sec_c = section(md, "C", "Controlled gas benchmark")
sec_d = section(md, "D", "Gas breakdown")
sec_e = section(md, "E", "High-value optimizations and execution planner")

# The sentences the page quotes. Each one has to still be in the report, word for word.
NO_EXPLOIT = verbatim(sec_b, "**No critical, high or medium exploit was demonstrated.**", REPORT_MD + " section B")
REFERENCE_IS = verbatim(
    sec_c,
    "The minimal reference keeps caller binding, code check, nonempty/length checks, zero/self/zero-amount "
    "checks, reentrancy protection and return validation.", REPORT_MD + " section C")
NOT_ALL_REMOVABLE = verbatim(
    sec_d,
    "Router overhead is **not all removable**: the safe reference still needs a loop, ABI encoding, external "
    "calls, safety checks and calldata.", REPORT_MD + " section D")
NO_PROTOTYPE = verbatim(
    sec_e, "**No new implementation meets the threshold for a worthwhile production optimization.**",
    REPORT_MD + " section E")
NO_NEW_DEPLOYMENT = verbatim(
    sec_a, "Shape specialization does not justify a new deployment or execution planner on the evidence below.",
    REPORT_MD + " section A")
ALREADY_IMPLEMENTED = verbatim(
    sec_e, "The high-value behavior is **already implemented**: ascending complete-row NFT ordering.",
    REPORT_MD + " section E")

SHAPES = ["A", "B", "C", "D", "E", "F"]

# ---- benchmarks.csv: every measured receipt --------------------------------------------------------------
bench = {}
rows = list(csv.DictReader(read(BENCH_CSV).splitlines()))
if not rows:
    die("%s has no rows" % BENCH_CSV)
for r in rows:
    try:
        bench[(r["shape"], int(r["n"]), r["variant"])] = {
            "gas": int(r["gas"]),
            "bytes": int(r["bytes"]),
            "intrinsic": int(r["intrinsic"]),
            "tokenExecution": int(r["tokenExecution"]) if r["tokenExecution"] else None,
            "routerExecution": int(r["routerExecution"]) if r["routerExecution"] else None,
        }
    except (KeyError, TypeError, ValueError) as exc:
        die("%s has a row this script cannot read (%s): %r" % (BENCH_CSV, exc, r))


def gas(shape, n, variant):
    key = (shape, n, variant)
    if key not in bench:
        die("%s has no row for shape %s, n=%d, variant %s" % (BENCH_CSV, shape, n, variant))
    return bench[key]["gas"]


results = read_json(RESULTS_JSON)
env = results.get("environment") or die("%s has no environment block" % RESULTS_JSON)
for k in ("chain", "compiler", "optimizerRuns", "sourceHash"):
    if k not in env:
        die("%s's environment block has no %r" % (RESULTS_JSON, k))

provenance = read_json(PROVENANCE_JSON)
final = read_json(FINAL_JSON)
mainnet = read_json(MAINNET_JSON)
testnet = read_json(TESTNET_JSON)
status_md = read(STATUS_MD)
rounds_in = read_json(ROUNDS_JSON)
findings_in = read_json(FINDINGS_JSON)
faq_in = read_json(FAQ_JSON)


# ---------------------------------------------------------------------------- section B: the findings

b_table = table_with_header(sec_b, "Severity", REPORT_MD + " section B")
if len(b_table) != 5 or len(b_table[0]) != 4:
    die("%s section B's findings table is %d rows by %d columns; this page renders the four rows it had. "
       "Add the new row's plain-English sentence to %s and re-run."
        % (REPORT_MD, len(b_table) - 1, len(b_table[0]), FINDINGS_JSON))

plain = findings_in.get("plain_english") or die("%s has no plain_english map" % FINDINGS_JSON)
findings = []
for row in b_table[1:]:
    severity, what, evidence, fix = row
    if what not in plain:
        die("%s has no plain-English sentence for this finding, exactly as the report writes it:\n  %s\n"
            "Add it there rather than describing the finding in the generator." % (FINDINGS_JSON, what))
    findings.append({
        "severity": severity,
        "finding": what,
        "plain_english": plain[what],
        "evidence": evidence,
        "minimal_fix": fix,
        "status": "open limitation, no fix recommended by the report",
    })
orphans = sorted(set(plain) - {f["finding"] for f in findings})
if orphans:
    die("%s describes findings the report's table no longer carries, so a sentence on the page would be "
        "attached to nothing:\n  %s" % (FINDINGS_JSON, "\n  ".join(orphans)))

# The harness row lives in docs/status.md's round-twenty-two table, not in the report: it is the maintainer's
# record of a finding about the test harness rather than about the contract, and it is the one row with a
# verdict of closed. Taken verbatim.
r22 = re.search(r"^### Round twenty-two findings\s*$", status_md, re.M)
if not r22:
    die("%s has no 'Round twenty-two findings' heading" % STATUS_MD)
nxt = re.search(r"^#{2,3} |^Round ", status_md[r22.end():], re.M)
r22_text = status_md[r22.end(): r22.end() + nxt.start()] if nxt else status_md[r22.end():]
harness_row = None
for t in tables(r22_text):
    for row in t:
        if row and row[0].strip() == "harness":
            harness_row = row
if not harness_row or len(harness_row) != 3:
    die("%s's round-twenty-two table has no three-column 'harness' row; the Trust Center quotes it verbatim "
        "and will not paraphrase it." % STATUS_MD)
harness = {
    "severity": harness_row[0],
    "finding": harness_row[1],
    "resolution": harness_row[2],
    "status": findings_in.get("harness_status", ""),
}
if not harness["resolution"].startswith("closed"):
    die("%s's harness row no longer reads as closed: %r" % (STATUS_MD, harness["resolution"]))
if harness["status"] != "closed":
    die("%s's harness_status must be \"closed\" while the status file says closed" % FINDINGS_JSON)


# ---------------------------------------------------------------------------- gas: the three charts

# The six shapes are named by the report, not here: its own row labels are what the charts are labelled with,
# so a shape that is redefined is renamed on the page rather than quietly mislabelled by a name kept in this
# script.
c_table = table_with_header(sec_c, "Shape", REPORT_MD + " section C")
if len(c_table) != 7:
    die("%s section C's 100-recipient table has %d data rows, expected 6" % (REPORT_MD, len(c_table) - 1))
SHAPE_NAMES = {}
for row in c_table[1:]:
    letter = row[0].split(":")[0].strip()
    if letter not in SHAPES:
        die("%s section C names a shape this script does not know: %r" % (REPORT_MD, row[0]))
    SHAPE_NAMES[letter] = row[0]
if sorted(SHAPE_NAMES) != SHAPES:
    die("%s section C names the shapes %s; this page is written for %s"
        % (REPORT_MD, ", ".join(sorted(SHAPE_NAMES)), ", ".join(SHAPES)))

# Chart 1. Overhead over the reference at 300 recipients, computed from the CSV, then checked against the
# report's own n=100 overhead column so a CSV that has drifted away from the report is caught.
overhead300 = []
for s in SHAPES:
    ref = gas(s, 300, "reference")
    row = {"shape": s, "label": SHAPE_NAMES[s], "reference": ref}
    for variant in ("strict", "lenient"):
        g = gas(s, 300, variant)
        row[variant] = g
        row[variant + "_overhead_pct"] = (g - ref) * 100.0 / ref
    overhead300.append(row)

for row in c_table[1:]:
    letter = row[0].split(":")[0].strip()
    ref, strict, lenient = num(row[1], "section C"), num(row[2], "section C"), num(row[5], "section C")
    close(ref, gas(letter, 100, "reference"), 0.5, "section C's reference for shape " + letter)
    close(strict, gas(letter, 100, "strict"), 0.5, "section C's strict for shape " + letter)
    close(lenient, gas(letter, 100, "lenient"), 0.5, "section C's lenient for shape " + letter)
    # The identity the report's own overhead column states, recomputed here rather than read.
    close((strict - ref) * 100.0 / ref, num(row[4], "section C"), 0.01,
          "section C's strict overhead for shape " + letter)
    close((lenient - ref) * 100.0 / ref, num(row[6], "section C"), 0.01,
          "section C's lenient overhead for shape " + letter)

strict300 = [r["strict_overhead_pct"] for r in overhead300]
strict300_min, strict300_max = min(strict300), max(strict300)

# Chart 2. Where the gas goes at 100 recipients: the report's section D table, checked to add up.
d_table = table_with_header(sec_d, "Shape", REPORT_MD + " section D")
if len(d_table) != 7:
    die("%s section D's breakdown table has %d data rows, expected 6" % (REPORT_MD, len(d_table) - 1))
breakdown = []
for row in d_table[1:]:
    letter = row[0].strip()
    if letter not in SHAPE_NAMES:
        die("%s section D names a shape this script does not know: %r" % (REPORT_MD, row[0]))
    token, token_pct = num(row[1], "section D"), num(row[2], "section D")
    router, router_pct = num(row[3], "section D"), num(row[4], "section D")
    base, total = num(row[5], "section D"), num(row[6], "section D")
    # "These three components reconcile exactly to receipt gas", says the report. Checked, not believed.
    close(token + router + base, total, 0.5, "section D's three components for shape " + letter)
    close(total, gas(letter, 100, "strict"), 0.5, "section D's total for shape " + letter)
    close(token * 100.0 / total, token_pct, 0.01, "section D's token share for shape " + letter)
    close(router * 100.0 / total, router_pct, 0.01, "section D's router share for shape " + letter)
    breakdown.append({
        "shape": letter, "label": SHAPE_NAMES[letter],
        "token": int(token), "token_pct": token_pct,
        "router": int(router), "router_pct": router_pct,
        "base_calldata": int(base), "base_calldata_pct": base * 100.0 / total,
        "total": int(total),
    })
token_pcts = [b["token_pct"] for b in breakdown]
router_pcts = [b["router_pct"] for b in breakdown]

# Chart 3. ERC721A ordering at 100 recipients, from section C's implementation-sensitivity table.
nft_table = table_with_header(sec_c, "Fixture / ordering", REPORT_MD + " section C")
sensitivity = {}
for row in nft_table[1:]:
    sensitivity[row[0].strip()] = {"reference": int(num(row[1], "section C")),
                                   "strict": int(num(row[2], "section C"))}
ordering = []
for name in ("ERC721A ascending", "ERC721A descending", "ERC721A gapped ascending"):
    if name not in sensitivity:
        die("%s section C's implementation-sensitivity table has no row for %r" % (REPORT_MD, name))
    close(sensitivity[name]["strict"], gas(name, 100, "strict"), 0.5,
          "section C's strict figure for " + name)
    ordering.append({"ordering": name, "strict": sensitivity[name]["strict"]})
asc = sensitivity["ERC721A ascending"]["strict"]
desc = sensitivity["ERC721A descending"]["strict"]
ordering_saving_pct = (desc - asc) * 100.0 / desc
ordering_saving_gas = desc - asc

# The prototypes, from section E.
e_table = table_with_header(sec_e, "Prototype", REPORT_MD + " section E")
if len(e_table) != 4:
    die("%s section E's prototype table has %d data rows, expected 3" % (REPORT_MD, len(e_table) - 1))
prototypes = []
for row in e_table[1:]:
    current, proto, saving = num(row[1], "section E"), num(row[2], "section E"), num(row[3], "section E")
    close((current - proto) * 100.0 / current, saving, 0.01,
          "section E's saving for the %s prototype" % row[0])
    calldata = row[4]
    prototypes.append({
        "prototype": row[0], "current_strict": int(current), "prototype_gas": int(proto),
        "saving_pct": saving, "calldata": calldata,
        "verdict": "not worth a new deployment",
    })
best_saving = max(p["saving_pct"] for p in prototypes)


# ---------------------------------------------------------------------------- the pinned verification run

def passed(key):
    """'417 passed, 0 failed' -> (417, 0). A suite with a failure is not a suite this page will print."""
    raw = final.get(key)
    if not isinstance(raw, str):
        die("%s has no %r string to read a count from" % (FINAL_JSON, key))
    m = re.fullmatch(r"(\d+) passed, (\d+) failed", raw.strip())
    if not m:
        die("%s's %r is %r, which is not the 'N passed, M failed' shape this script reads." % (FINAL_JSON, key, raw))
    n, f = int(m.group(1)), int(m.group(2))
    if f:
        die("%s records %d failures in %s, so there is no clean run to publish." % (FINAL_JSON, f, key))
    return n


SUITES = [
    ("airdrop page", "test/web/client.test.mjs", "browser_client",
     "every check the airdrop page's own suite makes, in headless Chromium with every answer mocked"),
    ("Check page", "test/web/check.test.mjs", "browser_check",
     "the same, for the Check page"),
    ("page readers", "test/readers.test.mjs", "readers",
     "the recipient-list readers, extracted from the page's own bytes and run in node"),
    ("worker", "test/worker.test.mjs", "worker",
     "the Worker the publisher builds, including its explorer translation, offline"),
    ("CSP publish gate", "test/csp-gate.test.sh", "csp_gate",
     "every weakening of the published policy, each one refused"),
    ("mainnet fork", "test/fork/MainnetGuards.t.sol", "fork",
     "the paste guards against real mainnet collections and tokens, on a read-only fork"),
]
suites = []
checks_total = 0
for name, path, key, covers in SUITES:
    n = passed(key)
    checks_total += n
    suites.append({"suite": name, "file": path, "covers": covers,
                   "result": final[key], "checks": n})

contract_suites = final.get("contract_suites")
m = re.fullmatch(r"(\d+)/(\d+)", str(contract_suites).strip())
if not m or m.group(1) != m.group(2):
    die("%s's contract_suites is %r; this page prints it only when every ordinary contract suite passed."
        % (FINAL_JSON, contract_suites))
# Counted in files, not in checks: forge reports whether each suite file passed, and a file is not a check.
# It is the seventh row of the table and it deliberately contributes nothing to the total, which is why the
# total is checked against the six rows that do.
suites.append({"suite": "ordinary contract suites", "file": "forge test", "covers":
               "every ordinary Solidity test file, on the pinned toolchain",
               "result": "%s of %s files passed" % (m.group(1), m.group(2)), "checks": None})

counted = [s["checks"] for s in suites if s["checks"] is not None]
if len(suites) != 7:
    die("the test table has %d rows; it is written for the seven suites the verification bundle records" % len(suites))
if sum(counted) != checks_total:
    die("the suite counts (%s) do not sum to the total this page prints (%d)"
        % (" + ".join(str(c) for c in counted), checks_total))

live = final.get("live") or die("%s has no live block" % FINAL_JSON)
for k in ("mainnet", "frontend", "block", "address", "runtimeBytes", "runtimeKeccak256", "constructor",
          "immutables", "constants", "selectors", "compiler", "secondary", "testnet"):
    if k not in live:
        die("%s's live block has no %r" % (FINAL_JSON, k))
if live["mainnet"] != "PASS":
    die("%s records live.mainnet as %r; this page says the live runtime is verified only when it is."
        % (FINAL_JSON, live["mainnet"]))
if live["address"].lower() != mainnet["BulkSend"].lower():
    die("%s verified %s but %s records %s. The page would name one and cite the other."
        % (FINAL_JSON, live["address"], MAINNET_JSON, mainnet["BulkSend"]))
if int(live["runtimeBytes"]) != int(mainnet["runtime_bytes"]):
    die("the verified runtime is %s bytes and %s records %s" % (live["runtimeBytes"], MAINNET_JSON, mainnet["runtime_bytes"]))
if live["runtimeKeccak256"].lower() != mainnet["runtime_keccak256"].lower():
    die("the verified runtime hash and %s's runtime_keccak256 are different" % MAINNET_JSON)
if provenance["source_sha256"].lower() != mainnet["source_sha256"].lower():
    die("%s's source_sha256 and %s's are different, so 'the reviewed source' names two things"
        % (PROVENANCE_JSON, MAINNET_JSON))
if not str(live["secondary"]).startswith("PASS"):
    die("%s records live.secondary as %r, so the second endpoint did not corroborate the first"
        % (FINAL_JSON, live["secondary"]))
if final.get("connector_reproducibility") != "PASS":
    die("%s records connector_reproducibility as %r" % (FINAL_JSON, final.get("connector_reproducibility")))

fork_n = passed("fork")
verification = [
    {"what": "pinned build", "result": final.get("pinned_build"),
     "detail": "Foundry %s, node %s, solc %s, %s, optimizer %s runs, via_ir %s"
               % (final["pinned_versions"]["foundry"], final["pinned_versions"]["node"],
                  final["pinned_versions"]["solc"], final["pinned_versions"]["evm"],
                  final["pinned_versions"]["optimizer_runs"],
                  str(final["pinned_versions"]["via_ir"]).lower())},
    {"what": "live mainnet bytecode", "result": live["mainnet"],
     "detail": "the runtime at %s read back at block %s is byte for byte what this source builds, "
               "corroborated by a second RPC endpoint at the same block"
               % (live["address"], commas(live["block"]))},
    {"what": "frontend consistency", "result": live["frontend"],
     "detail": "the served page names the deployed address, and its embedded ABI and selectors match the "
               "live contract"},
    {"what": "mainnet fork tests", "result": final["fork"],
     "detail": "%d of %d, read-only, against real mainnet collections and tokens" % (fork_n, fork_n)},
    {"what": "connector reproducibility", "result": final["connector_reproducibility"],
     "detail": "the WalletConnect bundle rebuilt from its pinned inputs matched the shipped file and its "
               "expected digest"},
    {"what": "testnet twin", "result": live["testnet"],
     "detail": "the testnet deployment at %s runs the same runtime" % testnet["BulkSend"]},
]
for v in verification:
    if not str(v["result"]).startswith("PASS") and "passed" not in str(v["result"]):
        die("the verification table would print %r for %r, which is not a pass" % (v["result"], v["what"]))

advanced = [
    ("address", live["address"]),
    ("block read at", commas(live["block"])),
    ("runtime bytes", commas(live["runtimeBytes"])),
    ("runtime keccak256", live["runtimeKeccak256"]),
    ("constructor", live["constructor"]),
    ("immutables", live["immutables"]),
    ("constants", ", ".join("%s = %s" % (k, commas(v)) for k, v in sorted(live["constants"].items()))),
    ("selectors", ", ".join("%s %s" % (s["selector"], s["signature"]) for s in live["selectors"])),
    ("compiler", live["compiler"]["version"] + ", optimizer %s runs, %s"
     % (final["pinned_versions"]["optimizer_runs"], final["pinned_versions"]["evm"])),
    ("source sha256", provenance["source_sha256"]),
    ("second endpoint", live["secondary"]),
    ("testnet twin", "%s, same runtime" % testnet["BulkSend"]),
]
if len(live["selectors"]) != 10:
    die("%s's live block records %d selectors; the page says ten were compared" % (FINAL_JSON, len(live["selectors"])))
if len(live["constants"]) != 4:
    die("%s's live block records %d constants; the page says four were compared" % (FINAL_JSON, len(live["constants"])))


# ---------------------------------------------------------------------------- the review history

rounds = rounds_in.get("rounds") or die("%s has no rounds array" % ROUNDS_JSON)
for i, r in enumerate(rounds, 1):
    for field in ("round", "date", "reviewer", "blockers", "report", "commit"):
        if field not in r:
            die("%s round %d has no %r field" % (ROUNDS_JSON, i, field))
    if r["round"] != i:
        die("%s is out of order: entry %d says round %s" % (ROUNDS_JSON, i, r["round"]))
    path = "docs/" + r["report"]
    if not os.path.exists(os.path.join(ROOT, path)):
        die("%s names %s for round %d, and that file is not in this repository. The page links every round "
            "to its report; a link that 404s is worse than no page." % (ROUNDS_JSON, path, i))
    m = re.match(r"audit-(\d{4}-\d{2}-\d{2})-", r["report"])
    if not m:
        die("%s's report filename does not begin with a date: %s" % (ROUNDS_JSON, r["report"]))
    if m.group(1) != r["date"]:
        die("%s round %d is dated %s and its report file is dated %s. The filename is the record."
            % (ROUNDS_JSON, i, r["date"], m.group(1)))
    if not isinstance(r["blockers"], int) or r["blockers"] < 0:
        die("%s round %d has a blocker count that is not a whole number: %r" % (ROUNDS_JSON, i, r["blockers"]))

rounds_total = len(rounds)
clean = [r["round"] for r in rounds if r["blockers"] == 0]
blockers_total = sum(r["blockers"] for r in rounds)


# ---------------------------------------------------------------------------- the figures, in one place

FIGURES = {
    "mainnet_address": live["address"],
    "testnet_address": testnet["BulkSend"],
    "runtime_bytes": commas(live["runtimeBytes"]),
    "reviewed_commit": provenance["reviewed_commit"][:7],
    "rounds_total": str(rounds_total),
    "rounds_clean": str(len(clean)),
    "blockers_total": str(blockers_total),
    "checks_total": commas(checks_total),
    "strict_300_min": pct(strict300_min),
    "strict_300_max": pct(strict300_max),
    "best_saving": pct(best_saving),
    "ordering_saving": pct(ordering_saving_pct, 1),
    "ordering_saving_gas": commas(ordering_saving_gas),
    "token_share_min": pct(min(token_pcts)),
    "token_share_max": pct(max(token_pcts)),
    "router_share_min": pct(min(router_pcts)),
    "router_share_max": pct(max(router_pcts)),
    "default_gas": commas(live["constants"]["DEFAULT_GAS"]),
    "min_gas": commas(live["constants"]["MIN_GAS"]),
    "max_gas": commas(live["constants"]["MAX_GAS"]),
    "block": commas(live["block"]),
}

faq = []
for item in faq_in.get("questions") or die("%s has no questions array" % FAQ_JSON):
    if "q" not in item or "answer" not in item:
        die("%s has a question with no q or no answer" % FAQ_JSON)
    text = item["answer"]
    for name in re.findall(r"\{([a-z0-9_]+)\}", text):
        if name not in FIGURES:
            die("%s uses the figure {%s}, which this script does not compute. The known ones are: %s"
                % (FAQ_JSON, name, ", ".join(sorted(FIGURES))))
        text = text.replace("{" + name + "}", FIGURES[name])
    if "{" in text or "}" in text:
        die("%s's answer to %r still has a brace in it after substitution: %r" % (FAQ_JSON, item["q"], text))
    faq.append({"q": item["q"], "answer": text})
if len(faq) != 8:
    die("%s has %d questions; the page is written for the eight it was specified with" % (FAQ_JSON, len(faq)))


# ---------------------------------------------------------------------------- data.json

data = {
    "_why": ("Every figure the Trust Center prints, with the file it came from. Generated by "
             "deploy/build-trust.py; do not edit by hand. It is committed so that a change to the page is a "
             "diff of numbers rather than a diff of markup."),
    "page": {"url": SITE + "/trust", "card": SITE + "/trust-og.png", "csp": TRUST_CSP,
             "generator": "deploy/build-trust.py"},
    "glance": {
        "source": [REPORT_MD, FINAL_JSON, ROUNDS_JSON],
        "critical": 0, "high": 0, "medium": 0,
        "severity_sentence": NO_EXPLOIT.strip("*"),
        "rounds": rounds_total,
        "rounds_without_blocker": len(clean),
        "rounds_without_blocker_list": clean,
        "checks": checks_total,
        "live_mainnet": live["mainnet"],
        "strict_overhead_300_min_pct": strict300_min,
        "strict_overhead_300_max_pct": strict300_max,
        "reference_sentence": REFERENCE_IS,
    },
    "findings": {
        "source": [REPORT_MD, STATUS_MD, FINDINGS_JSON],
        "rows": findings,
        "harness": harness,
    },
    "gas": {
        "source": [REPORT_MD, BENCH_CSV, RESULTS_JSON],
        "environment": env,
        "overhead_at_300": overhead300,
        "breakdown_at_100": breakdown,
        "erc721a_ordering_at_100": ordering,
        "erc721a_ordering_saving_pct": ordering_saving_pct,
        "erc721a_ordering_saving_gas": ordering_saving_gas,
        "prototypes": prototypes,
        "router_sentence": NOT_ALL_REMOVABLE.replace("**", ""),
        "prototype_sentence": NO_PROTOTYPE.strip("*"),
        "planner_sentence": NO_NEW_DEPLOYMENT,
        "ordering_sentence": ALREADY_IMPLEMENTED.replace("**", ""),
    },
    "verification": {
        "source": [FINAL_JSON, MAINNET_JSON, TESTNET_JSON, PROVENANCE_JSON],
        "rows": verification,
        "advanced": [{"what": k, "value": v} for k, v in advanced],
    },
    "tests": {
        "source": [FINAL_JSON],
        "suites": suites,
        "total_checks": checks_total,
    },
    "rounds": {
        "source": [ROUNDS_JSON, STATUS_MD],
        "total": rounds_total,
        "without_blocker": clean,
        "blockers_total": blockers_total,
        "rows": rounds,
    },
    "faq": {"source": [FAQ_JSON], "questions": faq},
    "provenance": {
        "source": [PROVENANCE_JSON, MAINNET_JSON],
        "reviewed_commit": provenance["reviewed_commit"],
        "source_sha256": provenance["source_sha256"],
        "artifact_sha256": provenance["artifact_sha256"],
        "mainnet": mainnet,
        "downloads": [
            {"what": "the round-twenty-two report", "href": BLOB + "docs/" + rounds[-1]["report"]},
            {"what": "the verification bundle", "href": TREE + BUNDLE},
            {"what": "benchmarks.csv", "href": BLOB + BENCH_CSV},
            {"what": "results.json", "href": BLOB + RESULTS_JSON},
            {"what": "provenance.json", "href": BLOB + PROVENANCE_JSON},
            {"what": "deployments.mainnet.json", "href": BLOB + MAINNET_JSON},
        ],
    },
    "figures": FIGURES,
}

data_text = json.dumps(data, indent=2, ensure_ascii=False, sort_keys=False) + "\n"


# ---------------------------------------------------------------------------- the page

def esc(s):
    return htmllib.escape(str(s), quote=True)


def code(s):
    return '<code class="mono">%s</code>' % esc(s)


def md_inline(s):
    """The report writes `identifiers` in backticks and **emphasis** in asterisks. Rendered as written."""
    out = esc(s)
    out = re.sub(r"`([^`]+)`", r'<code class="mono">\1</code>', out)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", out)
    return out


def svg_open(w, h, title, desc):
    return ('<svg class="chart" viewBox="0 0 %d %d" width="%d" height="%d" role="img" '
            'xmlns="http://www.w3.org/2000/svg" aria-labelledby="t%d d%d">'
            '<title id="t%d">%s</title><desc id="d%d">%s</desc>'
            % (w, h, w, h, svg_open.n, svg_open.n, svg_open.n, esc(title), svg_open.n, esc(desc)))


svg_open.n = 0


def next_svg(w, h, title, desc):
    svg_open.n += 1
    return svg_open(w, h, title, desc)


# ---- chart 1: overhead over the reference at 300 recipients ----------------------------------------------
W = 900
rowh, gap = 20, 12
top = 8
parts = [next_svg(W, top + len(overhead300) * (2 * rowh + gap) + 4,
                  "Overhead over the minimal safe reference at 300 recipients",
                  "Six token shapes, strict and lenient, as a percentage of the reference loop's own gas. "
                  "Every value is printed at the end of its bar.")]
scale = max(r["lenient_overhead_pct"] for r in overhead300)
LAB, BAR0 = 250, 260
BARW = W - BAR0 - 70
y = top
for r in overhead300:
    parts.append('<text x="0" y="%d" class="s-lab">%s</text>' % (y + 14, esc(r["label"])))
    for variant, klass in (("strict", "s-bar"), ("lenient", "s-bar2")):
        v = r[variant + "_overhead_pct"]
        w = max(2.0, v / scale * BARW)
        parts.append('<text x="%d" y="%d" class="s-var" text-anchor="end">%s</text>' % (BAR0 - 10, y + 14, variant))
        parts.append('<rect x="%d" y="%d" width="%.2f" height="%d" class="%s" rx="2"/>'
                     % (BAR0, y + 3, w, rowh - 6, klass))
        parts.append('<text x="%.2f" y="%d" class="s-val">%s</text>' % (BAR0 + w + 8, y + 14, pct(v)))
        y += rowh
    y += gap
parts.append("</svg>")
chart_overhead = "".join(parts)

# ---- chart 2: where the gas goes at 100 recipients -------------------------------------------------------
rowh, gap = 22, 22
parts = [next_svg(W, 8 + len(breakdown) * (rowh + gap) + 4,
                  "Where the gas goes at 100 recipients",
                  "Each bar is one batch, split into the token's own transfer, the router, and the "
                  "transaction base plus calldata. Every share is printed under its bar.")]
y = 8
for b in breakdown:
    parts.append('<text x="0" y="%d" class="s-lab">%s</text>' % (y + 15, esc(b["label"])))
    x = BAR0
    full = W - BAR0 - 10
    for key, klass in (("token", "s-bar"), ("router", "s-bar2"), ("base_calldata", "s-bar3")):
        w = b[key + "_pct"] / 100.0 * full
        parts.append('<rect x="%.2f" y="%d" width="%.2f" height="%d" class="%s"/>' % (x, y + 2, w, rowh - 8, klass))
        x += w
    parts.append('<text x="%d" y="%d" class="s-val">token %s · router %s · base and calldata %s · %s gas</text>'
                 % (BAR0, y + rowh + 9, pct(b["token_pct"]), pct(b["router_pct"]),
                    pct(b["base_calldata_pct"]), commas(b["total"])))
    y += rowh + gap
parts.append("</svg>")
chart_breakdown = "".join(parts)

# ---- chart 3: ERC721A ordering -----------------------------------------------------------------------------
rowh, gap = 24, 16
parts = [next_svg(W, 8 + len(ordering) * (rowh + gap),
                  "ERC721A id ordering at 100 recipients",
                  "The same 100 transfers of the same ids, in three orders, as gas actually spent. "
                  "Each total is printed at the end of its bar.")]
top_val = max(o["strict"] for o in ordering)
ORDERW = W - BAR0 - 120        # these values are printed in full, not as percentages, so they need the room
y = 8
for o in ordering:
    w = o["strict"] / float(top_val) * ORDERW
    parts.append('<text x="0" y="%d" class="s-lab">%s</text>' % (y + 16, esc(o["ordering"])))
    parts.append('<rect x="%d" y="%d" width="%.2f" height="%d" class="s-bar" rx="2"/>' % (BAR0, y + 3, w, rowh - 8))
    parts.append('<text x="%.2f" y="%d" class="s-val">%s gas</text>' % (BAR0 + w + 8, y + 16, commas(o["strict"])))
    y += rowh + gap
parts.append("</svg>")
chart_ordering = "".join(parts)

# ---- chart 4: release blockers per round -------------------------------------------------------------------
CW, CH = 900, 206
TOPGAP, LABELROW = 20, 22
bw = CW / float(rounds_total)
maxb = max(r["blockers"] for r in rounds)
plot = CH - TOPGAP - LABELROW
base_y = TOPGAP + plot
parts = [next_svg(CW, CH, "Release blockers found, by review round",
                  "One bar per round, in order, round one on the left and round %d on the right. A round "
                  "that found none is drawn as a flat baseline mark and labelled zero. Every count is "
                  "printed above its bar and every round number below it." % rounds_total)]
for i, r in enumerate(rounds):
    x = i * bw
    h = (r["blockers"] / float(maxb)) * plot if maxb else 0
    if r["blockers"] == 0:
        parts.append('<rect x="%.2f" y="%.2f" width="%.2f" height="3" class="s-zero"/>'
                     % (x + 3, base_y, bw - 6))
    else:
        parts.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" class="s-bar" rx="2"/>'
                     % (x + 3, base_y - h, bw - 6, h))
    parts.append('<text x="%.2f" y="%.2f" class="s-num">%d</text>' % (x + bw / 2, base_y - h - 5, r["blockers"]))
    parts.append('<text x="%.2f" y="%.2f" class="s-num">%d</text>' % (x + bw / 2, base_y + 16, r["round"]))
parts.append("</svg>")
chart_rounds = "".join(parts)


# ---- the glance strip -------------------------------------------------------------------------------------
GLANCE = [
    ("critical", "0", "critical"),
    ("high", "0", "high"),
    ("medium", "0", "medium"),
    ("rounds", str(rounds_total), "review rounds"),
    ("clean", str(len(clean)), "with no blocker"),
    ("checks", str(checks_total), "passing checks"),
]
glance_cells = "".join(
    '<div class="g" data-figure="%s"><span class="fig">%s</span><span class="cap">%s</span></div>' % (k, v, c)
    for k, v, c in GLANCE)
glance_cells += ('<div class="g wide" data-figure="live"><span class="fig">%s</span>'
                 '<span class="cap">live mainnet runtime verified</span></div>' % esc(live["mainnet"]))
glance_cells += ('<div class="g wide" data-figure="overhead"><span class="fig">%s to %s</span>'
                 '<span class="cap">strict overhead over the safe reference, 300 recipients</span></div>'
                 % (pct(strict300_min), pct(strict300_max)))

glance_html = """<section id="glance" class="card">
  <h2>At a glance</h2>
  <div class="strip">%s</div>
  <p class="note">%s</p>
</section>""" % (glance_cells, esc(REFERENCE_IS))

# ---- findings ----------------------------------------------------------------------------------------------
find_rows = "".join(
    """<tr><td class="sev">%s</td><td>%s<div class="plain">%s</div></td><td class="fix">%s</td></tr>"""
    % (md_inline(f["severity"]), md_inline(f["finding"]), esc(f["plain_english"]), md_inline(f["minimal_fix"]))
    for f in findings)
find_rows += ("""<tr><td class="sev">%s · closed</td><td>%s<div class="plain">%s</div></td>"""
              """<td class="fix">%s</td></tr>"""
              % (md_inline(harness["severity"]), md_inline(harness["finding"]),
                 "A finding about the test harness rather than the contract, and the one row of the round "
                 "that was fixed rather than kept.", md_inline(harness["resolution"])))
evidence_rows = "".join(
    "<tr><td>%s</td><td>%s</td></tr>" % (md_inline(f["finding"]), md_inline(f["evidence"]))
    for f in findings)

findings_html = """<section id="findings" class="card">
  <h2>Findings</h2>
  <p class="lead">%s The four rows below are the limitations it recorded instead, each with the report's own
  minimal fix beside it, plus the harness note from <a href="%s">docs/status.md</a>.</p>
  <div class="scroll"><table>
    <thead><tr><th>Severity</th><th>Finding</th><th>The report's minimal fix</th></tr></thead>
    <tbody>%s</tbody>
  </table></div>
  <details><summary>The evidence each one rests on, in the report's words</summary>
    <div class="scroll"><table>
      <thead><tr><th>Finding</th><th>Evidence and failure scenario</th></tr></thead>
      <tbody>%s</tbody>
    </table></div>
  </details>
</section>""" % (md_inline(NO_EXPLOIT), esc(BLOB + STATUS_MD), find_rows, evidence_rows)

# ---- gas -----------------------------------------------------------------------------------------------------
proto_rows = "".join(
    "<tr><td>%s</td><td class=\"n\">%s</td><td class=\"n\">%s</td><td class=\"n\">%s</td><td>%s</td><td>%s</td></tr>"
    % (esc(p["prototype"]), commas(p["current_strict"]), commas(p["prototype_gas"]),
       pct(p["saving_pct"]), esc(p["calldata"]), esc(p["verdict"]))
    for p in prototypes)

gas_html = """<section id="gas" class="card">
  <h2>Gas efficiency</h2>
  <p class="lead">Receipts from a local chain, not estimates: %s, compiler %s, optimizer %s runs. Each
  scenario starts from the same snapshot and every recipient was checked afterwards.</p>

  <h3>Overhead over the reference, 300 recipients</h3>
  %s
  <p class="note">The reference is the minimal safe loop described above. At this size the product's strict
  path costs between %s and %s more than it, depending on the token standard; lenient execution buys the
  skip-and-continue behaviour the reference does not offer.</p>

  <h3>Where the gas goes, 100 recipients</h3>
  %s
  <p class="note">%s %s of a batch is the token's own transfer, which no batch sender can avoid, and %s is
  the router. %s</p>

  <h3>ERC721A id ordering, 100 recipients</h3>
  %s
  <p class="note">Ascending order costs %s less than descending on this collection, a saving of %s gas on the
  same 100 transfers of the same ids. %s</p>

  <h3>The specialized prototypes that were built and rejected</h3>
  <div class="scroll"><table>
    <thead><tr><th>Prototype</th><th class="n">Current strict</th><th class="n">Prototype</th>
      <th class="n">Saving</th><th>Calldata bytes</th><th>Verdict</th></tr></thead>
    <tbody>%s</tbody>
  </table></div>
  <p class="note">%s</p>
</section>""" % (
    esc(env["chain"]), esc(env["compiler"]), commas(env["optimizerRuns"]),
    chart_overhead, pct(strict300_min), pct(strict300_max),
    chart_breakdown,
    "Between", "%s and %s" % (pct(min(token_pcts)), pct(max(token_pcts))),
    "%s to %s" % (pct(min(router_pcts)), pct(max(router_pcts))),
    esc(NOT_ALL_REMOVABLE.replace("**", "")),
    chart_ordering, pct(ordering_saving_pct, 1), commas(ordering_saving_gas),
    esc(ALREADY_IMPLEMENTED.replace("**", "")),
    proto_rows, esc(NO_PROTOTYPE.strip("*") + " " + NO_NEW_DEPLOYMENT))

# ---- verification ----------------------------------------------------------------------------------------------
ver_rows = "".join(
    '<tr><td>%s</td><td class="pass"><span class="pill ok">%s</span></td><td>%s</td></tr>'
    % (esc(v["what"]), esc(v["result"]), esc(v["detail"])) for v in verification)
adv_rows = "".join(
    '<tr><td>%s</td><td class="mono wrap">%s</td></tr>' % (esc(k), esc(v)) for k, v in advanced)

verification_html = """<section id="verification" class="card">
  <h2>Verification of the live deployment</h2>
  <p class="lead">Not a claim about the source: a reading of the contract that is actually on Robinhood Chain
  mainnet, taken at block %s and compared with what this repository builds.</p>
  <div class="scroll"><table>
    <thead><tr><th>What</th><th>Result</th><th>What that means</th></tr></thead>
    <tbody>%s</tbody>
  </table></div>
  <details><summary>Advanced: what was compared</summary>
    <div class="scroll"><table><tbody>%s</tbody></table></div>
  </details>
</section>""" % (commas(live["block"]), ver_rows, adv_rows)

# ---- tests ---------------------------------------------------------------------------------------------------
test_rows = "".join(
    '<tr><td>%s</td><td class="mono">%s</td><td>%s</td><td class="n">%s</td></tr>'
    % (esc(s["suite"]), esc(s["file"]), esc(s["result"]),
       (str(s["checks"]) if s["checks"] is not None else "·"))
    for s in suites)

tests_html = """<section id="tests" class="card">
  <h2>Test results</h2>
  <div class="scroll"><table>
    <thead><tr><th>Suite</th><th>File</th><th>Result</th><th class="n">Checks</th></tr></thead>
    <tbody>%s</tbody>
    <tfoot><tr><td colspan="3">total checks</td><td class="n">%s</td></tr></tfoot>
  </table></div>
  <p class="note">The suites print their own counts when they are run, CI reruns them on every push, and this
  page is regenerated from the recorded results rather than from anybody's memory of them.</p>
</section>""" % (test_rows, commas(checks_total))

# ---- rounds ---------------------------------------------------------------------------------------------------
round_rows = "".join(
    '<tr><td class="n">%d</td><td>%s</td><td>%s</td><td class="n">%s</td><td class="mono">%s</td>'
    '<td><a href="%s">%s</a></td></tr>'
    % (r["round"], esc(r["date"]), esc(r["reviewer"]),
       ("none" if r["blockers"] == 0 else str(r["blockers"])),
       esc(r["commit"][:7]) if r["commit"] else "·",
       esc(BLOB + "docs/" + r["report"]), esc(r["report"]))
    for r in rounds)

rounds_html = """<section id="rounds" class="card">
  <h2>Review history</h2>
  <p class="lead">%d rounds, each by a fresh model given the code and no other context and asked to break it,
  published unedited. %d found no release blocker: rounds %s. %d release blockers have been found across the
  whole history; docs/status.md is where each one's state is recorded.</p>
  %s
  <p class="note">Each bar is one round, in order; its height is the release blockers that round found, and
  the number under it is the round.</p>
  <div class="scroll"><table>
    <thead><tr><th class="n">Round</th><th>Date</th><th>Reviewer</th><th class="n">Blockers</th>
      <th>Commit</th><th>Report</th></tr></thead>
    <tbody>%s</tbody>
  </table></div>
  <p class="note">These are not an audit in the sense a firm means it. No human audit firm has reviewed this.</p>
</section>""" % (rounds_total, len(clean),
                 ", ".join(str(c) for c in clean), blockers_total, chart_rounds, round_rows)

# ---- faq ------------------------------------------------------------------------------------------------------
faq_html = """<section id="faq" class="card">
  <h2>Questions</h2>
  %s
</section>""" % "".join(
    "<details%s><summary>%s</summary><p>%s</p></details>"
    % (" open" if i == 0 else "", esc(f["q"]), esc(f["answer"])) for i, f in enumerate(faq))

# ---- provenance -------------------------------------------------------------------------------------------------
dl = "".join('<li><a href="%s">%s</a></li>' % (esc(d["href"]), esc(d["what"]))
             for d in data["provenance"]["downloads"])
art_rows = "".join('<tr><td class="mono">%s</td><td class="mono wrap">%s</td></tr>' % (esc(k), esc(v))
                   for k, v in sorted(provenance["artifact_sha256"].items()))

provenance_html = """<section id="provenance" class="card">
  <h2>Downloads and provenance</h2>
  <ul class="dl">%s</ul>
  <p class="note">Reviewed commit %s. Source sha256 %s, which is also the source hash recorded in
  <code class="mono">deployments.mainnet.json</code> for the deployed runtime.</p>
  <div class="scroll"><table>
    <thead><tr><th>Artifact</th><th>sha256</th></tr></thead>
    <tbody>%s</tbody>
  </table></div>
</section>""" % (dl, code(provenance["reviewed_commit"]), code(provenance["source_sha256"]), art_rows)

DESCRIPTION = ("What has been reviewed, measured and verified about BulkSend, from the files in the "
               "repository, and how to check it yourself.")

STYLE = """
  :root{ color-scheme: light dark; --bg:#f6f7f4; --ink:#17201c; --mut:#5f6b64; --line:#d9ded9; --card:#ffffff; --acc:#1f7a4d; --acc2:#0f5f3a; --warn:#9a5b00; --bad:#a32d2d; --ok:#1f7a4d; --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace; }
  @media (prefers-color-scheme: dark){ :root{ --bg:#101412; --ink:#e8ede9; --mut:#9aa69f; --line:#27302b; --card:#171d19; --acc:#3fbf7f; --acc2:#6fd9a1; --warn:#e5ab5e; --bad:#f28b8b; --ok:#6fd9a1; } }
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px 22px;border-bottom:1px solid var(--line)}
  h1{font-size:18px;margin:0;letter-spacing:.2px} h1 small{color:var(--mut);font-weight:400;margin-left:8px}
  header p{margin:6px 0 0;font-size:13.5px;color:var(--mut);max-width:62ch}
  header nav{font-size:13px;display:flex;gap:14px;flex-wrap:wrap;align-items:center}
  main{max-width:920px;margin:0 auto;padding:22px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:16px}
  .card h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin:0 0 12px}
  .card h3{font-size:13px;font-weight:600;margin:22px 0 8px;color:var(--ink)}
  .card h3:first-of-type{margin-top:10px}
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;border:1px solid var(--line);font-size:12px;color:var(--mut)}
  .pill.ok{color:var(--ok);border-color:var(--ok)}
  .mono{font-family:var(--mono);font-size:12.5px}
  .wrap{word-break:break-all}
  a{color:var(--acc2)}
  p{margin:0 0 10px} p:last-child{margin-bottom:0}
  .lead{font-size:13.5px} .note{font-size:12.5px;color:var(--mut);margin-top:10px}
  .strip{display:flex;flex-wrap:wrap;gap:10px}
  .g{border:1px solid var(--line);border-radius:9px;padding:10px 14px;min-width:104px;flex:1 1 104px}
  .g.wide{flex:1 1 240px}
  .g .fig{display:block;font-family:var(--mono);font-size:22px;font-weight:600;color:var(--acc)}
  .g .cap{display:block;font-size:11.5px;color:var(--mut);margin-top:2px;text-transform:uppercase;letter-spacing:.05em}
  .scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  table{border-collapse:collapse;width:100%;font-size:12.5px;min-width:520px}
  th,td{text-align:left;vertical-align:top;padding:7px 10px;border-bottom:1px solid var(--line)}
  th{color:var(--mut);font-weight:600;text-transform:uppercase;letter-spacing:.05em;font-size:11px;white-space:nowrap}
  td.n,th.n{text-align:right;font-family:var(--mono);white-space:nowrap}
  td.sev{white-space:nowrap;color:var(--mut)}
  td.fix{color:var(--mut)}
  td.pass{white-space:nowrap}
  tfoot td{font-weight:600;border-bottom:none}
  .plain{color:var(--mut);margin-top:4px}
  details{border-top:1px solid var(--line);margin-top:12px;padding-top:10px}
  summary{cursor:pointer;color:var(--mut);font-size:13px}
  details p{font-size:13.5px;margin:8px 0 0;max-width:78ch}
  ul.dl{margin:0;padding-left:18px;font-size:13.5px} ul.dl li{margin-bottom:4px}
  .chart{display:block;width:100%;height:auto;max-width:900px;margin:4px 0 2px}
  .s-lab{font-size:12px;fill:var(--ink);font-family:system-ui,sans-serif}
  .s-var{font-size:11px;fill:var(--mut);font-family:var(--mono)}
  .s-val{font-size:11px;fill:var(--mut);font-family:var(--mono)}
  .s-num{font-size:10px;fill:var(--mut);font-family:var(--mono);text-anchor:middle}
  .s-bar{fill:var(--acc)} .s-bar2{fill:var(--acc);opacity:.55} .s-bar3{fill:var(--mut);opacity:.45}
  .s-zero{fill:var(--mut);opacity:.6}
  footer{color:var(--mut);font-size:12.5px;padding:18px 22px;border-top:1px solid var(--line);max-width:920px;margin:0 auto}
  @media(max-width:640px){ .g .fig{font-size:19px} main{padding:14px} }
"""

page = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{csp}">
<title>BulkSend Trust Center</title>
<meta name="description" content="{desc}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%8E%AF%3C/text%3E%3C/svg%3E">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#101412">
<meta property="og:type" content="website">
<meta property="og:site_name" content="GM GN Repeat">
<meta property="og:title" content="BulkSend Trust Center">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{site}/trust">
<meta property="og:image" content="{site}/trust-og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="BulkSend Trust Center: no critical, high or medium finding, {rounds} review rounds, {checks} passing checks, live mainnet runtime verified.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="BulkSend Trust Center">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{site}/trust-og.png">
<style>{style}</style>
</head>
<body>
<header id="top">
  <div>
    <h1>BulkSend <small>Trust Center</small></h1>
    <p>{desc}</p>
    <p class="mono"><a href="{explorer}/address/{addr}">{addr}</a> · Robinhood Chain mainnet</p>
  </div>
  <nav>
    <a href="/">The tool</a>
    <a href="{repo}">Source</a>
    <a href="#provenance">Downloads</a>
  </nav>
</header>
<main>
{glance}
{findings}
{gas}
{verification}
{tests}
{rounds_section}
{faq}
{provenance}
</main>
<footer>
  Generated from the repository's own files by <code class="mono">deploy/build-trust.py</code>; regenerate when
  a round is added.
  MIT licensed, including the vendored dependencies under <code class="mono">lib/</code>; the source is at
  <a href="{repo}">{repo_short}</a>. Nothing here is financial advice.
</footer>
</body>
</html>
""".format(csp=TRUST_CSP, desc=esc(DESCRIPTION), site=SITE, style=STYLE,
           rounds=rounds_total, checks=commas(checks_total),
           explorer=EXPLORER, addr=esc(live["address"]), repo=REPO,
           repo_short="github.com/SRHSoulja/robinhood-chain-tools",
           glance=glance_html, findings=findings_html, gas=gas_html,
           verification=verification_html, tests=tests_html, rounds_section=rounds_html,
           faq=faq_html, provenance=provenance_html)


# ---------------------------------------------------------------------------- last checks, then write

if re.search(r"<script", page, re.I):
    die("the generated page contains a <script tag. It is published with none, and its policy has no "
        "script-src at all, so the tag would be a promise the page breaks.")
for label, pat in (("an inline event-handler attribute", r"(?<![A-Za-z-])on[a-z]+="),
                   ("a javascript: URL", r"javascript:"),
                   ("an <iframe>, <object>, <embed>, <form> or <base> tag", r"<(iframe|object|embed|form|base)\b")):
    if re.search(pat, page, re.I):
        die("the generated page contains %s, which this page does not publish" % label)
if 'content="%s"' % TRUST_CSP not in page:
    die("the generated page does not carry the exact policy the Worker sends as a header")
for want in (commas(checks_total), str(rounds_total), live["address"]):
    if want not in page:
        die("the generated page does not print %r, which its own data says it should" % want)

os.makedirs(os.path.join(ROOT, "docs/trust"), exist_ok=True)
with open(os.path.join(ROOT, OUT_DATA), "w", encoding="utf-8") as fh:
    fh.write(data_text)
with open(os.path.join(ROOT, OUT_HTML), "w", encoding="utf-8") as fh:
    fh.write(page)

print("  wrote %s  (%d figures, %d sections)" % (OUT_DATA, len(FIGURES), len(data) - 2))
print("  wrote %s  (%d bytes, no script tag, %d passing checks, %d rounds, %d with no blocker)"
      % (OUT_HTML, len(page.encode("utf-8")), checks_total, rounds_total, len(clean)))
print("  next: node deploy/render-trust-card.mjs   (renders web/og-trust.png from %s)" % OUT_DATA)
