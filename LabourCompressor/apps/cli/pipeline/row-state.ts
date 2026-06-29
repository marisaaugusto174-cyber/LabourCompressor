import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { type DownloadedMediaAsset } from '../../../packages/features/download/domain/index.ts';
import { type SpreadsheetTaskRow } from '../../../packages/features/spreadsheet-tasks/domain/index.ts';
import { type PipelineRowState } from '../local-pipeline-helpers.ts';

export function createBasicRowState(input: {
  readonly row: SpreadsheetTaskRow;
  readonly archiveState: string;
  readonly sourceFilePath?: string | undefined;
  readonly currentFilePath?: string | undefined;
  readonly compressedCachePath?: string | undefined;
  readonly sourceRowNumber?: number | undefined;
  readonly segmentIndex?: number | undefined;
  readonly errorMessage?: string | undefined;
  readonly levelValues?: Readonly<Record<string, string>> | undefined;
  readonly archivePath?: string | undefined;
  readonly archiveFileName?: string | undefined;
  readonly taggingJsonFileName?: string | undefined;
  readonly taggingJsonArchivePath?: string | undefined;
  readonly acceptedPaths?: readonly string[] | undefined;
  readonly selectedContentTopicPath?: string | undefined;
}): PipelineRowState {
  return {
    rowNumber: input.row.rowNumber,
    url: input.row.url,
    collector: input.row.values['采集人'] ?? '',
    archiveState: input.archiveState,
    sourceFilePath: input.sourceFilePath ?? resolveSourceFilePath(input.row),
    currentFilePath: input.currentFilePath ?? resolveRowFilePath(input.row),
    compressedCachePath:
      input.compressedCachePath ??
      (input.row.values['压缩缓存路径']?.trim() || undefined),
    sourceRowNumber: input.sourceRowNumber ?? parseOptionalNumber(input.row.values['源行号']),
    segmentIndex: input.segmentIndex ?? parseOptionalNumber(input.row.values['片段序号']),
    errorMessage: input.errorMessage,
    levelValues: input.levelValues ?? getLevelValues(input.row),
    archivePath: input.archivePath ?? input.row.values['归档路径'] ?? '',
    archiveFileName: input.archiveFileName ?? input.row.values['归档文件名'] ?? '',
    taggingJsonFileName: input.taggingJsonFileName ?? input.row.values['标签JSON文件'] ?? undefined,
    taggingJsonArchivePath: input.taggingJsonArchivePath ?? input.row.values['归档路径'] ?? undefined,
    acceptedPaths: Object.freeze(input.acceptedPaths ?? []),
    selectedContentTopicPath: input.selectedContentTopicPath
  };
}

export function createSkippedRowState(input: {
  readonly row: SpreadsheetTaskRow;
  readonly archiveState: string;
  readonly errorMessage: string;
}): PipelineRowState {
  return createBasicRowState(input);
}

export function shouldProcessMediaRow(row: SpreadsheetTaskRow): boolean {
  const archiveState = row.values['归档状态']?.trim() ?? '';
  return (
    archiveState !== '已归档' &&
    !archiveState.startsWith('已分割') &&
    archiveState !== '等待下载'
  );
}

export function resolveRowFilePath(row: SpreadsheetTaskRow, baseDirectory?: string): string | undefined {
  const currentFilePath = row.values['当前文件路径']?.trim();
  if (currentFilePath !== undefined && currentFilePath.length > 0) {
    return currentFilePath;
  }

  const sourceFilePath = row.values['源文件路径']?.trim();
  if (sourceFilePath !== undefined && sourceFilePath.length > 0 && path.isAbsolute(sourceFilePath)) {
    return sourceFilePath;
  }

  if (row.sourceKind === 'local-file' && row.sourceFileName !== undefined && path.isAbsolute(row.sourceFileName)) {
    return row.sourceFileName;
  }

  if (baseDirectory !== undefined) {
    const relativePath =
      row.sourceFileRelativePath ??
      normalizeOptionalPath(row.values['相对路径']) ??
      (row.sourceKind === 'local-file' ? normalizeOptionalPath(row.sourceFileName) : undefined) ??
      normalizeOptionalPath(row.values['文件名']);

    if (relativePath !== undefined) {
      return path.resolve(baseDirectory, relativePath);
    }
  }

  return undefined;
}

export function resolveSourceFilePath(row: SpreadsheetTaskRow, baseDirectory?: string): string | undefined {
  const sourceFilePath = row.values['源文件路径']?.trim();
  if (sourceFilePath !== undefined && sourceFilePath.length > 0) {
    return sourceFilePath;
  }
  return resolveRowFilePath(row, baseDirectory);
}

export function normalizeOptionalPath(value: string | undefined): string | undefined {
  const normalized = value?.trim() ?? '';
  return normalized.length === 0 ? undefined : normalized;
}

export function createAssetFromRow(input: {
  readonly row: SpreadsheetTaskRow;
  readonly filePath: string;
  readonly startedAt: string;
}): DownloadedMediaAsset {
  return Object.freeze({
    mediaAssetId: `${input.row.taskId}::asset`,
    taskId: input.row.taskId,
    rowNumber: input.row.rowNumber,
    sourceUrl: input.row.url,
    platform: 'bilibili',
    filePath: input.filePath,
    fileName: path.basename(input.filePath),
    downloadedAt: input.startedAt
  });
}

export function resolveSelectedArchivePath(row: SpreadsheetTaskRow): string | undefined {
  const archivePath = row.values['归档路径']?.trim() ?? '';
  const segments = archivePath.split('/').map((segment) => segment.trim()).filter(Boolean);
  const archiveRootIndex = segments.indexOf('视频数据归档库');
  const relativeSegments = archiveRootIndex === -1
    ? segments
    : segments.slice(archiveRootIndex + 1);

  return relativeSegments.length >= 2
    ? relativeSegments.join(' > ')
    : undefined;
}

export const resolveSelectedContentTopicPath = resolveSelectedArchivePath;

export function resolveTaggingJsonFileName(row: SpreadsheetTaskRow, filePath: string): string | undefined {
  const fromRow = row.values['标签JSON文件']?.trim();

  if (fromRow !== undefined && fromRow.length > 0) {
    return fromRow;
  }

  return replaceExtension(path.basename(filePath), '.json');
}

export function replaceExtension(fileName: string, extension: string): string {
  const parsed = path.parse(fileName);
  return `${parsed.name}${extension}`;
}

export async function readOptionalSidecarJson(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(path.dirname(filePath), replaceExtension(path.basename(filePath), '.json')), 'utf8');
  } catch {
    return undefined;
  }
}

export function getLevelValues(row: SpreadsheetTaskRow): Readonly<Record<string, string>> {
  return Object.freeze({
    一级标签: row.values['一级标签'] ?? '',
    二级标签: row.values['二级标签'] ?? '',
    三级标签: row.values['三级标签'] ?? '',
    四级标签: row.values['四级标签'] ?? ''
  });
}

export function emptyLevelValues(): Readonly<Record<string, string>> {
  return Object.freeze({
    一级标签: '',
    二级标签: '',
    三级标签: '',
    四级标签: ''
  });
}

export function parseOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
