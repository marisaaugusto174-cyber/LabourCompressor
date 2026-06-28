import path from 'node:path';

import { createSimulatedDownloaderAdapter } from '../../../../packages/adapters/downloaders/simulated-downloader.ts';
import { createPlatformAwareDownloaderAdapter } from '../../../../packages/adapters/downloaders/platform-aware-downloader.ts';
import { createFfmpegMergeOperator } from '../../../../packages/adapters/media/ffmpeg-merge-operator.ts';
import { mergeDownloadedStreams } from '../../../../packages/adapters/media/local-merge-operator.ts';
import { runSpreadsheetDownloadBatch } from '../../../../packages/features/download/domain/index.ts';
import { applyDownloadFailureStates, loadPlatformCredentialConfig } from '../../local-pipeline-after-edit.ts';
import { loadDownloadFixtures } from '../../local-pipeline-helpers.ts';
import { waitForPipelineCheckpoint } from '../../pipeline-control.ts';
import {
  createBasicRowState,
  createSkippedRowState,
  resolveRowFilePath
} from '../row-state.ts';
import { type StageContext } from './stage-context.ts';

export async function runDownloadStage(input: StageContext & {
  readonly workflowSessionId: string;
}): Promise<void> {
  await waitForPipelineCheckpoint(input.input.control);
  const platformCredentialConfig = await loadPlatformCredentialConfig(input.input.options.platformCredentialConfigPath);
  const remoteRows = input.sheet.rows.filter((row) =>
    row.sourceKind === 'url' &&
    (row.values['当前文件路径'] ?? '').trim().length === 0
  );
  const localRows = input.sheet.rows.filter((row) => row.sourceKind === 'local-file');
  const spreadsheetDirectory = path.dirname(input.input.options.spreadsheet);

  for (const row of localRows) {
    const localPath = resolveRowFilePath(row, spreadsheetDirectory);
    if (localPath === undefined) {
      input.resultsByRow.set(row.rowNumber, createSkippedRowState({
        row,
        archiveState: '等待分割',
        errorMessage: '本地文件无需下载，但缺少可用本地路径。'
      }));
      continue;
    }
    input.resultsByRow.set(row.rowNumber, createBasicRowState({
      row,
      archiveState: '等待分割',
      sourceFilePath: localPath,
      currentFilePath: localPath,
      errorMessage: '本地文件无需下载'
    }));
  }

  if (remoteRows.length === 0) {
    input.emit('download', 'succeeded', 'No network URL rows to download');
    return;
  }

  const downloadFixtures = await loadDownloadFixtures(input.input.options);
  input.emit('download', 'running', `Downloading ${remoteRows.length} network URL row(s)`);
  const downloadBatch = await runSpreadsheetDownloadBatch({
    workflowSessionId: input.workflowSessionId,
    sheet: Object.freeze({ ...input.sheet, rows: Object.freeze(remoteRows) }),
    outputDirectory: input.input.options.downloadDir,
    downloader:
      input.input.options.downloaderMode === 'yt-dlp'
        ? createPlatformAwareDownloaderAdapter({
            binaryPath: input.input.options.ytDlpBinary,
            cookiesFilePath: input.input.options.cookiesFilePath,
            cookiesFromBrowser: input.input.options.cookiesFromBrowser,
            platformCredentialConfig
          })
        : createSimulatedDownloaderAdapter({
            fixtures: downloadFixtures,
            downloadedAt: input.startedAt
          }),
    mergeOperator:
      input.input.options.mergeMode === 'ffmpeg'
        ? createFfmpegMergeOperator()
        : { mergeStreams: mergeDownloadedStreams },
    startedAt: input.startedAt,
    signal: input.input.control?.signal,
    waitIfPaused: input.input.control?.waitIfPaused,
    onProgress: (event) => {
      const speed = event.details?.downloadSpeed;
      const eta = event.details?.downloadEta;
      const suffix = [
        typeof speed === 'string' && speed.length > 0 ? speed : undefined,
        typeof eta === 'string' && eta.length > 0 ? `ETA ${eta}` : undefined
      ].filter(Boolean).join(' · ');
      input.emit('download', 'running', suffix.length > 0
        ? `下载中 ${event.progress.current}/${event.progress.total} · ${suffix}`
        : `下载中 ${event.progress.current}/${event.progress.total}`, {
        currentItem: event.currentItem,
        progress: event.progress,
        details: event.details
      });
    }
  });

  for (const asset of downloadBatch.downloadedAssets) {
    const row = remoteRows.find((candidate) => candidate.taskId === asset.taskId);
    if (row === undefined) {
      continue;
    }
    input.resultsByRow.set(row.rowNumber, createBasicRowState({
      row,
      archiveState: '已下载',
      sourceFilePath: asset.filePath,
      currentFilePath: asset.filePath
    }));
  }
  applyDownloadFailureStates({
    rows: remoteRows,
    downloadTasks: downloadBatch.tasks,
    startedAt: input.startedAt,
    failures: input.failures,
    resultsByRow: input.resultsByRow
  });
  input.emit('download', 'succeeded', `Downloaded ${downloadBatch.downloadedAssets.length} media asset(s)`);
}
