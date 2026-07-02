#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/dist"
PACKAGE_DIR="$DIST_DIR/TagVision-macOS-V0.5.1"
ZIP_PATH="$DIST_DIR/TagVision-macOS-V0.5.1.zip"

rm -rf "$DIST_DIR"/TagVision-macOS-V* "$DIST_DIR"/tagvision-macos-*.tgz
mkdir -p "$PACKAGE_DIR"

rsync -a \
  --exclude node_modules \
  --exclude dist \
  --exclude tagvision-launcher.log \
  --exclude tagvision-macos-launcher.log \
  --exclude tagvision-macos-server.pid \
  --exclude '_tagvision-thumbnails' \
  "$PROJECT_ROOT/" "$PACKAGE_DIR/"

(cd "$PACKAGE_DIR" && npm ci --omit=dev --no-audit --no-fund)
(cd "$PROJECT_ROOT" && npm pack --pack-destination "$DIST_DIR")
(cd "$DIST_DIR" && COPYFILE_DISABLE=1 zip -r -q "$(basename "$ZIP_PATH")" "$(basename "$PACKAGE_DIR")" -x '*/.DS_Store' '*/._*')

echo "Wrote $ZIP_PATH"
