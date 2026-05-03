import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildFfmpegMergeArgs,
  createFfmpegMergeOperator,
  validateFfmpegBinary
} from '../../../adapters/media/ffmpeg-merge-operator.ts';
import { createDownloadRequest } from '../../../features/download/domain/index.ts';

test('builds ffmpeg merge args', () => {
  const args = buildFfmpegMergeArgs({
    videoFilePath: '/tmp/video.mp4',
    audioFilePath: '/tmp/audio.m4a',
    outputFilePath: '/tmp/output.mp4'
  });

  assert.deepEqual(args.slice(0, 6), ['-y', '-i', '/tmp/video.mp4', '-i', '/tmp/audio.m4a', '-c']);
});

test('merges video and audio with ffmpeg binary', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-ffmpeg-'));
  const videoPath = path.join(tempDir, 'video.mp4');
  const audioPath = path.join(tempDir, 'audio.m4a');

  try {
    execFileSync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=16x16:d=0.1',
      '-c:v',
      'libx264',
      '-an',
      videoPath
    ]);
    execFileSync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=1000:duration=0.1',
      '-c:a',
      'aac',
      '-vn',
      audioPath
    ]);

    const operator = createFfmpegMergeOperator();
    const merged = await operator.mergeStreams({
      request: createDownloadRequest({
        taskId: 'task-1',
        workflowSessionId: 'workflow-1',
        rowNumber: 2,
        sourceUrl: 'https://www.douyin.com/video/1',
        outputDirectory: tempDir,
        outputFileStem: 'merged'
      }),
      videoArtifact: {
        kind: 'video-only',
        filePath: videoPath,
        fileName: 'video.mp4',
        container: 'mp4'
      },
      audioArtifact: {
        kind: 'audio-only',
        filePath: audioPath,
        fileName: 'audio.m4a',
        container: 'm4a'
      },
      outputDirectory: tempDir,
      outputFileStem: 'merged',
      cleanupSourceArtifacts: true
    });

    assert.equal(existsSync(merged.mergedFilePath), true);
    assert.equal(existsSync(videoPath), false);
    assert.equal(existsSync(audioPath), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('validates that ffmpeg binary is available', async () => {
  assert.equal(await validateFfmpegBinary(), true);
});
