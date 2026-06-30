import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';

import { type ModelFallbackTrace } from '../../../features/tagging/domain/index.ts';

const xlsx = XLSX.default ?? XLSX;
const DIRECTORY_NAME = '待人工复查';
const SHEET_NAME = '待人工复查';
const WORKBOOK_NAME = '待人工复查总表.xlsx';
const HUMAN_COLUMNS = ['人工复查状态', '人工标签', '处理人', '处理时间', '备注'] as const;
const HEADERS = [
  '记录ID', '任务ID', '媒体ID', '文件名', '归档文件路径', '来源表', '原始行号', '来源URL',
  '首选模型', 'Qwen错误码', 'Qwen错误信息', 'Gemini状态', 'Gemini错误码', 'Gemini错误信息',
  '首次进入时间', '最近更新时间', ...HUMAN_COLUMNS
] as const;

export interface ManualReviewSidecar {
  readonly systemStatus: '待人工复查';
  readonly modelFallbackTrace: ModelFallbackTrace;
}

export async function archiveManualReviewItem(input: {
  readonly sourceFilePath: string;
  readonly archiveRoot: string;
  readonly taskId: string;
  readonly mediaAssetId: string;
  readonly sourceRowNumber: number;
  readonly sourceSpreadsheet: string;
  readonly sourceUrl: string;
  readonly recordedAt: string;
  readonly sidecar: ManualReviewSidecar;
}): Promise<{ readonly filePath: string; readonly recordId: string }> {
  const directory = path.join(input.archiveRoot, DIRECTORY_NAME);
  await mkdir(directory, { recursive: true });
  const sourceHash = await hashFile(input.sourceFilePath);
  const targetPath = await resolveTargetPath(directory, input.sourceFilePath, sourceHash);
  if (!(await exists(targetPath))) await copyFile(input.sourceFilePath, targetPath);
  const recordId = `manual-review:${input.taskId}:${input.mediaAssetId}`;
  await writeFile(replaceExtension(targetPath, '.json'), `${JSON.stringify({
    recordId,
    taskId: input.taskId,
    mediaAssetId: input.mediaAssetId,
    sourceFileName: path.basename(input.sourceFilePath),
    sourceHash,
    recordedAt: input.recordedAt,
    ...input.sidecar
  }, null, 2)}\n`, 'utf8');
  upsertWorkbook({ ...input, recordId, targetPath, workbookPath: path.join(directory, WORKBOOK_NAME) });
  return Object.freeze({ filePath: targetPath, recordId });
}

async function resolveTargetPath(directory: string, sourcePath: string, sourceHash: string): Promise<string> {
  const direct = path.join(directory, path.basename(sourcePath));
  if (!(await exists(direct))) return direct;
  if (await hashFile(direct) === sourceHash) return direct;
  const parsed = path.parse(direct);
  return path.join(parsed.dir, `${parsed.name}_${sourceHash.slice(0, 8)}${parsed.ext}`);
}

function upsertWorkbook(input: {
  readonly workbookPath: string;
  readonly recordId: string;
  readonly targetPath: string;
  readonly taskId: string;
  readonly mediaAssetId: string;
  readonly sourceRowNumber: number;
  readonly sourceSpreadsheet: string;
  readonly sourceUrl: string;
  readonly recordedAt: string;
  readonly sidecar: ManualReviewSidecar;
}): void {
  const existing = readRows(input.workbookPath);
  const previous = existing.find((row) => row.记录ID === input.recordId);
  const trace = input.sidecar.modelFallbackTrace;
  const row: Record<string, string | number> = {
    记录ID: input.recordId,
    任务ID: input.taskId,
    媒体ID: input.mediaAssetId,
    文件名: path.basename(input.targetPath),
    归档文件路径: input.targetPath,
    来源表: input.sourceSpreadsheet,
    原始行号: input.sourceRowNumber,
    来源URL: input.sourceUrl,
    首选模型: trace.primaryProfileId,
    Qwen错误码: trace.primaryErrorCode,
    Qwen错误信息: trace.primaryErrorMessage,
    Gemini状态: trace.fallbackStatus,
    Gemini错误码: trace.fallbackErrorCode ?? '',
    Gemini错误信息: trace.fallbackErrorMessage ?? '',
    首次进入时间: previous?.首次进入时间 ?? input.recordedAt,
    最近更新时间: input.recordedAt,
    人工复查状态: previous?.人工复查状态 || '待复查',
    人工标签: previous?.人工标签 ?? '',
    处理人: previous?.处理人 ?? '',
    处理时间: previous?.处理时间 ?? '',
    备注: previous?.备注 ?? ''
  };
  const rows = previous === undefined
    ? [...existing, row]
    : existing.map((item) => item.记录ID === input.recordId ? row : item);
  writeWorkbook(input.workbookPath, rows);
}

function readRows(workbookPath: string): Array<Record<string, string>> {
  if (!existsSync(workbookPath)) return [];
  const workbook = xlsx.readFile(workbookPath);
  const sheet = workbook.Sheets[SHEET_NAME];
  return sheet === undefined ? [] : xlsx.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
}

function writeWorkbook(workbookPath: string, rows: Array<Record<string, string | number>>): void {
  const workbook = xlsx.utils.book_new();
  const sheet = xlsx.utils.json_to_sheet(rows, { header: [...HEADERS] });
  const pathColumn = HEADERS.indexOf('归档文件路径');
  for (let index = 0; index < rows.length; index += 1) {
    const cell = sheet[xlsx.utils.encode_cell({ r: index + 1, c: pathColumn })];
    if (cell !== undefined) cell.l = { Target: pathToFileURL(String(rows[index]?.归档文件路径 ?? '')).toString() };
  }
  xlsx.utils.book_append_sheet(workbook, sheet, SHEET_NAME);
  xlsx.writeFile(workbook, workbookPath);
}

async function hashFile(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function exists(filePath: string): Promise<boolean> {
  try { await stat(filePath); return true; } catch { return false; }
}

function replaceExtension(filePath: string, extension: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
}
