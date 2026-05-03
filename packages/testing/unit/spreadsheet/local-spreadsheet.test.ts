import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import ZAHL from 'xlsx/dist/xlsx.zahl.mjs';

import {
  buildNumbersWritebackScript,
  createPostEditArchiveRecordSpreadsheet,
  readSpreadsheetTaskSheet,
  writeTagResultsToSpreadsheet
} from '../../../adapters/spreadsheets/local-spreadsheet.ts';

const xlsx = XLSX.default ?? XLSX;

test('reads csv spreadsheet tasks with header row', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-csv-'));
  const filePath = path.join(tempDir, 'tasks.csv');

  try {
    writeFileSync(filePath, 'url,title\nhttps://example.com/a,Sample A\n');

    const sheet = readSpreadsheetTaskSheet({
      filePath,
      urlColumnName: 'url'
    });

    assert.equal(sheet.fileKind, 'csv');
    assert.equal(sheet.rows.length, 1);
    assert.equal(sheet.rows[0]?.url, 'https://example.com/a');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('reads csv spreadsheet tasks from first column when header is blank', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-csv-blank-'));
  const filePath = path.join(tempDir, 'tasks.csv');

  try {
    writeFileSync(
      filePath,
      'https://example.com/a,,,\nhttps://example.com/b,,,\n'
    );

    const sheet = readSpreadsheetTaskSheet({
      filePath,
      urlColumnIndex: 0
    });

    assert.equal(sheet.fileKind, 'csv');
    assert.equal(sheet.rows.length, 2);
    assert.equal(sheet.rows[0]?.url, 'https://example.com/a');
    assert.equal(sheet.rows[1]?.url, 'https://example.com/b');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('skips non-url placeholder rows in spreadsheet input', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-csv-placeholder-'));
  const filePath = path.join(tempDir, 'tasks.csv');

  try {
    writeFileSync(
      filePath,
      'URL,备注\n请填写有效完整链接,模板说明\nhttps://example.com/a,有效任务\n'
    );

    const sheet = readSpreadsheetTaskSheet({
      filePath,
      urlColumnIndex: 0
    });

    assert.equal(sheet.rows.length, 1);
    assert.equal(sheet.rows[0]?.url, 'https://example.com/a');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writes accepted tags back to csv without header by inserting synthetic header row', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-csv-writeback-'));
  const filePath = path.join(tempDir, 'tasks.csv');

  try {
    writeFileSync(
      filePath,
      'https://example.com/a,,,\nhttps://example.com/b,,,\n'
    );

    writeTagResultsToSpreadsheet({
      filePath,
      updates: [
        {
          rowNumber: 1,
          acceptedPaths: ['内容题材 > 广告营销 > 产品广告']
        }
      ]
    });

    const updatedWorkbook = xlsx.readFile(filePath);
    const updatedSheet = xlsx.utils.sheet_to_json<(string | number)[]>(
      updatedWorkbook.Sheets[updatedWorkbook.SheetNames[0]!],
      {
        header: 1,
        blankrows: false,
        defval: ''
      }
    );

    assert.equal(String(updatedSheet[0]?.[0] ?? ''), 'column_1');
    assert.equal(String(updatedSheet[0]?.includes('accepted_tags')), 'true');
    assert.equal(String(updatedSheet[1]?.[0] ?? ''), 'https://example.com/a');
    assert.equal(
      updatedSheet[1]?.includes('内容题材 > 广告营销 > 产品广告'),
      true
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writes accepted tags back to xlsx spreadsheet', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-xlsx-'));
  const filePath = path.join(tempDir, 'tasks.xlsx');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['url', 'title'],
      ['https://example.com/a', 'Sample A']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, filePath);

    writeTagResultsToSpreadsheet({
      filePath,
      updates: [
        {
          rowNumber: 2,
          acceptedPaths: ['主体对象 > 人物 > 年龄']
        }
      ]
    });

    const updatedWorkbook = xlsx.readFile(filePath);
    const updatedSheet = xlsx.utils.sheet_to_json<(string | number)[]>(
      updatedWorkbook.Sheets.Sheet1,
      {
        header: 1,
        blankrows: false,
        defval: ''
      }
    );

    assert.equal(updatedSheet[0]?.includes('accepted_tags'), true);
    assert.equal(
      updatedSheet[1]?.includes('主体对象 > 人物 > 年龄'),
      true
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('reads numbers spreadsheet tasks', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-numbers-'));
  const filePath = path.join(tempDir, 'tasks.numbers');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['URL', '标题', 'accepted_tags'],
      ['https://example.com/a', 'Sample A', '']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, filePath, {
      numbers: ZAHL,
      compression: true
    });

    const sheet = readSpreadsheetTaskSheet({
      filePath,
      urlColumnIndex: 0
    });

    assert.equal(sheet.fileKind, 'numbers');
    assert.equal(sheet.rows.length, 1);
    assert.equal(sheet.rows[0]?.url, 'https://example.com/a');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('reads post-edit spreadsheet rows from 文件名 first column', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-afteredit-read-'));
  const filePath = path.join(tempDir, 'AfterEdit_归档记录表.xlsx');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['文件名', '归档状态'],
      ['样本A_720P_260427_000010.mp4', ''],
      ['样本B_1080P_260427_000018.mov', '已归档']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, filePath);

    const sheet = readSpreadsheetTaskSheet({
      filePath,
      urlColumnIndex: 0
    });

    assert.equal(sheet.rows.length, 2);
    assert.equal(sheet.rows[0]?.sourceKind, 'local-file');
    assert.equal(sheet.rows[0]?.sourceFileName, '样本A_720P_260427_000010.mp4');
    assert.equal(sheet.rows[0]?.url, '样本A_720P_260427_000010.mp4');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('reads post-edit spreadsheet relative paths for local file lookup', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-afteredit-read-'));
  const filePath = path.join(tempDir, 'AfterEdit_归档记录表.xlsx');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['文件名', '相对路径', '原始文件名', '来源URL', '归档状态'],
      ['样本A_720P_260427_000010.mp4', 'clips/样本A_720P_260427_000010.mp4', 'export-1.mp4', '', '']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, filePath);

    const sheet = readSpreadsheetTaskSheet({
      filePath,
      urlColumnIndex: 0
    });

    assert.equal(sheet.rows.length, 1);
    assert.equal(sheet.rows[0]?.sourceKind, 'local-file');
    assert.equal(sheet.rows[0]?.sourceFileName, '样本A_720P_260427_000010.mp4');
    assert.equal(sheet.rows[0]?.sourceFileRelativePath, 'clips/样本A_720P_260427_000010.mp4');
    assert.equal(sheet.rows[0]?.url, '样本A_720P_260427_000010.mp4');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('builds apple script writeback commands for numbers documents', () => {
  const script = buildNumbersWritebackScript({
    documentPath: '/tmp/tasks.numbers',
    sheetName: 'Sheet 1',
    headers: ['URL', '归档状态', '一级标签'],
    acceptedTagsColumnName: 'accepted_tags',
    updates: [
      {
        rowNumber: 3,
        columnValues: {
          归档状态: '已归档',
          一级标签: '动画'
        }
      }
    ]
  });

  assert.equal(script.includes('tell application "Numbers"'), true);
  assert.equal(script.includes('set value of cell 2 of row 3 to "已归档"'), true);
  assert.equal(script.includes('set value of cell 3 of row 3 to "动画"'), true);
});

test('builds apple script plain filename writeback for numbers hyperlink cells', () => {
  const script = buildNumbersWritebackScript({
    documentPath: '/tmp/tasks.numbers',
    sheetName: 'Sheet 1',
    headers: ['URL', '归档路径', '归档文件名'],
    acceptedTagsColumnName: 'accepted_tags',
    updates: [
      {
        rowNumber: 3,
        columnValues: {
          归档路径: '视频数据归档库/内容题材/动画/2D动画',
          归档文件名: {
            kind: 'hyperlink',
            label: '刷短视频现状_720P_260426_000026.mp4',
            target: 'file:///Users/tianyi/Desktop/视频数据归档库/内容题材/动画/2D动画/刷短视频现状_720P_260426_000026.mp4'
          }
        }
      }
    ]
  });

  assert.equal(script.includes('set value of cell 3 of row 3 to "刷短视频现状_720P_260426_000026.mp4"'), true);
  assert.equal(script.includes('刷短视频现状_720P_260426_000026.mp4'), true);
});

test('writes structured taxonomy columns without adding accepted_tags when explicit column values are provided', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-structured-writeback-'));
  const filePath = path.join(tempDir, 'tasks.xlsx');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['URL', '采集人', '归档状态', '一级标签', '二级标签', '三级标签', '四级标签', '归档路径'],
      ['https://example.com/a', '测试用户', '', '', '', '', '', '']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, filePath);

    writeTagResultsToSpreadsheet({
      filePath,
      updates: [
        {
          rowNumber: 2,
          columnValues: {
            归档状态: '已归档',
            一级标签: '广告营销',
            二级标签: '产品广告',
            三级标签: '前端开发',
            四级标签: '',
            归档路径: '视频数据归档库/内容题材/广告营销/产品广告/前端开发'
          }
        }
      ]
    });

    const updatedSheet = readSpreadsheetTaskSheet({
      filePath,
      urlColumnIndex: 0
    });

    assert.equal(updatedSheet.headers.includes('accepted_tags'), false);
    assert.equal(updatedSheet.rows[0]?.values['归档状态'], '已归档');
    assert.equal(updatedSheet.rows[0]?.values['一级标签'], '广告营销');
    assert.equal(updatedSheet.rows[0]?.values['二级标签'], '产品广告');
    assert.equal(updatedSheet.rows[0]?.values['三级标签'], '前端开发');
    assert.equal(
      updatedSheet.rows[0]?.values['归档路径'],
      '视频数据归档库/内容题材/广告营销/产品广告/前端开发'
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writes hyperlink cells back to xlsx structured columns', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-hyperlink-writeback-'));
  const filePath = path.join(tempDir, 'tasks.xlsx');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['URL', '归档状态', '一级标签', '二级标签', '三级标签', '四级标签', '归档路径'],
      ['https://example.com/a', '', '', '', '', '', '']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, filePath);

    writeTagResultsToSpreadsheet({
      filePath,
      updates: [
        {
          rowNumber: 2,
          columnValues: {
            归档状态: '已归档',
            一级标签: '内容题材: 动画',
            二级标签: '内容题材: 2D动画',
            三级标签: '',
            四级标签: '',
            归档路径: '视频数据归档库/内容题材/动画/2D动画',
            归档文件名: {
              kind: 'hyperlink',
              label: '刷短视频现状_720P_260426_000026.mp4',
              target: 'file:///Users/tianyi/Desktop/视频数据归档库/内容题材/动画/2D动画/刷短视频现状_720P_260426_000026.mp4'
            }
          }
        }
      ]
    });

    const updatedWorkbook = xlsx.readFile(filePath);
    const updatedWorksheet = updatedWorkbook.Sheets.Sheet1!;
    const fileNameCell = updatedWorksheet['H2'];

    assert.equal(updatedWorksheet['H1']?.v, '归档文件名');
    assert.equal(fileNameCell?.v, '刷短视频现状_720P_260426_000026.mp4');
    assert.equal(typeof fileNameCell?.l?.Target, 'string');
    assert.equal(fileNameCell?.l?.Target?.startsWith('file:///Users/tianyi/Desktop/'), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('creates a post-edit archive record spreadsheet from file names', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-afteredit-sheet-'));
  const filePath = path.join(tempDir, 'AfterEdit_归档记录表.xlsx');

  try {
    createPostEditArchiveRecordSpreadsheet({
      filePath,
      fileEntries: Object.freeze([
        {
          fileName: '样本A_720P_260427_000010.mp4',
          relativePath: 'clips/样本A_720P_260427_000010.mp4',
          originalFileName: 'export-a.mp4'
        },
        {
          fileName: '样本B_1080P_260427_000018.mov',
          relativePath: 'clips/样本B_1080P_260427_000018.mov',
          originalFileName: 'export-b.mov'
        }
      ])
    });

    const workbook = xlsx.readFile(filePath);
    const updatedSheet = xlsx.utils.sheet_to_json<(string | number)[]>(
      workbook.Sheets[workbook.SheetNames[0]!],
      { header: 1, blankrows: false, defval: '' }
    );

    assert.equal(updatedSheet[0]?.[0], '文件名');
    assert.equal(updatedSheet[0]?.[1], '相对路径');
    assert.equal(updatedSheet[0]?.[2], '原始文件名');
    assert.equal(updatedSheet[0]?.[3], '来源URL');
    assert.equal(updatedSheet[1]?.[0], '样本A_720P_260427_000010.mp4');
    assert.equal(updatedSheet[1]?.[1], 'clips/样本A_720P_260427_000010.mp4');
    assert.equal(updatedSheet[1]?.[2], 'export-a.mp4');
    assert.equal(updatedSheet[2]?.[0], '样本B_1080P_260427_000018.mov');
    assert.equal(updatedSheet[1]?.length, 12);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
