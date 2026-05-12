import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createMacosAppBundleSpec
} from '../../../features/desktop/domain/macos-app-bundle.ts';
import {
  writeMacosAppBundle
} from '../../../../scripts/create-macos-app.ts';

test('creates a macos app bundle spec for the local web ui launcher', () => {
  const bundle = createMacosAppBundleSpec({
    appName: 'LabourCompressor',
    projectRoot: '/Users/tianyi/Desktop/codex/jobtask',
    defaultPort: 4311
  });

  assert.equal(bundle.bundleDirectoryName, 'LabourCompressor.app');
  assert.equal(bundle.files.length, 2);
  assert.equal(bundle.files[0].relativePath, 'Contents/Info.plist');
  assert.equal(bundle.files[0].executable, false);
  assert.match(bundle.files[0].content, /CFBundleExecutable/);
  assert.match(bundle.files[0].content, /labour-compressor/);

  assert.equal(bundle.files[1].relativePath, 'Contents/MacOS/labour-compressor');
  assert.equal(bundle.files[1].executable, true);
  assert.match(bundle.files[1].content, /LABOUR_COMPRESSOR_WEB_PORT/);
  assert.match(bundle.files[1].content, /node apps\/cli\/main\.ts serve-web-ui/);
  assert.match(bundle.files[1].content, /Library\/Logs\/LabourCompressor/);
  assert.match(bundle.files[1].content, /\/usr\/bin\/open/);
  assert.match(bundle.files[1].content, /api\/defaults/);
});

test('escapes project root paths in generated launcher scripts', () => {
  const bundle = createMacosAppBundleSpec({
    appName: 'Labour Compressor',
    projectRoot: '/Users/tianyi/Desktop/Project With Spaces/jobtask',
    defaultPort: 4311
  });

  const launcher = bundle.files.find((file) => {
    return file.relativePath === 'Contents/MacOS/labour-compressor';
  });

  assert.ok(launcher);
  assert.match(
    launcher.content,
    /PROJECT_ROOT='\/Users\/tianyi\/Desktop\/Project With Spaces\/jobtask'/
  );
});

test('writes macos app bundle files with executable launcher mode', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'labour-app-'));

  const appPath = await writeMacosAppBundle({
    outputRoot,
    bundle: createMacosAppBundleSpec({
      appName: 'LabourCompressor',
      projectRoot: '/tmp/labour-project',
      defaultPort: 4311
    })
  });

  assert.equal(appPath, path.join(outputRoot, 'LabourCompressor.app'));
  assert.match(
    await readFile(path.join(appPath, 'Contents/Info.plist'), 'utf8'),
    /CFBundleName/
  );

  const launcherPath = path.join(appPath, 'Contents/MacOS/labour-compressor');
  assert.match(await readFile(launcherPath, 'utf8'), /PROJECT_ROOT='\/tmp\/labour-project'/);
  assert.equal((await stat(launcherPath)).mode & 0o111, 0o111);
});
