import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createLocalShotBoundaryRefiner,
  parseShotBoundaryRefinementOutput
} from '../../../adapters/media/local-shot-boundary-refiner.ts';

test('parses accepted boundary refinements into refined shots', () => {
  const result = parseShotBoundaryRefinementOutput(JSON.stringify({
    algorithmVersion: 'atomic-boundary-refinement-v1',
    boundaries: [{
      originalSeconds: 1.8,
      refinedSeconds: 2,
      refinedFrame: 20,
      accepted: true,
      reason: 'confirmed',
      metrics: { score: 10, prominence: 2 }
    }]
  }), {
    shots: [{ startSeconds: 0, endSeconds: 1.8 }, { startSeconds: 1.8, endSeconds: 4 }],
    durationSeconds: 4,
    frameRate: 10
  });

  assert.deepEqual(result.shots, [
    {
      startSeconds: 0,
      endSeconds: 2,
      endFrame: 20,
      sourceBoundary: {
        originalSeconds: 1.8,
        refinedSeconds: 2,
        refinedFrame: 20,
        accepted: true,
        reason: 'confirmed'
      }
    },
    { startSeconds: 2, endSeconds: 4, startFrame: 20 }
  ]);
  assert.equal(result.boundaries[0]?.accepted, true);
});

test('deduplicates accepted boundaries that collapse to the same frame', () => {
  const result = parseShotBoundaryRefinementOutput(JSON.stringify({
    algorithmVersion: 'atomic-boundary-refinement-v1',
    boundaries: [
      { originalSeconds: 2, refinedSeconds: 2, refinedFrame: 20, accepted: true, reason: 'confirmed', metrics: {} },
      { originalSeconds: 2.02, refinedSeconds: 2.01, refinedFrame: 20, accepted: true, reason: 'confirmed', metrics: {} }
    ]
  }), {
    shots: [
      { startSeconds: 0, endSeconds: 2 },
      { startSeconds: 2, endSeconds: 2.02 },
      { startSeconds: 2.02, endSeconds: 5 }
    ],
    durationSeconds: 5,
    frameRate: 25
  });

  assert.deepEqual(result.shots.map((shot) => [shot.startSeconds, shot.endSeconds]), [
    [0, 2],
    [2, 5]
  ]);
});

test('runs one refiner process for all candidate boundaries', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'shot-refiner-process-'));
  const executablePath = path.join(tempDir, 'fake-python');
  const scriptPath = path.join(tempDir, 'fake-refiner.py');
  const countPath = path.join(tempDir, 'count.txt');
  const fixturePath = path.join(tempDir, 'fixture.json');

  try {
    writeFileSync(executablePath, '#!/bin/sh\nprintf x >> "$COUNT_PATH"\ncp "$FIXTURE_PATH" "$5"\n', { mode: 0o755 });
    writeFileSync(scriptPath, '# fake refiner');
    writeFileSync(fixturePath, JSON.stringify({ boundaries: [
      { originalSeconds: 2, refinedSeconds: 2, refinedFrame: 20, accepted: true, reason: 'confirmed', metrics: {} },
      { originalSeconds: 4, refinedSeconds: 4, refinedFrame: 40, accepted: true, reason: 'confirmed', metrics: {} }
    ] }));
    const refiner = createLocalShotBoundaryRefiner({
      pythonPath: executablePath,
      scriptPath,
      environment: { COUNT_PATH: countPath, FIXTURE_PATH: fixturePath }
    });

    const result = await refiner.refineShots({
      filePath: '/tmp/source.mp4',
      shots: [
        { startSeconds: 0, endSeconds: 2 },
        { startSeconds: 2, endSeconds: 4 },
        { startSeconds: 4, endSeconds: 6 }
      ],
      durationSeconds: 6,
      frameRate: 10
    });

    assert.equal(result.boundaries.length, 2);
    assert.equal((await readFile(countPath, 'utf8')).length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('refines a hard visual cut to the local peak frame', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'shot-refiner-hard-cut-'));
  const videoPath = path.join(tempDir, 'hard-cut.mp4');
  const projectRoot = path.resolve(import.meta.dirname, '../../../..');

  try {
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=10:d=2',
      '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10:d=2',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', videoPath
    ]);
    const refiner = createLocalShotBoundaryRefiner({
      pythonPath: path.join(projectRoot, '.tools/scenedetect-venv/bin/python'),
      scriptPath: path.join(projectRoot, 'scripts/refine-shot-boundaries.py')
    });

    const result = await refiner.refineShots({
      filePath: videoPath,
      shots: [{ startSeconds: 0, endSeconds: 1.7 }, { startSeconds: 1.7, endSeconds: 4 }],
      durationSeconds: 4,
      frameRate: 10
    });

    assert.equal(result.boundaries[0]?.accepted, true);
    assert.ok(Math.abs((result.boundaries[0]?.refinedSeconds ?? 0) - 2) <= 0.11);
    assert.deepEqual(result.shots.map((shot) => [shot.startSeconds, shot.endSeconds]), [
      [0, result.boundaries[0]?.refinedSeconds],
      [result.boundaries[0]?.refinedSeconds, 4]
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('filters a brightness-only boundary candidate', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'shot-refiner-luma-'));
  const videoPath = path.join(tempDir, 'luma-change.mp4');
  const projectRoot = path.resolve(import.meta.dirname, '../../../..');

  try {
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=10:d=2',
      '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=10:d=2',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', videoPath
    ]);
    const refiner = createLocalShotBoundaryRefiner({
      pythonPath: path.join(projectRoot, '.tools/scenedetect-venv/bin/python'),
      scriptPath: path.join(projectRoot, 'scripts/refine-shot-boundaries.py')
    });

    const result = await refiner.refineShots({
      filePath: videoPath,
      shots: [{ startSeconds: 0, endSeconds: 2 }, { startSeconds: 2, endSeconds: 4 }],
      durationSeconds: 4,
      frameRate: 10
    });

    assert.equal(result.boundaries[0]?.accepted, false);
    assert.match(result.boundaries[0]?.reason ?? '', /亮度|遮挡/u);
    assert.deepEqual(result.shots, [{ startSeconds: 0, endSeconds: 4 }]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
