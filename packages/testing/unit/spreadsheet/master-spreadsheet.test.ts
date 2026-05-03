import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import {
  appendRowsToMasterSpreadsheet,
  ensureMasterSpreadsheetTemplate
} from '../../../adapters/spreadsheets/local-spreadsheet.ts';

const xlsx = XLSX.default ?? XLSX;

const standardMasterHeaders = Object.freeze([
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

test('creates the internal master spreadsheet with the fixed standard template', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-master-template-'));
  const filePath = path.join(tempDir, '视频数据采集总表.xlsx');

  try {
    ensureMasterSpreadsheetTemplate(filePath);

    const workbook = xlsx.readFile(filePath);
    const matrix = xlsx.utils.sheet_to_json<(string | number)[]>(
      workbook.Sheets[workbook.SheetNames[0]!],
      { header: 1, blankrows: false, defval: '' }
    );

    assert.deepEqual(matrix[0], standardMasterHeaders);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('keeps master spreadsheet standard columns and upserts rows by URL', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-master-writeback-'));
  const filePath = path.join(tempDir, '视频数据采集总表.xlsx');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      [...standardMasterHeaders, '来源表格', '处理时间'],
      ['https://example.com/a', '旧采集人', '已下载待剪辑', '', '', '', '', '', '', '旧表.xlsx', '2026-04-26T09:00:00.000Z']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, filePath);

    appendRowsToMasterSpreadsheet({
      filePath,
      entries: [
        {
          url: 'https://example.com/a',
          collector: '测试用户',
          archiveState: '已归档',
          levelValues: {
            一级标签: '广告营销',
            二级标签: '品牌宣传',
            三级标签: '',
            四级标签: ''
          },
          archivePath: '视频数据归档库/内容题材/广告营销/品牌宣传',
          archiveFileName: {
            kind: 'hyperlink',
            label: '样本A-v2.mp4',
            target: 'file:///Users/tianyi/Desktop/视频数据归档库/内容题材/广告营销/品牌宣传/样本A-v2.mp4'
          },
          sourceSpreadsheet: '用户表.xlsx',
          processedAt: '2026-04-26T11:00:00.000Z'
        },
        {
          url: 'https://example.com/b',
          collector: '另一个用户',
          archiveState: '已下载未归档',
          levelValues: {
            一级标签: '',
            二级标签: '',
            三级标签: '',
            四级标签: ''
          },
          archivePath: '',
          archiveFileName: '',
          sourceSpreadsheet: '第二张表.xlsx',
          processedAt: '2026-04-26T11:05:00.000Z'
        }
      ]
    });

    const updatedWorkbook = xlsx.readFile(filePath);
    const worksheetAfterWrite = updatedWorkbook.Sheets[updatedWorkbook.SheetNames[0]!];
    const matrix = xlsx.utils.sheet_to_json<(string | number)[]>(
      worksheetAfterWrite,
      { header: 1, blankrows: false, defval: '' }
    );
    const records = xlsx.utils.sheet_to_json<Record<string, string>>(
      worksheetAfterWrite,
      { defval: '' }
    );

    assert.deepEqual(matrix[0], standardMasterHeaders);
    assert.equal(records.length, 2);
    assert.equal(records[0]?.URL, 'https://example.com/a');
    assert.equal(records[0]?.采集人, '测试用户');
    assert.equal(records[0]?.二级标签, '品牌宣传');
    assert.equal(records[0]?.归档文件名, '样本A-v2.mp4');
    assert.equal(Object.hasOwn(records[0] ?? {}, '来源表格'), false);
    assert.equal(Object.hasOwn(records[0] ?? {}, '处理时间'), false);
    assert.equal(records[1]?.URL, 'https://example.com/b');
    assert.equal(records[1]?.归档状态, '已下载未归档');

    const linkCell = worksheetAfterWrite?.['I2'];
    assert.equal(linkCell?.v, '样本A-v2.mp4');
    assert.equal(typeof linkCell?.l?.Target, 'string');
    assert.equal(linkCell?.l?.Target?.startsWith('file:///Users/tianyi/Desktop/'), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
