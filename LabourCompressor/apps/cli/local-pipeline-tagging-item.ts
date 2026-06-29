import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import { createDecisionFingerprint } from '../../packages/core/contracts/index.ts';
import { type DownloadedMediaAsset } from '../../packages/features/download/domain/index.ts';
import {
  ArchivePrimaryTagError,
  buildStructuredLevelValues,
  generateContentTopicCandidatePaths,
  generateModelCandidatePaths,
  runAutomaticTagging,
  type GenerateModelCandidatePathsResult
} from '../../packages/features/tagging/domain/index.ts';
import { type SpreadsheetTaskRow } from '../../packages/features/spreadsheet-tasks/domain/index.ts';
import { type VideoTaggingCacheResult } from '../../packages/adapters/media/media-frame-extractor.ts';
import {
  buildFailure,
  createFailureRowState,
  formatBytes,
  requireSheetRow,
  requireValue
} from './local-pipeline-helpers.ts';
import { resolveRequiredArchivePath, resolveRequiredContentTopic } from './archive-path-resolution.ts';
import { classifyTaggingError, isVideoTooShortError } from './tagging-failure-classification.ts';
import { type PipelineItemTimings, type RunTaggingBatchInput } from './local-pipeline-tagging-contracts.ts';
import { DEFAULT_VIDEO_CACHE_DIRECTORY } from './project-paths.ts';
import { withRateLimitRetry } from './tagging-rate-limit.ts';

interface ItemContext {
  readonly input: RunTaggingBatchInput;
  readonly asset: DownloadedMediaAsset;
  readonly row: SpreadsheetTaskRow;
  readonly index: number;
  readonly totalAssets: number;
  readonly itemStartedAt: number;
  readonly taxonomyVersionId: string;
  readonly archiveDimension: string;
  modelRequestMs: number;
  tagNormalizeMs: number;
}

interface ProcessedTaggingResult {
  readonly candidateCount: number;
  readonly acceptedCount: number;
  readonly selectedArchivePath: string;
  readonly fallbackApplied: boolean;
}

export async function processTaggingItem(input: {
  readonly batch: RunTaggingBatchInput;
  readonly asset: DownloadedMediaAsset;
  readonly index: number;
  readonly completedCount: () => number;
}): Promise<void> {
  const context = createItemContext(input);
  try {
    emitItemStarted(context);
    const modelResult = await requestInitialModelResult(context);
    const candidatePaths = resolveCandidatePaths(context, modelResult);
    emitCacheIfPresent(context, modelResult?.videoTaggingCache);
    const result = await normalizeAndPersist(context, candidatePaths, modelResult);
    emitItemSucceeded(context, result, input.completedCount());
  } catch (error) {
    handleTaggingFailure(context, error, input.completedCount());
  }
}

function createItemContext(input: {
  readonly batch: RunTaggingBatchInput;
  readonly asset: DownloadedMediaAsset;
  readonly index: number;
}): ItemContext {
  return {
    input: input.batch,
    asset: input.asset,
    row: requireSheetRow(input.batch.rowByTaskId, input.asset.taskId),
    index: input.index,
    totalAssets: input.batch.assets.length,
    itemStartedAt: Date.now(),
    taxonomyVersionId: input.batch.taxonomyVersionId ?? 'taxonomy-v1',
    archiveDimension: input.batch.archiveDimension ?? '内容题材',
    modelRequestMs: 0,
    tagNormalizeMs: 0
  };
}

function emitItemStarted(context: ItemContext): void {
  context.input.emit('tagging-item', 'running', `Analyzing ${context.asset.fileName}`, {
    currentItem: context.asset.fileName,
    progress: { current: context.index + 1, total: context.totalAssets }
  });
}

async function requestInitialModelResult(
  context: ItemContext
): Promise<GenerateModelCandidatePathsResult | undefined> {
  if (context.input.taggingMode !== 'qwen') {
    return undefined;
  }
  return timeModelRequest(context, () => generateModelCandidatePaths(buildModelInput(context)));
}

function buildModelInput(context: ItemContext) {
  return {
    mediaFilePath: context.asset.filePath,
    mediaAssetId: context.asset.mediaAssetId,
    taxonomyTree: context.input.taxonomyTree,
    promptLibrary: context.input.promptLibrary,
    taxonomyBaseMarkdown: context.input.taxonomyBaseMarkdown,
    taxonomyVersionId: context.taxonomyVersionId,
    archiveDimension: context.archiveDimension,
    archivePathPolicy: context.input.archivePathPolicy,
    modelResponseShape: context.input.modelResponseShape,
    providerConfig: requireValue(context.input.realModelProviderConfig, 'The selected real-model provider config is required when tagging-mode=qwen.'),
    videoCacheDirectory: DEFAULT_VIDEO_CACHE_DIRECTORY,
    selectedModelProfileId: context.input.selectedModelProfileId
  };
}

async function timeModelRequest<T>(context: ItemContext, operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await withRateLimitRetry({ operation });
  } finally {
    context.modelRequestMs += Date.now() - startedAt;
  }
}

function resolveCandidatePaths(
  context: ItemContext,
  modelResult: GenerateModelCandidatePathsResult | undefined
): readonly string[] {
  const paths = context.input.taggingMode === 'qwen'
    ? modelResult?.candidatePaths
    : context.input.candidateFixtures?.[context.asset.sourceUrl];
  if (paths === undefined) {
    throw new Error(`Missing candidate fixture for source URL: "${context.asset.sourceUrl}"`);
  }
  return paths;
}

async function normalizeAndPersist(
  context: ItemContext,
  candidatePaths: readonly string[],
  modelResult: GenerateModelCandidatePathsResult | undefined
): Promise<ProcessedTaggingResult> {
  const startedAt = Date.now();
  const taggingResult = runAutomaticTagging(buildAutomaticTaggingInput(context, candidatePaths));
  const resolution = context.input.archivePathPolicy === undefined
    ? await resolveLegacyArchivePath(context, taggingResult.acceptedPaths)
    : await resolvePolicyArchivePath(context, taggingResult.acceptedPaths, modelResult);
  context.tagNormalizeMs = Date.now() - startedAt;
  await persistTaggingResult(context, resolution, modelResult);
  const selectedArchivePath = 'selectedArchivePath' in resolution
    ? resolution.selectedArchivePath
    : resolution.selectedContentTopicPath;
  return {
    candidateCount: candidatePaths.length,
    acceptedCount: resolution.acceptedPaths.length,
    selectedArchivePath,
    fallbackApplied: 'fallbackApplied' in resolution
      ? resolution.fallbackApplied
      : resolution.repairApplied
  };
}

function buildAutomaticTaggingInput(context: ItemContext, candidatePaths: readonly string[]) {
  return {
    taskId: context.asset.taskId,
    mediaAssetId: context.asset.mediaAssetId,
    taxonomyVersionId: context.taxonomyVersionId,
    fingerprintId: createFingerprint(context).id,
    candidateSetId: `candidate:${context.index + 1}`,
    assignmentId: `assignment:${context.index + 1}`,
    generatedAt: context.input.startedAt,
    assignedAt: context.input.startedAt,
    candidatePaths,
    taxonomyTree: context.input.taxonomyTree,
    promptLibrary: context.input.promptLibrary
  };
}

function createFingerprint(context: ItemContext) {
  return createDecisionFingerprint({
    id: `fingerprint:${context.asset.taskId}`,
    taskId: context.asset.taskId,
    entityId: context.asset.mediaAssetId,
    entityType: 'tag-assignment',
    taxonomyVersionId: context.taxonomyVersionId,
    modelAdapterVersion: context.input.taggingMode === 'qwen'
      ? `qwen-compatible:${context.input.selectedVideoModelProfile?.modelName ?? 'unknown'}`
      : 'simulated-model:gpt-5.4',
    decisionClass: 'cli-local-pipeline',
    timestamp: context.input.startedAt
  });
}

async function resolveLegacyArchivePath(context: ItemContext, acceptedPaths: readonly string[]) {
  return resolveRequiredContentTopic({
    acceptedPaths,
    archiveDimension: context.archiveDimension,
    requestFallbackPaths: async () => requestLegacyFallback(context)
  });
}

async function requestLegacyFallback(context: ItemContext): Promise<readonly string[]> {
  if (context.input.taggingMode !== 'qwen') {
    return Object.freeze([]);
  }
  const result = await timeModelRequest(context, () =>
    generateContentTopicCandidatePaths(buildModelInput(context))
  );
  return runAutomaticTagging({
    ...buildAutomaticTaggingInput(context, result.candidatePaths),
    candidateSetId: `candidate:${context.index + 1}:content-topic`,
    assignmentId: `assignment:${context.index + 1}:content-topic`
  }).acceptedPaths;
}

async function resolvePolicyArchivePath(
  context: ItemContext,
  acceptedPaths: readonly string[],
  modelResult: GenerateModelCandidatePathsResult | undefined
) {
  return resolveRequiredArchivePath({
    acceptedPaths,
    structuredResponse: modelResult?.structuredResponse,
    modelJson: modelResult?.parsedJson,
    policy: requireValue(context.input.archivePathPolicy, 'Archive path policy is required.'),
    taxonomyTree: context.input.taxonomyTree,
    allowPathSynthesis: context.input.taggingMode !== 'qwen',
    requestRepair: async () => requestPolicyRepair(context)
  });
}

async function requestPolicyRepair(context: ItemContext) {
  if (context.input.taggingMode !== 'qwen') {
    throw new ArchivePrimaryTagError('archive-primary-tag-missing');
  }
  const result = await timeModelRequest(context, () => generateModelCandidatePaths(buildModelInput(context)));
  return { structuredResponse: result.structuredResponse, modelJson: result.parsedJson };
}

type ArchiveResolution = Awaited<ReturnType<typeof resolveLegacyArchivePath>> |
  Awaited<ReturnType<typeof resolvePolicyArchivePath>>;

async function persistTaggingResult(
  context: ItemContext,
  resolution: ArchiveResolution,
  modelResult: GenerateModelCandidatePathsResult | undefined
): Promise<void> {
  const selectedPath = 'selectedArchivePath' in resolution
    ? resolution.selectedArchivePath
    : resolution.selectedContentTopicPath;
  const archivePath = ['视频数据归档库', ...selectedPath.split(' > ')].join('/');
  const modelJson = 'mergedModelJson' in resolution
    ? resolution.mergedModelJson ?? modelResult?.parsedJson
    : modelResult?.parsedJson;
  const payload = buildTaggingJsonPayload(context.taxonomyVersionId, modelJson, resolution.acceptedPaths);
  const jsonFileName = replaceExtension(context.asset.fileName, '.json');
  await writeFile(replaceExtension(context.asset.filePath, '.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  context.input.resultsByRow.set(context.row.rowNumber, {
    rowNumber: context.row.rowNumber, url: context.row.url,
    collector: context.row.values['采集人'] ?? '', archiveState: '待归档',
    levelValues: buildStructuredLevelValues(resolution.acceptedPaths, context.archiveDimension),
    archivePath, archiveFileName: '', taggingJsonFileName: jsonFileName,
    taggingJsonArchivePath: archivePath, taggingJsonPayload: payload,
    acceptedPaths: resolution.acceptedPaths, selectedContentTopicPath: selectedPath,
    timings: buildTimings(context)
  });
}

function buildTaggingJsonPayload(
  taxonomyVersionId: string,
  modelJson: unknown | undefined,
  acceptedPaths: readonly string[]
): unknown {
  if (modelJson !== undefined) {
    return modelJson;
  }
  return Object.freeze({ taxonomy_version: taxonomyVersionId, accepted_paths: acceptedPaths });
}

function emitItemSucceeded(
  context: ItemContext,
  result: ProcessedTaggingResult,
  completedCount: number
): void {
  const rowState = requireValue(context.input.resultsByRow.get(context.row.rowNumber), 'Tagging result is required.');
  context.input.emit('tagging-item', 'succeeded', `${context.asset.fileName}: ${result.acceptedCount} accepted path(s)`, {
    currentItem: context.asset.fileName,
    progress: { current: completedCount, total: context.totalAssets },
    durationMs: rowState.timings?.totalMs,
    details: {
      candidateCount: result.candidateCount,
      acceptedCount: result.acceptedCount,
      selectedContentTopicPath: result.selectedArchivePath,
      fallbackApplied: result.fallbackApplied
    }
  });
}

function emitCacheIfPresent(context: ItemContext, cache: VideoTaggingCacheResult | undefined): void {
  if (cache === undefined) return;
  context.input.emit('video-preprocess', 'succeeded', `${context.asset.fileName}: ${cache.cacheHit ? 'cache-hit' : 'compressed'} ${formatBytes(cache.sourceSizeBytes)} -> ${formatBytes(cache.cacheSizeBytes)}`, {
    currentItem: context.asset.fileName,
    progress: { current: context.index + 1, total: context.totalAssets },
    details: {
      cacheHit: cache.cacheHit, sourceSizeBytes: cache.sourceSizeBytes,
      cacheSizeBytes: cache.cacheSizeBytes, sourceDurationSec: Number(cache.sourceDurationSec.toFixed(2)),
      sourceFps: Number(cache.sourceFps.toFixed(2)), cacheFps: Number(cache.cacheFps.toFixed(2)),
      profileId: cache.profileId
    }
  });
}

function handleTaggingFailure(context: ItemContext, error: unknown, completedCount: number): void {
  if (isVideoTooShortError(error)) {
    context.input.resultsByRow.set(context.row.rowNumber, {
      rowNumber: context.row.rowNumber, url: context.row.url,
      collector: context.row.values['采集人'] ?? '', archiveState: '已跳过：视频过短',
      levelValues: buildStructuredLevelValues([]), archivePath: '', archiveFileName: '',
      acceptedPaths: Object.freeze([]), selectedContentTopicPath: undefined,
      timings: buildTimings(context)
    });
    context.input.emit('tagging-item', 'succeeded', `${context.asset.fileName}: skipped because video is too short`, {
      currentItem: context.asset.fileName, progress: { current: completedCount, total: context.totalAssets },
      details: { skipped: true, reason: 'video-too-short' }
    });
    return;
  }
  persistTaggingFailure(context, error, completedCount);
}

function persistTaggingFailure(context: ItemContext, error: unknown, completedCount: number): void {
  const message = error instanceof Error ? error.message : 'Tagging failed.';
  const failure = buildFailure({
    row: context.row, phase: 'tagging', errorCode: classifyTaggingError(error),
    errorMessage: message, timestamp: new Date().toISOString()
  });
  context.input.failures.push(failure);
  context.input.resultsByRow.set(context.row.rowNumber, {
    ...createFailureRowState({
      row: context.row,
      archiveState: /缺少内容题材/iu.test(message) ? '打标失败：缺少内容题材' : '打标失败',
      failure
    }),
    timings: buildTimings(context)
  });
  context.input.emit('tagging-item', 'failed', `${context.asset.fileName}: ${failure.errorMessage}`, {
    currentItem: context.asset.fileName,
    progress: { current: completedCount, total: context.totalAssets },
    durationMs: Date.now() - context.itemStartedAt
  });
}

function buildTimings(context: ItemContext): PipelineItemTimings {
  return Object.freeze({
    preprocessMs: 0, modelRequestMs: context.modelRequestMs,
    tagNormalizeMs: context.tagNormalizeMs, archiveMs: 0,
    totalMs: Date.now() - context.itemStartedAt
  });
}

function replaceExtension(filePath: string, extension: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
}
