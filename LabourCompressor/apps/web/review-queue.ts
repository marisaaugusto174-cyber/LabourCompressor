import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import {
  createPostEditArchiveRecordSpreadsheet,
  type PostEditArchiveRecordFileEntry
} from '../../packages/adapters/spreadsheets/local-spreadsheet.ts';

export const REVIEW_QUEUE_STATE_FILE_NAME = '_review-queue.json';

const VIDEO_FILE_NAME_PATTERN = /\.(mp4|mov|m4v|mkv|avi|webm)$/iu;
const STANDARDIZED_VIDEO_FILE_NAME_PATTERN =
  /^[\p{Script=Han}A-Za-z0-9_]+_[A-Z0-9]+P_\d{6}_\d{6}(?:_\d{2,4})?\.[A-Za-z0-9]+$/u;

export type ReviewQueueDecision = 'discard' | 'keep-afteredit' | 'keep-problem' | 'manual-retry';
export type ReviewQueueTargetPool = 'Discarded' | 'AfterEdit' | 'ProblemClips' | 'ManualReview';
export type ReviewQueueNextStage = 'discarded' | 'compress' | 'problem-review' | 'manual-retry';

export interface ReviewQueueItem {
  readonly id: string;
  readonly sourceTaskId?: string | undefined;
  readonly phase: string;
  readonly errorCode: string;
  readonly reason: string;
  readonly sourcePath: string;
  readonly currentPath: string;
  readonly fileName: string;
  readonly relativePath: string;
  readonly decision?: ReviewQueueDecision | undefined;
  readonly targetPool?: ReviewQueueTargetPool | undefined;
  readonly nextStage?: ReviewQueueNextStage | undefined;
  readonly reviewedAt?: string | undefined;
}

export interface ReviewQueueStateFile {
  readonly version: 1;
  readonly updatedAt: string;
  readonly items: Readonly<Record<string, ReviewQueueItem>>;
}

export interface ReviewQueueScanResult {
  readonly directoryPath: string;
  readonly items: readonly ReviewQueueItem[];
  readonly state: ReviewQueueStateFile | null;
}

export interface ReviewQueueDecisionResult {
  readonly directoryPath: string;
  readonly item: ReviewQueueItem;
  readonly state: ReviewQueueStateFile;
  readonly afterEditSpreadsheetPath?: string | undefined;
}

export async function scanReviewQueueDirectory(input: {
  readonly directoryPath: string;
}): Promise<ReviewQueueScanResult> {
  const directoryPath = path.resolve(input.directoryPath);
  const state = await readReviewQueueState(directoryPath);
  const items: ReviewQueueItem[] = [];

  await scanDirectory(directoryPath, directoryPath, items);

  return Object.freeze({
    directoryPath,
    items: Object.freeze(items.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-Hans-CN'))),
    state
  });

  async function scanDirectory(
    rootDirectory: string,
    currentDirectory: string,
    output: ReviewQueueItem[]
  ): Promise<void> {
    let entries;

    try {
      entries = await readdir(currentDirectory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const filePath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        await scanDirectory(rootDirectory, filePath, output);
        continue;
      }

      if (!entry.isFile() || !VIDEO_FILE_NAME_PATTERN.test(entry.name)) {
        continue;
      }

      const relativePath = toPortableRelativePath(rootDirectory, filePath);

      if (!isProblemClipRelativePath(rootDirectory, relativePath)) {
        continue;
      }

      const baseItem = buildProblemClipQueueItem({
        rootDirectory,
        filePath,
        relativePath
      });
      const stateItem = state?.items[baseItem.id];

      output.push(Object.freeze({
        ...baseItem,
        decision: stateItem?.decision,
        targetPool: stateItem?.targetPool,
        nextStage: stateItem?.nextStage,
        reviewedAt: stateItem?.reviewedAt,
        currentPath: stateItem?.currentPath ?? baseItem.currentPath
      }));
    }
  }
}

export async function applyReviewQueueDecision(input: {
  readonly directoryPath: string;
  readonly reviewItemId: string;
  readonly decision: ReviewQueueDecision;
  readonly afterEditDirectoryPath?: string | undefined;
}): Promise<ReviewQueueDecisionResult> {
  const directoryPath = path.resolve(input.directoryPath);
  const scan = await scanReviewQueueDirectory({ directoryPath });
  const existingState = await readReviewQueueState(directoryPath);
  const existingItems = { ...(existingState?.items ?? {}) };
  const scannedItem = scan.items.find((item) => item.id === input.reviewItemId);
  const stateItem = existingItems[input.reviewItemId];
  const item = scannedItem ?? stateItem;

  if (item === undefined) {
    throw new Error(`Review queue item not found: ${input.reviewItemId}`);
  }

  const reviewedAt = new Date().toISOString();
  let updatedItem: ReviewQueueItem;
  let afterEditSpreadsheetPath: string | undefined;

  if (input.decision === 'keep-afteredit') {
    const afterEditDirectoryPath = path.resolve(
      input.afterEditDirectoryPath ?? path.join(directoryPath, 'AfterEdit')
    );
    await mkdir(afterEditDirectoryPath, { recursive: true });
    const sourcePath = await resolveExistingItemPath(item);
    const destinationPath = await resolveAvailableAfterEditPath({
      afterEditDirectoryPath,
      fileName: item.fileName
    });

    await copyFile(sourcePath, destinationPath);
    updatedItem = Object.freeze({
      ...item,
      decision: input.decision,
      targetPool: 'AfterEdit',
      nextStage: 'compress',
      reviewedAt,
      currentPath: destinationPath
    });
    existingItems[input.reviewItemId] = updatedItem;
    const state = await writeReviewQueueState({
      directoryPath,
      updatedAt: reviewedAt,
      items: Object.values(existingItems)
    });
    afterEditSpreadsheetPath = await writeKeptAfterEditSpreadsheet({
      afterEditDirectoryPath,
      state
    });

    return Object.freeze({
      directoryPath,
      item: updatedItem,
      state,
      afterEditSpreadsheetPath
    });
  }

  if (input.decision === 'discard') {
    const sourcePath = await resolveExistingItemPath(item);
    const discardedDirectoryPath = path.join(directoryPath, 'Discarded');
    await mkdir(discardedDirectoryPath, { recursive: true });
    const destinationPath = await resolveAvailableFilePath({
      directoryPath: discardedDirectoryPath,
      fileName: path.basename(sourcePath)
    });

    await moveFile(sourcePath, destinationPath);
    updatedItem = Object.freeze({
      ...item,
      decision: input.decision,
      targetPool: 'Discarded',
      nextStage: 'discarded',
      reviewedAt,
      currentPath: destinationPath
    });
  } else if (input.decision === 'keep-problem') {
    updatedItem = Object.freeze({
      ...item,
      decision: input.decision,
      targetPool: 'ProblemClips',
      nextStage: 'problem-review',
      reviewedAt
    });
  } else {
    updatedItem = Object.freeze({
      ...item,
      decision: input.decision,
      targetPool: 'ManualReview',
      nextStage: 'manual-retry',
      reviewedAt
    });
  }

  existingItems[input.reviewItemId] = updatedItem;
  const state = await writeReviewQueueState({
    directoryPath,
    updatedAt: reviewedAt,
    items: Object.values(existingItems)
  });

  return Object.freeze({
    directoryPath,
    item: updatedItem,
    state
  });
}

function buildProblemClipQueueItem(input: {
  readonly rootDirectory: string;
  readonly filePath: string;
  readonly relativePath: string;
}): ReviewQueueItem {
  return Object.freeze({
    id: createReviewQueueItemId(input.relativePath),
    phase: 'segmentation',
    errorCode: 'problem-clip',
    reason: '问题片段待复查',
    sourcePath: input.filePath,
    currentPath: input.filePath,
    fileName: path.basename(input.filePath),
    relativePath: input.relativePath
  });
}

async function readReviewQueueState(directoryPath: string): Promise<ReviewQueueStateFile | null> {
  try {
    const payload = JSON.parse(
      await readFile(path.join(directoryPath, REVIEW_QUEUE_STATE_FILE_NAME), 'utf8')
    ) as unknown;

    if (!isReviewQueueStateFile(payload)) {
      return null;
    }

    return payload;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeReviewQueueState(input: {
  readonly directoryPath: string;
  readonly updatedAt: string;
  readonly items: readonly ReviewQueueItem[];
}): Promise<ReviewQueueStateFile> {
  const items = Object.fromEntries(input.items.map((item) => [item.id, item]));
  const state: ReviewQueueStateFile = Object.freeze({
    version: 1,
    updatedAt: input.updatedAt,
    items: Object.freeze(items)
  });
  const targetPath = path.join(input.directoryPath, REVIEW_QUEUE_STATE_FILE_NAME);
  const temporaryPath = `${targetPath}.tmp`;

  await mkdir(input.directoryPath, { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, targetPath);
  return state;
}

async function writeKeptAfterEditSpreadsheet(input: {
  readonly afterEditDirectoryPath: string;
  readonly state: ReviewQueueStateFile;
}): Promise<string> {
  const keptItems = Object.values(input.state.items)
    .filter((item) => item.decision === 'keep-afteredit' && item.targetPool === 'AfterEdit');
  const fileEntries: PostEditArchiveRecordFileEntry[] = [];

  for (const item of keptItems) {
    const currentPath = path.resolve(item.currentPath);
    const relativePath = toPortableRelativePath(input.afterEditDirectoryPath, currentPath);

    fileEntries.push(Object.freeze({
      fileName: path.basename(currentPath),
      relativePath,
      originalFileName: path.basename(item.sourcePath),
      sourceUrl: item.sourcePath,
      archiveState: '待压缩',
      sourceFilePath: item.sourcePath,
      currentFilePath: currentPath,
      failureMessage: item.reason,
      errorMessage: item.errorCode
    }));
  }

  const filePath = path.join(input.afterEditDirectoryPath, 'AfterEdit_复查保留表.xlsx');
  createPostEditArchiveRecordSpreadsheet({
    filePath,
    fileEntries
  });
  return filePath;
}

async function resolveExistingItemPath(item: ReviewQueueItem): Promise<string> {
  for (const candidatePath of [item.sourcePath, item.currentPath]) {
    try {
      const fileStat = await stat(candidatePath);

      if (fileStat.isFile()) {
        return candidatePath;
      }
    } catch {
      continue;
    }
  }

  throw new Error(`Review queue media file not found: ${item.fileName}`);
}

async function resolveAvailableAfterEditPath(input: {
  readonly afterEditDirectoryPath: string;
  readonly fileName: string;
}): Promise<string> {
  const normalizedFileName = normalizeAfterEditFileName(input.fileName);
  return resolveAvailableFilePath({
    directoryPath: input.afterEditDirectoryPath,
    fileName: normalizedFileName
  });
}

async function resolveAvailableFilePath(input: {
  readonly directoryPath: string;
  readonly fileName: string;
}): Promise<string> {
  const parsed = path.parse(input.fileName);
  let candidatePath = path.join(input.directoryPath, input.fileName);

  for (let index = 1; index <= 999; index += 1) {
    if (!(await fileExists(candidatePath))) {
      return candidatePath;
    }

    const suffix = String(9000 + index);
    const baseStem = parsed.name.replace(/_\d{2,4}$/u, '');
    candidatePath = path.join(input.directoryPath, `${baseStem}_${suffix}${parsed.ext}`);
  }

  throw new Error(`Unable to allocate a unique file name for ${input.fileName}`);
}

function normalizeAfterEditFileName(fileName: string): string {
  if (STANDARDIZED_VIDEO_FILE_NAME_PATTERN.test(fileName)) {
    return fileName;
  }

  const parsed = path.parse(fileName);
  const withoutProblemSuffix = `${parsed.name.replace(/_problem_\d+$/iu, '')}${parsed.ext}`;

  if (STANDARDIZED_VIDEO_FILE_NAME_PATTERN.test(withoutProblemSuffix)) {
    return withoutProblemSuffix;
  }

  const now = new Date();
  const datePart = [
    String(now.getFullYear()).slice(-2),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const timePart = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('');
  const suffix = createHash('sha1').update(fileName).digest('hex').slice(0, 4);
  const extension = parsed.ext.length > 0 ? parsed.ext : '.mp4';

  return `复查片段_720P_${datePart}_${timePart}_${suffix}${extension}`;
}

async function moveFile(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await rename(sourcePath, destinationPath);
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EXDEV') {
      throw error;
    }
    await copyFile(sourcePath, destinationPath);
    await unlink(sourcePath);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isProblemClipRelativePath(rootDirectory: string, relativePath: string): boolean {
  const segments = relativePath.split('/').filter((segment) => segment.length > 0);

  if (segments.some((segment) => segment.toLocaleLowerCase('en-US') === 'discarded')) {
    return false;
  }

  if (path.basename(rootDirectory).toLocaleLowerCase('en-US') === 'problemclips') {
    return true;
  }

  return segments.some((segment) => segment.toLocaleLowerCase('en-US') === 'problemclips');
}

function createReviewQueueItemId(relativePath: string): string {
  return `review-${createHash('sha1').update(relativePath).digest('hex').slice(0, 16)}`;
}

function toPortableRelativePath(rootDirectory: string, filePath: string): string {
  const rootPath = path.resolve(rootDirectory);
  const resolvedFilePath = path.resolve(filePath);

  if (!isInsideDirectory(rootPath, resolvedFilePath)) {
    throw new Error(`Path escapes root directory: ${filePath}`);
  }

  return path.relative(rootPath, resolvedFilePath).split(path.sep).join('/');
}

function isInsideDirectory(rootDirectory: string, filePath: string): boolean {
  return filePath === rootDirectory || filePath.startsWith(`${rootDirectory}${path.sep}`);
}

function isReviewQueueStateFile(value: unknown): value is ReviewQueueStateFile {
  if (!isRecord(value) || value.version !== 1 || typeof value.updatedAt !== 'string' || !isRecord(value.items)) {
    return false;
  }

  return Object.values(value.items).every(isReviewQueueItem);
}

function isReviewQueueItem(value: unknown): value is ReviewQueueItem {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.phase === 'string' &&
    typeof value.errorCode === 'string' &&
    typeof value.reason === 'string' &&
    typeof value.sourcePath === 'string' &&
    typeof value.currentPath === 'string' &&
    typeof value.fileName === 'string' &&
    typeof value.relativePath === 'string'
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
