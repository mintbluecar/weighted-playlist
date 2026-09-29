#!/bin/sh
# Runs app.js scenarios in headless Chrome against a fake YouTube player (macOS Chrome path).
# Usage: tests/browser/run.sh [scenario ...]   (default: all)
cd "$(dirname "$0")/../.." || exit 1
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8765
SCENARIOS=${*:-load-race failed-load typed-weight added-note-hides dismiss-note cued-after-load row-thumbnail remove-song removed-stays-removed readd-removed}

python3 -m http.server $PORT >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1

status=0
for s in $SCENARIOS; do
  out=$(mktemp)
  "$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$(mktemp -d)" \
    --virtual-time-budget=30000 --dump-dom "http://localhost:$PORT/tests/browser/app-harness.html?scenario=$s" >"$out" 2>/dev/null &
  chrome=$!
  for _ in $(seq 1 60); do grep -q 'RESULT:' "$out" && break; sleep 1; done
  kill $chrome 2>/dev/null
  line=$(grep -o 'RESULT:{.*' "$out" | sed 's/<\/pre>.*//' | head -1)
  echo "${line:-RESULT:{\"scenario\":\"$s\",\"pass\":false,\"error\":\"no result\"}}"
  echo "$line" | grep -q '"pass":true' || status=1
done
exit $status
