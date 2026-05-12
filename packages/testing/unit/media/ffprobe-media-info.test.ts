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
    'stream=width,height:format=duration',
    '-of',
    'json',
    '/tmp/source.mp4'
  ]);
});

test('parses ffprobe media info json', () => {
  const info = parseFfprobeMediaInfo(JSON.stringify({
    format: { duration: '12.345' },
    streams: [{ width: 1920, height: 1080 }]
  }));

  assert.deepEqual(info, {
    durationSeconds: 12.345,
    width: 1920,
    height: 1080
  });
});

test('rejects invalid ffprobe media info json', () => {
  assert.throws(() => {
    parseFfprobeMediaInfo(JSON.stringify({
      format: { duration: '0' },
      streams: [{ width: 1920, height: 1080 }]
    }));
  }, /Unable to determine media duration/);
});
