import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import {
  getSpreadsheetHeadersByRole,
  SPREADSHEET_SCHEMA_COLUMNS
} from '../../../features/spreadsheet-tasks/domain/index.ts';
import {
  writeTagResultsToSpreadsheet
} from '../../../adapters/spreadsheets/local-spreadsheet.ts';

const xlsx = XLSX.default ?? XLSX;

test('declares user input, visible output, and machine trace spreadsheet columns', () => {
  assert.deepEqual(getSpreadsheetHeadersByRole('user-input'), ['URL', '采集人']);
  assert.deepEqual(getSpreadsheetHeadersByRole('user-visible-output'), [
    '归档状态',
    '一级标签',
    '二级标签',
    '三级标签',
    '四级标签',
    '归档路径',
    '归档文件名',
    '失败信息'
  ]);
  assert.deepEqual(getSpreadsheetHeadersByRole('machine-trace'), [
    '文件名',
    '相对路径',
    '来源URL',
    '源文件路径',
    '当前文件路径',
    '压缩缓存路径',
    '源行号',
    '片段序号',
    '标签JSON文件',
    '错误信息'
  ]);
  assert.equal(SPREADSHEET_SCHEMA_COLUMNS.every((column) => column.header.trim().length > 0), true);
});

test('xlsx writeback expands a minimal URL sheet and hides machine trace columns', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-schema-'));
  const filePath = path.join(tempDir, 'tasks.xlsx');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['URL', '采集人'],
      ['https://example.com/a', '测试用户']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, filePath);

    writeTagResultsToSpreadsheet({
      filePath,
      updates: [
        {
          rowNumber: 2,
          columnValues: {
            归档状态: '已归档'
          }
        }
      ]
    });

    const updatedWorkbook = xlsx.readFile(filePath, { cellStyles: true });
    const updatedWorksheet = updatedWorkbook.Sheets.Sheet1!;
    const matrix = xlsx.utils.sheet_to_json<(string | number)[]>(
      updatedWorksheet,
      { header: 1, blankrows: false, defval: '' }
    );
    const headers = matrix[0]?.map(String) ?? [];

    for (const column of SPREADSHEET_SCHEMA_COLUMNS) {
      assert.equal(headers.includes(column.header), true, `missing ${column.header}`);
    }

    for (const header of getSpreadsheetHeadersByRole('machine-trace')) {
      const columnIndex = headers.indexOf(header);
      assert.notEqual(columnIndex, -1);
      assert.equal(updatedWorksheet['!cols']?.[columnIndex]?.hidden, true, `${header} should be hidden`);
    }

    for (const header of getSpreadsheetHeadersByRole('user-visible-output')) {
      const columnIndex = headers.indexOf(header);
      assert.notEqual(columnIndex, -1);
      assert.notEqual(updatedWorksheet['!cols']?.[columnIndex]?.hidden, true, `${header} should be visible`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
