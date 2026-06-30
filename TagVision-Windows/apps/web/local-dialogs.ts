import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface LocalDialogResult {
  readonly cancelled: boolean;
  readonly path: string | null;
}

export async function chooseLocalPath(input: {
  readonly kind: 'file' | 'folder';
  readonly prompt: string;
  readonly defaultPath?: string;
}): Promise<LocalDialogResult> {
  if (process.platform === 'win32') {
    return chooseWindowsLocalPath(input);
  }

  return chooseMacLocalPath(input);
}

async function chooseWindowsLocalPath(input: {
  readonly kind: 'file' | 'folder';
  readonly prompt: string;
  readonly defaultPath?: string;
}): Promise<LocalDialogResult> {
  const script = buildWindowsChoosePathScript(input);

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        encoding: 'utf8',
        windowsHide: true
      }
    );
    const selectedPath = stdout.trim();

    return Object.freeze({
      cancelled: false,
      path: selectedPath.length === 0 ? null : selectedPath
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = readErrorCode(error);

    if (code === 2 || /User canceled|execution error: User canceled|用户已取消/iu.test(message)) {
      return Object.freeze({
        cancelled: true,
        path: null
      });
    }

    throw error;
  }
}

async function chooseMacLocalPath(input: {
  readonly kind: 'file' | 'folder';
  readonly prompt: string;
  readonly defaultPath?: string;
}): Promise<LocalDialogResult> {
  const script = buildMacChoosePathScript(input);

  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      encoding: 'utf8'
    });
    const selectedPath = stdout.trim();

    return Object.freeze({
      cancelled: false,
      path: selectedPath.length === 0 ? null : selectedPath
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/User canceled|execution error: User canceled|用户已取消/iu.test(message)) {
      return Object.freeze({
        cancelled: true,
        path: null
      });
    }

    throw error;
  }
}

function buildWindowsChoosePathScript(input: {
  readonly kind: 'file' | 'folder';
  readonly prompt: string;
  readonly defaultPath?: string;
}): string {
  const prompt = escapePowerShellSingleQuotedString(input.prompt);
  const defaultPath = escapePowerShellSingleQuotedString(normalizeDefaultPath(input));

  if (input.kind === 'folder') {
    return [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      `$dialog.Description = '${prompt}'`,
      '$dialog.ShowNewFolderButton = $false',
      `if ('${defaultPath}'.Length -gt 0 -and (Test-Path -LiteralPath '${defaultPath}')) { $dialog.SelectedPath = '${defaultPath}' }`,
      '$result = $dialog.ShowDialog()',
      'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath; exit 0 }',
      'exit 2'
    ].join('; ');
  }

  return [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    `$dialog.Title = '${prompt}'`,
    `if ('${defaultPath}'.Length -gt 0 -and (Test-Path -LiteralPath '${defaultPath}')) { $dialog.InitialDirectory = '${defaultPath}' }`,
    '$result = $dialog.ShowDialog()',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName; exit 0 }',
    'exit 2'
  ].join('; ');
}

function buildMacChoosePathScript(input: {
  readonly kind: 'file' | 'folder';
  readonly prompt: string;
  readonly defaultPath?: string;
}): string {
  const prompt = escapeAppleScriptString(input.prompt);
  const defaultLocation = buildDefaultLocationClause(input);
  const chooser = input.kind === 'folder' ? 'choose folder' : 'choose file';

  return [
    `${chooser} with prompt "${prompt}"${defaultLocation}`,
    'POSIX path of result'
  ].join('\n');
}

function buildDefaultLocationClause(input: {
  readonly kind: 'file' | 'folder';
  readonly defaultPath?: string;
}): string {
  if (typeof input.defaultPath !== 'string' || input.defaultPath.trim().length === 0) {
    return '';
  }

  const normalizedPath =
    input.kind === 'folder'
      ? input.defaultPath
      : path.dirname(input.defaultPath);

  return ` default location POSIX file "${escapeAppleScriptString(normalizedPath)}"`;
}

function escapeAppleScriptString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function normalizeDefaultPath(input: {
  readonly kind: 'file' | 'folder';
  readonly defaultPath?: string;
}): string {
  if (typeof input.defaultPath !== 'string' || input.defaultPath.trim().length === 0) {
    return '';
  }

  return input.kind === 'folder' ? input.defaultPath : path.dirname(input.defaultPath);
}

function escapePowerShellSingleQuotedString(value: string): string {
  return value.replaceAll("'", "''");
}

function readErrorCode(error: unknown): number | string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { readonly code?: number | string }).code
    : undefined;
}
