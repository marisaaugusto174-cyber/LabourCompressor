import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  buildVideoTaggingCacheArgs,
  DEFAULT_VIDEO_TAGGING_CACHE_PROFILE,
  prepareVideoTaggingCache
} from '../../../adapters/media/media-frame-extractor.ts';

test('builds standardized ffmpeg args for video tagging cache', () => {
  const args = buildVideoTaggingCacheArgs({
    inputFilePath: '/tmp/input.mp4',
    outputFilePath: '/tmp/output.mp4'
  });

  assert.equal(args.includes('libx264'), true);
  assert.equal(args.includes('650k'), true);
  assert.equal(args.includes('aac'), true);
  assert.equal(args.includes('64k'), true);
  assert.equal(args.includes('+faststart'), true);
});

test('prepares standardized cached video and reuses it on second call', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-video-cache-'));
  const sourceFilePath = path.join(tempDir, 'source.mp4');
  const cacheRootDirectory = path.join(tempDir, '.cache', 'video-tagging');

  try {
    execFileSync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=960x540:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=1000:sample_rate=44100',
      '-t',
      '6',
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      sourceFilePath
    ]);

    const first = await prepareVideoTaggingCache({
      mediaFilePath: sourceFilePath,
      cacheRootDirectory
    });
    const second = await prepareVideoTaggingCache({
      mediaFilePath: sourceFilePath,
      cacheRootDirectory
    });

    const cacheStats = await stat(first.cachePath);
    const streamInfo = JSON.parse(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=height',
        '-of',
        'json',
        first.cachePath
      ], { encoding: 'utf8' })
    ) as { streams?: Array<{ height?: number }> };
    const audioInfo = JSON.parse(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_name,bit_rate',
        '-of',
        'json',
        first.cachePath
      ], { encoding: 'utf8' })
    ) as { streams?: Array<{ codec_name?: string; bit_rate?: string }> };

    assert.equal(first.profileId, DEFAULT_VIDEO_TAGGING_CACHE_PROFILE.profileId);
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(first.cachePath, second.cachePath);
    assert.equal(streamInfo.streams?.[0]?.height, 360);
    assert.equal(audioInfo.streams?.[0]?.codec_name, 'aac');
    assert.ok(Number(audioInfo.streams?.[0]?.bit_rate ?? '0') > 0);
    const safeUploadFileBytes = Math.floor(
      ((DEFAULT_VIDEO_TAGGING_CACHE_PROFILE.maxDataUriBytes - 64) * 3) / 4
    );
    assert.ok(cacheStats.size <= safeUploadFileBytes);
    assert.ok(first.cacheFps > 0);
    assert.equal(Math.round(first.sourceFps), Math.round(first.cacheFps));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
