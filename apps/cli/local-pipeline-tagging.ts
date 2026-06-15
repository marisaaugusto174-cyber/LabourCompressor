import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import {
  createDecisionFingerprint
} from '../../packages/core/contracts/index.ts';
import {
  type DownloadedMediaAsset
} from '../../packages/features/download/domain/index.ts';
import {
  buildStructuredLevelValues,
  generateContentTopicCandidatePaths,
  generateModelCandidatePaths,
  runAutomaticTagging,
  selectUniqueArchivePath,
  type LocalProviderConfig,
  type PromptLibraryDocument,
  type VideoModelProfile
} from '../../packages/features/tagging/domain/index.ts';
import {
  type ParsedTaxonomyTree
} from '../../packages/features/taxonomy/domain/index.ts';
import {
  type SpreadsheetTaskRow
} from '../../packages/features/spreadsheet-tasks/domain/index.ts';
import {
  buildFailure,
  createFailureRowState,
  formatBytes,
  type PipelineRowState,
  requireSheetRow,
  requireValue
} from './local-pipeline-helpers.ts';
import { type RunLocalPipelineFailure } from './pipeline-result.ts';
import { type CliStageEvent } from './status-reporter.ts';
import { DEFAULT_VIDEO_CACHE_DIRECTORY } from './project-paths.ts';
import { type VideoTaggingCacheResult } from '../../packages/adapters/media/media-frame-extractor.ts';

export interface RequiredContentTopicResolution {
  readonly acceptedPaths: readonly string[];
  readonly selectedContentTopicPath: string;
  readonly fallbackApplied: boolean;
}

export interface PipelineItemTimings {
  readonly preprocessMs: number;
  readonly modelRequestMs: number;
  readonly tagNormalizeMs: number;
  readonly archiveMs: number;
  readonly totalMs: number;
}

export async function runTaggingBatch(input: {
  readonly assets: readonly DownloadedMediaAsset[];
  readonly rowByTaskId: ReadonlyMap<string, SpreadsheetTaskRow>;
  readonly resultsByRow: Map<number, PipelineRowState>;
  readonly failures: RunLocalPipelineFailure[];
  readonly startedAt: string;
  readonly taggingMode?: 'simulated' | 'qwen';
  readonly selectedModelProfileId?: string;
  readonly selectedVideoModelProfile?: VideoModelProfile;
  readonly realModelProviderConfig?: LocalProviderConfig;
  readonly candidateFixtures?: Record<string, readonly string[]>;
  readonly taxonomyTree: ParsedTaxonomyTree;
  readonly promptLibrary: PromptLibraryDocument;
  readonly taxonomyBaseMarkdown?: string;
  readonly taxonomyVersionId?: string;
  readonly archiveDimension?: string;
  readonly modelResponseShape?: 'paths-json-array' | 'structured-json';
  readonly emit: (
    stage: string,
    status: CliStageEvent['status'],
    message: string,
    extras?: Omit<CliStageEvent, 'stage' | 'status' | 'message' | 'timestamp'>
  ) => void;
}): Promise<void> {
  let completedCount = 0;
  const totalAssets = input.assets.length;
  const concurrency =
    input.taggingMode === 'qwen'
      ? input.selectedVideoModelProfile?.defaultTaggingConcurrency ?? 1
      : 1;

  await runConcurrentInOrder(input.assets, concurrency, async (asset, index) => {
    const row = requireSheetRow(input.rowByTaskId, asset.taskId);
    const itemStartedAt = Date.now();
    let modelRequestMs = 0;
    let tagNormalizeMs = 0;

	    try {
      const taxonomyVersionId = input.taxonomyVersionId ?? 'taxonomy-v1';
      const archiveDimension = input.archiveDimension ?? '内容题材';
	      input.emit('tagging-item', 'running', `Analyzing ${asset.fileName}`, {
        currentItem: asset.fileName,
        progress: { current: index + 1, total: totalAssets }
      });
      const fingerprint = createDecisionFingerprint({
        id: `fingerprint:${asset.taskId}`,
        taskId: asset.taskId,
        entityId: asset.mediaAssetId,
        entityType: 'tag-assignment',
	        taxonomyVersionId,
        modelAdapterVersion:
          input.taggingMode === 'qwen'
            ? `qwen-compatible:${input.selectedVideoModelProfile?.modelName ?? 'unknown'}`
            : 'simulated-model:gpt-5.4',
        decisionClass: 'cli-local-pipeline',
        timestamp: input.startedAt
      });
      const modelStartedAt = Date.now();
      const modelResult =
        input.taggingMode === 'qwen'
          ? await withRateLimitRetry({
              operation: () => generateModelCandidatePaths({
                mediaFilePath: asset.filePath,
                mediaAssetId: asset.mediaAssetId,
                taxonomyTree: input.taxonomyTree,
	                promptLibrary: input.promptLibrary,
                taxonomyBaseMarkdown: input.taxonomyBaseMarkdown,
                taxonomyVersionId,
                archiveDimension,
                modelResponseShape: input.modelResponseShape,
	                providerConfig: requireValue(input.realModelProviderConfig, 'The selected real-model provider config is required when tagging-mode=qwen.'),
                videoCacheDirectory: DEFAULT_VIDEO_CACHE_DIRECTORY,
                selectedModelProfileId: input.selectedModelProfileId
              })
            })
          : undefined;
      modelRequestMs += Date.now() - modelStartedAt;
      const candidatePaths =
        input.taggingMode === 'qwen'
          ? modelResult?.candidatePaths
          : input.candidateFixtures?.[asset.sourceUrl];

      if (candidatePaths === undefined) {
        throw new Error(`Missing candidate fixture for source URL: "${asset.sourceUrl}"`);
      }

      if (modelResult?.videoTaggingCache !== undefined) {
        emitVideoCacheEvent({ input, asset, index, totalAssets, cache: modelResult.videoTaggingCache });
      }

      const normalizeStartedAt = Date.now();
      const taggingResult = runAutomaticTagging({
        taskId: asset.taskId,
        mediaAssetId: asset.mediaAssetId,
	        taxonomyVersionId,
        fingerprintId: fingerprint.id,
        candidateSetId: `candidate:${index + 1}`,
        assignmentId: `assignment:${index + 1}`,
        generatedAt: input.startedAt,
        assignedAt: input.startedAt,
        candidatePaths,
        taxonomyTree: input.taxonomyTree,
        promptLibrary: input.promptLibrary
      });
	      const topicResolution = await resolveRequiredContentTopic({
	        acceptedPaths: taggingResult.acceptedPaths,
        archiveDimension,
	        requestFallbackPaths: async () => {
          if (input.taggingMode !== 'qwen') {
            return Object.freeze([]);
          }
          const fallbackStartedAt = Date.now();
          const fallbackResult = await withRateLimitRetry({
            operation: () => generateContentTopicCandidatePaths({
              mediaFilePath: asset.filePath,
              mediaAssetId: asset.mediaAssetId,
	              taxonomyTree: input.taxonomyTree,
	              promptLibrary: input.promptLibrary,
              taxonomyBaseMarkdown: input.taxonomyBaseMarkdown,
              taxonomyVersionId,
              archiveDimension,
              modelResponseShape: input.modelResponseShape,
	              providerConfig: requireValue(input.realModelProviderConfig, 'The selected real-model provider config is required when tagging-mode=qwen.'),
              videoCacheDirectory: DEFAULT_VIDEO_CACHE_DIRECTORY,
              selectedModelProfileId: input.selectedModelProfileId
            })
          });
          modelRequestMs += Date.now() - fallbackStartedAt;
          return runAutomaticTagging({
            taskId: asset.taskId,
            mediaAssetId: asset.mediaAssetId,
	            taxonomyVersionId,
            fingerprintId: fingerprint.id,
            candidateSetId: `candidate:${index + 1}:content-topic`,
            assignmentId: `assignment:${index + 1}:content-topic`,
            generatedAt: input.startedAt,
            assignedAt: input.startedAt,
            candidatePaths: fallbackResult.candidatePaths,
            taxonomyTree: input.taxonomyTree,
            promptLibrary: input.promptLibrary
          }).acceptedPaths;
        }
      });
	      tagNormalizeMs = Date.now() - normalizeStartedAt;
	      const archivePath = ['视频数据归档库', ...topicResolution.selectedContentTopicPath.split(' > ')].join('/');
      const taggingJsonPayload = buildTaggingJsonPayload({
        taxonomyVersionId,
        modelJson: modelResult?.parsedJson,
        acceptedPaths: topicResolution.acceptedPaths
      });
      const taggingJsonFileName = replaceExtension(asset.fileName, '.json');
      await writeFile(
        replaceExtension(asset.filePath, '.json'),
        `${JSON.stringify(taggingJsonPayload, null, 2)}\n`,
        'utf8'
      );
	      const timings = buildTimings({ itemStartedAt, modelRequestMs, tagNormalizeMs });

      input.resultsByRow.set(row.rowNumber, {
        rowNumber: row.rowNumber,
        url: row.url,
        collector: row.values['采集人'] ?? '',
        archiveState: '待归档',
	        levelValues: buildStructuredLevelValues(topicResolution.acceptedPaths, archiveDimension),
	        archivePath,
	        archiveFileName: '',
        taggingJsonFileName,
        taggingJsonArchivePath: archivePath,
        taggingJsonPayload,
	        acceptedPaths: topicResolution.acceptedPaths,
        selectedContentTopicPath: topicResolution.selectedContentTopicPath,
        timings
      });
      completedCount += 1;
      input.emit('tagging-item', 'succeeded', `${asset.fileName}: ${topicResolution.acceptedPaths.length} accepted path(s)`, {
        currentItem: asset.fileName,
        progress: { current: completedCount, total: totalAssets },
        durationMs: timings.totalMs,
        details: {
          candidateCount: candidatePaths.length,
          acceptedCount: topicResolution.acceptedPaths.length,
          selectedContentTopicPath: topicResolution.selectedContentTopicPath,
          fallbackApplied: topicResolution.fallbackApplied
        }
      });
    } catch (error) {
      handleTaggingFailure({ input, asset, row, error, index, totalAssets, completedCount, itemStartedAt, modelRequestMs, tagNormalizeMs });
      completedCount += 1;
    }
  });
}

export async function resolveRequiredContentTopic(input: {
  readonly acceptedPaths: readonly string[];
  readonly archiveDimension?: string;
  readonly requestFallbackPaths: () => Promise<readonly string[]>;
}): Promise<RequiredContentTopicResolution> {
  const archiveDimension = input.archiveDimension ?? '内容题材';
  const firstDecision = selectUniqueArchivePath({
    acceptedPaths: input.acceptedPaths,
    archiveDimension
  });

  if (firstDecision.selectedPath !== undefined) {
    return Object.freeze({
      acceptedPaths: Object.freeze([...input.acceptedPaths]),
      selectedContentTopicPath: firstDecision.selectedPath,
      fallbackApplied: false
    });
  }

  const fallbackPaths = await input.requestFallbackPaths();
  const mergedPaths = Object.freeze(
    [...new Set([...input.acceptedPaths, ...fallbackPaths].map((value) => value.trim()).filter(Boolean))]
  );
  const fallbackDecision = selectUniqueArchivePath({
    acceptedPaths: mergedPaths,
    archiveDimension
  });

  if (fallbackDecision.selectedPath === undefined) {
    throw new Error(`打标失败：缺少${archiveDimension}`);
  }

  return Object.freeze({
    acceptedPaths: mergedPaths,
    selectedContentTopicPath: fallbackDecision.selectedPath,
    fallbackApplied: true
  });
}

export async function runConcurrentInOrder<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<readonly R[]> {
  const safeConcurrency = Math.max(1, Math.min(Math.floor(concurrency), items.length || 1));
  const results: R[] = Array.from({ length: items.length });
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: safeConcurrency }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
      }
    })
  );

  return Object.freeze(results);
}

function emitVideoCacheEvent(input: {
  readonly input: Parameters<typeof runTaggingBatch>[0];
  readonly asset: DownloadedMediaAsset;
  readonly index: number;
  readonly totalAssets: number;
  readonly cache: VideoTaggingCacheResult;
}): void {
  input.input.emit(
    'video-preprocess',
    'succeeded',
    `${input.asset.fileName}: ${input.cache.cacheHit ? 'cache-hit' : 'compressed'} ${formatBytes(input.cache.sourceSizeBytes)} -> ${formatBytes(input.cache.cacheSizeBytes)}`,
    {
      currentItem: input.asset.fileName,
      progress: { current: input.index + 1, total: input.totalAssets },
      details: {
        cacheHit: input.cache.cacheHit,
        sourceSizeBytes: input.cache.sourceSizeBytes,
        cacheSizeBytes: input.cache.cacheSizeBytes,
        sourceDurationSec: Number(input.cache.sourceDurationSec.toFixed(2)),
        sourceFps: Number(input.cache.sourceFps.toFixed(2)),
        cacheFps: Number(input.cache.cacheFps.toFixed(2)),
        profileId: input.cache.profileId
      }
    }
  );
}

function handleTaggingFailure(input: {
  readonly input: Parameters<typeof runTaggingBatch>[0];
  readonly asset: DownloadedMediaAsset;
  readonly row: SpreadsheetTaskRow;
  readonly error: unknown;
  readonly index: number;
  readonly totalAssets: number;
  readonly completedCount: number;
  readonly itemStartedAt: number;
  readonly modelRequestMs: number;
  readonly tagNormalizeMs: number;
}): void {
  if (isVideoTooShortError(input.error)) {
    input.input.resultsByRow.set(input.row.rowNumber, {
      rowNumber: input.row.rowNumber,
      url: input.row.url,
      collector: input.row.values['采集人'] ?? '',
      archiveState: '已跳过：视频过短',
      levelValues: buildStructuredLevelValues([]),
      archivePath: '',
      archiveFileName: '',
      acceptedPaths: Object.freeze([]),
      selectedContentTopicPath: undefined,
      timings: buildTimings(input)
    });
    input.input.emit('tagging-item', 'succeeded', `${input.asset.fileName}: skipped because video is too short`, {
      currentItem: input.asset.fileName,
      progress: { current: input.completedCount + 1, total: input.totalAssets },
      details: { skipped: true, reason: 'video-too-short' }
    });
    return;
  }

  const message = input.error instanceof Error ? input.error.message : 'Tagging failed.';
  const failure = buildFailure({
    row: input.row,
    phase: 'tagging',
    errorCode: /缺少内容题材/iu.test(message) ? 'missing-content-topic' : 'tagging-failed',
    errorMessage: message,
    timestamp: new Date().toISOString()
  });
  input.input.failures.push(failure);
  input.input.resultsByRow.set(
    input.row.rowNumber,
    {
      ...createFailureRowState({
        row: input.row,
        archiveState: /缺少内容题材/iu.test(message) ? '打标失败：缺少内容题材' : '打标失败',
        failure
      }),
      timings: buildTimings(input)
    }
  );
  input.input.emit('tagging-item', 'failed', `${input.asset.fileName}: ${failure.errorMessage}`, {
    currentItem: input.asset.fileName,
    progress: { current: input.completedCount + 1, total: input.totalAssets },
    durationMs: Date.now() - input.itemStartedAt
  });
}

function buildTimings(input: {
  readonly itemStartedAt: number;
  readonly modelRequestMs: number;
  readonly tagNormalizeMs: number;
  readonly archiveMs?: number;
}): PipelineItemTimings {
  return Object.freeze({
    preprocessMs: 0,
    modelRequestMs: input.modelRequestMs,
    tagNormalizeMs: input.tagNormalizeMs,
    archiveMs: input.archiveMs ?? 0,
    totalMs: Date.now() - input.itemStartedAt
  });
}

function isVideoTooShortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /video file is too short|video modality input does not meet the requirements/iu.test(message);
}

export async function withRateLimitRetry<T>(input: {
  readonly operation: () => Promise<T>;
  readonly maxRetries?: number;
  readonly delayMs?: number;
}): Promise<T> {
  const maxRetries = input.maxRetries ?? 2;
  const delayMs = input.delayMs ?? 1200;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await input.operation();
    } catch (error) {
      if (attempt >= maxRetries || !isRateLimitError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }

  throw new Error('Unreachable rate limit retry state.');
}

export function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate limit|resource_exhausted|too many requests|rps|tps|rpm|tpm/iu.test(message);
}

export function zeroTimings(): PipelineItemTimings {
  return Object.freeze({
    preprocessMs: 0,
    modelRequestMs: 0,
    tagNormalizeMs: 0,
    archiveMs: 0,
    totalMs: 0
  });
}

function buildTaggingJsonPayload(input: {
  readonly taxonomyVersionId: string;
  readonly modelJson?: unknown;
  readonly acceptedPaths: readonly string[];
}): unknown {
  if (input.modelJson !== undefined) {
    return input.modelJson;
  }

  return Object.freeze({
    taxonomy_version: input.taxonomyVersionId,
    accepted_paths: input.acceptedPaths
  });
}

function replaceExtension(filePath: string, extension: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
}
