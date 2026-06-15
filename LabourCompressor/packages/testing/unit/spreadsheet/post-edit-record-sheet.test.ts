import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { createPostEditArchiveRecordSpreadsheet } from '../../../adapters/spreadsheets/local-spreadsheet.ts';

const xlsx = XLSX.default ?? XLSX;

test('creates post-edit spreadsheet with 文件名 as first header and aligned file-name rows', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-afteredit-create-'));
  const filePath = path.join(tempDir, 'AfterEdit_归档记录表.xlsx');

  try {
    createPostEditArchiveRecordSpreadsheet({
      filePath,
      fileEntries: [
        {
          fileName: '样本A_720P_260427_000010.mp4',
          relativePath: 'clips/样本A_720P_260427_000010.mp4',
          originalFileName: 'export-a.mp4'
        },
        {
          fileName: '样本B_1080P_260427_000018.mp4',
          relativePath: 'clips/样本B_1080P_260427_000018.mp4',
          originalFileName: 'export-b.mp4'
        }
      ]
    });

    const workbook = xlsx.readFile(filePath);
    const matrix = xlsx.utils.sheet_to_json<(string | number)[]>(
      workbook.Sheets[workbook.SheetNames[0]!],
      { header: 1, blankrows: false, defval: '' }
    );

    assert.equal(matrix[0]?.[0], '文件名');
    assert.equal(matrix[1]?.[0], '样本A_720P_260427_000010.mp4');
    assert.equal(matrix[2]?.[0], '样本B_1080P_260427_000018.mp4');
    assert.equal(matrix[1]?.[1], 'clips/样本A_720P_260427_000010.mp4');
    assert.equal(matrix[2]?.[1], 'clips/样本B_1080P_260427_000018.mp4');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('creates post-edit spreadsheet rows with auto segmentation problem status', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-afteredit-problem-'));
  const filePath = path.join(tempDir, 'AfterEdit_归档记录表.xlsx');

  try {
    createPostEditArchiveRecordSpreadsheet({
      filePath,
      fileEntries: [
        {
          fileName: '样本A_720P_260512_000023_01.mp4',
          relativePath: 'AfterEdit/样本A_720P_260512_000023_01.mp4',
          originalFileName: '样本A_720P_260512_000045.mp4',
          sourceUrl: 'https://example.com/video'
        },
        {
          fileName: '样本A_720P_260512_000002_problem_01.mp4',
          relativePath: 'ProblemClips/样本A_720P_260512_000002_problem_01.mp4',
          originalFileName: '样本A_720P_260512_000045.mp4',
          sourceUrl: 'https://example.com/video',
          archiveState: '自动分割待处理',
          failureMessage: '无法满足 3-30s'
        }
      ]
    });

    const workbook = xlsx.readFile(filePath);
    const matrix = xlsx.utils.sheet_to_json<(string | number)[]>(
      workbook.Sheets[workbook.SheetNames[0]!],
      { header: 1, blankrows: false, defval: '' }
    );

    assert.equal(matrix[1]?.[4], '');
    assert.equal(matrix[1]?.[17], '');
    assert.equal(matrix[2]?.[4], '自动分割待处理');
    assert.equal(matrix[2]?.[17], '无法满足 3-30s');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
