export type SpreadsheetColumnRole =
  | 'user-input'
  | 'user-visible-output'
  | 'machine-trace';

export interface SpreadsheetSchemaColumn {
  readonly header: string;
  readonly role: SpreadsheetColumnRole;
}

export const SPREADSHEET_SCHEMA_COLUMNS: readonly SpreadsheetSchemaColumn[] = Object.freeze([
  Object.freeze({ header: 'URL', role: 'user-input' }),
  Object.freeze({ header: '采集人', role: 'user-input' }),
  Object.freeze({ header: '归档状态', role: 'user-visible-output' }),
  Object.freeze({ header: '一级标签', role: 'user-visible-output' }),
  Object.freeze({ header: '二级标签', role: 'user-visible-output' }),
  Object.freeze({ header: '三级标签', role: 'user-visible-output' }),
  Object.freeze({ header: '四级标签', role: 'user-visible-output' }),
  Object.freeze({ header: '归档路径', role: 'user-visible-output' }),
  Object.freeze({ header: '归档文件名', role: 'user-visible-output' }),
  Object.freeze({ header: '失败信息', role: 'user-visible-output' }),
  Object.freeze({ header: '文件名', role: 'machine-trace' }),
  Object.freeze({ header: '相对路径', role: 'machine-trace' }),
  Object.freeze({ header: '来源URL', role: 'machine-trace' }),
  Object.freeze({ header: '源文件路径', role: 'machine-trace' }),
  Object.freeze({ header: '当前文件路径', role: 'machine-trace' }),
  Object.freeze({ header: '压缩缓存路径', role: 'machine-trace' }),
  Object.freeze({ header: '源行号', role: 'machine-trace' }),
  Object.freeze({ header: '片段序号', role: 'machine-trace' }),
  Object.freeze({ header: '标签JSON文件', role: 'machine-trace' }),
  Object.freeze({ header: '错误信息', role: 'machine-trace' })
]);

export function getSpreadsheetHeadersByRole(
  role: SpreadsheetColumnRole
): readonly string[] {
  return Object.freeze(
    SPREADSHEET_SCHEMA_COLUMNS
      .filter((column) => column.role === role)
      .map((column) => column.header)
  );
}

export interface SpreadsheetTaskRow {
  readonly taskId: string;
  readonly rowNumber: number;
  readonly url: string;
  readonly sourceKind: 'url' | 'local-file';
  readonly sourceFileName?: string | undefined;
  readonly sourceFileRelativePath?: string | undefined;
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
  readonly acceptedPaths?: readonly string[] | undefined;
  readonly columnValues?: Readonly<Record<string, SpreadsheetCellValue>> | undefined;
}

export type SpreadsheetAppendRow = Readonly<Record<string, SpreadsheetCellValue>>;

export interface MasterSpreadsheetWritebackEntry {
  readonly url: string;
  readonly collector: string;
  readonly archiveState: string;
  readonly sourceFilePath?: string | undefined;
  readonly currentFilePath?: string | undefined;
  readonly compressedCachePath?: string | undefined;
  readonly sourceRowNumber?: number | undefined;
  readonly segmentIndex?: number | undefined;
  readonly errorMessage?: string | undefined;
  readonly levelValues: Readonly<Record<string, string>>;
  readonly archivePath: string;
  readonly archiveFileName: SpreadsheetCellValue;
  readonly taggingJsonFileName?: SpreadsheetCellValue | undefined;
  readonly sourceSpreadsheet: string;
  readonly processedAt: string;
}
