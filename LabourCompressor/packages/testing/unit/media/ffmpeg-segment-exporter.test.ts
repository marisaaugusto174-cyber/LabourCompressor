import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildFfmpegSegmentArgs,
  createFfmpegSegmentExporter
} from '../../../adapters/media/ffmpeg-segment-exporter.ts';

test('builds ffmpeg segment export args', () => {
  const args = buildFfmpegSegmentArgs({
    inputFilePath: '/tmp/source.mp4',
    outputFilePath: '/tmp/out.mp4',
    startSeconds: 5,
    endSeconds: 12
  });

  assert.deepEqual(args.slice(0, 8), [
    '-y',
    '-ss',
    '5',
    '-to',
    '12',
    '-i',
    '/tmp/source.mp4',
    '-map'
  ]);
  assert.equal(args.at(-1), '/tmp/out.mp4');
});

test('exports a segment with ffmpeg binary', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-segment-'));
  const sourcePath = path.join(tempDir, 'source.mp4');
  const outputPath = path.join(tempDir, 'clip.mp4');

  try {
    execFileSync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=160x90:rate=10:duration=6',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=1000:duration=6',
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      sourcePath
    ]);

    const exporter = createFfmpegSegmentExporter();
    const result = await exporter.exportSegment({
      inputFilePath: sourcePath,
      outputFilePath: outputPath,
      startSeconds: 1,
      endSeconds: 4
    });

    assert.equal(result.outputFilePath, outputPath);
    assert.equal(existsSync(outputPath), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
