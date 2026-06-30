import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { archiveFileByPlans } from '../../../../packages/adapters/storage/filesystem/archive-file-operator.ts';
import { archiveManualReviewItem } from '../../../../packages/adapters/storage/filesystem/manual-review-archive.ts';
import { buildArchivePlacementPlans } from '../../../../packages/features/archive/domain/index.ts';
import { buildContentTopicArchiveRoot } from '../../../../packages/features/tagging/domain/index.ts';
import { type SpreadsheetTaskRow } from '../../../../packages/features/spreadsheet-tasks/domain/index.ts';
import { waitForPipelineCheckpoint } from '../../pipeline-control.ts';
import { pushStageFailure } from '../stage-failures.ts';
import { buildFailure, createFailureRowState } from '../../local-pipeline-helpers.ts';
import {
  createAssetFromRow,
  createBasicRowState,
  createSkippedRowState,
  getLevelValues,
  readOptionalSidecarJson,
  resolveRowFilePath,
  resolveSelectedArchivePath,
  resolveSourceFilePath,
  resolveTaggingJsonFileName,
  shouldProcessMediaRow
} from '../row-state.ts';
import { type StageContext } from './stage-context.ts';

export async function runArchiveStage(input: StageContext): Promise<void> {
  const archiveLibraryRoot = buildContentTopicArchiveRoot(input.input.options.archiveRoot);
  const rows = input.sheet.rows.filter((row) => shouldProcessMediaRow(row));
  const spreadsheetDirectory = path.dirname(input.input.options.spreadsheet);

  for (const row of rows) {
    if (row.values['归档状态']?.trim() === '待人工复查') {
      await archiveManualReviewRow(input, row, spreadsheetDirectory);
      continue;
    }
    if ((row.values['归档状态']?.trim() ?? '').startsWith('打标失败')) {
      restoreTaggingFailure(input, row);
      continue;
    }
    if (shouldSkipArchiveRow(row, input.resultsByRow.get(row.rowNumber))) {
      continue;
    }
    await waitForPipelineCheckpoint(input.input.control);
    const filePath = resolveRowFilePath(row, spreadsheetDirectory);
    const selectedArchivePath = resolveSelectedArchivePath(row);
    if (filePath === undefined) {
      input.resultsByRow.set(row.rowNumber, createSkippedRowState({
        row,
        archiveState: '等待下载',
        errorMessage: '缺少当前文件路径'
      }));
      continue;
    }
    if (selectedArchivePath === undefined) {
      input.resultsByRow.set(row.rowNumber, createSkippedRowState({
        row,
        archiveState: '等待打标',
        errorMessage: '缺少标签结果'
      }));
      continue;
    }
    try {
      const asset = createAssetFromRow({ row, filePath, startedAt: input.startedAt });
      const taggingJsonContent = await readOptionalSidecarJson(filePath);
      const archiveRecords = await archiveFileByPlans({
        sourceFilePath: filePath,
        archiveRoot: archiveLibraryRoot,
        placementPlans: buildArchivePlacementPlans({
          acceptedPaths: [selectedArchivePath],
          fileName: path.basename(filePath)
        }),
        placementMode: 'copy',
        taskId: asset.taskId,
        mediaAssetId: asset.mediaAssetId,
        taxonomyVersionId: 'taxonomy-v1',
        fingerprintId: `fingerprint:${asset.taskId}`,
        recordedAt: input.startedAt,
        jsonSidecarContent: taggingJsonContent
      });
      const primaryArchiveRecord = archiveRecords[0];
      input.resultsByRow.set(row.rowNumber, createBasicRowState({
        row,
        archiveState: '已归档',
        sourceFilePath: resolveSourceFilePath(row, spreadsheetDirectory) ?? filePath,
        currentFilePath: filePath,
        compressedCachePath: row.values['压缩缓存路径']?.trim() || undefined,
        levelValues: getLevelValues(row),
        archivePath: row.values['归档路径'] ?? '',
        archiveFileName:
          primaryArchiveRecord === undefined
            ? ''
            : path.basename(primaryArchiveRecord.archivePath),
        taggingJsonFileName: resolveTaggingJsonFileName(row, filePath),
        taggingJsonArchivePath: row.values['归档路径'] ?? '',
        acceptedPaths: [selectedArchivePath],
        selectedContentTopicPath: selectedArchivePath
      }));
    } catch (error) {
      pushStageFailure({
        context: {
          options: input.input.options,
          startedAt: input.startedAt,
          failures: input.failures,
          resultsByRow: input.resultsByRow
        },
        row,
        phase: 'archive',
        archiveState: '归档失败',
        errorCode: 'archive-failed',
        error
      });
    }
  }
  input.emit('archive', 'succeeded', 'Archive stage completed');
}

export function shouldSkipArchiveRow(
  row: SpreadsheetTaskRow,
  existingResult: Readonly<{ readonly failure?: unknown }> | undefined
): boolean {
  return existingResult?.failure !== undefined ||
    (row.values['归档状态']?.trim() ?? '').startsWith('待复核：') ||
    (row.values['归档状态']?.trim() ?? '').startsWith('打标失败');
}

async function archiveManualReviewRow(
  input: StageContext,
  row: SpreadsheetTaskRow,
  spreadsheetDirectory: string
): Promise<void> {
  const filePath = resolveRowFilePath(row, spreadsheetDirectory);
  if (filePath === undefined) {
    input.resultsByRow.set(row.rowNumber, createSkippedRowState({
      row, archiveState: '待人工复查', errorMessage: '人工复查视频文件缺失'
    }));
    return;
  }
  try {
    const asset = createAssetFromRow({ row, filePath, startedAt: input.startedAt });
    const sidecar = JSON.parse(await readFile(replaceExtension(filePath, '.manual-review.json'), 'utf8'));
    const archived = await archiveManualReviewItem({
      sourceFilePath: filePath,
      archiveRoot: input.input.options.archiveRoot,
      taskId: asset.taskId,
      mediaAssetId: asset.mediaAssetId,
      sourceRowNumber: row.rowNumber,
      sourceSpreadsheet: path.basename(input.input.options.spreadsheet),
      sourceUrl: row.url,
      recordedAt: input.startedAt,
      sidecar
    });
    input.resultsByRow.set(row.rowNumber, {
      ...createBasicRowState({
      row,
      archiveState: '待人工复查',
      sourceFilePath: resolveSourceFilePath(row, spreadsheetDirectory) ?? filePath,
      currentFilePath: filePath,
      archivePath: '待人工复查',
      archiveFileName: path.basename(archived.filePath),
      taggingJsonFileName: path.basename(replaceExtension(archived.filePath, '.json')),
      taggingJsonArchivePath: '待人工复查'
      }),
      modelFallbackTrace: sidecar.modelFallbackTrace
    });
  } catch (error) {
    pushStageFailure({
      context: {
        options: input.input.options, startedAt: input.startedAt,
        failures: input.failures, resultsByRow: input.resultsByRow
      },
      row, phase: 'archive', archiveState: '人工复查归档失败',
      errorCode: 'manual-review-writeback-failed', error
    });
  }
}

function restoreTaggingFailure(input: StageContext, row: SpreadsheetTaskRow): void {
  const message = row.values['失败信息']?.trim() || row.values['错误信息']?.trim() || '打标失败';
  const failure = buildFailure({
    row, phase: 'tagging',
    errorCode: /备用模型/iu.test(message) ? 'model-fallback-failed' : 'tagging-failed',
    errorMessage: message,
    timestamp: input.startedAt
  });
  input.failures.push(failure);
  input.resultsByRow.set(row.rowNumber, createFailureRowState({
    row, archiveState: row.values['归档状态']?.trim() || '打标失败', failure
  }));
}

function replaceExtension(filePath: string, extension: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
}
