#!/usr/bin/env bash
# Pull the page's script out and hand it to node's parser. A comment appended to a one-line function has
# silently commented out its body more than once; this catches that before anything is deployed.
set -euo pipefail
OUT=${TMPDIR:-/tmp}/rh-airdrop-client-check.js
python3 - "$1" "$OUT" <<'PY'
import sys
s = open(sys.argv[1], encoding='utf-8').read()
i = s.index('<script>\n(() => {'); j = s.rindex('</script>')
open(sys.argv[2], 'w', encoding='utf-8').write(s[i+len('<script>'):j])
PY
node --check "$OUT" && echo "parses: $1"
