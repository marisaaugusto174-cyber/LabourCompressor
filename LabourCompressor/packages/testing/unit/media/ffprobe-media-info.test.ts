import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFfprobeMediaInfoArgs,
  parseFfprobeMediaInfo
} from '../../../adapters/media/ffprobe-media-info.ts';

test('builds ffprobe media info args', () => {
  const args = buildFfprobeMediaInfoArgs('/tmp/source.mp4');

  assert.deepEqual(args, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,r_frame_rate,avg_frame_rate:format=duration',
    '-of',
    'json',
    '/tmp/source.mp4'
  ]);
});

test('parses ffprobe media info json', () => {
  const info = parseFfprobeMediaInfo(JSON.stringify({
    format: { duration: '12.345' },
    streams: [{ width: 1920, height: 1080, r_frame_rate: '30000/1001' }]
  }));

  assert.deepEqual(info, {
    durationSeconds: 12.345,
    width: 1920,
    height: 1080,
    frameRate: 30000 / 1001
  });
});

test('falls back to avg_frame_rate when r_frame_rate is unavailable', () => {
  const info = parseFfprobeMediaInfo(JSON.stringify({
    format: { duration: '5' },
    streams: [{ width: 1280, height: 720, r_frame_rate: '0/0', avg_frame_rate: '24/1' }]
  }));

  assert.equal(info.frameRate, 24);
});

test('rejects invalid ffprobe media info json', () => {
  assert.throws(() => {
    parseFfprobeMediaInfo(JSON.stringify({
      format: { duration: '0' },
      streams: [{ width: 1920, height: 1080 }]
    }));
  }, /Unable to determine media duration/);
});
