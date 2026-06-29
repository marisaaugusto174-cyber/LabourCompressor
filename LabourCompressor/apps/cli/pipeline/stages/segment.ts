import { access } from 'node:fs/promises';
import path from 'node:path';

import { createPostEditArchiveRecordSpreadsheet } from '../../../../packages/adapters/spreadsheets/local-spreadsheet.ts';
import { type DownloadedMediaAsset } from '../../../../packages/features/download/domain/index.ts';
import { type SpreadsheetAppendRow } from '../../../../packages/features/spreadsheet-tasks/domain/index.ts';
import {
  buildFailure,
  createFailureRowState
} from '../../local-pipeline-helpers.ts';
import {
  runAutoSegmentationStage,
  type AutoSegmentationDependencies
} from '../../local-pipeline-segmentation.ts';
import { waitForPipelineCheckpoint } from '../../pipeline-control.ts';
import {
  createAssetFromRow,
  createSkippedRowState,
  resolveRowFilePath
} from '../row-state.ts';
import { type StageContext } from './stage-context.ts';

export async function runSegmentStage(input: StageContext & {
  readonly appendRows: SpreadsheetAppendRow[];
  readonly segmentationDependencies?: AutoSegmentationDependencies | undefined;
}): Promise<void> {
  const afterEditDirectoryPath = path.join(
    input.input.options.downloadDir,
    input.input.options.afterEditDirectoryName ?? 'AfterEdit'
  );
  const problemClipsDirectoryPath = path.join(
    input.input.options.downloadDir,
    input.input.options.problemClipsDirectoryName ?? 'ProblemClips'
  );
  const rowByTaskId = new Map(input.sheet.rows.map((row) => [row.taskId, row] as const));
  const assets: DownloadedMediaAsset[] = [];
  const sourcePathByTaskId = new Map<string, string>();

  for (const row of input.sheet.rows) {
    await waitForPipelineCheckpoint(input.input.control);
    if (row.values['归档状态']?.trim().startsWith('已分割')) {
      continue;
    }
    if (row.url.includes('#clip=')) {
      continue;
    }
    const filePath = resolveRowFilePath(row, path.dirname(input.input.options.spreadsheet));
    if (filePath === undefined) {
      input.resultsByRow.set(row.rowNumber, createSkippedRowState({
        row,
        archiveState: '等待下载',
        errorMessage: '缺少当前文件路径'
      }));
      continue;
    }
    try {
      await access(filePath);
      sourcePathByTaskId.set(row.taskId, filePath);
      assets.push(createAssetFromRow({ row, filePath, startedAt: input.startedAt }));
    } catch (error) {
      const failure = buildFailure({
        row,
        phase: 'segment',
        errorCode: 'local-file-missing',
        errorMessage: error instanceof Error ? error.message : 'Local file not found.',
        timestamp: input.startedAt
      });
      input.failures.push(failure);
      input.resultsByRow.set(row.rowNumber, createFailureRowState({
        row,
        archiveState: '文件缺失',
        failure
      }));
    }
  }

  if (assets.length === 0) {
    input.emit('segmentation', 'succeeded', 'No rows are ready for segmentation');
    return;
  }

  input.emit('segmentation', 'running', `Segmenting ${assets.length} media asset(s)`);
  const segmentation = await runAutoSegmentationStage({
    downloadedAssets: assets,
    rowByTaskId,
    afterEditDirectoryPath,
    problemClipsDirectoryPath,
    profileId: input.input.options.segmentationProfileId ?? 'standard_ad',
    startedAt: input.startedAt,
    emit: input.emit,
    dependencies: input.segmentationDependencies,
    ...(input.input.control?.signal === undefined ? {} : { signal: input.input.control.signal })
  });

  if (segmentation.postEditEntries.length > 0) {
    createPostEditArchiveRecordSpreadsheet({
      filePath: path.join(afterEditDirectoryPath, 'AfterEdit_归档记录表.xlsx'),
      fileEntries: Object.freeze(
        segmentation.postEditEntries.map((entry) => {
          const currentFilePath = path.join(
            afterEditDirectoryPath,
            entry.relativePath ?? entry.fileName
          );

          return {
            ...entry,
            archiveState: entry.archiveState ?? '待压缩',
            sourceFilePath: entry.sourceFilePath ?? currentFilePath,
            currentFilePath: entry.currentFilePath ?? currentFilePath
          };
        })
      )
    });
  }

  for (const rowState of segmentation.sourceRowStates) {
    const row = input.sheet.rows.find((candidate) => candidate.rowNumber === rowState.rowNumber);
    if (row === undefined) {
      continue;
    }
    input.resultsByRow.set(rowState.rowNumber, {
      ...rowState,
      archiveState: rowState.archiveState.includes('含问题') ? '已分割，含问题片段' : '已分割',
      sourceFilePath: sourcePathByTaskId.get(row.taskId),
      currentFilePath: sourcePathByTaskId.get(row.taskId)
    });
  }
  for (const problemRow of segmentation.problemRows) {
    input.resultsByRow.set(problemRow.rowNumber, {
      ...problemRow,
      archiveState: '已分割，含问题片段',
      errorMessage: problemRow.failure?.errorMessage
    });
  }
  for (const failure of segmentation.failures) {
    input.failures.push(failure);
  }
  for (const [index, segmentedRow] of segmentation.segmentedRows.entries()) {
    const asset = segmentation.segmentedAssets[index];
    if (asset === undefined) {
      continue;
    }
    const sourceRowNumber = Math.floor(segmentedRow.rowNumber / 10000);
    const sourceRow = input.sheet.rows.find((row) => row.rowNumber === sourceRowNumber);
    const segmentIndex = segmentedRow.rowNumber - sourceRowNumber * 10000;
    input.appendRows.push(Object.freeze({
      URL: segmentedRow.url,
      采集人: segmentedRow.values['采集人'] ?? sourceRow?.values['采集人'] ?? '',
      归档状态: '待压缩',
      文件名: asset.fileName,
      源文件路径: sourceRow === undefined ? '' : sourcePathByTaskId.get(sourceRow.taskId) ?? '',
      当前文件路径: asset.filePath,
      压缩缓存路径: '',
      源行号: String(sourceRowNumber),
      片段序号: String(segmentIndex),
      错误信息: ''
    }));
  }
  input.emit('segmentation', 'succeeded', `Automatic segmentation produced ${segmentation.segmentedAssets.length} clip(s)`);
}
