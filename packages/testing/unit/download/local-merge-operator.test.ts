import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mergeDownloadedStreams } from '../../../adapters/media/local-merge-operator.ts';
import { createDownloadRequest } from '../../../features/download/domain/index.ts';

test('merges separated streams and cleans source artifacts', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-merge-'));
  const videoPath = path.join(tempDir, 'sample.video.m4v');
  const audioPath = path.join(tempDir, 'sample.audio.m4a');

  try {
    writeFileSync(videoPath, 'video');
    writeFileSync(audioPath, 'audio');

    const merged = await mergeDownloadedStreams({
      request: createDownloadRequest({
        taskId: 'task-1',
        workflowSessionId: 'workflow-1',
        rowNumber: 2,
        sourceUrl: 'https://www.douyin.com/video/1',
        outputDirectory: tempDir,
        outputFileStem: 'sample'
      }),
      videoArtifact: {
        kind: 'video-only',
        filePath: videoPath,
        fileName: 'sample.video.m4v',
        container: 'm4v'
      },
      audioArtifact: {
        kind: 'audio-only',
        filePath: audioPath,
        fileName: 'sample.audio.m4a',
        container: 'm4a'
      },
      outputDirectory: tempDir,
      outputFileStem: 'sample',
      cleanupSourceArtifacts: true
    });

    assert.equal(path.basename(merged.mergedFilePath), 'sample.mp4');
    assert.equal(await readFile(merged.mergedFilePath, 'utf8'), 'video:video\naudio:audio\n');
    assert.equal(existsSync(videoPath), false);
    assert.equal(existsSync(audioPath), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
