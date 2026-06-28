import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as XLSX from 'xlsx';

import { type SpreadsheetWritebackUpdate } from '../../features/spreadsheet-tasks/domain/index.ts';
import {
  detectHasHeaderRow,
  loadWritableSpreadsheetSheet
} from './local-spreadsheet-helpers.ts';

const xlsx = XLSX.default ?? XLSX;

export function writeTagResultsToNumbers(input: {
  readonly filePath: string;
  readonly updates: readonly SpreadsheetWritebackUpdate[];
  readonly sheetName?: string | undefined;
  readonly acceptedTagsColumnName?: string | undefined;
}): void {
  const writableSheet = loadWritableSpreadsheetSheet(input.filePath, input.sheetName);
  const hasHeaderRow = detectHasHeaderRow(writableSheet.matrix);

  if (!hasHeaderRow) {
    throw new Error('Numbers writeback requires a visible header row.');
  }

  const headers = writableSheet.matrix[0]!.map((value) => String(value).trim());
  const acceptedTagsColumnName = input.acceptedTagsColumnName ?? 'accepted_tags';
  const shouldWriteAcceptedTags = input.updates.some(
    (update) => update.acceptedPaths !== undefined
  );
  const resolvedHeaders = [...headers];

  for (const update of input.updates) {
    for (const columnName of Object.keys(update.columnValues ?? {})) {
      if (!resolvedHeaders.includes(columnName)) {
        resolvedHeaders.push(columnName);
      }
    }
  }

  if (shouldWriteAcceptedTags && !resolvedHeaders.includes(acceptedTagsColumnName)) {
    resolvedHeaders.push(acceptedTagsColumnName);
  }

  const script = buildNumbersWritebackScript({
    documentPath: input.filePath,
    sheetName: writableSheet.sheetName,
    headers: resolvedHeaders,
    updates: input.updates,
    acceptedTagsColumnName
  });

  execFileSync('osascript', ['-e', script], {
    stdio: 'pipe'
  });
}

export function buildNumbersWritebackScript(input: {
  readonly documentPath: string;
  readonly sheetName: string;
  readonly headers: readonly string[];
  readonly updates: readonly SpreadsheetWritebackUpdate[];
  readonly acceptedTagsColumnName: string;
}): string {
  const documentStem = path.basename(input.documentPath, path.extname(input.documentPath));
  const lines = [
    'tell application "Numbers"',
    `  if (exists document ${toAppleScriptString(documentStem)}) then`,
    `    set targetDocument to document ${toAppleScriptString(documentStem)}`,
    '  else',
    `    set targetDocument to open POSIX file ${toAppleScriptString(input.documentPath)}`,
    '  end if',
    '  tell targetDocument',
    `    tell sheet ${toAppleScriptString(input.sheetName)}`,
    '      tell table 1'
  ];

  const columnIndexes = new Map(
    input.headers.map((header, index) => [header, index + 1] as const)
  );

  for (const [index, header] of input.headers.entries()) {
    lines.push(
      `        if (count of columns) < ${index + 1} then`,
      `          repeat while (count of columns) < ${index + 1}`,
      '            add column after last column',
      '          end repeat',
      '        end if',
      `        set value of cell ${index + 1} of row 1 to ${toAppleScriptString(header)}`
    );
  }

  for (const update of input.updates) {
    if (update.acceptedPaths !== undefined) {
      lines.push(
        `        set value of cell ${requireColumnIndex(columnIndexes, input.acceptedTagsColumnName)} of row ${update.rowNumber} to ${toAppleScriptString(update.acceptedPaths.join(' | '))}`
      );
    }

    for (const [columnName, value] of Object.entries(update.columnValues ?? {})) {
      lines.push(
        `        set value of cell ${requireColumnIndex(columnIndexes, columnName)} of row ${update.rowNumber} to ${toAppleScriptString(displayValue(value))}`
      );
    }
  }

  lines.push(
    '      end tell',
    '    end tell',
    '    save',
    '  end tell',
    'end tell'
  );

  return lines.join('\n');
}

function requireColumnIndex(
  columnIndexes: ReadonlyMap<string, number>,
  columnName: string
): number {
  const columnIndex = columnIndexes.get(columnName);

  if (columnIndex === undefined) {
    throw new Error(`Numbers column not found for writeback: "${columnName}"`);
  }

  return columnIndex;
}

function toAppleScriptString(value: string): string {
  return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

function isHyperlinkValue(value: unknown): value is Readonly<{
  readonly kind: 'hyperlink';
  readonly label: string;
}> {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'hyperlink';
}

function displayValue(value: string | Readonly<{ readonly kind: 'hyperlink'; readonly label: string }>): string {
  return isHyperlinkValue(value) ? value.label : value;
}
