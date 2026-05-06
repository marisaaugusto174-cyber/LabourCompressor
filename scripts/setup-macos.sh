#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== LabourCompressor macOS setup =="
echo "Project: ${ROOT_DIR}"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed."
  echo "Install Node.js 22+ first: https://nodejs.org/"
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "${NODE_MAJOR}" -lt 22 ]; then
  echo "ERROR: Node.js 22+ is required. Current version: $(node --version)"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is not installed. Reinstall Node.js 22+ with npm."
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "ERROR: Homebrew is not installed."
  echo "Install Homebrew first: https://brew.sh/"
  exit 1
fi

install_brew_package() {
  local package_name="$1"
  local binary_name="$2"

  if command -v "${binary_name}" >/dev/null 2>&1; then
    echo "OK: ${binary_name} is already available."
    return
  fi

  echo "Installing ${package_name}..."
  brew install "${package_name}"
}

install_brew_package "yt-dlp" "yt-dlp"
install_brew_package "ffmpeg" "ffmpeg"

echo "Installing Node dependencies..."
cd "${ROOT_DIR}"
npm install

echo "Setup complete."
echo "Start Web UI with:"
echo "  npm run web"
