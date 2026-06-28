export {
  detectSupportedPlatformUrl,
  sanitizePlatformUrlForOutput
} from './platform-detection.ts';
export {
  createDownloadRequest,
  createDownloadTaskRecord,
  createDownloadedMediaAsset,
  detectRequestPlatform,
  getMuxedArtifact,
  getSeparatedArtifacts,
  markDownloadTaskCompleted,
  markDownloadTaskFailed,
  markDownloadTaskStarted
} from './download-records.ts';
export {
  createSpreadsheetDownloadJobs,
  runSpreadsheetDownloadBatch
} from './download-pipeline.ts';
export {
  getGlobalCredentialEntry,
  getPlatformCredentialEntry,
  parsePlatformCredentialConfig
} from './platform-credentials.ts';

export type {
  DetectedPlatformUrl,
  SupportedPlatform
} from './platform-detection.ts';
export type {
  DownloadArtifact,
  DownloadArtifactKind,
  DownloadExecutionResult,
  DownloadMediaMetadata,
  DownloadRequest,
  DownloadedMediaAsset
} from './download-records.ts';
export type {
  DownloadBatchResult,
  DownloadExecutionOptions,
  DownloadExecutionProgress,
  DownloaderAdapter,
  MergeOperator,
  MergeStreamsInput,
  MergeStreamsResult,
  SpreadsheetDownloadJob
} from './download-pipeline.ts';
export type {
  PlatformCredentialConfig,
  PlatformCredentialEntry
} from './platform-credentials.ts';
