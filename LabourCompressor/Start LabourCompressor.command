#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}"
SETUP_SCRIPT="${ROOT_DIR}/scripts/setup-macos.sh"
APP_PATH="${ROOT_DIR}/dist/LabourCompressor.app"

cd "${ROOT_DIR}"

if [ ! -f "${SETUP_SCRIPT}" ]; then
  /usr/bin/osascript -e "display dialog \"Missing setup script: ${SETUP_SCRIPT}\" buttons {\"OK\"} default button \"OK\" with icon stop" >/dev/null 2>&1 || true
  exit 1
fi

needs_setup() {
  if [ ! -d "${ROOT_DIR}/node_modules/xlsx" ]; then
    return 0
  fi

  if [ ! -f "${ROOT_DIR}/config/model-providers/providers.local.json" ]; then
    return 0
  fi

  if [ ! -f "${ROOT_DIR}/config/download-platform-credentials.local.json" ]; then
    return 0
  fi

  if [ ! -d "${APP_PATH}" ]; then
    return 0
  fi

  return 1
}

if needs_setup; then
  /bin/bash "${SETUP_SCRIPT}"
fi

if [ ! -d "${APP_PATH}" ]; then
  node "${ROOT_DIR}/scripts/create-macos-app.ts"
fi

/usr/bin/open "${APP_PATH}"
