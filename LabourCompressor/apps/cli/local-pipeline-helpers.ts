import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { appendRowsToMasterSpreadsheet, writeTagResultsToSpreadsheet } from '../../packages/adapters/spreadsheets/local-spreadsheet.ts';
import { type SimulatedDownloadFixture } from '../../packages/adapters/downloaders/simulated-downloader.ts';
import { type SpreadsheetTaskRow } from '../../packages/features/spreadsheet-tasks/domain/index.ts';
import { sanitizePlatformUrlForOutput } from '../../packages/features/download/domain/index.ts';
import { type CliStageEvent } from './status-reporter.ts';
import { type RunLocalPipelineOptions } from './local-pipeline-command.ts';
import { type RunLocalPipelineFailure } from './pipeline-result.ts';
import { type PipelineItemTimings } from './local-pipeline-tagging.ts';
import { DEFAULT_MASTER_SPREADSHEET_PATH } from './project-paths.ts';

export const STANDARDIZED_VIDEO_FILE_NAME_PATTERN =
  /^[\p{Script=Han}A-Za-z0-9_]+_[A-Z0-9]+P_\d{6}_\d{6}(?:_\d{2,4})?\.[A-Za-z0-9]+$/u;

export interface PipelineRowState {
  readonly rowNumber: number;
  readonly url: string;
  readonly collector: string;
  readonly archiveState: string;
  readonly sourceFilePath?: string | undefined;
  readonly currentFilePath?: string | undefined;
  readonly compressedCachePath?: string | undefined;
  readonly sourceRowNumber?: number | undefined;
  readonly segmentIndex?: number | undefined;
  readonly errorMessage?: string | undefined;
  readonly levelValues: Readonly<Record<string, string>>;
  readonly archivePath: string;
  readonly archiveFileName: string;
  readonly taggingJsonFileName?: string | undefined;
  readonly taggingJsonArchivePath?: string | undefined;
  readonly taggingJsonPayload?: unknown | undefined;
  readonly acceptedPaths: readonly string[];
  readonly selectedContentTopicPath?: string | undefined;
  readonly timings?: PipelineItemTimings | undefined;
  readonly failure?: RunLocalPipelineFailure | undefined;
}

export function createStageEmitter(
  report: (event: CliStageEvent) => void
): (
  stage: string,
  status: CliStageEvent['status'],
  message: string,
  extras?: Omit<CliStageEvent, 'stage' | 'status' | 'message' | 'timestamp'>
) => void {
  return (stage, status, message, extras) =>
    report({
      stage,
      phase: stage,
      status,
      message,
      timestamp: new Date().toISOString(),
      ...extras
    });
}

export async function loadDownloadFixtures(
  options: RunLocalPipelineOptions
): Promise<Record<string, SimulatedDownloadFixture>> {
  if (options.downloaderMode === 'yt-dlp') {
    return {};
  }

  return JSON.parse(
    await readFile(
      requireValue(options.downloadFixtures, '--download-fixtures is required when downloader-mode=simulated.'),
      'utf8'
    )
  ) as Record<string, SimulatedDownloadFixture>;
}

export async function loadCandidateFixtures(
  options: RunLocalPipelineOptions
): Promise<Record<string, readonly string[]> | undefined> {
  if (options.taggingMode !== 'simulated') {
    return undefined;
  }

  return JSON.parse(
    await readFile(
      requireValue(options.candidateFixtures, '--candidate-fixtures is required when tagging-mode=simulated.'),
      'utf8'
    )
  ) as Record<string, readonly string[]>;
}

export async function writePipelineResults(input: {
  readonly options: RunLocalPipelineOptions;
  readonly headers: readonly string[];
  readonly archiveLibraryRoot: string;
  readonly results: readonly PipelineRowState[];
  readonly startedAt: string;
  readonly userWritebackRowNumbers?: readonly number[] | undefined;
}): Promise<void> {
  const writebackTarget = input.options.writebackTarget ?? 'user';
  const userWritebackRowNumbers =
    input.userWritebackRowNumbers === undefined
      ? undefined
      : new Set(input.userWritebackRowNumbers);
  const userResults =
    userWritebackRowNumbers === undefined
      ? input.results
      : input.results.filter((result) => userWritebackRowNumbers.has(result.rowNumber));

  if (writebackTarget === 'user' || writebackTarget === 'both') {
    writeTagResultsToSpreadsheet({
      filePath: input.options.spreadsheet,
      acceptedTagsColumnName: input.options.acceptedTagsColumnName,
      updates: userResults.map((result) => ({
        rowNumber: result.rowNumber,
        columnValues: {
          归档状态: result.archiveState,
          一级标签: result.levelValues['一级标签'] ?? '',
          二级标签: result.levelValues['二级标签'] ?? '',
          三级标签: result.levelValues['三级标签'] ?? '',
          四级标签: result.levelValues['四级标签'] ?? '',
          归档路径: result.archivePath,
          归档文件名: toArchiveSpreadsheetCell(result, input.archiveLibraryRoot),
          标签JSON文件: toTaggingJsonSpreadsheetCell(result, input.archiveLibraryRoot),
          失败信息: result.failure?.errorMessage ?? '',
          源文件路径: result.sourceFilePath ?? '',
          当前文件路径: result.currentFilePath ?? '',
          压缩缓存路径: result.compressedCachePath ?? '',
          源行号: result.sourceRowNumber === undefined ? '' : String(result.sourceRowNumber),
          片段序号: result.segmentIndex === undefined ? '' : String(result.segmentIndex),
          错误信息: result.errorMessage ?? result.failure?.errorMessage ?? ''
        }
      }))
    });
  }

  if (writebackTarget === 'master' || writebackTarget === 'both') {
    appendRowsToMasterSpreadsheet({
      filePath:
        input.options.masterSpreadsheetPath ??
        DEFAULT_MASTER_SPREADSHEET_PATH,
      entries: input.results.map((result) => ({
        url: result.url,
        collector: result.collector,
        archiveState: result.archiveState,
        sourceFilePath: result.sourceFilePath,
        currentFilePath: result.currentFilePath,
        compressedCachePath: result.compressedCachePath,
        sourceRowNumber: result.sourceRowNumber,
        segmentIndex: result.segmentIndex,
        errorMessage: result.errorMessage ?? result.failure?.errorMessage,
        levelValues: result.levelValues,
        archivePath: result.archivePath,
        archiveFileName: toArchiveSpreadsheetCell(result, input.archiveLibraryRoot),
        taggingJsonFileName: toTaggingJsonSpreadsheetCell(result, input.archiveLibraryRoot),
        sourceSpreadsheet: path.basename(input.options.spreadsheet),
        processedAt: input.startedAt
      }))
    });
  }
}

export async function writeCurrentRunTaggingSpreadsheet(input: {
  readonly filePath: string;
  readonly sourceSpreadsheetName: string;
  readonly archiveLibraryRoot: string;
  readonly results: readonly PipelineRowState[];
  readonly startedAt: string;
}): Promise<void> {
  appendRowsToMasterSpreadsheet({
    filePath: input.filePath,
    entries: input.results.map((result) => ({
      url: result.url,
      collector: result.collector,
      archiveState: result.archiveState,
      sourceFilePath: result.sourceFilePath,
      currentFilePath: result.currentFilePath,
      compressedCachePath: result.compressedCachePath,
      sourceRowNumber: result.sourceRowNumber,
      segmentIndex: result.segmentIndex,
      errorMessage: result.errorMessage ?? result.failure?.errorMessage,
      levelValues: result.levelValues,
      archivePath: result.archivePath,
      archiveFileName: toArchiveSpreadsheetCell(result, input.archiveLibraryRoot),
      taggingJsonFileName: toTaggingJsonSpreadsheetCell(result, input.archiveLibraryRoot),
      sourceSpreadsheet: input.sourceSpreadsheetName,
      processedAt: input.startedAt
    }))
  });
}

export async function auditPipelineResults(input: {
  readonly results: readonly PipelineRowState[];
  readonly archiveLibraryRoot: string;
}): Promise<readonly string[]> {
  const issues: string[] = [];

  for (const result of input.results) {
    if (result.archiveState !== '已归档') {
      continue;
    }

    if (!STANDARDIZED_VIDEO_FILE_NAME_PATTERN.test(result.archiveFileName)) {
      issues.push(
        `row ${result.rowNumber}: archive file name does not match naming rule (${result.archiveFileName})`
      );
    }

    try {
      await access(path.join(input.archiveLibraryRoot, result.archivePath, result.archiveFileName));
    } catch {
      issues.push(
        `row ${result.rowNumber}: archive file not found at ${result.archivePath}/${result.archiveFileName}`
      );
    }
  }

  return Object.freeze(issues);
}

export function createFailureRowState(input: {
  readonly row: SpreadsheetTaskRow;
  readonly archiveState: string;
  readonly failure: RunLocalPipelineFailure;
}): PipelineRowState {
  return {
    rowNumber: input.row.rowNumber,
    url: sanitizePlatformUrlForOutput(input.row.url),
    collector: input.row.values['采集人'] ?? '',
    archiveState: input.archiveState,
    levelValues: emptyLevelValues(),
    archivePath: '',
    archiveFileName: '',
    acceptedPaths: Object.freeze([]),
    failure: input.failure
  };
}

export function buildFailure(input: {
  readonly row: SpreadsheetTaskRow;
  readonly phase: string;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly timestamp: string;
}): RunLocalPipelineFailure {
  return Object.freeze({
    rowNumber: input.row.rowNumber,
    url: sanitizePlatformUrlForOutput(input.row.url),
    phase: input.phase,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    timestamp: input.timestamp
  });
}

export function requireSheetRow(
  rowByTaskId: ReadonlyMap<string, SpreadsheetTaskRow>,
  taskId: string
): SpreadsheetTaskRow {
  const row = rowByTaskId.get(taskId);

  if (row === undefined) {
    throw new Error(`Spreadsheet row not found for task "${taskId}".`);
  }

  return row;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function requireValue<T>(value: T | undefined, errorMessage: string): T {
  if (value === undefined) {
    throw new Error(errorMessage);
  }

  return value;
}

function emptyLevelValues(): Readonly<Record<string, string>> {
  return Object.freeze({
    一级标签: '',
    二级标签: '',
    三级标签: '',
    四级标签: ''
  });
}

function toArchiveSpreadsheetCell(
  result: PipelineRowState,
  archiveLibraryRoot: string
): string | { readonly kind: 'hyperlink'; readonly label: string; readonly target: string } {
  if (result.archiveFileName.length === 0 || result.archivePath.length === 0) {
    return '';
  }

  return {
    kind: 'hyperlink',
    label: result.archiveFileName,
    target: pathToFileURL(
      path.join(archiveLibraryRoot, result.archivePath, result.archiveFileName)
    ).toString()
  };
}

function toTaggingJsonSpreadsheetCell(
  result: PipelineRowState,
  archiveLibraryRoot: string
): string | { readonly kind: 'hyperlink'; readonly label: string; readonly target: string } {
  if (
    result.taggingJsonFileName === undefined ||
    result.taggingJsonFileName.length === 0
  ) {
    return '';
  }

  const archivePath = result.taggingJsonArchivePath ?? result.archivePath;

  if (archivePath.length === 0) {
    return result.taggingJsonFileName;
  }

  return {
    kind: 'hyperlink',
    label: result.taggingJsonFileName,
    target: pathToFileURL(
      path.join(archiveLibraryRoot, archivePath, result.taggingJsonFileName)
    ).toString()
  };
}
