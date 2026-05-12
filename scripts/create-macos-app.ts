#!/usr/bin/env node

import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createMacosAppBundleSpec,
  type MacosAppBundleSpec
} from '../packages/features/desktop/domain/macos-app-bundle.ts';

export interface WriteMacosAppBundleInput {
  readonly outputRoot: string;
  readonly bundle: MacosAppBundleSpec;
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

  return appPath;
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
