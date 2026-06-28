import * as XLSX from 'xlsx';

import { SPREADSHEET_SCHEMA_COLUMNS } from '../../features/spreadsheet-tasks/domain/index.ts';
import { createSyntheticHeaders, detectHasHeaderRow } from './local-spreadsheet-helpers.ts';

const xlsx = XLSX.default ?? XLSX;
const MACHINE_TRACE_HEADERS = new Set(
  SPREADSHEET_SCHEMA_COLUMNS.filter((column) => column.role === 'machine-trace').map((column) => column.header)
);

export interface SpreadsheetHyperlinkUpdate {
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly label: string;
  readonly target: string;
}

export function ensureSpreadsheetSchemaColumns(matrix: (string | number)[][]): (string | number)[][] {
  const nextMatrix = matrix.map((row) => [...row]);
  if (nextMatrix.length === 0) nextMatrix.push([]);
  if (!detectHasHeaderRow(nextMatrix)) {
    nextMatrix.unshift([...createSyntheticHeaders(nextMatrix[0]?.length ?? 0)]);
  }
  const headers = nextMatrix[0]!.map((value) => String(value).trim());
  const isLocalFileSheet = headers.includes('文件名') &&
    !headers.some((header) => header === 'URL' || header.toLowerCase() === 'url');
  for (const column of SPREADSHEET_SCHEMA_COLUMNS) {
    if (isLocalFileSheet && column.header === 'URL') continue;
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
  readonly hyperlinks?: readonly SpreadsheetHyperlinkUpdate[] | undefined;
}): void {
  const currentRange = input.worksheet['!ref']
    ? xlsx.utils.decode_range(input.worksheet['!ref'])
    : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const nextRange = {
    s: { r: 0, c: 0 },
    e: {
      r: Math.max(0, input.matrix.length - 1),
      c: Math.max(0, ...input.matrix.map((row) => Math.max(0, row.length - 1)))
    }
  };
  for (let rowIndex = 0; rowIndex < input.matrix.length; rowIndex += 1) {
    const row = input.matrix[rowIndex] ?? [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cellAddress = xlsx.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const value = row[columnIndex] ?? '';
      const nextCell = (input.worksheet[cellAddress] as XLSX.CellObject | undefined) ?? { t: 's', v: '' };
      nextCell.t = typeof value === 'number' ? 'n' : 's';
      nextCell.v = typeof value === 'number' ? value : String(value);
      delete nextCell.l;
      delete nextCell.w;
      input.worksheet[cellAddress] = nextCell;
    }
  }
  for (const hyperlink of input.hyperlinks ?? []) {
    const cellAddress = xlsx.utils.encode_cell({ r: hyperlink.rowIndex, c: hyperlink.columnIndex });
    const nextCell = (input.worksheet[cellAddress] as XLSX.CellObject | undefined) ?? { t: 's', v: hyperlink.label };
    nextCell.t = 's';
    nextCell.v = hyperlink.label;
    nextCell.l = { Target: hyperlink.target, Tooltip: hyperlink.target };
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
  const nextColumns = [...(input.worksheet['!cols'] ?? [])];
  for (const [columnIndex, header] of input.headers.entries()) {
    if (MACHINE_TRACE_HEADERS.has(header)) {
      nextColumns[columnIndex] = { ...(nextColumns[columnIndex] ?? {}), hidden: true };
    }
  }
  input.worksheet['!cols'] = nextColumns;
}
