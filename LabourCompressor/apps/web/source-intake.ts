import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  createPostEditArchiveRecordSpreadsheet,
  type PostEditArchiveRecordFileEntry
} from '../../packages/adapters/spreadsheets/local-spreadsheet.ts';
import { STANDARDIZED_VIDEO_FILE_NAME_PATTERN } from '../cli/local-pipeline-helpers.ts';

const execFileAsync = promisify(execFile);
const VIDEO_FILE_NAME_PATTERN = /\.(mp4|mov|m4v|mkv|avi|webm)$/iu;

export interface SourceIntakeFile {
  readonly sourceFilePath: string;
  readonly sourceRelativePath: string;
  readonly currentFilePath: string;
  readonly fileName: string;
  readonly originalFileName: string;
  readonly relativePath: string;
  readonly renamed: boolean;
}

export interface SourceIntakeResult {
  readonly sourceDirectoryPath: string;
  readonly afterEditDirectoryPath: string;
  readonly outputFilePath: string;
  readonly fileCount: number;
  readonly copiedCount: number;
  readonly renamedCount: number;
  readonly files: readonly SourceIntakeFile[];
}

interface ScannedSourceFile {
  readonly filePath: string;
  readonly fileName: string;
  readonly relativePath: string;
}

export async function importSourceMediaDirectory(input: {
  readonly sourceDirectoryPath: string;
  readonly downloadDirectory: string;
  readonly afterEditDirectoryName?: string | undefined;
  readonly outputFilePath?: string | undefined;
}): Promise<SourceIntakeResult> {
  const sourceDirectoryPath = path.resolve(input.sourceDirectoryPath);
  const afterEditDirectoryPath = path.join(
    path.resolve(input.downloadDirectory),
    input.afterEditDirectoryName ?? 'AfterEdit'
  );
  const outputFilePath = input.outputFilePath ??
    path.join(afterEditDirectoryPath, 'SourceIntake_素材导入表.xlsx');

  const sourceFiles = await scanSourceVideoFiles(sourceDirectoryPath);

  if (sourceFiles.length === 0) {
    throw new Error('素材目录中没有可用视频文件。');
  }

  await mkdir(afterEditDirectoryPath, { recursive: true });
  const importedFiles = await copyAndPrepareSourceFiles({
    sourceFiles,
    afterEditDirectoryPath
  });

  createPostEditArchiveRecordSpreadsheet({
    filePath: outputFilePath,
    fileEntries: Object.freeze(
      importedFiles.map((file): PostEditArchiveRecordFileEntry => ({
        fileName: file.fileName,
        relativePath: file.relativePath,
        originalFileName: file.originalFileName,
        sourceUrl: file.sourceFilePath,
        archiveState: '待压缩',
        sourceFilePath: file.sourceFilePath,
        currentFilePath: file.currentFilePath
      }))
    )
  });

  return Object.freeze({
    sourceDirectoryPath,
    afterEditDirectoryPath,
    outputFilePath,
    fileCount: importedFiles.length,
    copiedCount: importedFiles.length,
    renamedCount: importedFiles.filter((file) => file.renamed).length,
    files: Object.freeze(importedFiles)
  });
}

async function scanSourceVideoFiles(sourceDirectoryPath: string): Promise<readonly ScannedSourceFile[]> {
  const files: ScannedSourceFile[] = [];
  await scanDirectory(sourceDirectoryPath);

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

      files.push(Object.freeze({
        filePath: entryPath,
        fileName: entry.name,
        relativePath: toPortableRelativePath(sourceDirectoryPath, entryPath)
      }));
    }
  }
}

async function copyAndPrepareSourceFiles(input: {
  readonly sourceFiles: readonly ScannedSourceFile[];
  readonly afterEditDirectoryPath: string;
}): Promise<readonly SourceIntakeFile[]> {
  const usedStemKeys = new Set<string>();
  const importedFiles: SourceIntakeFile[] = [];

  for (const file of input.sourceFiles) {
    const baseFileName = await buildStandardizedSourceFileName(file);
    const targetFileName = await makeUniqueStandardFileName({
      directoryPath: input.afterEditDirectoryPath,
      baseFileName,
      usedStemKeys
    });
    const targetPath = path.join(input.afterEditDirectoryPath, targetFileName);

    if (path.resolve(file.filePath) !== path.resolve(targetPath)) {
      await copyFile(file.filePath, targetPath);
    }

    usedStemKeys.add(stemKey(targetFileName));
    importedFiles.push(Object.freeze({
      sourceFilePath: file.filePath,
      sourceRelativePath: file.relativePath,
      currentFilePath: targetPath,
      fileName: targetFileName,
      originalFileName: file.fileName,
      relativePath: toPortableRelativePath(input.afterEditDirectoryPath, targetPath),
      renamed: targetFileName !== file.fileName
    }));
  }

  return Object.freeze(importedFiles);
}

async function buildStandardizedSourceFileName(file: ScannedSourceFile): Promise<string> {
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
  readonly baseFileName: string;
  readonly usedStemKeys: Set<string>;
}): Promise<string> {
  let fileName = input.baseFileName;
  let suffix = 2;

  while (
    input.usedStemKeys.has(stemKey(fileName)) ||
    await fileExists(path.join(input.directoryPath, fileName))
  ) {
    fileName = appendTitleSuffix(input.baseFileName, suffix);
    suffix += 1;
  }

  return fileName;
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
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
