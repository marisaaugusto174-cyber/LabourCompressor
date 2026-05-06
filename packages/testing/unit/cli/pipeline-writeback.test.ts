import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';

import {
  writeCurrentRunTaggingSpreadsheet,
  writePipelineResults
} from '../../../../apps/cli/local-pipeline-helpers.ts';

const xlsx = XLSX.default ?? XLSX;

test('pipeline writeback appends structured taxonomy columns when user sheet does not contain them', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-pipeline-writeback-'));
  const spreadsheetPath = path.join(tempDir, 'tasks.xlsx');
  const archiveRoot = path.join(tempDir, 'archive-root');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['URL', '采集人'],
      ['https://example.com/video-a', '测试用户']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, spreadsheetPath);

    await writePipelineResults({
      options: {
        spreadsheet: spreadsheetPath,
        downloadDir: path.join(tempDir, 'downloads'),
        taxonomy: path.join(tempDir, 'taxonomy.md'),
        promptLibrary: path.join(tempDir, 'prompt-library.md'),
        archiveRoot,
        writebackTarget: 'user'
      },
      headers: ['URL', '采集人'],
      archiveLibraryRoot: archiveRoot,
      startedAt: '2026-05-04T10:00:00.000Z',
      results: [
        {
          rowNumber: 2,
          url: 'https://example.com/video-a',
          collector: '测试用户',
          archiveState: '已归档',
          levelValues: {
            一级标签: '内容题材: 广告营销',
            二级标签: '内容题材: 产品广告',
            三级标签: '',
            四级标签: ''
          },
          archivePath: '视频数据归档库/内容题材/广告营销/产品广告',
          archiveFileName: '样本A_720P_260504_000027.mp4',
          acceptedPaths: ['内容题材 > 广告营销 > 产品广告']
        }
      ]
    });

    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const worksheetAfterWrite = updatedWorkbook.Sheets.Sheet1!;
    const records = xlsx.utils.sheet_to_json<Record<string, string>>(
      worksheetAfterWrite,
      { defval: '' }
    );
    const linkCell = worksheetAfterWrite['I2'];

    assert.equal(records[0]?.一级标签, '内容题材: 广告营销');
    assert.equal(records[0]?.二级标签, '内容题材: 产品广告');
    assert.equal(records[0]?.归档文件名, '样本A_720P_260504_000027.mp4');
    assert.equal(Object.hasOwn(records[0] ?? {}, 'accepted_tags'), false);
    assert.equal(
      linkCell?.l?.Target,
      pathToFileURL(
        path.join(
          archiveRoot,
          '视频数据归档库/内容题材/广告营销/产品广告/样本A_720P_260504_000027.mp4'
        )
      ).toString()
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writes current-run tagging spreadsheet with standard columns and archive hyperlinks', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-current-run-sheet-'));
  const archiveRoot = path.join(tempDir, 'archive-root');
  const spreadsheetPath = path.join(tempDir, 'downloads', '本次打标结果', '本次打标结果表_task-1.xlsx');

  try {
    await writeCurrentRunTaggingSpreadsheet({
      filePath: spreadsheetPath,
      sourceSpreadsheetName: 'AfterEdit_归档记录表.xlsx',
      archiveLibraryRoot: archiveRoot,
      startedAt: '2026-05-04T10:00:00.000Z',
      results: [
        {
          rowNumber: 2,
          url: '剪辑样本_720P_260504_000027.mp4',
          collector: '测试用户',
          archiveState: '已归档',
          levelValues: {
            一级标签: '内容题材: 生活方式',
            二级标签: '内容题材: 日常记录',
            三级标签: '',
            四级标签: ''
          },
          archivePath: '视频数据归档库/内容题材/生活方式/日常记录',
          archiveFileName: '剪辑样本_720P_260504_000027.mp4',
          acceptedPaths: ['内容题材 > 生活方式 > 日常记录']
        }
      ]
    });

    const workbook = xlsx.readFile(spreadsheetPath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]!]!;
    const records = xlsx.utils.sheet_to_json<Record<string, string>>(worksheet, { defval: '' });
    const linkCell = worksheet['I2'];

    assert.deepEqual(Object.keys(records[0] ?? {}), [
      'URL',
      '采集人',
      '归档状态',
      '一级标签',
      '二级标签',
      '三级标签',
      '四级标签',
      '归档路径',
      '归档文件名'
    ]);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.URL, '剪辑样本_720P_260504_000027.mp4');
    assert.equal(records[0]?.归档状态, '已归档');
    assert.equal(linkCell?.l?.Target, pathToFileURL(
      path.join(
        archiveRoot,
        '视频数据归档库/内容题材/生活方式/日常记录/剪辑样本_720P_260504_000027.mp4'
      )
    ).toString());
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
