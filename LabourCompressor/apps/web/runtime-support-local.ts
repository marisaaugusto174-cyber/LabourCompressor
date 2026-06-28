import { execFile } from 'node:child_process';
import { access, mkdir, readdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  createPostEditArchiveRecordSpreadsheet,
  ensureMasterSpreadsheetTemplate,
  type PostEditArchiveRecordFileEntry
} from '../../packages/adapters/spreadsheets/local-spreadsheet.ts';
import { STANDARDIZED_VIDEO_FILE_NAME_PATTERN } from '../cli/local-pipeline-helpers.ts';
export {
  checkDirectoryWritable,
  checkFileReadable,
  checkOptionalFileReadable,
  chooseLocalPath
} from './runtime-support-local-paths.ts';

const execFileAsync = promisify(execFile);
const VIDEO_FILE_NAME_PATTERN = /\.(mp4|mov|m4v|mkv|avi|webm)$/iu;

export async function ensureDefaultMasterSpreadsheet(filePath: string): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  ensureMasterSpreadsheetTemplate(filePath);
  return filePath;
}

export async function buildPostEditRecordSheet(input: {
  readonly downloadDirectory?: string | undefined;
  readonly videoDirectoryPath?: string | undefined;
  readonly afterEditDirectoryName?: string | undefined;
  readonly outputFilePath?: string | undefined;
  readonly batchSampleFilePath?: string | undefined;
}): Promise<Readonly<Record<string, unknown>>> {
  const afterEditDirectoryName = input.afterEditDirectoryName ?? 'AfterEdit';
  const afterEditDirectoryPath =
    input.videoDirectoryPath === undefined || input.videoDirectoryPath.trim().length === 0
      ? path.join(requireDownloadDirectory(input.downloadDirectory), afterEditDirectoryName)
      : path.resolve(input.videoDirectoryPath);

  await mkdir(afterEditDirectoryPath, { recursive: true });
  const scannedFiles = await scanAfterEditVideoFiles(afterEditDirectoryPath);

  if (scannedFiles.length === 0) {
    throw new Error('AfterEdit 目录中没有可用视频文件。');
  }

  const batchFilter = resolveAfterEditBatchFilter({
    afterEditDirectoryPath,
    batchSampleFilePath: input.batchSampleFilePath
  });
  const selectedFiles = batchFilter === null
    ? scannedFiles
    : filterAfterEditFilesByBatchSample({
      files: scannedFiles,
      batchFilter
    });

  if (selectedFiles.length === 0) {
    throw new Error(`AfterEdit 目录中没有找到批次 ${batchFilter?.batchKey ?? ''} 的视频文件。`);
  }

  const outputFilePath =
    input.outputFilePath ??
    path.join(
      afterEditDirectoryPath,
      batchFilter === null
        ? 'AfterEdit_归档记录表.xlsx'
        : `AfterEdit_归档记录表_${sanitizeOutputFileStem(batchFilter.batchKey)}.xlsx`
    );

  const preparedFiles = await standardizeAfterEditFiles({
    afterEditDirectoryPath,
    files: selectedFiles
  });

  createPostEditArchiveRecordSpreadsheet({
    filePath: outputFilePath,
    fileEntries: Object.freeze(
      preparedFiles.map((file) => ({
        fileName: file.fileName,
        relativePath: file.relativePath,
        originalFileName: file.originalFileName,
        archiveState: '待压缩',
        sourceFilePath: path.join(afterEditDirectoryPath, file.relativePath),
        currentFilePath: path.join(afterEditDirectoryPath, file.relativePath)
      }))
    )
  });

  return Object.freeze({
    afterEditDirectoryPath,
    outputFilePath,
    filterMode: batchFilter === null ? 'all' : 'batch-sample',
    batchKey: batchFilter?.batchKey,
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

function requireDownloadDirectory(downloadDirectory: string | undefined): string {
  if (downloadDirectory === undefined || downloadDirectory.trim().length === 0) {
    throw new Error('downloadDirectory or videoDirectoryPath is required.');
  }

  return downloadDirectory;
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

interface AfterEditBatchFilter {
  readonly batchKey: string;
  readonly sampleRelativePath: string;
}

function resolveAfterEditBatchFilter(input: {
  readonly afterEditDirectoryPath: string;
  readonly batchSampleFilePath?: string | undefined;
}): AfterEditBatchFilter | null {
  if (typeof input.batchSampleFilePath !== 'string' || input.batchSampleFilePath.trim().length === 0) {
    return null;
  }

  const sampleFilePath = path.resolve(input.batchSampleFilePath);
  const relativePath = path.relative(input.afterEditDirectoryPath, sampleFilePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('批次样例文件必须位于当前 AfterEdit 目录内。');
  }

  return Object.freeze({
    batchKey: parseSegmentedAfterEditBatchKey(path.basename(sampleFilePath)),
    sampleRelativePath: relativePath.split(path.sep).join('/')
  });
}

function filterAfterEditFilesByBatchSample(input: {
  readonly files: readonly ScannedAfterEditFile[];
  readonly batchFilter: AfterEditBatchFilter;
}): readonly ScannedAfterEditFile[] {
  return Object.freeze(
    input.files.filter((file) => {
      try {
        return parseSegmentedAfterEditBatchKey(file.fileName) === input.batchFilter.batchKey;
      } catch {
        return file.relativePath === input.batchFilter.sampleRelativePath;
      }
    })
  );
}

function parseSegmentedAfterEditBatchKey(fileName: string): string {
  const stem = path.basename(fileName, path.extname(fileName));
  const match = /^(.+)_([A-Z0-9]+P)_(\d{6})_\d{6}_\d+$/u.exec(stem);

  if (match === null) {
    throw new Error(
      `批次样例文件名必须是“标题_清晰度_日期_时长_分段序号”格式，当前为：${fileName}`
    );
  }

  return `${match[1]}_${match[2]}_${match[3]}`;
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
      readonly streams?: readonly { readonly height?: number }[] | undefined;
      readonly format?: { readonly duration?: string } | undefined;
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

function sanitizeOutputFileStem(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/gu, '_')
    .replace(/\s+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_+|_+$/gu, '') || 'batch';
}
