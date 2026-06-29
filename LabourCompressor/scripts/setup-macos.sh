#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== LabourCompressor macOS setup =="
echo "Project: ${ROOT_DIR}"

if [ "$(uname -m)" != "arm64" ]; then
  echo "ERROR: LabourCompressor.app currently supports Apple Silicon Macs only."
  exit 1
fi

if ! xcrun --find clang >/dev/null 2>&1; then
  echo "ERROR: Xcode Command Line Tools are required to build the Apple Silicon launcher app."
  echo "Install them with:"
  echo "  xcode-select --install"
  exit 1
fi

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
install_brew_package "python@3.11" "python3.11"

PYTHON_FOR_SCENEDETECT="$(command -v python3.11 || true)"
if [ -z "${PYTHON_FOR_SCENEDETECT}" ]; then
  echo "ERROR: Python 3.11 is required for PySceneDetect."
  exit 1
fi

install_scenedetect() {
  local tools_bin="${ROOT_DIR}/.tools/bin"
  local venv_dir="${ROOT_DIR}/.tools/scenedetect-venv"
  local scenedetect_bin="${tools_bin}/scenedetect"

  mkdir -p "${tools_bin}"

  if [ -x "${scenedetect_bin}" ]; then
    echo "OK: scenedetect is already available at ${scenedetect_bin}."
    return
  fi

  echo "Installing PySceneDetect into project-local venv..."
  rm -rf "${venv_dir}"
  rm -f "${scenedetect_bin}"
  "${PYTHON_FOR_SCENEDETECT}" -m venv "${venv_dir}"
  "${venv_dir}/bin/python" -m ensurepip --upgrade || return 1
  "${venv_dir}/bin/python" -m pip install "scenedetect[opencv]==0.7" || return 1

  ln -sf "${venv_dir}/bin/scenedetect" "${scenedetect_bin}"
  echo "Created: ${scenedetect_bin}"
}

if ! install_scenedetect; then
  echo "WARNING: PySceneDetect setup did not complete."
  echo "WARNING: The Web UI can still start, but automatic segmentation preflight may fail until PySceneDetect is installed."
fi

echo "Installing Node dependencies..."
cd "${ROOT_DIR}"
npm install

create_local_config() {
  local template_path="$1"
  local local_path="$2"

  if [ -f "${local_path}" ]; then
    echo "OK: $(basename "${local_path}") already exists."
    return
  fi

  if [ ! -f "${template_path}" ]; then
    echo "ERROR: Missing template: ${template_path}"
    exit 1
  fi

  cp "${template_path}" "${local_path}"
  echo "Created: ${local_path}"
}

create_local_config \
  "${ROOT_DIR}/config/model-providers/providers.template.json" \
  "${ROOT_DIR}/config/model-providers/providers.local.json"
create_local_config \
  "${ROOT_DIR}/config/download-platform-credentials.template.json" \
  "${ROOT_DIR}/config/download-platform-credentials.local.json"

echo "Creating macOS launcher app..."
node "${ROOT_DIR}/scripts/create-macos-app.ts"

echo "Setup complete."
echo "Open the Web UI app with:"
echo "  open \"${ROOT_DIR}/dist/LabourCompressor.app\""
