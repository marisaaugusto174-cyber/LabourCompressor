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

test('auto segmentation forced-splits a long detected scene into valid AfterEdit clips', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-auto-seg-'));
  const sourcePath = path.join(tempDir, 'Sample_A_720P_260512_000045.mp4');
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
            return { durationSeconds: 45, width: 1920, height: 1080 };
          }
        },
        boundaryDetector: {
          async detectShots() {
            return [{ startSeconds: 0, endSeconds: 45 }];
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

    assert.equal(result.segmentedAssets.length, 2);
    assert.equal(result.failures.length, 0);
    assert.deepEqual(writes.map((write) => write.endSeconds - write.startSeconds), [22.5, 22.5]);
    assert.deepEqual(result.segmentedAssets.map((asset) => asset.fileName), [
      'Sample_A_720P_260512_000023_01.mp4',
      'Sample_A_720P_260512_000023_02.mp4'
    ]);
    assert.deepEqual(result.postEditEntries.map((entry) => entry.fileName), [
      'Sample_A_720P_260512_000023_01.mp4',
      'Sample_A_720P_260512_000023_02.mp4'
    ]);
    assert.equal(
      await readFile(path.join(afterEditDirectoryPath, 'Sample_A_720P_260512_000023_01.mp4'), 'utf8'),
      '0-22.5'
    );
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
