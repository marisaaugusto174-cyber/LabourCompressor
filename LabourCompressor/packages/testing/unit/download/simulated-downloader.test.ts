import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createSimulatedDownloaderAdapter } from '../../../adapters/downloaders/simulated-downloader.ts';
import { createDownloadRequest } from '../../../features/download/domain/index.ts';

test('writes muxed media fixture to output directory', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-simdl-'));

  try {
    const adapter = createSimulatedDownloaderAdapter({
      fixtures: {
        'https://www.youtube.com/watch?v=abc': {
          mode: 'muxed',
          extension: 'mp4',
          content: 'video',
          title: '刷短视频 现状!?',
          resolutionLabel: '720P',
          durationSeconds: 27
        }
      },
      downloadedAt: '2026-04-24T18:12:00.000Z'
    });
    const result = await adapter.download(
      createDownloadRequest({
        taskId: 'task-1',
        workflowSessionId: 'workflow-1',
        rowNumber: 2,
        sourceUrl: 'https://www.youtube.com/watch?v=abc',
        outputDirectory: tempDir,
        outputFileStem: '2-sample'
      })
    );

    assert.equal(result.artifacts[0]?.kind, 'muxed-video');
    assert.equal(result.mediaMetadata.sourceTitle, '刷短视频 现状!?');
    assert.equal(result.mediaMetadata.resolutionLabel, '720P');
    assert.equal(result.mediaMetadata.durationSeconds, 27);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
