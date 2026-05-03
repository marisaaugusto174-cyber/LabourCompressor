import {
  attachTaskCheckpoint,
  attachTaskResumeState,
  completeTaskRecord,
  createTaskCheckpoint,
  createTaskRecord,
  createTaskResumeState,
  failTaskRecord,
  startTaskRecord,
  type TaskId,
  type TaskRecord,
  type WorkflowSessionId
} from '../../../core/contracts/index.ts';
import {
  detectSupportedPlatformUrl,
  type DetectedPlatformUrl,
  type SupportedPlatform
} from './platform-detection.ts';

export type DownloadArtifactKind =
  | 'muxed-video'
  | 'video-only'
  | 'audio-only';

export interface DownloadArtifact {
  readonly kind: DownloadArtifactKind;
  readonly filePath: string;
  readonly fileName: string;
  readonly container: string;
}

export interface DownloadMediaMetadata {
  readonly sourceTitle: string;
  readonly resolutionLabel?: string;
  readonly durationSeconds?: number;
}

export interface DownloadRequest {
  readonly taskId: TaskId;
  readonly workflowSessionId: WorkflowSessionId;
  readonly rowNumber: number;
  readonly sourceUrl: string;
  readonly platform: SupportedPlatform;
  readonly normalizedUrl: string;
  readonly outputDirectory: string;
  readonly outputFileStem: string;
  readonly fallbackTitle: string;
}

export interface DownloadExecutionResult {
  readonly request: DownloadRequest;
  readonly artifacts: readonly DownloadArtifact[];
  readonly downloadedAt: string;
  readonly mediaMetadata: DownloadMediaMetadata;
}

export interface DownloadedMediaAsset {
  readonly mediaAssetId: string;
  readonly taskId: TaskId;
  readonly rowNumber: number;
  readonly sourceUrl: string;
  readonly platform: SupportedPlatform;
  readonly filePath: string;
  readonly fileName: string;
  readonly downloadedAt: string;
}

export function createDownloadRequest(input: {
  readonly taskId: TaskId;
  readonly workflowSessionId: WorkflowSessionId;
  readonly rowNumber: number;
  readonly sourceUrl: string;
  readonly outputDirectory: string;
  readonly outputFileStem: string;
  readonly fallbackTitle?: string;
}): DownloadRequest {
  const detectedUrl = detectSupportedPlatformUrl(input.sourceUrl);

  return Object.freeze({
    taskId: input.taskId,
    workflowSessionId: input.workflowSessionId,
    rowNumber: input.rowNumber,
    sourceUrl: detectedUrl.originalUrl,
    platform: detectedUrl.platform,
    normalizedUrl: detectedUrl.normalizedUrl,
    outputDirectory: input.outputDirectory.trim(),
    outputFileStem: input.outputFileStem.trim(),
    fallbackTitle: (input.fallbackTitle ?? 'asset').trim() || 'asset'
  });
}

export function createDownloadTaskRecord(input: {
  readonly taskId: TaskId;
  readonly workflowSessionId: WorkflowSessionId;
  readonly createdAt: string;
  readonly parentTaskId?: TaskId;
}): TaskRecord {
  return createTaskRecord({
    id: input.taskId,
    kind: 'single-url-download',
    workflowSessionId: input.workflowSessionId,
    createdAt: input.createdAt,
    parentTaskId: input.parentTaskId
  });
}

export function markDownloadTaskStarted(
  task: TaskRecord,
  startedAt: string
): TaskRecord {
  return startTaskRecord(task, {
    startedAt
  });
}

export function markDownloadTaskFailed(input: {
  readonly task: TaskRecord;
  readonly request: DownloadRequest;
  readonly failedAt: string;
  readonly errorCode: string;
  readonly errorMessage: string;
}): TaskRecord {
  const resumeState = createTaskResumeState({
    token: input.request.normalizedUrl,
    fromCheckpoint: input.task.lastVerifiedStep ?? 'queued',
    createdAt: input.failedAt
  });
  const resumedTask = attachTaskResumeState(input.task, resumeState);

  return failTaskRecord(resumedTask, {
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    failedAt: input.failedAt
  });
}

export function markDownloadTaskCompleted(input: {
  readonly task: TaskRecord;
  readonly stage: 'downloaded' | 'merged';
  readonly finishedAt: string;
}): TaskRecord {
  const checkpoint = createTaskCheckpoint({
    stage: input.stage,
    status: 'verified',
    recordedAt: input.finishedAt
  });

  return completeTaskRecord(
    attachTaskCheckpoint(input.task, checkpoint),
    {
      finishedAt: input.finishedAt,
      checkpoint
    }
  );
}

export function createDownloadedMediaAsset(input: {
  readonly mediaAssetId: string;
  readonly executionResult: DownloadExecutionResult;
  readonly filePath: string;
  readonly fileName: string;
}): DownloadedMediaAsset {
  return Object.freeze({
    mediaAssetId: input.mediaAssetId,
    taskId: input.executionResult.request.taskId,
    rowNumber: input.executionResult.request.rowNumber,
    sourceUrl: input.executionResult.request.sourceUrl,
    platform: input.executionResult.request.platform,
    filePath: input.filePath,
    fileName: input.fileName,
    downloadedAt: input.executionResult.downloadedAt
  });
}

export function getMuxedArtifact(
  executionResult: DownloadExecutionResult
): DownloadArtifact | undefined {
  return executionResult.artifacts.find(
    (artifact) => artifact.kind === 'muxed-video'
  );
}

export function getSeparatedArtifacts(
  executionResult: DownloadExecutionResult
): {
  readonly videoArtifact?: DownloadArtifact;
  readonly audioArtifact?: DownloadArtifact;
} {
  return Object.freeze({
    videoArtifact: executionResult.artifacts.find(
      (artifact) => artifact.kind === 'video-only'
    ),
    audioArtifact: executionResult.artifacts.find(
      (artifact) => artifact.kind === 'audio-only'
    )
  });
}

export function detectRequestPlatform(
  sourceUrl: string
): DetectedPlatformUrl {
  return detectSupportedPlatformUrl(sourceUrl);
}
