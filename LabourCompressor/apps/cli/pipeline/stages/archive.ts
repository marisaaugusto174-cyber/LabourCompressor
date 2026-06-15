import path from 'node:path';

import { archiveFileByPlans } from '../../../../packages/adapters/storage/filesystem/archive-file-operator.ts';
import { buildArchivePlacementPlans } from '../../../../packages/features/archive/domain/index.ts';
import { buildContentTopicArchiveRoot } from '../../../../packages/features/tagging/domain/index.ts';
import { waitForPipelineCheckpoint } from '../../pipeline-control.ts';
import { pushStageFailure } from '../stage-failures.ts';
import {
  createAssetFromRow,
  createBasicRowState,
  createSkippedRowState,
  getLevelValues,
  readOptionalSidecarJson,
  resolveRowFilePath,
  resolveSelectedContentTopicPath,
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
    await waitForPipelineCheckpoint(input.input.control);
    const filePath = resolveRowFilePath(row, spreadsheetDirectory);
    const selectedContentTopicPath = resolveSelectedContentTopicPath(row);
    if (filePath === undefined) {
      input.resultsByRow.set(row.rowNumber, createSkippedRowState({
        row,
        archiveState: '等待下载',
        errorMessage: '缺少当前文件路径'
      }));
      continue;
    }
    if (selectedContentTopicPath === undefined) {
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
          acceptedPaths: [selectedContentTopicPath],
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
        acceptedPaths: [selectedContentTopicPath],
        selectedContentTopicPath
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
