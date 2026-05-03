import { access, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  createPostEditArchiveRecordSpreadsheet,
  ensureMasterSpreadsheetTemplate,
  type PostEditArchiveRecordFileEntry
} from '../../packages/adapters/spreadsheets/local-spreadsheet.ts';
import { STANDARDIZED_VIDEO_FILE_NAME_PATTERN } from '../cli/local-pipeline-helpers.ts';
import { type LocalDialogResult } from './runtime-support-types.ts';

const execFileAsync = promisify(execFile);
const VIDEO_FILE_NAME_PATTERN = /\.(mp4|mov|m4v|mkv|avi|webm)$/iu;

export async function ensureDefaultMasterSpreadsheet(filePath: string): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  ensureMasterSpreadsheetTemplate(filePath);
  return filePath;
}

export async function buildPostEditRecordSheet(input: {
  readonly downloadDirectory: string;
  readonly afterEditDirectoryName?: string;
  readonly outputFilePath?: string;
}): Promise<Readonly<Record<string, unknown>>> {
  const afterEditDirectoryName = input.afterEditDirectoryName ?? 'AfterEdit';
  const afterEditDirectoryPath = path.join(input.downloadDirectory, afterEditDirectoryName);
  const outputFilePath =
    input.outputFilePath ?? path.join(afterEditDirectoryPath, 'AfterEdit_归档记录表.xlsx');

  await mkdir(afterEditDirectoryPath, { recursive: true });
  const scannedFiles = await scanAfterEditVideoFiles(afterEditDirectoryPath);

  if (scannedFiles.length === 0) {
    throw new Error('AfterEdit 目录中没有可用视频文件。');
  }

  const preparedFiles = await standardizeAfterEditFiles({
    afterEditDirectoryPath,
    files: scannedFiles
  });

  createPostEditArchiveRecordSpreadsheet({
    filePath: outputFilePath,
    fileEntries: Object.freeze(
      preparedFiles.map((file) => ({
        fileName: file.fileName,
        relativePath: file.relativePath,
        originalFileName: file.originalFileName
      }))
    )
  });

  return Object.freeze({
    afterEditDirectoryPath,
    outputFilePath,
    fileCount: preparedFiles.length,
    renamedCount: preparedFiles.filter((file) => file.renamed).length,
    files: Object.freeze(
      preparedFiles.map((file) => Object.freeze({
        originalRelativePath: file.originalRelativePath,
        relativePath: file.relativePath,
        fileName: file.fileName,
        renamed: file.renamed
      }))
    )
  });
}

interface ScannedAfterEditFile {
  readonly filePath: string;
  readonly relativePath: string;
  readonly fileName: string;
}

interface PreparedAfterEditFile extends PostEditArchiveRecordFileEntry {
  readonly originalFileName: string;
  readonly originalRelativePath: string;
  readonly relativePath: string;
  readonly renamed: boolean;
}

async function scanAfterEditVideoFiles(
  afterEditDirectoryPath: string
): Promise<readonly ScannedAfterEditFile[]> {
  const files: ScannedAfterEditFile[] = [];
  await scanDirectory(afterEditDirectoryPath);

  return Object.freeze(
    files.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath, 'zh-Hans-CN')
    )
  );

  async function scanDirectory(directoryPath: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const entryPath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        await scanDirectory(entryPath);
        continue;
      }

      if (!entry.isFile() || !VIDEO_FILE_NAME_PATTERN.test(entry.name)) {
        continue;
      }

      files.push({
        filePath: entryPath,
        relativePath: toPortableRelativePath(afterEditDirectoryPath, entryPath),
        fileName: entry.name
      });
    }
  }
}

async function standardizeAfterEditFiles(input: {
  readonly afterEditDirectoryPath: string;
  readonly files: readonly ScannedAfterEditFile[];
}): Promise<readonly PreparedAfterEditFile[]> {
  const usedStemKeys = new Set<string>();
  const preparedFiles: PreparedAfterEditFile[] = [];

  for (const file of input.files) {
    const directoryPath = path.dirname(file.filePath);
    const baseFileName = await buildStandardizedAfterEditFileName(file);
    const targetFileName = await makeUniqueStandardFileName({
      directoryPath,
      currentFilePath: file.filePath,
      baseFileName,
      usedStemKeys
    });
    const targetPath = path.join(directoryPath, targetFileName);

    if (targetPath !== file.filePath) {
      await rename(file.filePath, targetPath);
    }

    usedStemKeys.add(stemKey(targetFileName));
    preparedFiles.push({
      fileName: targetFileName,
      relativePath: toPortableRelativePath(input.afterEditDirectoryPath, targetPath),
      originalFileName: file.fileName,
      originalRelativePath: file.relativePath,
      renamed: targetPath !== file.filePath
    });
  }

  return Object.freeze(preparedFiles);
}

async function buildStandardizedAfterEditFileName(
  file: ScannedAfterEditFile
): Promise<string> {
  if (STANDARDIZED_VIDEO_FILE_NAME_PATTERN.test(file.fileName)) {
    return file.fileName;
  }

  const extension = path.extname(file.fileName).toLowerCase() || '.mp4';
  const title = sanitizeVideoTitle(path.basename(file.fileName, path.extname(file.fileName)));
  const metadata = await probeVideoMetadata(file.filePath);
  const fileStat = await stat(file.filePath);

  return [
    title,
    metadata.resolutionLabel,
    formatCompactDate(fileStat.mtime),
    String(metadata.durationSeconds).padStart(6, '0')
  ].join('_') + extension;
}

async function makeUniqueStandardFileName(input: {
  readonly directoryPath: string;
  readonly currentFilePath: string;
  readonly baseFileName: string;
  readonly usedStemKeys: Set<string>;
}): Promise<string> {
  let fileName = input.baseFileName;
  let suffix = 2;

  while (
    input.usedStemKeys.has(stemKey(fileName)) ||
    await targetExistsForAnotherFile({
      targetPath: path.join(input.directoryPath, fileName),
      currentFilePath: input.currentFilePath
    })
  ) {
    fileName = appendTitleSuffix(input.baseFileName, suffix);
    suffix += 1;
  }

  return fileName;
}

async function targetExistsForAnotherFile(input: {
  readonly targetPath: string;
  readonly currentFilePath: string;
}): Promise<boolean> {
  if (input.targetPath === input.currentFilePath) {
    return false;
  }

  try {
    await access(input.targetPath);
    return true;
  } catch {
    return false;
  }
}

function appendTitleSuffix(fileName: string, suffix: number): string {
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  const match = /^(.+)_([A-Z0-9]+P)_(\d{6})_(\d{6})$/u.exec(stem);

  if (match === null) {
    return `${stem}_${String(suffix).padStart(2, '0')}${extension}`;
  }

  return `${match[1]}_${String(suffix).padStart(2, '0')}_${match[2]}_${match[3]}_${match[4]}${extension}`;
}

async function probeVideoMetadata(filePath: string): Promise<{
  readonly resolutionLabel: string;
  readonly durationSeconds: number;
}> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=height:format=duration',
      '-of',
      'json',
      filePath
    ]);
    const parsed = JSON.parse(stdout) as {
      readonly streams?: readonly { readonly height?: number }[];
      readonly format?: { readonly duration?: string };
    };
    const height = parsed.streams?.find((stream) => Number.isFinite(stream.height))?.height;
    const durationSeconds = Math.max(0, Math.round(Number(parsed.format?.duration ?? 0)));

    return Object.freeze({
      resolutionLabel: Number.isFinite(height) && height !== undefined ? `${Math.round(height)}P` : '0P',
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0
    });
  } catch {
    return Object.freeze({
      resolutionLabel: '0P',
      durationSeconds: 0
    });
  }
}

function sanitizeVideoTitle(value: string): string {
  const normalized = value
    .trim()
    .replace(/\s+/gu, '_')
    .replace(/[^\p{Script=Han}A-Za-z0-9_]+/gu, '')
    .replace(/_+/gu, '_')
    .replace(/^_+|_+$/gu, '');

  return normalized.length > 0 ? normalized : 'asset';
}

function formatCompactDate(value: Date): string {
  return [
    String(value.getFullYear()).slice(2),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0')
  ].join('');
}

function stemKey(fileName: string): string {
  return path.parse(fileName).name.toLocaleLowerCase('zh-Hans-CN');
}

function toPortableRelativePath(rootDirectory: string, filePath: string): string {
  return path.relative(rootDirectory, filePath).split(path.sep).join('/');
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

export async function checkFileReadable(
  key: string,
  filePath: string
): Promise<import('./runtime-support-types.ts').RuntimeCheckResult> {
  try {
    await access(filePath);
    return Object.freeze({ key, ok: true, message: `${key} is readable.` });
  } catch (error) {
    return buildFailedCheck(key, `${key} is not readable.`, error);
  }
}

export async function checkOptionalFileReadable(
  key: string,
  filePath: string
): Promise<import('./runtime-support-types.ts').RuntimeCheckResult> {
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

export async function checkDirectoryWritable(
  key: string,
  directoryPath: string
): Promise<import('./runtime-support-types.ts').RuntimeCheckResult> {
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

function buildFailedCheck(
  key: string,
  message: string,
  error: unknown
): import('./runtime-support-types.ts').RuntimeCheckResult {
  return Object.freeze({
    key,
    ok: false,
    message,
    details: {
      error: error instanceof Error ? error.message : String(error)
    }
  });
}
