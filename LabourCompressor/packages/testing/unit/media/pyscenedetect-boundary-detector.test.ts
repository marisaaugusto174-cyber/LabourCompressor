import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPySceneDetectArgs,
  parseSceneDetectCsv
} from '../../../adapters/media/pyscenedetect-boundary-detector.ts';

test('builds pyscenedetect adaptive detector args', () => {
  const args = buildPySceneDetectArgs({
    inputFilePath: '/tmp/source.mp4',
    outputDirectoryPath: '/tmp/scenes',
    detector: 'adaptive'
  });

  assert.deepEqual(args, [
    '-i',
    '/tmp/source.mp4',
    'detect-adaptive',
    'list-scenes',
    '-o',
    '/tmp/scenes',
    '-f',
    'scenes.csv'
  ]);
});

test('parses scenedetect csv into candidate shot ranges', () => {
  const shots = parseSceneDetectCsv(
    'Start Timecode,End Timecode\n00:00:00.000,00:00:05.000\n00:00:05.000,00:00:12.250\n'
  );

  assert.deepEqual(shots, [
    { startSeconds: 0, endSeconds: 5 },
    { startSeconds: 5, endSeconds: 12.25 }
  ]);
});

test('parses scenedetect csv with leading timecode list metadata', () => {
  const shots = parseSceneDetectCsv(
    [
      'Timecode List:,00:00:02.400,00:00:04.300',
      'Scene Number,Start Frame,Start Timecode,Start Time (seconds),End Frame,End Timecode,End Time (seconds)',
      '1,1,00:00:00.000,0.000,72,00:00:02.400,2.400',
      '2,73,00:00:02.400,2.400,129,00:00:04.300,4.300'
    ].join('\n')
  );

  assert.deepEqual(shots, [
    { startSeconds: 0, endSeconds: 2.4 },
    { startSeconds: 2.4, endSeconds: 4.3 }
  ]);
});

test('rejects malformed scenedetect csv rows', () => {
  assert.throws(() => {
    parseSceneDetectCsv('Start Timecode,End Timecode\nbad,00:00:05.000\n');
  }, /Invalid scene timecode/);
});
