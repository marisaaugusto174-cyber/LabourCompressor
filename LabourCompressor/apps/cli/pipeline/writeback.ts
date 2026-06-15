import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  appendRowsToMasterSpreadsheet,
  writeTagResultsToSpreadsheet
} from '../../../packages/adapters/spreadsheets/local-spreadsheet.ts';
import { type SpreadsheetAppendRow } from '../../../packages/features/spreadsheet-tasks/domain/index.ts';
import { type PipelineRowState } from '../local-pipeline-helpers.ts';
import { DEFAULT_MASTER_SPREADSHEET_PATH } from '../project-paths.ts';
import { type RunLocalPipelineOptions } from './options.ts';
import { emptyLevelValues, parseOptionalNumber } from './row-state.ts';

export async function writeStageResults(input: {
  readonly options: RunLocalPipelineOptions;
  readonly results: readonly PipelineRowState[];
  readonly appendRows: readonly SpreadsheetAppendRow[];
  readonly startedAt: string;
  readonly archiveLibraryRoot: string;
}): Promise<void> {
  const writebackTarget = input.options.writebackTarget ?? 'user';

  if (writebackTarget === 'user' || writebackTarget === 'both') {
    writeTagResultsToSpreadsheet({
      filePath: input.options.spreadsheet,
      acceptedTagsColumnName: input.options.acceptedTagsColumnName,
      updates: input.results.map((result) => ({
        rowNumber: result.rowNumber,
        columnValues: rowStateToColumnValues(result, input.archiveLibraryRoot)
      })),
      appendRows: input.appendRows
    });
  }

  if (writebackTarget === 'master' || writebackTarget === 'both') {
    appendRowsToMasterSpreadsheet({
      filePath:
        input.options.masterSpreadsheetPath ??
        DEFAULT_MASTER_SPREADSHEET_PATH,
      entries: [
        ...input.results.map((result) => ({
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
          archiveFileName: result.archiveFileName,
          taggingJsonFileName: result.taggingJsonFileName,
          sourceSpreadsheet: path.basename(input.options.spreadsheet),
          processedAt: input.startedAt
        })),
        ...input.appendRows.map((row) => ({
          url: String(row.URL ?? ''),
          collector: String(row.采集人 ?? ''),
          archiveState: String(row.归档状态 ?? ''),
          sourceFilePath: String(row.源文件路径 ?? ''),
          currentFilePath: String(row.当前文件路径 ?? ''),
          compressedCachePath: String(row.压缩缓存路径 ?? ''),
          sourceRowNumber: parseOptionalNumber(row.源行号),
          segmentIndex: parseOptionalNumber(row.片段序号),
          errorMessage: String(row.错误信息 ?? ''),
          levelValues: emptyLevelValues(),
          archivePath: '',
          archiveFileName: '',
          sourceSpreadsheet: path.basename(input.options.spreadsheet),
          processedAt: input.startedAt
        }))
      ]
    });
  }
}

export function rowStateToColumnValues(
  result: PipelineRowState,
  archiveLibraryRoot: string
): Record<string, string | { readonly kind: 'hyperlink'; readonly label: string; readonly target: string }> {
  return {
    归档状态: result.archiveState,
    一级标签: result.levelValues['一级标签'] ?? '',
    二级标签: result.levelValues['二级标签'] ?? '',
    三级标签: result.levelValues['三级标签'] ?? '',
    四级标签: result.levelValues['四级标签'] ?? '',
    归档路径: result.archivePath,
    归档文件名:
      result.archiveFileName.length > 0 && result.archivePath.length > 0
        ? {
            kind: 'hyperlink',
            label: result.archiveFileName,
            target: pathToFileURL(resolveArchiveFilePath({
              archiveLibraryRoot,
              archivePath: result.archivePath,
              archiveFileName: result.archiveFileName
            })).toString()
          }
        : '',
    标签JSON文件:
      result.taggingJsonFileName !== undefined &&
      result.taggingJsonFileName.length > 0 &&
      result.taggingJsonArchivePath !== undefined &&
      result.taggingJsonArchivePath.length > 0
        ? {
            kind: 'hyperlink',
            label: result.taggingJsonFileName,
            target: pathToFileURL(resolveArchiveFilePath({
              archiveLibraryRoot,
              archivePath: result.taggingJsonArchivePath,
              archiveFileName: result.taggingJsonFileName
            })).toString()
          }
        : result.taggingJsonFileName ?? '',
    失败信息: result.failure?.errorMessage ?? '',
    源文件路径: result.sourceFilePath ?? '',
    当前文件路径: result.currentFilePath ?? '',
    压缩缓存路径: result.compressedCachePath ?? '',
    源行号: result.sourceRowNumber === undefined ? '' : String(result.sourceRowNumber),
    片段序号: result.segmentIndex === undefined ? '' : String(result.segmentIndex),
    错误信息: result.errorMessage ?? result.failure?.errorMessage ?? ''
  };
}

export function resolveArchiveFilePath(input: {
  readonly archiveLibraryRoot: string;
  readonly archivePath: string;
  readonly archiveFileName: string;
}): string {
  const normalizedArchivePath = input.archivePath.trim();
  const rootBasename = path.basename(input.archiveLibraryRoot);

  if (
    normalizedArchivePath === rootBasename ||
    normalizedArchivePath.startsWith(`${rootBasename}/`)
  ) {
    return path.join(path.dirname(input.archiveLibraryRoot), normalizedArchivePath, input.archiveFileName);
  }

  return path.join(input.archiveLibraryRoot, normalizedArchivePath, input.archiveFileName);
}
