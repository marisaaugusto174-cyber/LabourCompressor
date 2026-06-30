#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export TAGVISION_WEB_HOST="${TAGVISION_WEB_HOST:-127.0.0.1}"
export TAGVISION_WEB_PORT="${TAGVISION_WEB_PORT:-4312}"
TAGVISION_URL="http://${TAGVISION_WEB_HOST}:${TAGVISION_WEB_PORT}/review.html"
LOG_FILE="$SCRIPT_DIR/tagvision-macos-launcher.log"
PID_FILE="$SCRIPT_DIR/tagvision-macos-server.pid"

echo "Starting TagVision V0.1 macOS from: $SCRIPT_DIR"
echo "TagVision URL: $TAGVISION_URL"
echo "Launcher log: $LOG_FILE"

pause_on_error() {
  read -r -p "Press Enter to close..." || true
}

process_command() {
  ps -p "$1" -o command= 2>/dev/null || true
}

process_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
}

is_tagvision_package_dir() {
  local candidate_dir="$1"

  [ -f "$candidate_dir/package.json" ] || return 1
  node -e 'const fs = require("fs"); const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.exit(pkg.name === "tagvision-macos" ? 0 : 1);' "$candidate_dir/package.json" >/dev/null 2>&1
}

is_tagvision_server_process() {
  local pid="$1"
  local command_line
  local cwd

  command_line="$(process_command "$pid")"
  [[ "$command_line" == *"node apps/web/server.ts"* ]] || return 1

  cwd="$(process_cwd "$pid")"
  [ -n "$cwd" ] || return 1

  if [ "$cwd" = "$SCRIPT_DIR" ]; then
    return 0
  fi

  is_tagvision_package_dir "$cwd"
}

stop_verified_tagvision_pid() {
  local pid="$1"

  echo "Stopping previous TagVision server process: $pid"
  kill "$pid" >/dev/null 2>&1 || true

  for _ in $(seq 1 40); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done

  if is_tagvision_server_process "$pid"; then
    echo "Previous TagVision server did not exit after SIGTERM; forcing stop: $pid"
    kill -9 "$pid" >/dev/null 2>&1 || true
    return 0
  fi

  echo "Process changed while stopping; refusing to force kill pid $pid."
  return 1
}

stop_existing_tagvision_servers() {
  local port_pids
  port_pids="$(lsof -tiTCP:"$TAGVISION_WEB_PORT" -sTCP:LISTEN 2>/dev/null || true)"

  if [ -z "$port_pids" ]; then
    return 0
  fi

  for pid in $port_pids; do
    if is_tagvision_server_process "$pid"; then
      stop_verified_tagvision_pid "$pid"
      continue
    fi

    echo "Port $TAGVISION_WEB_PORT is occupied by pid $pid."
    echo "Refusing to stop non-TagVision process. Close that app or choose another TAGVISION_WEB_PORT."
    pause_on_error
    exit 1
  done
}

sync_dependencies() {
  echo "Syncing TagVision V0.1 macOS dependencies..."

  if [ -f "$SCRIPT_DIR/package-lock.json" ]; then
    npm ci --omit=dev --no-audit --no-fund
    return 0
  fi

  npm install --omit=dev --no-audit --no-fund
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install Node.js first, then run this launcher again."
  pause_on_error
  exit 1
fi

stop_existing_tagvision_servers

sync_dependencies

echo "Starting local server..."
: >"$LOG_FILE"
nohup npm run web >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"

for _ in $(seq 1 40); do
  if curl -fsS "$TAGVISION_URL" >/dev/null 2>&1; then
    echo "TagVision V0.1 macOS is ready."
    echo "Server process: $SERVER_PID"
    open "$TAGVISION_URL"
    exit 0
  fi

  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    echo "TagVision server exited before becoming ready. Last log lines:"
    tail -40 "$LOG_FILE" || true
    pause_on_error
    exit 1
  fi

  sleep 0.25
done

echo "Timed out waiting for TagVision. Last log lines:"
tail -40 "$LOG_FILE" || true
kill "$SERVER_PID" >/dev/null 2>&1 || true
pause_on_error
exit 1
