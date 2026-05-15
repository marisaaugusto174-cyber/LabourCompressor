import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createMacosAppBundleSpec,
  createNativeLauncherCompileArgs,
  createWindowsLauncherScript
} from '../../../features/desktop/domain/macos-app-bundle.ts';
import {
  writeMacosAppBundle
} from '../../../../scripts/create-macos-app.ts';
import {
  writeWindowsLauncher
} from '../../../../scripts/create-windows-launcher.ts';
import packageJson from '../../../../package.json' with { type: 'json' };

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

test('creates a Windows launcher script for the local web ui', () => {
  const launcher = createWindowsLauncherScript({
    appName: 'LabourCompressor',
    projectRoot: 'C:\\labour',
    defaultPort: 4311,
    nodeExecutablePath: 'C:\\Program Files\\nodejs\\node.exe'
  });

  assert.match(launcher, /LOCALAPPDATA/);
  assert.match(launcher, /LabourCompressor\\logs/);
  assert.match(launcher, /LABOUR_COMPRESSOR_WEB_PORT/);
  assert.match(launcher, /apps\\cli\\main\.ts serve-web-ui/);
  assert.match(launcher, /Start-Process "http:\/\/127\.0\.0\.1:\$Port"/);
  assert.match(launcher, /C:\\labour\\.tools\\bin/);
  assert.match(launcher, /C:\\labour\\.tools\\scenedetect-venv\\Scripts/);
});

test('exposes Windows setup and launcher npm scripts', () => {
  assert.equal(packageJson.scripts['setup:windows'], 'powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1');
  assert.equal(packageJson.scripts['launcher:windows'], 'node scripts/create-windows-launcher.ts');
});

test('writes Windows double-click app launcher files', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'labour-windows-app-'));
  const result = await writeWindowsLauncher({
    outputRoot,
    projectRoot: 'C:\\labour',
    appName: 'LabourCompressor',
    defaultPort: 4311,
    nodeExecutablePath: 'C:\\Program Files\\nodejs\\node.exe'
  });

  assert.equal(result.appLauncherPath, path.join(outputRoot, 'LabourCompressor.vbs'));
  assert.equal(result.cmdPath, path.join(outputRoot, 'LabourCompressor.cmd'));
  assert.equal(result.powershellPath, path.join(outputRoot, 'LabourCompressor.ps1'));

  const appLauncher = await readFile(result.appLauncherPath, 'utf8');
  assert.match(appLauncher, /CreateObject\("WScript\.Shell"\)/);
  assert.match(appLauncher, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -File/);
  assert.match(appLauncher, /LabourCompressor\.ps1/);
  assert.match(appLauncher, /, 0, False/);
});
