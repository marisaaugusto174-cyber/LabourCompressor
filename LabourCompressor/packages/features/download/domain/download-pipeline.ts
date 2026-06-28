import path from 'node:path';
import { rename, stat, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  type TaskRecord,
  type WorkflowSessionId
} from '../../../core/contracts/index.ts';
import { type SpreadsheetSheetData } from '../../spreadsheet-tasks/domain/index.ts';
import {
  createDefaultDownloadBatchTaggingScope,
  type DownloadBatchTaggingScope
} from '../../tagging/domain/index.ts';
import {
  createDownloadRequest,
  createDownloadTaskRecord,
  createDownloadedMediaAsset,
  getMuxedArtifact,
  getSeparatedArtifacts,
  markDownloadTaskCompleted,
  markDownloadTaskFailed,
  markDownloadTaskStarted,
  type DownloadArtifact,
  type DownloadExecutionResult,
  type DownloadMediaMetadata,
  type DownloadRequest,
  type DownloadedMediaAsset
} from './download-records.ts';
import { sanitizePlatformUrlForOutput } from './platform-detection.ts';

const execFileAsync = promisify(execFile);
const STANDARDIZED_VIDEO_FILE_NAME_PATTERN =
  /^[\p{Script=Han}A-Za-z0-9_]+_[A-Z0-9]+P_\d{6}_\d{6}(?:_\d{2,4})?\.[A-Za-z0-9]+$/u;

export interface DownloaderAdapter {
  download(
    request: DownloadRequest,
    options?: DownloadExecutionOptions
  ): Promise<DownloadExecutionResult>;
}

export interface DownloadExecutionOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: DownloadExecutionProgress) => void;
}

export interface DownloadExecutionProgress {
  readonly percent?: number;
  readonly speedText?: string;
  readonly etaText?: string;
  readonly downloadedBytes?: number;
  readonly totalBytes?: number;
}

export interface DownloadBatchProgressEvent {
  readonly phase: 'start' | 'progress' | 'complete' | 'failed';
  readonly request: DownloadRequest;
  readonly currentItem: string;
  readonly progress: {
    readonly current: number;
    readonly total: number;
  };
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface MergeStreamsInput {
  readonly request: DownloadRequest;
  readonly videoArtifact: DownloadArtifact;
  readonly audioArtifact: DownloadArtifact;
  readonly outputDirectory: string;
  readonly outputFileStem: string;
  readonly cleanupSourceArtifacts: boolean;
}

export interface MergeStreamsResult {
  readonly mergedFilePath: string;
  readonly mergedFileName: string;
}

export interface MergeOperator {
  mergeStreams(input: MergeStreamsInput): Promise<MergeStreamsResult>;
}

export interface SpreadsheetDownloadJob {
  readonly taskId: string;
  readonly rowNumber: number;
  readonly sourceUrl: string;
  readonly outputDirectory: string;
  readonly outputFileStem: string;
  readonly fallbackTitle: string;
}

export interface DownloadBatchResult {
  readonly workflowSessionId: WorkflowSessionId;
  readonly tasks: readonly TaskRecord[];
  readonly downloadedAssets: readonly DownloadedMediaAsset[];
  readonly taggingScope: DownloadBatchTaggingScope;
}

export function createSpreadsheetDownloadJobs(input: {
  readonly sheet: SpreadsheetSheetData;
  readonly outputDirectory: string;
}): readonly SpreadsheetDownloadJob[] {
  return Object.freeze(
    input.sheet.rows.map((row) =>
      Object.freeze({
        taskId: row.taskId,
        rowNumber: row.rowNumber,
        sourceUrl: row.url,
        outputDirectory: input.outputDirectory,
        outputFileStem: `${sanitizeOutputStem(row.rowNumber)}-${sanitizeOutputStem(
          row.values.title ?? 'asset'
        )}`,
        fallbackTitle: String(row.values.title ?? 'asset').trim() || 'asset'
      })
    )
  );
}

export async function runSpreadsheetDownloadBatch(input: {
  readonly workflowSessionId: WorkflowSessionId;
  readonly sheet: SpreadsheetSheetData;
  readonly outputDirectory: string;
  readonly downloader: DownloaderAdapter;
  readonly mergeOperator: MergeOperator;
  readonly startedAt: string;
  readonly signal?: AbortSignal;
  readonly waitIfPaused?: () => Promise<void>;
  readonly onProgress?: (event: DownloadBatchProgressEvent) => void;
}): Promise<DownloadBatchResult> {
  const jobs = createSpreadsheetDownloadJobs({
    sheet: input.sheet,
    outputDirectory: input.outputDirectory
  });
  const tasks: TaskRecord[] = [];
  const downloadedAssets: DownloadedMediaAsset[] = [];

  for (const [jobIndex, job] of jobs.entries()) {
    let task = createDownloadTaskRecord({
      taskId: job.taskId,
      workflowSessionId: input.workflowSessionId,
      createdAt: input.startedAt
    });
    const request = createDownloadRequest({
      taskId: job.taskId,
      workflowSessionId: input.workflowSessionId,
      rowNumber: job.rowNumber,
      sourceUrl: job.sourceUrl,
      outputDirectory: job.outputDirectory,
      outputFileStem: job.outputFileStem,
      fallbackTitle: job.fallbackTitle
    });
    const progress = Object.freeze({
      current: jobIndex + 1,
      total: jobs.length
    });

    try {
      throwIfAborted(input.signal);
      await input.waitIfPaused?.();
      throwIfAborted(input.signal);
      task = markDownloadTaskStarted(task, input.startedAt);
      input.onProgress?.({
        phase: 'start',
        request,
        currentItem: sanitizePlatformUrlForOutput(job.sourceUrl),
        progress
      });
      const executionResult = await input.downloader.download(request, {
        signal: input.signal,
        onProgress: (event) => {
          input.onProgress?.({
            phase: 'progress',
            request,
            currentItem: sanitizePlatformUrlForOutput(job.sourceUrl),
            progress,
            details: buildDownloadProgressDetails(event)
          });
        }
      });
      throwIfAborted(input.signal);
      const muxedArtifact = getMuxedArtifact(executionResult);

      if (muxedArtifact !== undefined) {
        const standardizedFile = await standardizeDownloadedFileName({
          filePath: muxedArtifact.filePath,
          downloadedAt: executionResult.downloadedAt,
          mediaMetadata: executionResult.mediaMetadata
        });
        downloadedAssets.push(
          createDownloadedMediaAsset({
            mediaAssetId: `${request.taskId}::asset`,
            executionResult,
            filePath: standardizedFile.filePath,
            fileName: standardizedFile.fileName
          })
        );
        task = markDownloadTaskCompleted({
          task,
          stage: 'downloaded',
          finishedAt: executionResult.downloadedAt
        });
        tasks.push(task);
        input.onProgress?.({
          phase: 'complete',
          request,
          currentItem: standardizedFile.fileName,
          progress
        });
        continue;
      }

      const { videoArtifact, audioArtifact } = getSeparatedArtifacts(
        executionResult
      );

      if (videoArtifact === undefined || audioArtifact === undefined) {
        throw new Error('Download result must contain muxed media or separated streams.');
      }

      const mergeResult = await input.mergeOperator.mergeStreams({
        request,
        videoArtifact,
        audioArtifact,
        outputDirectory: request.outputDirectory,
        outputFileStem: request.outputFileStem,
        cleanupSourceArtifacts: true
      });
      const standardizedFile = await standardizeDownloadedFileName({
        filePath: mergeResult.mergedFilePath,
        downloadedAt: executionResult.downloadedAt,
        mediaMetadata: executionResult.mediaMetadata
      });

      downloadedAssets.push(
        createDownloadedMediaAsset({
          mediaAssetId: `${request.taskId}::asset`,
          executionResult,
          filePath: standardizedFile.filePath,
          fileName: standardizedFile.fileName
        })
      );
      task = markDownloadTaskCompleted({
        task,
        stage: 'merged',
        finishedAt: executionResult.downloadedAt
      });
      tasks.push(task);
      input.onProgress?.({
        phase: 'complete',
        request,
        currentItem: standardizedFile.fileName,
        progress
      });
    } catch (error) {
      if (input.signal?.aborted === true || isCancellationError(error)) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Unknown download failure';
      const errorCode =
        typeof error === 'object' &&
        error !== null &&
        'downloadErrorCode' in error &&
        typeof (error as { downloadErrorCode?: unknown }).downloadErrorCode === 'string'
          ? (error as { downloadErrorCode: string }).downloadErrorCode
          : 'download-failed';
      tasks.push(
        markDownloadTaskFailed({
          task,
          request: createDownloadRequest({
            taskId: job.taskId,
            workflowSessionId: input.workflowSessionId,
            rowNumber: job.rowNumber,
            sourceUrl: job.sourceUrl,
            outputDirectory: job.outputDirectory,
            outputFileStem: job.outputFileStem,
            fallbackTitle: job.fallbackTitle
          }),
          failedAt: input.startedAt,
          errorCode,
          errorMessage: message
        })
      );
      input.onProgress?.({
        phase: 'failed',
        request,
        currentItem: sanitizePlatformUrlForOutput(job.sourceUrl),
        progress,
        details: {
          errorCode,
          errorMessage: message
        }
      });
    }
  }

  return Object.freeze({
    workflowSessionId: input.workflowSessionId,
    tasks: Object.freeze(tasks),
    downloadedAssets: Object.freeze(downloadedAssets),
    taggingScope: createDefaultDownloadBatchTaggingScope({
      id: `scope:${input.workflowSessionId}`,
      batchId: input.workflowSessionId,
      assetIds: downloadedAssets.map((asset) => asset.mediaAssetId)
    })
  });
}

function buildDownloadProgressDetails(
  event: DownloadExecutionProgress
): Readonly<Record<string, string | number | boolean | null>> {
  return Object.freeze({
    downloadPercent: event.percent ?? null,
    downloadSpeed: event.speedText ?? null,
    downloadEta: event.etaText ?? null,
    downloadedBytes: event.downloadedBytes ?? null,
    totalBytes: event.totalBytes ?? null
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw createCancellationError();
  }
}

function createCancellationError(): Error {
  const error = new Error('Task cancelled.');
  error.name = 'PipelineCancelledError';
  return error;
}

function isCancellationError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'PipelineCancelledError');
}

function sanitizeOutputStem(value: string | number): string {
  return String(value)
    .trim()
    .replace(/\s+/gu, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '') || path.basename(String(value)) || 'asset';
}

async function standardizeDownloadedFileName(input: {
  readonly filePath: string;
  readonly downloadedAt: string;
  readonly mediaMetadata: DownloadMediaMetadata;
}): Promise<{
  readonly filePath: string;
  readonly fileName: string;
}> {
  const existingFileName = path.basename(input.filePath);

  if (STANDARDIZED_VIDEO_FILE_NAME_PATTERN.test(existingFileName)) {
    return Object.freeze({
      filePath: input.filePath,
      fileName: existingFileName
    });
  }

  const extension = path.extname(input.filePath).toLowerCase() || '.mp4';
  const directoryPath = path.dirname(input.filePath);
  const title = sanitizeVideoTitle(input.mediaMetadata.sourceTitle);
  const resolutionLabel =
    sanitizeResolutionLabel(input.mediaMetadata.resolutionLabel) ??
    await probeResolutionLabel(input.filePath) ??
    'UNK';
  const durationSeconds =
    normalizeDurationSeconds(input.mediaMetadata.durationSeconds) ??
    await probeDurationSeconds(input.filePath) ??
    0;
  const compactDate = formatCompactDownloadDate(input.downloadedAt);
  const durationLabel = String(durationSeconds).padStart(6, '0');
  const fileName = `${title}_${resolutionLabel}_${compactDate}_${durationLabel}${extension}`;
  const filePath = path.join(directoryPath, fileName);

  if (filePath !== input.filePath) {
    try {
      await stat(filePath);
      await safeUnlink(input.filePath);
      return Object.freeze({
        filePath,
        fileName
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    await rename(input.filePath, filePath);
  }

  return Object.freeze({
    filePath,
    fileName
  });
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function sanitizeVideoTitle(value: string): string {
  const normalized = value
    .trim()
    .replace(/\s+/gu, '_')
    .replace(/[^\p{Script=Han}A-Za-z0-9_]+/gu, '')
    .replace(/_+/gu, '_')
    .replace(/^_+|_+$/gu, '');

  return normalized.length > 0 ? normalized : 'asset';
}

function sanitizeResolutionLabel(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const digits = value.match(/\d{3,4}/u)?.[0];
  return digits === undefined ? undefined : `${digits}P`;
}

function normalizeDurationSeconds(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.round(value);
}

function formatCompactDownloadDate(downloadedAt: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(downloadedAt);

  if (match === null) {
    return '000000';
  }

  return `${match[1]!.slice(2)}${match[2]}${match[3]}`;
}

async function probeResolutionLabel(filePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=height',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);

    return sanitizeResolutionLabel(stdout.trim());
  } catch {
    return undefined;
  }
}

async function probeDurationSeconds(filePath: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);

    return normalizeDurationSeconds(Number(stdout.trim()));
  } catch {
    return undefined;
  }
}
