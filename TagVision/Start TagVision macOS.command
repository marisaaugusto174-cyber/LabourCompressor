#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export TAGVISION_WEB_HOST="${TAGVISION_WEB_HOST:-127.0.0.1}"
export TAGVISION_WEB_PORT="${TAGVISION_WEB_PORT:-4312}"
TAGVISION_URL="http://${TAGVISION_WEB_HOST}:${TAGVISION_WEB_PORT}/review.html"
LOG_FILE="$SCRIPT_DIR/tagvision-macos-launcher.log"

echo "Starting TagVision V0.1 macOS from: $SCRIPT_DIR"
echo "TagVision URL: $TAGVISION_URL"
echo "Launcher log: $LOG_FILE"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install Node.js first, then run this launcher again."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "Installing TagVision V0.1 macOS dependencies..."
  npm install
fi

if lsof -nP -iTCP:"$TAGVISION_WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $TAGVISION_WEB_PORT is already in use. Opening existing TagVision URL."
  open "$TAGVISION_URL"
  read -r -p "Press Enter to close this launcher window..."
  exit 0
fi

echo "Starting local server..."
npm run web >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  if curl -fsS "$TAGVISION_URL" >/dev/null 2>&1; then
    echo "TagVision V0.1 macOS is ready."
    open "$TAGVISION_URL"
    echo "Server process: $SERVER_PID"
    echo "Close this Terminal window to stop TagVision."
    wait "$SERVER_PID"
    exit $?
  fi

  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    echo "TagVision server exited before becoming ready. Last log lines:"
    tail -40 "$LOG_FILE" || true
    read -r -p "Press Enter to close..."
    exit 1
  fi

  sleep 0.25
done

echo "Timed out waiting for TagVision. Last log lines:"
tail -40 "$LOG_FILE" || true
kill "$SERVER_PID" >/dev/null 2>&1 || true
read -r -p "Press Enter to close..."
exit 1
