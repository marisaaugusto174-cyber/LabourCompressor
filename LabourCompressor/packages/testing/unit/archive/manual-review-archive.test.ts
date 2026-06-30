import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { archiveManualReviewItem } from '../../../adapters/storage/filesystem/manual-review-archive.ts';

const xlsx = XLSX.default ?? XLSX;

test('archives manual review media beside the video library and upserts its workbook', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'manual-review-'));
  const source = path.join(root, 'source.mp4');
  try {
    await writeFile(source, 'video-content');
    const input = {
      sourceFilePath: source,
      archiveRoot: root,
      taskId: 'task-1', mediaAssetId: 'asset-1', sourceRowNumber: 2,
      sourceSpreadsheet: 'AfterEdit.xlsx', sourceUrl: 'source.mp4',
      recordedAt: '2026-06-30T00:00:00.000Z',
      sidecar: {
        systemStatus: '待人工复查',
        modelFallbackTrace: {
          primaryProfileId: 'qwen-3.7-plus', primaryErrorCode: 'DataInspectionFailed',
          primaryErrorMessage: 'rejected', fallbackStatus: 'not-configured' as const
        }
      }
    };
    const first = await archiveManualReviewItem(input);
    const second = await archiveManualReviewItem(input);

    assert.equal(first.filePath, second.filePath);
    assert.equal(path.dirname(first.filePath), path.join(root, '待人工复查'));
    const files = await readdir(path.join(root, '待人工复查'));
    assert.equal(files.filter((name) => name.endsWith('.mp4')).length, 1);
    assert.equal(files.includes('待人工复查总表.xlsx'), true);

    const workbook = xlsx.readFile(path.join(root, '待人工复查', '待人工复查总表.xlsx'));
    const rows = xlsx.utils.sheet_to_json<Record<string, string>>(workbook.Sheets['待人工复查']!);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.记录ID, 'manual-review:task-1:asset-1');
    assert.equal(rows[0]?.人工复查状态, '待复查');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preserves human review columns when updating an existing record', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'manual-review-human-'));
  const source = path.join(root, 'source.mp4');
  const sheetPath = path.join(root, '待人工复查', '待人工复查总表.xlsx');
  try {
    await writeFile(source, 'video-content');
    const input = createInput(root, source);
    await archiveManualReviewItem(input);
    const workbook = xlsx.readFile(sheetPath);
    const sheet = workbook.Sheets['待人工复查']!;
    const rows = xlsx.utils.sheet_to_json<Record<string, string>>(sheet);
    rows[0]!.人工复查状态 = '已处理';
    rows[0]!.人工标签 = '人工标签A';
    rows[0]!.备注 = '保留备注';
    workbook.Sheets['待人工复查'] = xlsx.utils.json_to_sheet(rows);
    xlsx.writeFile(workbook, sheetPath);

    await archiveManualReviewItem(input);
    const updated = xlsx.utils.sheet_to_json<Record<string, string>>(
      xlsx.readFile(sheetPath).Sheets['待人工复查']!
    )[0]!;
    assert.equal(updated.人工复查状态, '已处理');
    assert.equal(updated.人工标签, '人工标签A');
    assert.equal(updated.备注, '保留备注');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function createInput(root: string, source: string) {
  return {
    sourceFilePath: source, archiveRoot: root, taskId: 'task-1', mediaAssetId: 'asset-1',
    sourceRowNumber: 2, sourceSpreadsheet: 'AfterEdit.xlsx', sourceUrl: 'source.mp4',
    recordedAt: '2026-06-30T00:00:00.000Z',
    sidecar: {
      systemStatus: '待人工复查',
      modelFallbackTrace: {
        primaryProfileId: 'qwen-3.7-plus', primaryErrorCode: 'DataInspectionFailed',
        primaryErrorMessage: 'rejected', fallbackStatus: 'not-configured' as const
      }
    }
  };
}
