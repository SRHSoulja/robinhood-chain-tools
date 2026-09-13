#!/usr/bin/env bash
# Decides, mechanically, whether the changes in the working tree could possibly affect a transaction.
#
#   ./test/classify-change.sh [BASE]        BASE defaults to HEAD
#
# It prints every reason it found, one per line, and then exactly one verdict as its last line:
#
#   NO_CHANGE              nothing differs from BASE                                exit 0
#   PRESENTATION_ONLY      every change is in the presentation allowlist and        exit 0
#                          passes the page guard below
#   FULL_VERIFY_REQUIRED   anything else                                            exit 2
#
# The rule this exists to serve: ./verify.sh stays the authoritative gate and is untouched. This says only
# whether a change is one of the narrow kinds that cannot reach a transaction, and it answers
# FULL_VERIFY_REQUIRED whenever it cannot prove that. Nothing here is a judgement about whether a change
# "looks cosmetic": every test is a byte comparison against BASE over a named region. A reason is never
# printed beside PRESENTATION_ONLY; a single reason is enough to escalate.
#
# See docs/harness.md, "The presentation lane".
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
BASE="${1:-HEAD}"

reasons=()
esc() { reasons+=("escalate: $*"); }

verdict() {
  if [ "${#reasons[@]}" -gt 0 ]; then
    printf '%s\n' "${reasons[@]}"
    echo FULL_VERIFY_REQUIRED
    exit 2
  fi
  echo "$1"
  exit 0
}

if ! git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null 2>&1; then
  esc "$BASE is not a commit this repository knows, so nothing can be compared against it"
  verdict FULL_VERIFY_REQUIRED
fi

# Tracked differences against BASE (working tree, index included) and every untracked file git would not
# ignore. An untracked file is a change like any other: a new module dropped into src/ changes the build
# without changing one tracked byte.
files="$( { git diff --name-only "$BASE" -- .; git ls-files --others --exclude-standard; } | sort -u )"

if [ -z "$files" ]; then
  echo "classify-change: nothing differs from $BASE ($(git rev-parse --short "$BASE"))"
  verdict NO_CHANGE
fi

echo "classify-change: $(printf '%s\n' "$files" | wc -l) path(s) differ from $BASE ($(git rev-parse --short "$BASE"))"
printf '%s\n' "$files" | sed 's/^/    /'
echo

# ---- the page guard ------------------------------------------------------------------------------------
# Applied to web/index.html and web/check.html by comparing `git show BASE:<path>` with the working file.
# Everything it checks is a byte comparison over a region it locates by parsing, and every parse it is not
# sure about escalates.
page_guard() {
  local path="$1" kind="$2" basefile out rc
  basefile="$(mktemp)"
  if ! git show "$BASE:$path" >"$basefile" 2>/dev/null; then
    rm -f "$basefile"
    esc "$path has no version in $BASE, so there is nothing to compare a new page against"
    return
  fi
  if [ ! -f "$path" ]; then
    rm -f "$basefile"
    esc "$path was deleted"
    return
  fi
  out="$(python3 - "$basefile" "$path" "$path" "$kind" <<'PY'
import re, sys

base_path, work_path, name, kind = sys.argv[1:5]
base_src = open(base_path, encoding='utf-8').read()
work_src = open(work_path, encoding='utf-8').read()
out = []
def esc(msg):
    out.append('escalate: %s %s' % (name, msg))

SCRIPT = re.compile(r'<script([^>]*)>(.*?)</script>', re.S)

def scripts(src):
    """Every <script> in the file, split into the ones with a src attribute and the inline ones.
    A tag carrying src= is external and is compared as a tag; a tag without one is compared as text."""
    external, inline = [], []
    for m in SCRIPT.finditer(src):
        attrs, body = m.group(1), m.group(2)
        if 'src=' in attrs.lower():
            external.append('<script' + attrs + '>')
        else:
            inline.append((body, src[:m.start(2)].count('\n') + 1))
    return external, inline

b_ext, b_in = scripts(base_src)
w_ext, w_in = scripts(work_src)

# (a) Every <script src> tag: the whole opening tag, same count, same order. The integrity attribute and the
#     URL live in that tag, so a substituted library is a change to this string and nothing else.
if b_ext != w_ext:
    if len(b_ext) != len(w_ext):
        esc('has %d <script src> tag(s) where %s had %d' % (len(w_ext), 'BASE', len(b_ext)))
    else:
        for i, (b, w) in enumerate(zip(b_ext, w_ext)):
            if b != w:
                esc('<script src> tag %d changed: %s' % (i + 1, w[:160]))

# (b) The inline scripts: same count, and each pair identical once comments are removed by the rule below
#     and no other rule. Anything the parse is unsure about escalates rather than being waved through.
def unescaped(text, ch):
    """How many of `ch` are in `text` without a backslash in front of them."""
    n = i = 0
    while i < len(text):
        c = text[i]
        if c == '\\':
            i += 2
            continue
        if c == ch:
            n += 1
        i += 1
    return n

def strip_comments(text):
    """Removes exactly the comment parts the rule allows, and returns (kept_lines, first_line_numbers, why).

    A line qualifies as removable-comment content only if:
      (i)  the whole line, after leading whitespace, starts with //, or starts with /* or * or */ and the
           line contains no ' " or backtick; or
      (ii) the line contains // outside a string, where outside a string means the text before that // has an
           even number of unescaped ' and an even number of unescaped " and contains no backtick, and that
           text contains no other / character. The text from // to end of line is then removable.
    A line containing a backtick anywhere is never treated as a comment line, because a template literal
    spans lines and its content is not comment text.
    """
    kept, linenos = [], []
    depth = 0
    for i, line in enumerate(text.split('\n'), 1):
        s = line.lstrip()
        tick = '`' in line
        if not tick:
            if s.startswith('//'):
                continue                                   # (i), a whole-line // comment
            if (s.startswith('/*') or s.startswith('*/') or s.startswith('*')) and not ("'" in line or '"' in line):
                if s.startswith('/*') and '*/' not in s[2:]:
                    depth += 1
                elif s.startswith('*/'):
                    depth -= 1
                continue                                   # (i), a block-comment line
            p = line.find('//')
            if p >= 0:
                before = line[:p]
                if '/' not in before and unescaped(before, "'") % 2 == 0 and unescaped(before, '"') % 2 == 0:
                    line = before                          # (ii), a trailing comment
        if depth < 0:
            return kept, linenos, 'a block comment closes where none was open, at line %d' % i
        kept.append(line.rstrip())
        linenos.append(i)
    if depth != 0:
        return kept, linenos, 'a block comment is never closed, so the guard cannot tell comment from code'
    return kept, linenos, None

if len(b_in) != len(w_in):
    esc('has %d inline script(s) where BASE had %d' % (len(w_in), len(b_in)))
elif len(w_in) != 1:
    esc('has %d inline scripts; this guard is written for exactly one and will not guess' % len(w_in))
else:
    b_text, b_off = b_in[0]
    w_text, w_off = w_in[0]
    # (e) check.html's inline script is spliced from web/check.js by web/sync.sh, and check.js is not in the
    #     allowlist. Any difference at all, comments included, means check.js moved underneath it.
    if kind == 'check':
        if b_text != w_text:
            esc('inline script differs, and it is a copy of web/check.js spliced in by web/sync.sh, '
                'so the change came from a file outside the allowlist')
    else:
        b_keep, b_nums, b_why = strip_comments(b_text)
        w_keep, w_nums, w_why = strip_comments(w_text)
        if b_why or w_why:
            esc('inline script cannot be parsed with confidence: %s' % (w_why or b_why))
        elif b_keep != w_keep:
            n = min(len(b_keep), len(w_keep))
            at = next((i for i in range(n) if b_keep[i] != w_keep[i]), n)
            if at < len(w_nums):
                esc('inline script differs outside comments at line %d' % (w_off + w_nums[at] - 1))
            else:
                esc('inline script differs outside comments: %d line(s) were removed from the end'
                    % (len(b_keep) - len(w_keep)))

# (c) The Content-Security-Policy meta tag, and every other http-equiv meta tag.
META_HTTP = re.compile(r'<meta\b[^>]*http-equiv\s*=\s*"([^"]*)"[^>]*>', re.I)
SHA = re.compile(r"'sha256-[A-Za-z0-9+/=]+'")

def http_metas(src):
    csp, other = [], []
    for m in META_HTTP.finditer(src):
        (csp if m.group(1).lower() == 'content-security-policy' else other).append(m.group(0))
    return csp, other

b_csp, b_other = http_metas(base_src)
w_csp, w_other = http_metas(work_src)
if b_other != w_other:
    esc('an http-equiv meta tag other than the CSP changed')
if len(b_csp) != 1 or len(w_csp) != 1:
    esc('has %d Content-Security-Policy meta tag(s) where BASE had %d; this guard expects exactly one'
        % (len(w_csp), len(b_csp)))
else:
    b_hashes, w_hashes = SHA.findall(b_csp[0]), SHA.findall(w_csp[0])
    if len(b_hashes) != 1 or len(w_hashes) != 1:
        esc('its CSP names %d script hashes where BASE named %d; this guard expects exactly one'
            % (len(w_hashes), len(b_hashes)))
    elif SHA.sub("'sha256-X'", b_csp[0]) != SHA.sub("'sha256-X'", w_csp[0]):
        esc('Content-Security-Policy changed outside its single script hash')
    elif b_hashes != w_hashes and b_in and w_in and b_in[0][0] == w_in[0][0]:
        esc('CSP script hash changed while the inline script did not, so the page would no longer run')

if re.search(r'<base\b', work_src, re.I):
    esc('carries a <base> tag, which changes what every relative URL on the page resolves to')

# (d) The network selector, the non-icon links, the element ids, and the markup that can execute.
NET = re.compile(r'<select\b[^>]*\bid="net"[^>]*>.*?</select>', re.S)
b_net, w_net = NET.search(base_src), NET.search(work_src)
if not b_net or not w_net:
    esc('the <select id="net"> element could not be found in both versions')
elif b_net.group(0) != w_net.group(0):
    esc('the <select id="net"> element changed, so the networks offered or their order may have changed')

LINK = re.compile(r'<link\b[^>]*>', re.I)
REL = re.compile(r'\brel\s*=\s*"([^"]*)"', re.I)
def links(src):
    keep = []
    for tag in LINK.findall(src):
        rel = (REL.search(tag).group(1).strip().lower() if REL.search(tag) else '')
        if rel in ('icon', 'apple-touch-icon'):
            continue                                        # the icon lane: these may change
        keep.append(tag)
    return keep
if links(base_src) != links(work_src):
    esc('a <link> tag other than an icon changed')

# <meta name=...> and <meta property=...> are the share-metadata lane and may change freely. A meta tag that
# is none of name, property or http-equiv (charset, most of all) is not part of that lane.
META = re.compile(r'<meta\b[^>]*>', re.I)
def plain_metas(src):
    return [t for t in META.findall(src)
            if not re.search(r'\b(name|property|http-equiv)\s*=', t, re.I)]
if plain_metas(base_src) != plain_metas(work_src):
    esc('a <meta> tag that is neither name, property nor http-equiv changed')

ID = re.compile(r'\bid="([^"]*)"')
b_ids, w_ids = set(ID.findall(base_src)), set(ID.findall(work_src))
for gone in sorted(b_ids - w_ids):
    esc("element id '%s' removed" % gone)

# Markup that can execute, or that can host something that executes. Zero of each, unless BASE already
# carried some, in which case they must be exactly the same ones.
PATTERNS = [
    ('an inline event-handler attribute', re.compile(r'(?<![A-Za-z-])on[a-z]+=')),
    ('a javascript: URL', re.compile(r'javascript:', re.I)),
    ('an <iframe> tag', re.compile(r'<iframe', re.I)),
    ('an <object> tag', re.compile(r'<object', re.I)),
    ('an <embed> tag', re.compile(r'<embed', re.I)),
    ('a <form> tag', re.compile(r'<form', re.I)),
]
for label, pat in PATTERNS:
    b_hits, w_hits = pat.findall(base_src), pat.findall(work_src)
    if not b_hits and w_hits:
        esc('contains %s (%d), and BASE contained none' % (label, len(w_hits)))
    elif b_hits != w_hits:
        esc('the %s it already carried changed: %d now, %d in BASE' % (label, len(w_hits), len(b_hits)))

print('\n'.join(out))
PY
)"
  rc=$?
  rm -f "$basefile"
  if [ "$rc" -ne 0 ]; then
    esc "$path could not be parsed by the page guard, so it is not proven safe"
  fi
  while IFS= read -r line; do
    [ -n "$line" ] && reasons+=("$line")
  done <<<"$out"
}

# ---- the image guard -----------------------------------------------------------------------------------
# An allowlisted PNG is accepted only if it really is a PNG of the size the page and the worker expect.
png_guard() {
  local path="$1" w="$2" h="$3" out
  if [ ! -f "$path" ]; then
    esc "$path is missing"
    return
  fi
  out="$(python3 - "$path" "$w" "$h" <<'PY'
import struct, sys
path, want_w, want_h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
data = open(path, 'rb').read()
if data[:8] != b'\x89PNG\r\n\x1a\n':
    print('escalate: %s is not a PNG (its 8-byte signature is wrong)' % path)
elif len(data) < 24 or data[12:16] != b'IHDR':
    print('escalate: %s has no IHDR chunk where a PNG must have one' % path)
else:
    w, h = struct.unpack('>II', data[16:24])
    if (w, h) != (want_w, want_h):
        print('escalate: %s is %dx%d; this file must be %dx%d' % (path, w, h, want_w, want_h))
PY
)"
  [ -n "$out" ] && reasons+=("$out")
}

pages=()
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    web/index.html)              pages+=("$f:airdrop") ;;
    web/check.html)              pages+=("$f:check") ;;
    web/og-airdrop.png|web/og-check.png)                 png_guard "$f" 1200 630 ;;
    web/apple-touch-icon.png|web/apple-touch-icon-check.png) png_guard "$f" 180 180 ;;
    README.md|SECURITY.md)       : ;;
    docs/*.md)                   : ;;
    test/web/presentation.test.mjs) : ;;
    *)                           esc "$f changed; it is not in the presentation allowlist" ;;
  esac
done <<<"$files"

for entry in ${pages[@]+"${pages[@]}"}; do
  page_guard "${entry%:*}" "${entry##*:}"
done

verdict PRESENTATION_ONLY
