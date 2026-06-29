import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveSceneDetectBinaryPath } from '../../../../apps/cli/local-pipeline-segmentation-binaries.ts';
import { runAutoSegmentationStage } from '../../../../apps/cli/local-pipeline-segmentation.ts';
import { type DownloadedMediaAsset } from '../../../features/download/domain/index.ts';
import { type SpreadsheetTaskRow } from '../../../features/spreadsheet-tasks/domain/index.ts';

test('auto segmentation keeps a 42 second strong-continuity group intact', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-auto-seg-'));
  const sourcePath = path.join(tempDir, 'Sample_A_720P_260512_000042.mp4');
  const afterEditDirectoryPath = path.join(tempDir, 'AfterEdit');
  const problemClipsDirectoryPath = path.join(tempDir, 'ProblemClips');
  const writes: readonly {
    readonly outputFilePath: string;
    readonly startSeconds: number;
    readonly endSeconds: number;
  }[] = [];

  try {
    writeFileSync(sourcePath, 'source-video', 'utf8');
    const result = await runAutoSegmentationStage({
      downloadedAssets: [createAsset({ sourcePath })],
      rowByTaskId: new Map([['task-1', createRow()]]),
      afterEditDirectoryPath,
      problemClipsDirectoryPath,
      profileId: 'standard_ad',
      startedAt: '2026-05-12T00:00:00.000Z',
      emit: () => undefined,
      dependencies: {
        mediaInfoReader: {
          async readMediaInfo() {
            return { durationSeconds: 42, width: 1920, height: 1080 };
          }
        },
        boundaryDetector: {
          async detectShots() {
            return [
              { startSeconds: 0, endSeconds: 18 },
              { startSeconds: 18, endSeconds: 42 }
            ];
          }
        },
        continuityAnalyzer: {
          async analyzeBoundaries() {
            return [createContinuityDecision(18, 'strong-continuity')];
          }
        },
        segmentExporter: {
          async exportSegment(input) {
            (writes as {
              outputFilePath: string;
              startSeconds: number;
              endSeconds: number;
            }[]).push({
              outputFilePath: input.outputFilePath,
              startSeconds: input.startSeconds,
              endSeconds: input.endSeconds
            });
            mkdirSync(path.dirname(input.outputFilePath), { recursive: true });
            writeFileSync(input.outputFilePath, `${input.startSeconds}-${input.endSeconds}`, 'utf8');
            return { outputFilePath: input.outputFilePath };
          }
        }
      }
    });

    assert.equal(result.segmentedAssets.length, 1);
    assert.equal(result.failures.length, 0);
    assert.deepEqual(writes.map((write) => write.endSeconds - write.startSeconds), [42]);
    assert.deepEqual(result.segmentedAssets.map((asset) => asset.fileName), [
      'Sample_A_720P_260512_000042_01.mp4'
    ]);
    assert.deepEqual(result.postEditEntries.map((entry) => entry.fileName), [
      'Sample_A_720P_260512_000042_01.mp4'
    ]);
    assert.equal(
      await readFile(path.join(afterEditDirectoryPath, 'Sample_A_720P_260512_000042_01.mp4'), 'utf8'),
      '0-42'
    );
    const diagnostic = JSON.parse(await readFile(path.join(
      tempDir, '.segmentation', 'Sample_A_720P_260512_000042', 'continuity.json'
    ), 'utf8')) as { fallbackApplied?: boolean };
    assert.equal(diagnostic.fallbackApplied, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('auto segmentation records and uses mechanical fallback when continuity analysis fails', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-fallback-'));
  const sourcePath = path.join(tempDir, 'Sample_A_720P_260512_000045.mp4');
  const writes: { startSeconds: number; endSeconds: number }[] = [];
  const events: { stage: string; details?: unknown }[] = [];

  try {
    writeFileSync(sourcePath, 'source-video', 'utf8');
    const result = await runAutoSegmentationStage({
      downloadedAssets: [createAsset({ sourcePath })],
      rowByTaskId: new Map([['task-1', createRow()]]),
      afterEditDirectoryPath: path.join(tempDir, 'AfterEdit'),
      problemClipsDirectoryPath: path.join(tempDir, 'ProblemClips'),
      profileId: 'standard_ad',
      startedAt: '2026-05-12T00:00:00.000Z',
      emit: (stage, _status, _message, extras) => events.push({ stage, details: extras?.details }),
      dependencies: {
        mediaInfoReader: { async readMediaInfo() { return { durationSeconds: 45, width: 1920, height: 1080 }; } },
        boundaryDetector: { async detectShots() { return [
          { startSeconds: 0, endSeconds: 20 }, { startSeconds: 20, endSeconds: 45 }
        ]; } },
        continuityAnalyzer: { async analyzeBoundaries() { throw new Error('analysis unavailable /private/path'); } },
        segmentExporter: { async exportSegment(input) {
          writes.push({ startSeconds: input.startSeconds, endSeconds: input.endSeconds });
          mkdirSync(path.dirname(input.outputFilePath), { recursive: true });
          writeFileSync(input.outputFilePath, 'clip');
          return { outputFilePath: input.outputFilePath };
        } }
      }
    });

    assert.deepEqual(writes, [
      { startSeconds: 0, endSeconds: 20 },
      { startSeconds: 20, endSeconds: 45 }
    ]);
    assert.equal(result.failures.length, 0);
    const diagnostic = JSON.parse(await readFile(path.join(
      tempDir, '.segmentation', 'Sample_A_720P_260512_000045', 'continuity.json'
    ), 'utf8')) as { fallbackApplied?: boolean; fallbackReason?: string };
    assert.equal(diagnostic.fallbackApplied, true);
    assert.equal(diagnostic.fallbackReason, 'continuity-analysis-failed');
    assert.doesNotMatch(JSON.stringify(diagnostic), /private\/path/u);
    assert.equal(events.some((event) =>
      event.stage === 'segmentation-continuity' &&
      JSON.stringify(event.details).includes('continuity-analysis-failed')
    ), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('auto segmentation propagates cancellation instead of creating a problem clip', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-cancel-'));
  const sourcePath = path.join(tempDir, 'Sample_A_720P_260512_000010.mp4');

  try {
    writeFileSync(sourcePath, 'source-video', 'utf8');
    await assert.rejects(() => runAutoSegmentationStage({
      downloadedAssets: [createAsset({ sourcePath })],
      rowByTaskId: new Map([['task-1', createRow()]]),
      afterEditDirectoryPath: path.join(tempDir, 'AfterEdit'),
      problemClipsDirectoryPath: path.join(tempDir, 'ProblemClips'),
      profileId: 'standard_ad', startedAt: '2026-05-12T00:00:00.000Z', emit: () => undefined,
      dependencies: {
        mediaInfoReader: { async readMediaInfo() { return { durationSeconds: 10, width: 1920, height: 1080 }; } },
        boundaryDetector: { async detectShots() { return [
          { startSeconds: 0, endSeconds: 5 }, { startSeconds: 5, endSeconds: 10 }
        ]; } },
        continuityAnalyzer: { async analyzeBoundaries() {
          const error = new Error('cancelled'); error.name = 'AbortError'; throw error;
        } },
        segmentExporter: { async exportSegment() { throw new Error('must not export'); } }
      }
    }), (error: unknown) => error instanceof Error && error.name === 'AbortError');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('auto segmentation stops before continuity work when its signal is already aborted', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-pre-cancel-'));
  const sourcePath = path.join(tempDir, 'Sample_A_720P_260512_000010.mp4');
  const controller = new AbortController();
  let analyzerCalls = 0;
  controller.abort();

  try {
    writeFileSync(sourcePath, 'source-video', 'utf8');
    await assert.rejects(() => runAutoSegmentationStage({
      downloadedAssets: [createAsset({ sourcePath })],
      rowByTaskId: new Map([['task-1', createRow()]]),
      afterEditDirectoryPath: path.join(tempDir, 'AfterEdit'),
      problemClipsDirectoryPath: path.join(tempDir, 'ProblemClips'),
      profileId: 'standard_ad', startedAt: '2026-05-12T00:00:00.000Z',
      emit: () => undefined, signal: controller.signal,
      dependencies: {
        mediaInfoReader: { async readMediaInfo() { return { durationSeconds: 10, width: 1920, height: 1080 }; } },
        boundaryDetector: { async detectShots() { return [
          { startSeconds: 0, endSeconds: 5 }, { startSeconds: 5, endSeconds: 10 }
        ]; } },
        continuityAnalyzer: { async analyzeBoundaries() { analyzerCalls += 1; return [createContinuityDecision(5, 'strong-continuity')]; } },
        segmentExporter: { async exportSegment() { throw new Error('must not export'); } }
      }
    }), (error: unknown) => error instanceof Error && error.name === 'AbortError');
    assert.equal(analyzerCalls, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('auto segmentation routes invalid detection to problem clips', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-auto-seg-'));
  const sourcePath = path.join(tempDir, 'Sample_A_720P_260512_000010.mp4');

  try {
    writeFileSync(sourcePath, 'source-video', 'utf8');
    const result = await runAutoSegmentationStage({
      downloadedAssets: [createAsset({ sourcePath })],
      rowByTaskId: new Map([['task-1', createRow()]]),
      afterEditDirectoryPath: path.join(tempDir, 'AfterEdit'),
      problemClipsDirectoryPath: path.join(tempDir, 'ProblemClips'),
      profileId: 'standard_ad',
      startedAt: '2026-05-12T00:00:00.000Z',
      emit: () => undefined,
      dependencies: {
        mediaInfoReader: {
          async readMediaInfo() {
            return { durationSeconds: 10, width: 1920, height: 1080 };
          }
        },
        boundaryDetector: {
          async detectShots() {
            return [{ startSeconds: 8, endSeconds: 7 }];
          }
        },
        segmentExporter: {
          async exportSegment() {
            throw new Error('should not export accepted clips');
          }
        }
      }
    });

    assert.equal(result.segmentedAssets.length, 0);
    assert.equal(result.failures[0]?.errorCode, 'detection-result-invalid');
    assert.equal(result.postEditEntries[0]?.archiveState, '自动分割待处理');
    assert.equal(result.postEditEntries[0]?.failureMessage?.startsWith('检测结果异常'), true);
    assert.equal(result.problemRows[0]?.archiveState, '自动分割待处理');
    assert.equal(
      await readFile(path.join(tempDir, 'ProblemClips', 'Sample_A_720P_260512_000010_problem_01.mp4'), 'utf8'),
      'source-video'
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('auto segmentation reports the 5-60 second hard duration rule', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-short-'));
  const sourcePath = path.join(tempDir, 'Sample_A_720P_260512_000004.mp4');

  try {
    writeFileSync(sourcePath, 'source-video', 'utf8');
    const result = await runAutoSegmentationStage({
      downloadedAssets: [createAsset({ sourcePath })],
      rowByTaskId: new Map([['task-1', createRow()]]),
      afterEditDirectoryPath: path.join(tempDir, 'AfterEdit'),
      problemClipsDirectoryPath: path.join(tempDir, 'ProblemClips'),
      profileId: 'standard_ad', startedAt: '2026-05-12T00:00:00.000Z', emit: () => undefined,
      dependencies: {
        mediaInfoReader: { async readMediaInfo() { return { durationSeconds: 4, width: 1920, height: 1080 }; } },
        boundaryDetector: { async detectShots() { return []; } },
        segmentExporter: { async exportSegment(input) {
          mkdirSync(path.dirname(input.outputFilePath), { recursive: true });
          writeFileSync(input.outputFilePath, 'problem');
          return { outputFilePath: input.outputFilePath };
        } }
      }
    });

    assert.equal(result.failures[0]?.errorCode, 'duration-rule-unsatisfied');
    assert.match(result.postEditEntries[0]?.failureMessage ?? '', /^无法满足 5-60s/u);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resolves project-local scenedetect binary before shell path lookup', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-scenedetect-'));
  const binaryPath = path.join(tempDir, '.tools', 'bin', 'scenedetect');

  try {
    mkdirSync(path.dirname(binaryPath), { recursive: true });
    writeFileSync(binaryPath, '#!/usr/bin/env bash\n', 'utf8');
    chmodSync(binaryPath, 0o755);

    assert.equal(resolveSceneDetectBinaryPath(tempDir), binaryPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('falls back to scenedetect command when project-local binary is absent', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-scenedetect-'));

  try {
    assert.equal(resolveSceneDetectBinaryPath(tempDir), 'scenedetect');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createAsset(input: { readonly sourcePath: string }): DownloadedMediaAsset {
  return Object.freeze({
    mediaAssetId: 'task-1::asset',
    taskId: 'task-1',
    rowNumber: 2,
    sourceUrl: 'https://example.com/video',
    platform: 'youtube',
    filePath: input.sourcePath,
    fileName: path.basename(input.sourcePath),
    downloadedAt: '2026-05-12T00:00:00.000Z'
  });
}

function createRow(): SpreadsheetTaskRow {
  return Object.freeze({
    taskId: 'task-1',
    rowNumber: 2,
    url: 'https://example.com/video',
    sourceKind: 'url',
    values: Object.freeze({
      URL: 'https://example.com/video',
      采集人: '测试用户',
      title: 'Sample A'
    })
  });
}

function createContinuityDecision(
  boundarySeconds: number,
  classification: 'strong-continuity' | 'strong-boundary' | 'weak-or-unknown'
) {
  return {
    boundarySeconds,
    visual: { verdict: 'continuous' as const, metrics: { histogramSimilarity: 0.9, normalizedFrameDifference: 0.1 } },
    motion: { verdict: 'continuous' as const, metrics: { beforeMagnitude: 1, afterMagnitude: 1, directionCosine: 0.8, magnitudeRatio: 1 } },
    audio: { verdict: 'unknown' as const, metrics: { available: false as const } },
    classification
  };
}
