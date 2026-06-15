import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { prepareVideoTaggingCache } from '../../../../packages/adapters/media/media-frame-extractor.ts';
import { waitForPipelineCheckpoint } from '../../pipeline-control.ts';
import { DEFAULT_VIDEO_CACHE_DIRECTORY } from '../../project-paths.ts';
import { pushStageFailure } from '../stage-failures.ts';
import {
  createBasicRowState,
  createSkippedRowState,
  resolveRowFilePath,
  resolveSourceFilePath,
  shouldProcessMediaRow
} from '../row-state.ts';
import { type StageContext } from './stage-context.ts';

export async function runCompressStage(input: StageContext): Promise<void> {
  const cacheRootDirectory = DEFAULT_VIDEO_CACHE_DIRECTORY;
  const rows = input.sheet.rows.filter((row) => shouldProcessMediaRow(row));
  const spreadsheetDirectory = path.dirname(input.input.options.spreadsheet);

  if (rows.length === 0) {
    input.emit('compress', 'succeeded', 'No rows are ready for compression');
    return;
  }

  await mkdir(cacheRootDirectory, { recursive: true });
  for (const row of rows) {
    await waitForPipelineCheckpoint(input.input.control);
    const filePath = resolveRowFilePath(row, spreadsheetDirectory);
    if (filePath === undefined) {
      input.resultsByRow.set(row.rowNumber, createSkippedRowState({
        row,
        archiveState: '等待下载',
        errorMessage: '缺少当前文件路径'
      }));
      continue;
    }
    try {
      input.emit('compress-item', 'running', `Preparing tagging cache for ${path.basename(filePath)}`);
      const cache = await prepareVideoTaggingCache({
        mediaFilePath: filePath,
        cacheRootDirectory
      });
      input.resultsByRow.set(row.rowNumber, createBasicRowState({
        row,
        archiveState: '已压缩',
        sourceFilePath: resolveSourceFilePath(row, spreadsheetDirectory) ?? filePath,
        currentFilePath: filePath,
        compressedCachePath: cache.cachePath
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
        phase: 'compress',
        archiveState: '压缩失败',
        errorCode: 'compress-failed',
        error
      });
    }
  }
  input.emit('compress', 'succeeded', 'Compression stage completed');
}
