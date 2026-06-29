import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createLocalContinuityAnalyzer,
  parseContinuityMetricsOutput
} from '../../../adapters/media/local-continuity-analyzer.ts';
import { DEFAULT_CONTINUITY_THRESHOLDS } from '../../../features/segmentation/domain/index.ts';

test('parses finite continuity metrics and fuses their verdicts', () => {
  const decisions = parseContinuityMetricsOutput(JSON.stringify({ boundaries: [{
    boundarySeconds: 5,
    visual: { histogramSimilarity: 0.9, normalizedFrameDifference: 0.1 },
    motion: { beforeMagnitude: 1, afterMagnitude: 1, directionCosine: 0.8, magnitudeRatio: 1 },
    audio: { available: false }
  }] }), DEFAULT_CONTINUITY_THRESHOLDS);

  assert.equal(decisions[0]?.classification, 'strong-continuity');
  assert.equal(decisions[0]?.audio.verdict, 'unknown');
});

test('runs one analyzer process for all boundaries', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'continuity-analyzer-'));
  const executablePath = path.join(tempDir, 'fake-python');
  const scriptPath = path.join(tempDir, 'fake-analyzer.py');
  const countPath = path.join(tempDir, 'count.txt');
  const fixturePath = path.join(tempDir, 'fixture.json');

  try {
    writeFileSync(executablePath, '#!/bin/sh\nprintf x >> "$COUNT_PATH"\ncp "$FIXTURE_PATH" "$5"\n', { mode: 0o755 });
    writeFileSync(scriptPath, '# fake analyzer');
    writeFileSync(fixturePath, JSON.stringify({ boundaries: [
      createRawBoundary(5),
      createRawBoundary(12)
    ] }));
    const analyzer = createLocalContinuityAnalyzer({
      pythonPath: executablePath,
      scriptPath,
      environment: { COUNT_PATH: countPath, FIXTURE_PATH: fixturePath }
    });
    const decisions = await analyzer.analyzeBoundaries({
      filePath: '/tmp/source.mp4',
      shots: [
        { startSeconds: 0, endSeconds: 5 },
        { startSeconds: 5, endSeconds: 12 },
        { startSeconds: 12, endSeconds: 20 }
      ],
      thresholds: DEFAULT_CONTINUITY_THRESHOLDS
    });

    assert.equal(decisions.length, 2);
    assert.equal((await readFile(countPath, 'utf8')).length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createRawBoundary(boundarySeconds: number) {
  return {
    boundarySeconds,
    visual: { histogramSimilarity: 0.9, normalizedFrameDifference: 0.1 },
    motion: { beforeMagnitude: 1, afterMagnitude: 1, directionCosine: 0.8, magnitudeRatio: 1 },
    audio: { available: false }
  };
}

test('analyzes a hard visual cut with the project-local OpenCV runtime', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'continuity-real-'));
  const videoPath = path.join(tempDir, 'cut.mp4');
  const projectRoot = path.resolve(import.meta.dirname, '../../../..');

  try {
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi',
      '-i', 'color=c=red:s=320x180:r=10:d=5',
      '-f', 'lavfi',
      '-i', 'color=c=blue:s=320x180:r=10:d=5',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', videoPath
    ]);
    const analyzer = createLocalContinuityAnalyzer({
      pythonPath: path.join(projectRoot, '.tools/scenedetect-venv/bin/python'),
      scriptPath: path.join(projectRoot, 'scripts/analyze-boundary-continuity.py')
    });
    const decisions = await analyzer.analyzeBoundaries({
      filePath: videoPath,
      shots: [
        { startSeconds: 0, endSeconds: 5 },
        { startSeconds: 5, endSeconds: 10 }
      ],
      thresholds: DEFAULT_CONTINUITY_THRESHOLDS
    });

    assert.equal(decisions.length, 1);
    assert.equal(decisions[0]?.visual.verdict, 'discontinuous');
    assert.equal(decisions[0]?.motion.verdict, 'continuous');
    assert.equal(decisions[0]?.audio.verdict, 'unknown');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
