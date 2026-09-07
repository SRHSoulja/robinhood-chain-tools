#!/usr/bin/env bash
# Puts the pages into a consistent state: check.js spliced into check.html, and each page's own CSP naming
# the hash of the script it actually carries.
#
# The hash used to be recomputed only at publish time, so any edit left the file broken until it was
# deployed, which meant the tests ran against a page whose own script the browser would refuse.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

python3 - <<'PY'
import base64, hashlib, re

# check.js is the source; check.html carries a copy of it between its script tags.
html = open('check.html', encoding='utf-8').read()
js = open('check.js', encoding='utf-8').read()
i = html.index('<script>\n(() => {'); j = html.rindex('</script>')
html = html[:i] + '<script>\n' + js + html[j:]
open('check.html', 'w', encoding='utf-8').write(html)

for path in ('index.html', 'check.html'):
    s = open(path, encoding='utf-8').read()
    blocks = [b for b in re.findall(r'<script>(.*?)</script>', s, re.S) if b.strip()]
    assert len(blocks) == 1, '%s has %d inline scripts' % (path, len(blocks))
    # Exactly what the browser hashes: everything between the tags, leading newline included.
    want = 'sha256-' + base64.b64encode(hashlib.sha256(blocks[0].encode()).digest()).decode()
    m = re.search(r'(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(">)', s)
    assert m, '%s has no CSP meta tag' % path
    cur = re.search(r'script-src ([^;]*)', m.group(2))
    assert cur, '%s has no script-src' % path
    sources = [t for t in cur.group(1).split() if not t.startswith("'sha256-")]
    new = m.group(2).replace(cur.group(0), 'script-src ' + ' '.join(sources + ["'%s'" % want]), 1)
    if new != m.group(2):
        open(path, 'w', encoding='utf-8').write(s[:m.start(2)] + new + s[m.end(2):])
        print('  %s: CSP hash updated' % path)
    else:
        print('  %s: CSP hash already correct' % path)
PY

./parsecheck.sh index.html
./parsecheck.sh check.html
