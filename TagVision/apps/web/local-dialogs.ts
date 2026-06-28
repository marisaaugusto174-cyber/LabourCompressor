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
  const script = buildChoosePathScript(input);

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

function buildChoosePathScript(input: {
  readonly kind: 'file' | 'folder';
  readonly prompt: string;
  readonly defaultPath?: string;
}): string {
  const prompt = escapeAppleScriptString(input.prompt);
  const defaultLocation = buildDefaultLocationClause(input);
  const chooser = input.kind === 'folder' ? 'choose folder' : 'choose file';

  return [
    'tell application "Finder" to activate',
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
