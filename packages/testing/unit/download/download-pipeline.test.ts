import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createSimulatedDownloaderAdapter } from '../../../adapters/downloaders/simulated-downloader.ts';
import { mergeDownloadedStreams } from '../../../adapters/media/local-merge-operator.ts';
import { runSpreadsheetDownloadBatch } from '../../../features/download/domain/index.ts';

test('runs spreadsheet download batch and creates default tagging scope', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-download-'));

  try {
    const result = await runSpreadsheetDownloadBatch({
      workflowSessionId: 'download-batch-1',
      sheet: {
        filePath: '/tmp/tasks.xlsx',
        fileKind: 'xlsx',
        sheetName: 'Sheet1',
        headers: Object.freeze(['url', 'title']),
        rows: Object.freeze([
          {
            taskId: 'sheet::row-2',
            rowNumber: 2,
            url: 'https://www.youtube.com/watch?v=abc',
            values: Object.freeze({
              url: 'https://www.youtube.com/watch?v=abc',
              title: 'Sample A'
            })
          }
        ])
      },
      outputDirectory: tempDir,
      downloader: createSimulatedDownloaderAdapter({
        fixtures: {
          'https://www.youtube.com/watch?v=abc': {
            mode: 'muxed',
            extension: 'mp4',
            content: 'muxed-content',
            title: '刷短视频 现状!?',
            resolutionLabel: '720P',
            durationSeconds: 27
          }
        },
        downloadedAt: '2026-04-24T18:10:00.000Z'
      }),
      mergeOperator: {
        mergeStreams: mergeDownloadedStreams
      },
      startedAt: '2026-04-24T18:09:00.000Z'
    });

    assert.equal(result.tasks[0]?.status, 'succeeded');
    assert.equal(result.downloadedAssets.length, 1);
    assert.equal(result.taggingScope.assetIds[0], 'sheet::row-2::asset');
    assert.equal(
      result.downloadedAssets[0]?.fileName,
      '刷短视频_现状_720P_260424_000027.mp4'
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('reuses an existing standardized download file instead of failing', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-download-'));

  try {
    const existingFilePath = path.join(
      tempDir,
      '刷短视频_现状_720P_260424_000027.mp4'
    );
    writeFileSync(existingFilePath, 'existing-content', 'utf8');

    const result = await runSpreadsheetDownloadBatch({
      workflowSessionId: 'download-batch-2',
      sheet: {
        filePath: '/tmp/tasks.xlsx',
        fileKind: 'xlsx',
        sheetName: 'Sheet1',
        headers: Object.freeze(['url', 'title']),
        rows: Object.freeze([
          {
            taskId: 'sheet::row-2',
            rowNumber: 2,
            url: 'https://www.youtube.com/watch?v=abc',
            values: Object.freeze({
              url: 'https://www.youtube.com/watch?v=abc',
              title: 'Sample A'
            })
          }
        ])
      },
      outputDirectory: tempDir,
      downloader: createSimulatedDownloaderAdapter({
        fixtures: {
          'https://www.youtube.com/watch?v=abc': {
            mode: 'muxed',
            extension: 'mp4',
            content: 'new-content',
            title: '刷短视频 现状!?',
            resolutionLabel: '720P',
            durationSeconds: 27
          }
        },
        downloadedAt: '2026-04-24T18:10:00.000Z'
      }),
      mergeOperator: {
        mergeStreams: mergeDownloadedStreams
      },
      startedAt: '2026-04-24T18:09:00.000Z'
    });

    assert.equal(result.tasks[0]?.status, 'succeeded');
    assert.equal(result.downloadedAssets[0]?.filePath, existingFilePath);
    assert.equal(existsSync(path.join(tempDir, '1-Sample-A.mp4')), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('preserves an already standardized artifact name on rerun', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-download-'));

  try {
    const existingFilePath = path.join(
      tempDir,
      '刷短视频_现状_720P_260424_000027.mp4'
    );
    writeFileSync(existingFilePath, 'existing-content', 'utf8');

    const result = await runSpreadsheetDownloadBatch({
      workflowSessionId: 'download-batch-3',
      sheet: {
        filePath: '/tmp/tasks.xlsx',
        fileKind: 'xlsx',
        sheetName: 'Sheet1',
        headers: Object.freeze(['url', 'title']),
        rows: Object.freeze([
          {
            taskId: 'sheet::row-2',
            rowNumber: 2,
            url: 'https://www.youtube.com/watch?v=abc',
            values: Object.freeze({
              url: 'https://www.youtube.com/watch?v=abc',
              title: 'Sample A'
            })
          }
        ])
      },
      outputDirectory: tempDir,
      downloader: {
        async download(request) {
          return Object.freeze({
            request,
            artifacts: Object.freeze([
              Object.freeze({
                kind: 'muxed-video' as const,
                filePath: existingFilePath,
                fileName: path.basename(existingFilePath),
                container: 'mp4'
              })
            ]),
            downloadedAt: '2026-05-04T08:10:00.000Z',
            mediaMetadata: Object.freeze({
              sourceTitle: '刷短视频 现状!?',
              resolutionLabel: '720P',
              durationSeconds: 27
            })
          });
        }
      },
      mergeOperator: {
        mergeStreams: mergeDownloadedStreams
      },
      startedAt: '2026-05-04T08:09:00.000Z'
    });

    assert.equal(result.tasks[0]?.status, 'succeeded');
    assert.equal(result.downloadedAssets[0]?.filePath, existingFilePath);
    assert.equal(result.downloadedAssets[0]?.fileName, path.basename(existingFilePath));
    assert.equal(existsSync(existingFilePath), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('reports spreadsheet download item progress with current and total counts', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-download-'));
  const events: unknown[] = [];

  try {
    await runSpreadsheetDownloadBatch({
      workflowSessionId: 'download-batch-progress',
      sheet: {
        filePath: '/tmp/tasks.xlsx',
        fileKind: 'xlsx',
        sheetName: 'Sheet1',
        headers: Object.freeze(['url', 'title']),
        rows: Object.freeze([
          {
            taskId: 'sheet::row-2',
            rowNumber: 2,
            url: 'https://www.youtube.com/watch?v=abc',
            values: Object.freeze({
              url: 'https://www.youtube.com/watch?v=abc',
              title: 'Sample A'
            })
          },
          {
            taskId: 'sheet::row-3',
            rowNumber: 3,
            url: 'https://www.youtube.com/watch?v=def',
            values: Object.freeze({
              url: 'https://www.youtube.com/watch?v=def',
              title: 'Sample B'
            })
          }
        ])
      },
      outputDirectory: tempDir,
      downloader: createSimulatedDownloaderAdapter({
        fixtures: {
          'https://www.youtube.com/watch?v=abc': {
            mode: 'muxed',
            extension: 'mp4',
            content: 'muxed-a',
            title: 'Sample A'
          },
          'https://www.youtube.com/watch?v=def': {
            mode: 'muxed',
            extension: 'mp4',
            content: 'muxed-b',
            title: 'Sample B'
          }
        },
        downloadedAt: '2026-04-24T18:10:00.000Z'
      }),
      mergeOperator: {
        mergeStreams: mergeDownloadedStreams
      },
      startedAt: '2026-04-24T18:09:00.000Z',
      onProgress: (event) => events.push(event)
    });

    assert.deepEqual(
      events.map((event) => (event as { progress?: { current: number; total: number } }).progress),
      [
        { current: 1, total: 2 },
        { current: 1, total: 2 },
        { current: 2, total: 2 },
        { current: 2, total: 2 }
      ]
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
