export interface SpreadsheetTaskRow {
  readonly taskId: string;
  readonly rowNumber: number;
  readonly url: string;
  readonly sourceKind: 'url' | 'local-file';
  readonly sourceFileName?: string;
  readonly sourceFileRelativePath?: string;
  readonly values: Readonly<Record<string, string>>;
}

export type SpreadsheetCellValue =
  | string
  | Readonly<{
      readonly kind: 'hyperlink';
      readonly label: string;
      readonly target: string;
    }>;

export interface SpreadsheetSheetData {
  readonly filePath: string;
  readonly fileKind: 'csv' | 'xlsx' | 'numbers';
  readonly sheetName: string;
  readonly headers: readonly string[];
  readonly rows: readonly SpreadsheetTaskRow[];
}

export interface SpreadsheetWritebackUpdate {
  readonly rowNumber: number;
  readonly acceptedPaths?: readonly string[];
  readonly columnValues?: Readonly<Record<string, SpreadsheetCellValue>>;
}

export type SpreadsheetAppendRow = Readonly<Record<string, SpreadsheetCellValue>>;

export interface MasterSpreadsheetWritebackEntry {
  readonly url: string;
  readonly collector: string;
  readonly archiveState: string;
  readonly sourceFilePath?: string;
  readonly currentFilePath?: string;
  readonly compressedCachePath?: string;
  readonly sourceRowNumber?: number;
  readonly segmentIndex?: number;
  readonly errorMessage?: string;
  readonly levelValues: Readonly<Record<string, string>>;
  readonly archivePath: string;
  readonly archiveFileName: SpreadsheetCellValue;
  readonly taggingJsonFileName?: SpreadsheetCellValue;
  readonly sourceSpreadsheet: string;
  readonly processedAt: string;
}
