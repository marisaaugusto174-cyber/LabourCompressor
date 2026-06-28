import { execFile } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { type LocalDialogResult, type RuntimeCheckResult } from './runtime-support-types.ts';

const execFileAsync = promisify(execFile);

export async function chooseLocalPath(input: {
  readonly kind: 'file' | 'folder';
  readonly prompt: string;
  readonly defaultPath?: string | undefined;
}): Promise<LocalDialogResult> {
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', buildChoosePathScript(input)], {
      encoding: 'utf8'
    });
    const selectedPath = stdout.trim();
    return Object.freeze({ cancelled: false, path: selectedPath.length === 0 ? null : selectedPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/User canceled|execution error: User canceled|用户已取消/iu.test(message)) {
      return Object.freeze({ cancelled: true, path: null });
    }
    throw error;
  }
}

export async function checkFileReadable(key: string, filePath: string): Promise<RuntimeCheckResult> {
  try {
    await access(filePath);
    return Object.freeze({ key, ok: true, message: `${key} is readable.` });
  } catch (error) {
    return buildFailedCheck(key, `${key} is not readable.`, error);
  }
}

export async function checkOptionalFileReadable(key: string, filePath: string): Promise<RuntimeCheckResult> {
  try {
    await access(filePath);
    return Object.freeze({ key, ok: true, message: `${key} is readable.` });
  } catch {
    return Object.freeze({
      key,
      ok: true,
      message: `${key} file is missing; platform downloads will fall back to global cookies or unauthenticated mode.`
    });
  }
}

export async function checkDirectoryWritable(key: string, directoryPath: string): Promise<RuntimeCheckResult> {
  try {
    await mkdir(directoryPath, { recursive: true });
    await access(directoryPath);
    return Object.freeze({ key, ok: true, message: `${key} is writable.` });
  } catch (error) {
    return buildFailedCheck(key, `${key} is not writable.`, error);
  }
}

function buildChoosePathScript(input: {
  readonly kind: 'file' | 'folder';
  readonly prompt: string;
  readonly defaultPath?: string | undefined;
}): string {
  const chooser = input.kind === 'folder' ? 'choose folder' : 'choose file';
  return [
    `${chooser} with prompt "${escapeAppleScriptString(input.prompt)}"${buildDefaultLocationClause(input)}`,
    'POSIX path of result'
  ].join('\n');
}

function buildDefaultLocationClause(input: {
  readonly kind: 'file' | 'folder';
  readonly defaultPath?: string | undefined;
}): string {
  if (typeof input.defaultPath !== 'string' || input.defaultPath.trim().length === 0) return '';
  const normalizedPath = input.kind === 'folder' ? input.defaultPath : path.dirname(input.defaultPath);
  return ` default location POSIX file "${escapeAppleScriptString(normalizedPath)}"`;
}

function escapeAppleScriptString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function buildFailedCheck(key: string, message: string, error: unknown): RuntimeCheckResult {
  return Object.freeze({
    key,
    ok: false,
    message,
    details: { error: error instanceof Error ? error.message : String(error) }
  });
}
