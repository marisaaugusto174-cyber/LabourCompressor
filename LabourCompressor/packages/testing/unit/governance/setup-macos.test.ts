import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../../..');
const SETUP_SCRIPT_PATH = path.join(PROJECT_ROOT, 'scripts', 'setup-macos.sh');

test('macOS setup avoids network-only pip self-upgrade during first launch', async () => {
  const setupScript = await readFile(SETUP_SCRIPT_PATH, 'utf8');

  assert.doesNotMatch(setupScript, /pip install --upgrade pip/);
  assert.match(setupScript, /ensurepip --upgrade/);
  assert.match(setupScript, /pip install "scenedetect\[opencv\]==0\.7"/);
});

test('macOS setup treats PySceneDetect install failure as non-blocking for launcher creation', async () => {
  const setupScript = await readFile(SETUP_SCRIPT_PATH, 'utf8');

  assert.match(setupScript, /if ! install_scenedetect; then/);
  assert.match(setupScript, /WARNING: PySceneDetect setup did not complete/);
  assert.match(setupScript, /node "\$\{ROOT_DIR\}\/scripts\/create-macos-app\.ts"/);
});

test('macOS setup does not create a scenedetect shim after failed pip install', async () => {
  const setupScript = await readFile(SETUP_SCRIPT_PATH, 'utf8');

  assert.match(
    setupScript,
    /pip install "scenedetect\[opencv\]==0\.7" \|\| return 1/
  );
  assert.match(setupScript, /rm -f "\$\{scenedetect_bin\}"/);
  assert.match(setupScript, /ln -sf "\$\{venv_dir\}\/bin\/scenedetect" "\$\{scenedetect_bin\}"/);
});
