#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createWindowsLauncherScript
} from '../packages/features/desktop/domain/macos-app-bundle.ts';

export interface WriteWindowsLauncherInput {
  readonly outputRoot: string;
  readonly projectRoot: string;
  readonly appName: string;
  readonly defaultPort: number;
  readonly nodeExecutablePath?: string;
}

export async function writeWindowsLauncher(
  input: WriteWindowsLauncherInput
): Promise<{
  readonly appLauncherPath: string;
  readonly powershellPath: string;
  readonly cmdPath: string;
}> {
  await mkdir(input.outputRoot, { recursive: true });

  const appLauncherPath = path.join(input.outputRoot, `${input.appName}.vbs`);
  const powershellPath = path.join(input.outputRoot, `${input.appName}.ps1`);
  const cmdPath = path.join(input.outputRoot, `${input.appName}.cmd`);
  const launcherScript = createWindowsLauncherScript({
    appName: input.appName,
    projectRoot: input.projectRoot,
    defaultPort: input.defaultPort,
    nodeExecutablePath: input.nodeExecutablePath
  });

  await writeFile(powershellPath, launcherScript, 'utf8');
  await writeFile(
    appLauncherPath,
    createWindowsScriptHostLauncher(`${input.appName}.ps1`),
    'utf8'
  );
  await writeFile(
    cmdPath,
    [
      '@echo off',
      'setlocal',
      'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0LabourCompressor.ps1"',
      'endlocal'
    ].join('\r\n') + '\r\n',
    'utf8'
  );

  return Object.freeze({
    appLauncherPath,
    powershellPath,
    cmdPath
  });
}

if (isMainModule()) {
  const projectRoot = path.resolve(
    readArg('--project-root') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  );
  const outputRoot = path.resolve(readArg('--output-root') ?? path.join(projectRoot, 'dist'));
  const appName = readArg('--app-name') ?? 'LabourCompressor';
  const defaultPort = Number(readArg('--default-port') ?? '4311');
  const result = await writeWindowsLauncher({
    outputRoot,
    projectRoot,
    appName,
    defaultPort,
    nodeExecutablePath: readArg('--node') ?? process.execPath
  });

  console.log(`Created Windows app launcher: ${result.appLauncherPath}`);
  console.log(`Created Windows command launcher: ${result.cmdPath}`);
  console.log(`PowerShell launcher: ${result.powershellPath}`);
}

function createWindowsScriptHostLauncher(
  powershellFileName: string
): string {
  const escapedPowerShellFileName = powershellFileName.replaceAll('"', '""');

  return [
    'Set shell = CreateObject("WScript.Shell")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)',
    `ps1Path = fso.BuildPath(scriptDir, "${escapedPowerShellFileName}")`,
    'command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & ps1Path & Chr(34)',
    'shell.Run command, 0, False'
  ].join('\r\n') + '\r\n';
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
