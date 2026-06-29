import { constants } from 'node:fs';
import { access, chmod, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { type RunLocalPipelineOptions } from '../cli/local-pipeline-command.ts';
import { type RuntimeTaskPreparationInput } from '../../packages/orchestrator/index.ts';

const SUPPORTED_EXTENSIONS = new Set(['.csv', '.xlsx']);

export class WorkingCopyNameConflictError extends Error {
  constructor(filePath: string) {
    super(`任务工作副本已存在：${filePath}`);
    this.name = 'WorkingCopyNameConflictError';
  }
}

export function buildUserSpreadsheetWorkingCopyPath(input: {
  readonly sourcePath: string;
  readonly taskId: string;
  readonly createdAt: string;
}): string {
  const extension = path.extname(input.sourcePath).toLowerCase();
  assertSupportedExtension(extension);
  const baseName = path.basename(input.sourcePath, path.extname(input.sourcePath));
  const fileName = [
    normalizeBaseName(baseName),
    '任务副本',
    formatLocalTimestamp(input.createdAt),
    input.taskId.slice(0, 8)
  ].join('_');
  return path.join(path.dirname(input.sourcePath), `${fileName}${extension}`);
}

export async function prepareUserSpreadsheetWorkingCopy(
  input: RuntimeTaskPreparationInput<RunLocalPipelineOptions>
): Promise<RunLocalPipelineOptions> {
  if (input.options.pipelineStage === 'resume-cache') return input.options;

  const sourcePath = input.options.spreadsheet;
  const directoryPath = path.dirname(sourcePath);
  const targetPath = buildUserSpreadsheetWorkingCopyPath({
    sourcePath,
    taskId: input.taskId,
    createdAt: input.createdAt
  });

  await assertSourceReadable(sourcePath);
  await assertDirectoryWritable(directoryPath);
  await copyWorkingFile(sourcePath, targetPath);
  return { ...input.options, spreadsheet: targetPath };
}

async function copyWorkingFile(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (isErrorCode(error, 'EEXIST')) throw new WorkingCopyNameConflictError(targetPath);
    await rm(targetPath, { force: true }).catch(() => undefined);
    throw error;
  }

  try {
    await chmod(targetPath, 0o644);
    await access(targetPath, constants.R_OK | constants.W_OK);
  } catch (error) {
    await rm(targetPath, { force: true }).catch(() => undefined);
    throw new Error(`任务工作副本创建后不可写：${targetPath}`, { cause: error });
  }
}

async function assertSourceReadable(sourcePath: string): Promise<void> {
  try {
    await access(sourcePath, constants.R_OK);
  } catch (error) {
    throw new Error(`用户表不可读取：${sourcePath}`, { cause: error });
  }
}

async function assertDirectoryWritable(directoryPath: string): Promise<void> {
  try {
    await access(directoryPath, constants.W_OK);
  } catch (error) {
    throw new Error(
      `用户表所在目录不可写，无法创建任务副本：${directoryPath}`,
      { cause: error }
    );
  }
}

function normalizeBaseName(value: string): string {
  const normalized = value.trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  return normalized.length > 0 ? normalized : '用户表';
}

function formatLocalTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`任务创建时间无效：${value}`);
  return [
    formatNumber(date.getFullYear(), 4),
    formatNumber(date.getMonth() + 1),
    formatNumber(date.getDate())
  ].join('') + '_' + [
    formatNumber(date.getHours()),
    formatNumber(date.getMinutes()),
    formatNumber(date.getSeconds())
  ].join('');
}

function formatNumber(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function assertSupportedExtension(extension: string): void {
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('用户表仅支持 .xlsx 或 .csv 格式。');
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
