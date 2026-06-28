import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import {
  REVIEW_QUEUE_STATE_FILE_NAME,
  applyReviewQueueDecision,
  scanReviewQueueDirectory
} from '../../../../apps/web/review-queue.ts';

const xlsx = XLSX.default ?? XLSX;

test('scanReviewQueueDirectory collects ProblemClips videos as problem review items', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'review-queue-scan-'));

  try {
    mkdirSync(path.join(tempDir, 'ProblemClips'), { recursive: true });
    mkdirSync(path.join(tempDir, 'AfterEdit'), { recursive: true });
    writeFileSync(path.join(tempDir, 'ProblemClips', '样本A_720P_260626_000001_problem_01.mp4'), 'video');
    writeFileSync(path.join(tempDir, 'AfterEdit', '样本A_720P_260626_000001_01.mp4'), 'video');

    const result = await scanReviewQueueDirectory({ directoryPath: tempDir });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.phase, 'segmentation');
    assert.equal(result.items[0]?.errorCode, 'problem-clip');
    assert.equal(result.items[0]?.reason, '问题片段待复查');
    assert.equal(result.items[0]?.relativePath, 'ProblemClips/样本A_720P_260626_000001_problem_01.mp4');
    assert.equal(result.items[0]?.decision, undefined);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('applyReviewQueueDecision keeps selected problem clips in AfterEdit and writes resume spreadsheet', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'review-queue-keep-'));

  try {
    mkdirSync(path.join(tempDir, 'ProblemClips'), { recursive: true });
    const sourcePath = path.join(tempDir, 'ProblemClips', '样本A_720P_260626_000001_problem_01.mp4');
    writeFileSync(sourcePath, 'video');

    const scan = await scanReviewQueueDirectory({ directoryPath: tempDir });
    const reviewItemId = scan.items[0]?.id;
    assert.ok(reviewItemId);

    const result = await applyReviewQueueDecision({
      directoryPath: tempDir,
      reviewItemId,
      decision: 'keep-afteredit'
    });

    assert.equal(result.item.decision, 'keep-afteredit');
    assert.equal(result.item.targetPool, 'AfterEdit');
    assert.equal(result.item.nextStage, 'compress');
    assert.ok(result.afterEditSpreadsheetPath);

    const copiedPath = result.item.currentPath;
    assert.ok(copiedPath);
    assert.equal(path.dirname(copiedPath), path.join(tempDir, 'AfterEdit'));
    assert.equal(readFileSync(copiedPath, 'utf8'), 'video');
    assert.equal(existsSync(sourcePath), true);

    const workbook = xlsx.readFile(result.afterEditSpreadsheetPath);
    const matrix = xlsx.utils.sheet_to_json<(string | number)[]>(
      workbook.Sheets[workbook.SheetNames[0]!],
      { header: 1, blankrows: false, defval: '' }
    );

    assert.equal(matrix[0]?.[0], '文件名');
    assert.equal(matrix[1]?.[0], path.basename(copiedPath));
    assert.equal(matrix[1]?.[1], path.basename(copiedPath));
    assert.equal(matrix[1]?.[4], '待压缩');
    assert.equal(matrix[1]?.[12], sourcePath);
    assert.equal(matrix[1]?.[13], copiedPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('applyReviewQueueDecision moves discarded clips to managed Discarded pool', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'review-queue-discard-'));

  try {
    mkdirSync(path.join(tempDir, 'ProblemClips'), { recursive: true });
    const sourcePath = path.join(tempDir, 'ProblemClips', '样本B_720P_260626_000002_problem_01.mp4');
    writeFileSync(sourcePath, 'video');

    const scan = await scanReviewQueueDirectory({ directoryPath: tempDir });
    const reviewItemId = scan.items[0]?.id;
    assert.ok(reviewItemId);

    const result = await applyReviewQueueDecision({
      directoryPath: tempDir,
      reviewItemId,
      decision: 'discard'
    });

    assert.equal(result.item.decision, 'discard');
    assert.equal(result.item.targetPool, 'Discarded');
    assert.equal(result.item.nextStage, 'discarded');
    assert.equal(existsSync(sourcePath), false);
    assert.equal(readFileSync(result.item.currentPath, 'utf8'), 'video');
    assert.equal(path.dirname(result.item.currentPath), path.join(tempDir, 'Discarded'));

    const state = JSON.parse(
      readFileSync(path.join(tempDir, REVIEW_QUEUE_STATE_FILE_NAME), 'utf8')
    ) as { items: Record<string, { decision?: string }> };
    assert.equal(state.items[reviewItemId]?.decision, 'discard');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
