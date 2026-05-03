import { mkdirSync } from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

import {
  type MasterSpreadsheetWritebackEntry,
  type SpreadsheetCellValue,
  type SpreadsheetSheetData,
  type SpreadsheetTaskRow,
  type SpreadsheetWritebackUpdate
} from '../../features/spreadsheet-tasks/domain/index.ts';
import {
  applySpreadsheetWritebackUpdates,
  buildHyperlinkUpdatesFromMasterEntries,
  createSpreadsheetTaskRow,
  createSyntheticHeaders,
  detectHasHeaderRow,
  detectSpreadsheetFileKind,
  displayValue,
  ensureMasterSpreadsheetTemplate,
  loadWritableSpreadsheetSheet,
  MASTER_SPREADSHEET_HEADERS,
  POST_EDIT_ARCHIVE_RECORD_HEADERS,
  resolveSourceColumn,
  writeMatrixToWorksheetPreservingLayout
} from './local-spreadsheet-helpers.ts';
import {
  buildNumbersWritebackScript,
  writeTagResultsToNumbers
} from './local-spreadsheet-numbers.ts';

const xlsx = XLSX.default ?? XLSX;

export { buildNumbersWritebackScript, ensureMasterSpreadsheetTemplate };

export function readSpreadsheetTaskSheet(input: {
  readonly filePath: string;
  readonly sheetName?: string;
  readonly hasHeaderRow?: boolean;
  readonly urlColumnIndex?: number;
  readonly urlColumnName?: string;
}): SpreadsheetSheetData {
  const workbook = xlsx.readFile(input.filePath);
  const sheetName = input.sheetName ?? workbook.SheetNames[0];

  if (sheetName === undefined) {
    throw new Error('Spreadsheet must contain at least one sheet.');
  }

  const worksheet = workbook.Sheets[sheetName];

  if (worksheet === undefined) {
    throw new Error(`Spreadsheet sheet not found: "${sheetName}"`);
  }

  const matrix = xlsx.utils.sheet_to_json<(string | number)[]>(worksheet, {
    header: 1,
    blankrows: false,
    defval: ''
  });

  if (matrix.length === 0) {
    throw new Error('Spreadsheet must contain at least one row.');
  }

  const hasHeaderRow = input.hasHeaderRow ?? detectHasHeaderRow(matrix);
  const headerRow = hasHeaderRow ? matrix[0] ?? [] : [];
  const headers = hasHeaderRow
    ? headerRow.map((header, index) =>
        String(header).trim().length === 0
          ? `column_${index + 1}`
          : String(header).trim()
      )
    : createSyntheticHeaders(matrix[0]?.length ?? 0);
  const dataRows = hasHeaderRow ? matrix.slice(1) : matrix;
  const sourceColumn = resolveSourceColumn({
    headers,
    urlColumnIndex: input.urlColumnIndex,
    urlColumnName: input.urlColumnName
  });

  const rows = Object.freeze(
    dataRows
      .map((row, index) =>
        createSpreadsheetTaskRow({
          filePath: input.filePath,
          row,
          rowNumber: hasHeaderRow ? index + 2 : index + 1,
          headers,
          sourceColumn
        })
      )
      .filter((row): row is SpreadsheetTaskRow => row !== undefined)
  );

  return Object.freeze({
    filePath: input.filePath,
    fileKind: detectSpreadsheetFileKind(input.filePath),
    sheetName,
    headers: Object.freeze(headers),
    rows
  });
}

export function writeTagResultsToSpreadsheet(input: {
  readonly filePath: string;
  readonly updates: readonly SpreadsheetWritebackUpdate[];
  readonly sheetName?: string;
  readonly acceptedTagsColumnName?: string;
}): void {
  const fileKind = detectSpreadsheetFileKind(input.filePath);

  if (fileKind === 'numbers') {
    writeTagResultsToNumbers(input);
    return;
  }

  const writableSheet = loadWritableSpreadsheetSheet(input.filePath, input.sheetName);
  const resolvedSheet = applySpreadsheetWritebackUpdates({
    matrix: writableSheet.matrix,
    acceptedTagsColumnName: input.acceptedTagsColumnName,
    updates: input.updates
  });

  if (fileKind === 'csv') {
    writableSheet.workbook.Sheets[writableSheet.sheetName] = xlsx.utils.aoa_to_sheet(
      resolvedSheet.matrix
    );
    xlsx.writeFile(writableSheet.workbook, input.filePath);
    return;
  }

  writeMatrixToWorksheetPreservingLayout({
    worksheet: writableSheet.worksheet,
    matrix: resolvedSheet.matrix,
    hyperlinks: resolvedSheet.hyperlinks
  });
  xlsx.writeFile(writableSheet.workbook, input.filePath);
}

export function appendRowsToMasterSpreadsheet(input: {
  readonly filePath: string;
  readonly entries: readonly MasterSpreadsheetWritebackEntry[];
  readonly sheetName?: string;
}): void {
  if (input.entries.length === 0) {
    return;
  }

  const fileKind = detectSpreadsheetFileKind(input.filePath);

  if (fileKind !== 'xlsx') {
    throw new Error('Master spreadsheet must be an xlsx file.');
  }

  ensureMasterSpreadsheetTemplate(input.filePath, input.sheetName);
  const writableSheet = loadWritableSpreadsheetSheet(input.filePath, input.sheetName);
  const existingHeaders = writableSheet.matrix[0]?.map((value) => String(value).trim()) ?? [];
  const headers = [...MASTER_SPREADSHEET_HEADERS];
  const matrix: (string | number)[][] = [
    [...headers],
    ...writableSheet.matrix.slice(1).map((existingRow) =>
      headers.map((header) => {
        const existingColumnIndex = existingHeaders.indexOf(header);
        return existingColumnIndex === -1
          ? ''
          : displayValue(existingRow[existingColumnIndex] ?? '');
      })
    )
  ];

  const urlColumnIndex = headers.indexOf('URL');
  const rowIndexByUrl = new Map<string, number>();

  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const rowUrl = String(matrix[rowIndex]?.[urlColumnIndex] ?? '').trim();

    if (rowUrl.length > 0) {
      rowIndexByUrl.set(rowUrl, rowIndex);
    }
  }

  for (const entry of input.entries) {
    let rowIndex = rowIndexByUrl.get(entry.url);

    if (rowIndex === undefined) {
      rowIndex = matrix.length;
      matrix.push(Array.from({ length: headers.length }, () => ''));
      rowIndexByUrl.set(entry.url, rowIndex);
    }

    const row = matrix[rowIndex] ?? Array.from({ length: headers.length }, () => '');
    matrix[rowIndex] = row;

    const hyperlinkColumnValues: Readonly<Record<string, SpreadsheetCellValue>> = {
      URL: entry.url,
      采集人: entry.collector,
      归档状态: entry.archiveState,
      一级标签: entry.levelValues['一级标签'] ?? '',
      二级标签: entry.levelValues['二级标签'] ?? '',
      三级标签: entry.levelValues['三级标签'] ?? '',
      四级标签: entry.levelValues['四级标签'] ?? '',
      归档路径: entry.archivePath,
      归档文件名: entry.archiveFileName
    };

    for (const [header, value] of Object.entries(hyperlinkColumnValues)) {
      const columnIndex = headers.indexOf(header);
      row[columnIndex] = displayValue(value);
    }
  }

  const hyperlinks = buildHyperlinkUpdatesFromMasterEntries({
    headers,
    matrix,
    entries: input.entries
  });

  writeMatrixToWorksheetPreservingLayout({
    worksheet: writableSheet.worksheet,
    matrix,
    hyperlinks
  });
  xlsx.writeFile(writableSheet.workbook, input.filePath);
}
export interface PostEditArchiveRecordFileEntry {
  readonly fileName: string;
  readonly relativePath?: string;
  readonly originalFileName?: string;
  readonly sourceUrl?: string;
}

export function createPostEditArchiveRecordSpreadsheet(input: {
  readonly filePath: string;
  readonly fileNames?: readonly string[];
  readonly fileEntries?: readonly PostEditArchiveRecordFileEntry[];
  readonly sheetName?: string;
}): void {
  const fileEntries =
    input.fileEntries ??
    input.fileNames?.map((fileName) => Object.freeze({ fileName })) ??
    [];

  mkdirSync(path.dirname(input.filePath), { recursive: true });
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.aoa_to_sheet([
    POST_EDIT_ARCHIVE_RECORD_HEADERS,
    ...fileEntries.map((entry) => [
      entry.fileName,
      entry.relativePath ?? entry.fileName,
      entry.originalFileName ?? entry.fileName,
      entry.sourceUrl ?? '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ])
  ]);
  xlsx.utils.book_append_sheet(workbook, worksheet, input.sheetName ?? 'Sheet1');
  xlsx.writeFile(workbook, input.filePath);
}
