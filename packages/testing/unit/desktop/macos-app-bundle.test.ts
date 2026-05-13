import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createMacosAppBundleSpec,
  createNativeLauncherCompileArgs
} from '../../../features/desktop/domain/macos-app-bundle.ts';
import {
  writeMacosAppBundle
} from '../../../../scripts/create-macos-app.ts';

test('creates a macos app bundle spec for the local web ui launcher', () => {
  const bundle = createMacosAppBundleSpec({
    appName: 'LabourCompressor',
    projectRoot: '/Users/tianyi/Desktop/codex/jobtask',
    defaultPort: 4311,
    nodeExecutablePath: '/opt/homebrew/bin/node'
  });

  assert.equal(bundle.bundleDirectoryName, 'LabourCompressor.app');
  assert.equal(bundle.files.length, 2);
  assert.equal(bundle.files[0].relativePath, 'Contents/Info.plist');
  assert.equal(bundle.files[0].executable, false);
  assert.match(bundle.files[0].content, /CFBundleExecutable/);
  assert.match(bundle.files[0].content, /labour-compressor/);
  assert.match(bundle.files[0].content, /LSArchitecturePriority/);
  assert.match(bundle.files[0].content, /arm64/);

  assert.equal(bundle.files[1].relativePath, 'Contents/Resources/launcher.sh');
  assert.equal(bundle.files[1].executable, true);
  assert.match(bundle.files[1].content, /LABOUR_COMPRESSOR_WEB_PORT/);
  assert.match(bundle.files[1].content, /NODE_BIN='\/opt\/homebrew\/bin\/node'/);
  assert.match(bundle.files[1].content, /\$\{PROJECT_ROOT\}\/\.tools\/bin/);
  assert.match(bundle.files[1].content, /\/opt\/homebrew\/bin/);
  assert.match(bundle.files[1].content, /"\$\{NODE_BIN\}" apps\/cli\/main\.ts serve-web-ui/);
  assert.match(bundle.files[1].content, /Library\/Logs\/LabourCompressor/);
  assert.match(bundle.files[1].content, /\/usr\/bin\/open/);
  assert.match(bundle.files[1].content, /api\/defaults/);

  assert.equal(
    bundle.nativeExecutable.relativePath,
    'Contents/MacOS/labour-compressor'
  );
  assert.match(bundle.nativeExecutable.source, /_NSGetExecutablePath/);
  assert.match(bundle.nativeExecutable.source, /Resources\/launcher\.sh/);
});

test('escapes project root paths in generated launcher scripts', () => {
  const bundle = createMacosAppBundleSpec({
    appName: 'Labour Compressor',
    projectRoot: '/Users/tianyi/Desktop/Project With Spaces/jobtask',
    defaultPort: 4311
  });

  const launcher = bundle.files.find((file) => {
    return file.relativePath === 'Contents/Resources/launcher.sh';
  });

  assert.ok(launcher);
  assert.match(
    launcher.content,
    /PROJECT_ROOT='\/Users\/tianyi\/Desktop\/Project With Spaces\/jobtask'/
  );
});

test('builds an arm64 clang command for the native launcher', () => {
  assert.deepEqual(
    createNativeLauncherCompileArgs({
      sourcePath: '/tmp/launcher.c',
      outputPath: '/tmp/LabourCompressor.app/Contents/MacOS/labour-compressor'
    }),
    [
      '-arch',
      'arm64',
      '-mmacosx-version-min=12.0',
      '/tmp/launcher.c',
      '-o',
      '/tmp/LabourCompressor.app/Contents/MacOS/labour-compressor'
    ]
  );
});

test('writes macos app bundle files before native compilation', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'labour-app-'));

  const appPath = await writeMacosAppBundle({
    outputRoot,
    bundle: createMacosAppBundleSpec({
      appName: 'LabourCompressor',
      projectRoot: '/tmp/labour-project',
      defaultPort: 4311
    }),
    compileNativeExecutable: false
  });

  assert.equal(appPath, path.join(outputRoot, 'LabourCompressor.app'));
  assert.match(
    await readFile(path.join(appPath, 'Contents/Info.plist'), 'utf8'),
    /CFBundleName/
  );

  const launcherPath = path.join(appPath, 'Contents/Resources/launcher.sh');
  assert.match(await readFile(launcherPath, 'utf8'), /PROJECT_ROOT='\/tmp\/labour-project'/);
  assert.equal((await stat(launcherPath)).mode & 0o111, 0o111);

  assert.match(
    await readFile(path.join(appPath, 'Contents/Resources/native-launcher.c'), 'utf8'),
    /launcher\.sh/
  );
});
