#!/bin/sh
# ElondiaRPG local launcher (macOS / Linux).
# Serves the "game" folder at http://localhost:8473/ and opens the browser.
# With Python, server.py also relays AI requests for services without CORS (the game's "經本機版轉送" option).
# Saves live in the browser and belong to this address, so the port stays fixed.
# Press Ctrl+C (or close the terminal) to stop.

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/game" || { echo "Cannot find the game folder next to this script."; exit 1; }
PORT=8473
URL="http://localhost:$PORT/"

open_url() {
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  else echo "Open $URL in your browser."
  fi
}

# Already running (another window)? Just open it.
if (command -v curl >/dev/null 2>&1 && curl -s -o /dev/null "$URL") ; then
  echo "The game is already running at $URL"
  open_url
  exit 0
fi

PY=""
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1 && python -c 'import sys; sys.exit(sys.version_info[0] < 3)'; then
  PY=python
elif command -v npx >/dev/null 2>&1; then
  echo "(Python 3 not found: running without the AI relay; the \"經本機版轉送\" option will not work.)"
else
  echo "Python 3 (or Node.js) is needed to run a local server."
  echo "macOS: install the Xcode command line tools (run: xcode-select --install) or Python from python.org."
  echo "Or play online: https://yellow630914.github.io/ElondiaRPG/"
  exit 1
fi

if [ -z "$PY" ]; then
  echo "ElondiaRPG is running at $URL"
fi
echo "Keep this window open while playing. Press Ctrl+C to stop."
( sleep 1; open_url ) &
if [ -n "$PY" ]; then
  exec "$PY" "$HERE/server.py" "$HERE/game"
fi
exec npx --yes serve -l "tcp://127.0.0.1:$PORT" .
