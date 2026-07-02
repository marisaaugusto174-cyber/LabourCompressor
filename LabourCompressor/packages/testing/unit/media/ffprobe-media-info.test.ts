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
    'stream=width,height,r_frame_rate,avg_frame_rate,nb_frames:format=duration',
    '-of',
    'json',
    '/tmp/source.mp4'
  ]);
});

test('parses ffprobe media info json', () => {
  const info = parseFfprobeMediaInfo(JSON.stringify({
    format: { duration: '12.345' },
    streams: [{
      width: 1920,
      height: 1080,
      r_frame_rate: '30000/1001',
      avg_frame_rate: '30000/1001',
      nb_frames: '370'
    }]
  }));

  assert.equal(info.durationSeconds, 12.345);
  assert.equal(info.width, 1920);
  assert.equal(info.height, 1080);
  assert.equal(info.frameRateSource, 'frame-count');
  assert.ok(Math.abs(info.frameRate - (370 / 12.345)) < 0.000001);
  assert.equal(info.nominalFrameRate, 30000 / 1001);
  assert.equal(info.averageFrameRate, 30000 / 1001);
  assert.equal(info.frameCount, 370);
  assert.equal(info.variableFrameRate, false);
});

test('uses frame-count effective rate when nominal and average rates disagree', () => {
  const info = parseFfprobeMediaInfo(JSON.stringify({
    format: { duration: '169.466667' },
    streams: [{
      width: 560,
      height: 320,
      r_frame_rate: '30/1',
      avg_frame_rate: '25425/1271',
      nb_frames: '3390'
    }]
  }));

  assert.ok(Math.abs(info.frameRate - (3390 / 169.466667)) < 0.000001);
  assert.equal(info.frameRateSource, 'frame-count');
  assert.equal(info.nominalFrameRate, 30);
  assert.ok(Math.abs((info.averageFrameRate ?? 0) - (25425 / 1271)) < 0.000001);
  assert.equal(info.frameCount, 3390);
  assert.equal(info.variableFrameRate, true);
});

test('falls back to avg_frame_rate when frame count is unavailable', () => {
  const info = parseFfprobeMediaInfo(JSON.stringify({
    format: { duration: '5' },
    streams: [{ width: 1280, height: 720, r_frame_rate: '0/0', avg_frame_rate: '24/1' }]
  }));

  assert.equal(info.frameRate, 24);
  assert.equal(info.frameRateSource, 'average');
  assert.equal(info.variableFrameRate, false);
});

test('falls back to r_frame_rate when frame count and avg_frame_rate are unavailable', () => {
  const info = parseFfprobeMediaInfo(JSON.stringify({
    format: { duration: '5' },
    streams: [{ width: 1280, height: 720, r_frame_rate: '25/1', avg_frame_rate: '0/0' }]
  }));

  assert.equal(info.frameRate, 25);
  assert.equal(info.frameRateSource, 'nominal');
  assert.equal(info.variableFrameRate, false);
});

test('rejects invalid ffprobe media info json', () => {
  assert.throws(() => {
    parseFfprobeMediaInfo(JSON.stringify({
      format: { duration: '0' },
      streams: [{ width: 1920, height: 1080 }]
    }));
  }, /Unable to determine media duration/);
});
