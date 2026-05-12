#!/usr/bin/env node

import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  createMacosAppBundleSpec,
  createNativeLauncherCompileArgs,
  type MacosAppBundleSpec
} from '../packages/features/desktop/domain/macos-app-bundle.ts';

const execFileAsync = promisify(execFile);

export interface WriteMacosAppBundleInput {
  readonly outputRoot: string;
  readonly bundle: MacosAppBundleSpec;
  readonly compileNativeExecutable?: boolean;
}

export async function writeMacosAppBundle(
  input: WriteMacosAppBundleInput
): Promise<string> {
  const appPath = path.join(input.outputRoot, input.bundle.bundleDirectoryName);

  await rm(appPath, { recursive: true, force: true });

  for (const file of input.bundle.files) {
    const outputPath = path.join(appPath, file.relativePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, file.content, 'utf8');

    if (file.executable) {
      await chmod(outputPath, 0o755);
    }
  }

  await writeNativeLauncherSource(appPath, input.bundle);

  if (input.compileNativeExecutable !== false) {
    await compileNativeLauncher(appPath, input.bundle);
  }

  return appPath;
}

async function writeNativeLauncherSource(
  appPath: string,
  bundle: MacosAppBundleSpec
): Promise<string> {
  const sourcePath = path.join(appPath, 'Contents/Resources/native-launcher.c');
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, bundle.nativeExecutable.source, 'utf8');
  return sourcePath;
}

async function compileNativeLauncher(
  appPath: string,
  bundle: MacosAppBundleSpec
): Promise<void> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('macOS launcher app generation requires an Apple Silicon Mac.');
  }

  const sourcePath = path.join(appPath, 'Contents/Resources/native-launcher.c');
  const outputPath = path.join(appPath, bundle.nativeExecutable.relativePath);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await execFileAsync('xcrun', [
    'clang',
    ...createNativeLauncherCompileArgs({ sourcePath, outputPath })
  ]);
  await chmod(outputPath, 0o755);
}

if (isMainModule()) {
  const projectRoot = path.resolve(
    readArg('--project-root') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  );
  const outputRoot = path.resolve(readArg('--output-root') ?? path.join(projectRoot, 'dist'));
  const appName = readArg('--app-name') ?? 'LabourCompressor';
  const defaultPort = Number(readArg('--default-port') ?? '4311');

  const appPath = await writeMacosAppBundle({
    outputRoot,
    bundle: createMacosAppBundleSpec({
      appName,
      projectRoot,
      defaultPort
    })
  });

  console.log(`Created macOS app: ${appPath}`);
  console.log('Open it with:');
  console.log(`  open ${JSON.stringify(appPath)}`);
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function isMainModule(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}
