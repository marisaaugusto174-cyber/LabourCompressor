import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

import {
  type MasterSpreadsheetWritebackEntry,
  SPREADSHEET_SCHEMA_COLUMNS,
  type SpreadsheetAppendRow,
  type SpreadsheetCellValue,
  type SpreadsheetTaskRow,
  type SpreadsheetWritebackUpdate
} from '../../features/spreadsheet-tasks/domain/index.ts';

const xlsx = XLSX.default ?? XLSX;

export interface WritableSpreadsheetSheet {
  readonly workbook: XLSX.WorkBook;
  readonly sheetName: string;
  readonly worksheet: XLSX.WorkSheet;
  readonly matrix: (string | number)[][];
}

export interface SpreadsheetHyperlinkUpdate {
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly label: string;
  readonly target: string;
}

const MACHINE_TRACE_HEADERS = new Set(
  SPREADSHEET_SCHEMA_COLUMNS
    .filter((column) => column.role === 'machine-trace')
    .map((column) => column.header)
);

export const MASTER_SPREADSHEET_HEADERS = Object.freeze([
  'URL',
  '采集人',
  '归档状态',
  '一级标签',
  '二级标签',
  '三级标签',
  '四级标签',
  '归档路径',
  '归档文件名',
  '标签JSON文件',
  '源文件路径',
  '当前文件路径',
  '压缩缓存路径',
  '源行号',
  '片段序号',
  '错误信息'
]);

export const POST_EDIT_ARCHIVE_RECORD_HEADERS = Object.freeze([
  '文件名',
  '相对路径',
  '原始文件名',
  '来源URL',
  '归档状态',
  '一级标签',
  '二级标签',
  '三级标签',
  '四级标签',
  '归档路径',
  '归档文件名',
  '标签JSON文件',
  '源文件路径',
  '当前文件路径',
  '压缩缓存路径',
  '源行号',
  '片段序号',
  '失败信息',
  '错误信息'
]);

export function detectSpreadsheetFileKind(
  filePath: string
): 'csv' | 'xlsx' | 'numbers' {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.csv') {
    return 'csv';
  }

  if (extension === '.numbers') {
    return 'numbers';
  }

  return 'xlsx';
}

export function createSyntheticHeaders(length: number): readonly string[] {
  return Object.freeze(
    Array.from({ length }, (_, index) => `column_${index + 1}`)
  );
}

export function detectHasHeaderRow(
  matrix: readonly (readonly (string | number)[])[]
): boolean {
  const firstRow = matrix[0] ?? [];
  const firstCell = String(firstRow[0] ?? '').trim();

  if (firstRow.every((value) => String(value).trim().length === 0)) {
    return false;
  }

  if (/^https?:\/\//u.test(firstCell)) {
    return false;
  }

  return true;
}

export function resolveSourceColumn(input: {
  readonly headers: readonly string[];
  readonly urlColumnIndex?: number;
  readonly urlColumnName?: string;
}): Readonly<{
  readonly kind: 'url' | 'local-file';
  readonly index: number;
}> {
  if (input.urlColumnName !== undefined) {
    const index = input.headers.findIndex(
      (header) => header === input.urlColumnName
    );

    if (index === -1) {
      throw new Error(
        `Spreadsheet URL column not found: "${input.urlColumnName}"`
      );
    }

    return Object.freeze({
      kind: 'url',
      index
    });
  }

  const explicitUrlColumnIndex = input.headers.findIndex((header) =>
    header === 'URL' || header.toLowerCase() === 'url'
  );

  if (explicitUrlColumnIndex !== -1) {
    return Object.freeze({
      kind: 'url',
      index: explicitUrlColumnIndex
    });
  }

  const fileNameColumnIndex = input.headers.findIndex((header) => header === '文件名');

  if (fileNameColumnIndex !== -1) {
    return Object.freeze({
      kind: 'local-file',
      index: fileNameColumnIndex
    });
  }

  return Object.freeze({
    kind: 'url',
    index: input.urlColumnIndex ?? 0
  });
}

export function createSpreadsheetTaskRow(input: {
  readonly filePath: string;
  readonly row: readonly (string | number)[];
  readonly rowNumber: number;
  readonly headers: readonly string[];
  readonly sourceColumn: Readonly<{
    readonly kind: 'url' | 'local-file';
    readonly index: number;
  }>;
}): SpreadsheetTaskRow | undefined {
  const values = Object.fromEntries(
    input.headers.map((header, index) => [
      header,
      String(input.row[index] ?? '').trim()
    ])
  );
  const sourceValue = values[input.headers[input.sourceColumn.index] ?? ''] ?? '';
  const localFilePath =
    input.sourceColumn.kind === 'url'
      ? normalizeLocalFileSourceValue(sourceValue)
      : undefined;

  if (
    input.sourceColumn.kind === 'url' &&
    !/^https?:\/\//u.test(sourceValue) &&
    localFilePath === undefined
  ) {
    return undefined;
  }

  if (input.sourceColumn.kind === 'local-file' && sourceValue.length === 0) {
    return undefined;
  }

  return Object.freeze({
    taskId: `${path.basename(input.filePath)}::row-${input.rowNumber}`,
    rowNumber: input.rowNumber,
    url: sourceValue,
    sourceKind:
      input.sourceColumn.kind === 'url' && localFilePath !== undefined
        ? 'local-file'
        : input.sourceColumn.kind,
    sourceFileName:
      input.sourceColumn.kind === 'local-file'
        ? sourceValue
        : localFilePath,
    sourceFileRelativePath:
      input.sourceColumn.kind === 'local-file'
        ? normalizeOptionalCellValue(values['相对路径'])
        : undefined,
    values: Object.freeze(values)
  });
}

function normalizeLocalFileSourceValue(value: string): string | undefined {
  const normalized = value.trim();

  if (normalized.length === 0) {
    return undefined;
  }

  if (normalized.startsWith('file://')) {
    try {
      return fileURLToPath(normalized);
    } catch {
      return undefined;
    }
  }

  return path.isAbsolute(normalized) ? normalized : undefined;
}

function normalizeOptionalCellValue(value: string | undefined): string | undefined {
  const normalized = value?.trim() ?? '';
  return normalized.length === 0 ? undefined : normalized;
}

export function loadWritableSpreadsheetSheet(
  filePath: string,
  requestedSheetName?: string
): WritableSpreadsheetSheet {
  const workbook = xlsx.readFile(filePath);
  const sheetName = requestedSheetName ?? workbook.SheetNames[0];

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
    throw new Error('Spreadsheet must contain a header row for writeback.');
  }

  return {
    workbook,
    sheetName,
    worksheet,
    matrix: matrix.map((row) => [...row])
  };
}

export function applySpreadsheetWritebackUpdates(input: {
  readonly matrix: (string | number)[][];
  readonly updates: readonly SpreadsheetWritebackUpdate[];
  readonly acceptedTagsColumnName?: string;
}): {
  readonly matrix: (string | number)[][];
  readonly hyperlinks: readonly SpreadsheetHyperlinkUpdate[];
} {
  const matrix = input.matrix.map((row) => [...row]);
  const hyperlinks: SpreadsheetHyperlinkUpdate[] = [];
  const hasHeaderRow = detectHasHeaderRow(matrix);

  if (!hasHeaderRow) {
    matrix.unshift([...createSyntheticHeaders(matrix[0]?.length ?? 0)]);
  }

  const headers = matrix[0]!.map((value) => String(value).trim());
  const acceptedTagsColumnName = input.acceptedTagsColumnName ?? 'accepted_tags';
  const shouldWriteAcceptedTags = input.updates.some(
    (update) => update.acceptedPaths !== undefined
  );
  let acceptedTagsColumnIndex = -1;

  if (shouldWriteAcceptedTags) {
    acceptedTagsColumnIndex = headers.findIndex(
      (header) => header === acceptedTagsColumnName
    );

    if (acceptedTagsColumnIndex === -1) {
      matrix[0]!.push(acceptedTagsColumnName);
      headers.push(acceptedTagsColumnName);
      acceptedTagsColumnIndex = headers.length - 1;
    }
  }

  for (const update of input.updates) {
    const targetRow = matrix[
      hasHeaderRow ? update.rowNumber - 1 : update.rowNumber
    ];

    if (targetRow === undefined) {
      throw new Error(
        `Spreadsheet writeback row does not exist: ${update.rowNumber}`
      );
    }

    if (shouldWriteAcceptedTags && update.acceptedPaths !== undefined) {
      targetRow[acceptedTagsColumnIndex] = update.acceptedPaths.join(' | ');
    }

    for (const [columnName, value] of Object.entries(update.columnValues ?? {})) {
      let columnIndex = headers.findIndex((header) => header === columnName);

      if (columnIndex === -1) {
        matrix[0]!.push(columnName);
        headers.push(columnName);
        columnIndex = headers.length - 1;
      }

      targetRow[columnIndex] = displayValue(value);

      if (isHyperlinkValue(value)) {
        hyperlinks.push({
          rowIndex: hasHeaderRow ? update.rowNumber - 1 : update.rowNumber,
          columnIndex,
          label: value.label,
          target: value.target
        });
      }
    }
  }

  return { matrix, hyperlinks: Object.freeze(hyperlinks) };
}

export function appendSpreadsheetRows(input: {
  readonly matrix: (string | number)[][];
  readonly rows: readonly SpreadsheetAppendRow[];
}): {
  readonly matrix: (string | number)[][];
  readonly hyperlinks: readonly SpreadsheetHyperlinkUpdate[];
} {
  const matrix = input.matrix.map((row) => [...row]);
  const hyperlinks: SpreadsheetHyperlinkUpdate[] = [];

  if (input.rows.length === 0) {
    return { matrix, hyperlinks: Object.freeze([]) };
  }

  const hasHeaderRow = detectHasHeaderRow(matrix);

  if (!hasHeaderRow) {
    matrix.unshift([...createSyntheticHeaders(matrix[0]?.length ?? 0)]);
  }

  const headers = matrix[0]!.map((value) => String(value).trim());

  for (const rowValues of input.rows) {
    for (const columnName of Object.keys(rowValues)) {
      if (!headers.includes(columnName)) {
        matrix[0]!.push(columnName);
        headers.push(columnName);
      }
    }

    const rowIndex = matrix.length;
    const nextRow = Array.from({ length: headers.length }, () => '');

    for (const [columnName, value] of Object.entries(rowValues)) {
      const columnIndex = headers.indexOf(columnName);
      nextRow[columnIndex] = displayValue(value);

      if (isHyperlinkValue(value)) {
        hyperlinks.push({
          rowIndex,
          columnIndex,
          label: value.label,
          target: value.target
        });
      }
    }

    matrix.push(nextRow);
  }

  return { matrix, hyperlinks: Object.freeze(hyperlinks) };
}

export function ensureSpreadsheetSchemaColumns(
  matrix: (string | number)[][]
): (string | number)[][] {
  const nextMatrix = matrix.map((row) => [...row]);

  if (nextMatrix.length === 0) {
    nextMatrix.push([]);
  }

  const hasHeaderRow = detectHasHeaderRow(nextMatrix);

  if (!hasHeaderRow) {
    nextMatrix.unshift([...createSyntheticHeaders(nextMatrix[0]?.length ?? 0)]);
  }

  const headers = nextMatrix[0]!.map((value) => String(value).trim());
  const isLocalFileSheet =
    headers.includes('文件名') &&
    !headers.some((header) => header === 'URL' || header.toLowerCase() === 'url');

  for (const column of SPREADSHEET_SCHEMA_COLUMNS) {
    if (isLocalFileSheet && column.header === 'URL') {
      continue;
    }

    if (!headers.includes(column.header)) {
      nextMatrix[0]!.push(column.header);
      headers.push(column.header);
    }
  }

  return nextMatrix;
}

export function writeMatrixToWorksheetPreservingLayout(input: {
  readonly worksheet: XLSX.WorkSheet;
  readonly matrix: readonly (readonly (string | number)[])[];
  readonly hyperlinks?: readonly SpreadsheetHyperlinkUpdate[];
}): void {
  const currentRange = input.worksheet['!ref']
    ? xlsx.utils.decode_range(input.worksheet['!ref'])
    : {
        s: { r: 0, c: 0 },
        e: { r: 0, c: 0 }
      };
  const nextRange = {
    s: { r: 0, c: 0 },
    e: {
      r: Math.max(0, input.matrix.length - 1),
      c: Math.max(
        0,
        ...input.matrix.map((row) => Math.max(0, row.length - 1))
      )
    }
  };

  for (let rowIndex = 0; rowIndex < input.matrix.length; rowIndex += 1) {
    const row = input.matrix[rowIndex] ?? [];

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cellAddress = xlsx.utils.encode_cell({
        r: rowIndex,
        c: columnIndex
      });
      const value = row[columnIndex] ?? '';
      const existingCell = input.worksheet[cellAddress] as XLSX.CellObject | undefined;
      const nextCell: XLSX.CellObject = existingCell ?? { t: 's', v: '' };

      if (typeof value === 'number') {
        nextCell.t = 'n';
        nextCell.v = value;
      } else {
        nextCell.t = 's';
        nextCell.v = String(value);
      }

      delete nextCell.l;
      delete nextCell.w;
      input.worksheet[cellAddress] = nextCell;
    }
  }

  for (const hyperlink of input.hyperlinks ?? []) {
    const cellAddress = xlsx.utils.encode_cell({
      r: hyperlink.rowIndex,
      c: hyperlink.columnIndex
    });
    const existingCell = input.worksheet[cellAddress] as XLSX.CellObject | undefined;
    const nextCell: XLSX.CellObject = existingCell ?? { t: 's', v: hyperlink.label };
    nextCell.t = 's';
    nextCell.v = hyperlink.label;
    nextCell.l = {
      Target: hyperlink.target,
      Tooltip: hyperlink.target
    };
    delete nextCell.w;
    input.worksheet[cellAddress] = nextCell;
  }

  for (let rowIndex = nextRange.e.r + 1; rowIndex <= currentRange.e.r; rowIndex += 1) {
    for (let columnIndex = currentRange.s.c; columnIndex <= currentRange.e.c; columnIndex += 1) {
      delete input.worksheet[xlsx.utils.encode_cell({ r: rowIndex, c: columnIndex })];
    }
  }

  input.worksheet['!ref'] = xlsx.utils.encode_range(nextRange);
}

export function applySpreadsheetSchemaColumnLayout(input: {
  readonly worksheet: XLSX.WorkSheet;
  readonly headers: readonly string[];
}): void {
  const existingColumns = input.worksheet['!cols'] ?? [];
  const nextColumns = [...existingColumns];

  for (const [columnIndex, header] of input.headers.entries()) {
    if (!MACHINE_TRACE_HEADERS.has(header)) {
      continue;
    }

    nextColumns[columnIndex] = {
      ...(nextColumns[columnIndex] ?? {}),
      hidden: true
    };
  }

  input.worksheet['!cols'] = nextColumns;
}

export function ensureMasterSpreadsheetTemplate(
  filePath: string,
  sheetName?: string
): void {
  if (existsSync(filePath)) {
    return;
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.aoa_to_sheet([MASTER_SPREADSHEET_HEADERS]);
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName ?? 'Sheet1');
  xlsx.writeFile(workbook, filePath);
}

export function buildHyperlinkUpdatesFromMasterEntries(input: {
  readonly headers: readonly string[];
  readonly matrix: readonly (readonly (string | number)[])[];
  readonly entries: readonly MasterSpreadsheetWritebackEntry[];
}): readonly SpreadsheetHyperlinkUpdate[] {
  const rowIndexByUrl = new Map<string, number>();
  const urlColumnIndex = input.headers.indexOf('URL');
  const archiveFileColumnIndex = input.headers.indexOf('归档文件名');
  const taggingJsonColumnIndex = input.headers.indexOf('标签JSON文件');

  if (urlColumnIndex === -1 || archiveFileColumnIndex === -1) {
    return Object.freeze([]);
  }

  for (let rowIndex = 1; rowIndex < input.matrix.length; rowIndex += 1) {
    const url = String(input.matrix[rowIndex]?.[urlColumnIndex] ?? '').trim();
    if (url.length > 0) {
      rowIndexByUrl.set(url, rowIndex);
    }
  }

  const hyperlinks: SpreadsheetHyperlinkUpdate[] = [];

  for (const entry of input.entries) {
    const rowIndex = rowIndexByUrl.get(entry.url);
    if (rowIndex === undefined || !isHyperlinkValue(entry.archiveFileName)) {
      continue;
    }

    hyperlinks.push({
      rowIndex,
      columnIndex: archiveFileColumnIndex,
      label: entry.archiveFileName.label,
      target: entry.archiveFileName.target
    });

    if (
      taggingJsonColumnIndex !== -1 &&
      entry.taggingJsonFileName !== undefined &&
      isHyperlinkValue(entry.taggingJsonFileName)
    ) {
      hyperlinks.push({
        rowIndex,
        columnIndex: taggingJsonColumnIndex,
        label: entry.taggingJsonFileName.label,
        target: entry.taggingJsonFileName.target
      });
    }
  }

  return Object.freeze(hyperlinks);
}

export function isHyperlinkValue(value: SpreadsheetCellValue): value is Readonly<{
  readonly kind: 'hyperlink';
  readonly label: string;
  readonly target: string;
}> {
  return typeof value === 'object' && value !== null && value.kind === 'hyperlink';
}

export function displayValue(value: SpreadsheetCellValue): string {
  return isHyperlinkValue(value) ? value.label : value;
}
