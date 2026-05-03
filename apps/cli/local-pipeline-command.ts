import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

import { createDecisionFingerprint } from '../../packages/core/contracts/index.ts';
import { createSimulatedDownloaderAdapter } from '../../packages/adapters/downloaders/simulated-downloader.ts';
import { createYtDlpDownloaderAdapter } from '../../packages/adapters/downloaders/ytdlp-downloader.ts';
import { createFfmpegMergeOperator } from '../../packages/adapters/media/ffmpeg-merge-operator.ts';
import { mergeDownloadedStreams } from '../../packages/adapters/media/local-merge-operator.ts';
import { readSpreadsheetTaskSheet } from '../../packages/adapters/spreadsheets/local-spreadsheet.ts';
import { archiveFileByPlans } from '../../packages/adapters/storage/filesystem/archive-file-operator.ts';
import { buildArchivePlacementPlans } from '../../packages/features/archive/domain/index.ts';
import { runSpreadsheetDownloadBatch } from '../../packages/features/download/domain/index.ts';
import { buildContentTopicArchiveRoot, buildStructuredLevelValues, generateModelCandidatePaths, getEnabledProviderConfig, getVideoModelProfile, loadLocalProviderConfigFile, parsePromptLibraryMarkdown, runAutomaticTagging, selectUniqueContentTopicPath } from '../../packages/features/tagging/domain/index.ts';
import { parseTaxonomyMarkdown } from '../../packages/features/taxonomy/domain/index.ts';
import { auditPipelineResults, buildFailure, createFailureRowState, createStageEmitter, formatBytes, loadCandidateFixtures, loadDownloadFixtures, type PipelineRowState, requireSheetRow, requireValue, writePipelineResults } from './local-pipeline-helpers.ts';
import {
  applyDownloadFailureStates,
  applyManualEditGateStates,
  finalizePipelineResult,
  isDownloadAlreadySatisfied,
  loadPlatformCredentialConfig,
  resolveLocalAfterEditAssets,
  validateLocalFileRows
} from './local-pipeline-after-edit.ts';
import { type RunLocalPipelineFailure, type RunLocalPipelineResult } from './pipeline-result.ts';
import { type CliStageEvent } from './status-reporter.ts';

export interface RunLocalPipelineOptions {
  readonly spreadsheet: string;
  readonly downloadDir: string;
  readonly taxonomy: string;
  readonly promptLibrary: string;
  readonly archiveRoot: string;
  readonly downloadFixtures?: string;
  readonly candidateFixtures?: string;
  readonly workflowSessionId?: string;
  readonly acceptedTagsColumnName?: string;
  readonly timestamp?: string;
  readonly downloaderMode?: 'simulated' | 'yt-dlp';
  readonly mergeMode?: 'local' | 'ffmpeg';
  readonly taggingMode?: 'simulated' | 'qwen';
  readonly providerConfigPath?: string;
  readonly ytDlpBinary?: string;
  readonly cookiesFilePath?: string;
  readonly cookiesFromBrowser?: string;
  readonly platformCredentialConfigPath?: string;
  readonly writebackTarget?: 'user' | 'master' | 'both';
  readonly masterSpreadsheetPath?: string;
  readonly manualEditGate?: boolean;
  readonly afterEditDirectoryName?: string;
  readonly selectedModelProfileId?: string;
}

export async function runLocalPipelineCommand(input: {
  readonly options: RunLocalPipelineOptions;
  readonly report: (event: CliStageEvent) => void;
}): Promise<RunLocalPipelineResult> {
  const startedAt = input.options.timestamp ?? new Date().toISOString();
  const workflowSessionId =
    input.options.workflowSessionId ?? `workflow:${Date.now()}`;
  const emit = createStageEmitter(input.report);
  const afterEditDirectoryName = input.options.afterEditDirectoryName ?? 'AfterEdit';
  const afterEditDirectoryPath = path.join(input.options.downloadDir, afterEditDirectoryName);
  const platformCredentialConfig = await loadPlatformCredentialConfig(input.options.platformCredentialConfigPath);
  const resultsByRow = new Map<number, PipelineRowState>();
  const failures: RunLocalPipelineFailure[] = [];

  emit('spreadsheet', 'running', `Reading spreadsheet ${input.options.spreadsheet}`);
  const sheet = readSpreadsheetTaskSheet({
    filePath: input.options.spreadsheet,
    urlColumnIndex: 0
  });
  const pendingRows = sheet.rows.filter((row) => !isDownloadAlreadySatisfied(row));
  const skippedRows = sheet.rows.length - pendingRows.length;
  const pendingSheet = Object.freeze({
    ...sheet,
    rows: Object.freeze(pendingRows)
  });
  const rowByTaskId = new Map(pendingSheet.rows.map((row) => [row.taskId, row] as const));
  const remoteRows = pendingSheet.rows.filter((row) => row.sourceKind === 'url');
  const localFileRows = pendingSheet.rows.filter((row) => row.sourceKind === 'local-file');
  emit(
    'spreadsheet',
    'succeeded',
    skippedRows === 0
      ? `Loaded ${sheet.rows.length} task rows`
      : `Loaded ${sheet.rows.length} task rows, pending ${pendingRows.length}, skipped ${skippedRows} completed row(s)`,
    { progress: { current: pendingRows.length, total: sheet.rows.length } }
  );

  emit('fixtures', 'running', 'Loading simulation fixtures when required');
  const downloadFixtures =
    remoteRows.length > 0 ? await loadDownloadFixtures(input.options) : {};
  const candidateFixtures = await loadCandidateFixtures(input.options);
  emit('fixtures', 'succeeded', 'Fixture loading completed');

  await mkdir(afterEditDirectoryPath, { recursive: true });

  if (localFileRows.length > 0) {
    const localFileValidation = await validateLocalFileRows({ localFileRows, afterEditDirectoryPath, startedAt });

    for (const failure of localFileValidation.failures) {
      failures.push(failure);
    }
    for (const [rowNumber, rowState] of localFileValidation.resultsByRow) {
      resultsByRow.set(rowNumber, rowState);
    }

    if (localFileValidation.failures.length > 0) {
      const results = [...resultsByRow.values()].sort((left, right) => left.rowNumber - right.rowNumber);
      emit('download', 'failed', 'AfterEdit 文件校验未通过，已阻断进入打标阶段');
      emit('writeback', 'running', 'Writing validation failures back to spreadsheet targets');
      await writePipelineResults({
        options: input.options,
        headers: sheet.headers,
        archiveLibraryRoot: buildContentTopicArchiveRoot(input.options.archiveRoot),
        results,
        startedAt
      });
      emit('writeback', 'succeeded', 'Spreadsheet writeback completed');

      return finalizePipelineResult({ workflowSessionId, startedAt, totalRows: pendingSheet.rows.length, failures, resultsByRow, forceSucceededRows: 0 });
    }
  }

  emit('download', 'running', 'Resolving downloadable inputs');
  const downloadedAssets = [];
  const downloadTasks = [];

  if (remoteRows.length > 0) {
    const downloadBatch = await runSpreadsheetDownloadBatch({
      workflowSessionId,
      sheet: Object.freeze({
        ...pendingSheet,
        rows: Object.freeze(remoteRows)
      }),
      outputDirectory: input.options.downloadDir,
      downloader:
        input.options.downloaderMode === 'yt-dlp'
          ? createYtDlpDownloaderAdapter({
              binaryPath: input.options.ytDlpBinary,
              cookiesFilePath: input.options.cookiesFilePath,
              cookiesFromBrowser: input.options.cookiesFromBrowser,
              platformCredentialConfig
            })
          : createSimulatedDownloaderAdapter({
              fixtures: downloadFixtures,
              downloadedAt: startedAt
            }),
      mergeOperator:
        input.options.mergeMode === 'ffmpeg'
          ? createFfmpegMergeOperator()
          : { mergeStreams: mergeDownloadedStreams },
      startedAt
    });
    downloadTasks.push(...downloadBatch.tasks);
    downloadedAssets.push(...downloadBatch.downloadedAssets);
  }

  const localAfterEditAssets = await resolveLocalAfterEditAssets({ localFileRows, afterEditDirectoryPath, startedAt });
  for (const asset of localAfterEditAssets.downloadedAssets) {
    downloadedAssets.push(asset);
  }
  for (const failure of localAfterEditAssets.failures) {
    failures.push(failure);
  }
  for (const [rowNumber, rowState] of localAfterEditAssets.resultsByRow) {
    resultsByRow.set(rowNumber, rowState);
  }
  const downloadBatch = Object.freeze({
    tasks: Object.freeze(downloadTasks),
    downloadedAssets: Object.freeze(downloadedAssets)
  });
  emit(
    'download',
    'succeeded',
    `Downloaded ${downloadBatch.downloadedAssets.length} media assets`
  );
  applyDownloadFailureStates({
    rows: pendingSheet.rows,
    downloadTasks: downloadBatch.tasks,
    startedAt,
    failures,
    resultsByRow
  });

  if (input.options.manualEditGate === true && remoteRows.length > 0) {
    applyManualEditGateStates({ downloadedAssets: downloadBatch.downloadedAssets, rowByTaskId, resultsByRow });

    const results = [...resultsByRow.values()].sort((left, right) => left.rowNumber - right.rowNumber);

    emit(
      'archive',
      'pending',
      `Manual edit gate enabled. 已进入等待人工剪辑；请把剪辑后文件导出到 ${afterEditDirectoryPath}`
    );
    emit('writeback', 'running', 'Writing download status back to spreadsheet targets');
    await writePipelineResults({
      options: {
        ...input.options,
        writebackTarget: 'user'
      },
      headers: sheet.headers,
      archiveLibraryRoot: buildContentTopicArchiveRoot(input.options.archiveRoot),
      results,
      startedAt
    });
    emit('writeback', 'succeeded', 'Spreadsheet writeback completed');

    return finalizePipelineResult({ workflowSessionId, startedAt, totalRows: pendingSheet.rows.length, failures, resultsByRow });
  }

  emit('taxonomy', 'running', 'Parsing taxonomy and prompt library');
  const taxonomyTree = parseTaxonomyMarkdown(await readFile(input.options.taxonomy, 'utf8'));
  const promptLibrary = parsePromptLibraryMarkdown(await readFile(input.options.promptLibrary, 'utf8'));
  emit('taxonomy', 'succeeded', 'Taxonomy and prompt library loaded');

  const selectedVideoModelProfile =
    input.options.taggingMode === 'qwen'
      ? getVideoModelProfile(input.options.selectedModelProfileId)
      : undefined;
  const realModelProviderConfig =
    input.options.taggingMode === 'qwen'
      ? getEnabledProviderConfig(
          await loadLocalProviderConfigFile(
            input.options.providerConfigPath ??
              path.join(process.cwd(), 'config/model-providers/providers.local.json')
          ),
          requireValue(selectedVideoModelProfile, 'Selected video model profile is required.').provider
        )
      : undefined;

  emit('tagging', 'running', 'Running automatic tagging');
  const totalAssets = downloadBatch.downloadedAssets.length;

  for (const [index, asset] of downloadBatch.downloadedAssets.entries()) {
    const row = requireSheetRow(rowByTaskId, asset.taskId);

    try {
      emit(
        'tagging-item',
        'running',
        `Analyzing ${asset.fileName}`,
        {
          currentItem: asset.fileName,
          progress: { current: index + 1, total: totalAssets }
        }
      );
      const fingerprint = createDecisionFingerprint({
        id: `fingerprint:${asset.taskId}`,
        taskId: asset.taskId,
        entityId: asset.mediaAssetId,
        entityType: 'tag-assignment',
        taxonomyVersionId: 'taxonomy-v1',
        modelAdapterVersion:
          input.options.taggingMode === 'qwen'
            ? 'qwen-compatible:qwen3.6-plus'
            : 'simulated-model:gpt-5.4',
        decisionClass: 'cli-local-pipeline',
        timestamp: startedAt
      });
      const modelResult =
        input.options.taggingMode === 'qwen'
          ? await generateModelCandidatePaths({
              mediaFilePath: asset.filePath,
              mediaAssetId: asset.mediaAssetId,
              taxonomyTree,
              promptLibrary,
              providerConfig: requireValue(
                realModelProviderConfig,
                'The selected real-model provider config is required when tagging-mode=qwen.'
              ),
              videoCacheDirectory: path.join(process.cwd(), '.cache', 'video-tagging'),
              selectedModelProfileId: input.options.selectedModelProfileId
            })
          : undefined;
      const candidatePaths =
        input.options.taggingMode === 'qwen'
          ? modelResult.candidatePaths
          : candidateFixtures?.[asset.sourceUrl];

      if (candidatePaths === undefined) {
        throw new Error(`Missing candidate fixture for source URL: "${asset.sourceUrl}"`);
      }

      if (modelResult?.videoTaggingCache !== undefined) {
        const cache = modelResult.videoTaggingCache;
        emit(
          'video-preprocess',
          'succeeded',
          `${asset.fileName}: ${cache.cacheHit ? 'cache-hit' : 'compressed'} ${formatBytes(cache.sourceSizeBytes)} -> ${formatBytes(cache.cacheSizeBytes)}`,
          {
            currentItem: asset.fileName,
            progress: { current: index + 1, total: totalAssets },
            details: {
              cacheHit: cache.cacheHit,
              sourceSizeBytes: cache.sourceSizeBytes,
              cacheSizeBytes: cache.cacheSizeBytes,
              sourceDurationSec: Number(cache.sourceDurationSec.toFixed(2)),
              sourceFps: Number(cache.sourceFps.toFixed(2)),
              cacheFps: Number(cache.cacheFps.toFixed(2)),
              profileId: cache.profileId
            }
          }
        );
      }

      const taggingResult = runAutomaticTagging({
        taskId: asset.taskId,
        mediaAssetId: asset.mediaAssetId,
        taxonomyVersionId: 'taxonomy-v1',
        fingerprintId: fingerprint.id,
        candidateSetId: `candidate:${index + 1}`,
        assignmentId: `assignment:${index + 1}`,
        generatedAt: startedAt,
        assignedAt: startedAt,
        candidatePaths,
        taxonomyTree,
        promptLibrary
      });
      const contentTopicDecision = selectUniqueContentTopicPath(taggingResult.acceptedPaths);
      const archivePath =
        contentTopicDecision.selectedPath === undefined
          ? ''
          : ['视频数据归档库', ...contentTopicDecision.selectedPath.split(' > ')].join('/');

      resultsByRow.set(
        row.rowNumber,
        {
          rowNumber: row.rowNumber,
          url: row.url,
          collector: row.values['采集人'] ?? '',
          archiveState:
            contentTopicDecision.selectedPath === undefined ? '已下载未归档' : '待归档',
          levelValues: buildStructuredLevelValues(taggingResult.acceptedPaths),
          archivePath,
          archiveFileName: '',
          acceptedPaths: taggingResult.acceptedPaths,
          selectedContentTopicPath: contentTopicDecision.selectedPath
        }
      );
      emit(
        'tagging-item',
        'succeeded',
        `${asset.fileName}: ${taggingResult.acceptedPaths.length} accepted path(s)`,
        {
          currentItem: asset.fileName,
          progress: { current: index + 1, total: totalAssets },
          details: {
            candidateCount: candidatePaths.length,
            acceptedCount: taggingResult.acceptedPaths.length,
            selectedContentTopicPath: contentTopicDecision.selectedPath ?? null
          }
        }
      );
    } catch (error) {
      if (isVideoTooShortError(error)) {
        resultsByRow.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          url: row.url,
          collector: row.values['采集人'] ?? '',
          archiveState: '已跳过：视频过短',
          levelValues: buildStructuredLevelValues([]),
          archivePath: '',
          archiveFileName: '',
          acceptedPaths: Object.freeze([]),
          selectedContentTopicPath: undefined
        });
        emit('tagging-item', 'succeeded', `${asset.fileName}: skipped because video is too short`, {
          currentItem: asset.fileName,
          progress: { current: index + 1, total: totalAssets },
          details: {
            skipped: true,
            reason: 'video-too-short'
          }
        });
        continue;
      }

      const failure = buildFailure({
        row,
        phase: 'tagging',
        errorCode: 'tagging-failed',
        errorMessage: error instanceof Error ? error.message : 'Tagging failed.',
        timestamp: new Date().toISOString()
      });
      failures.push(failure);
      resultsByRow.set(
        row.rowNumber,
        createFailureRowState({
          row,
          archiveState: '打标失败',
          failure
        })
      );
      emit('tagging-item', 'failed', `${asset.fileName}: ${failure.errorMessage}`, {
        currentItem: asset.fileName,
        progress: { current: index + 1, total: totalAssets }
      });
    }
  }
  emit('tagging', 'succeeded', 'Automatic tagging finished');

  emit('archive', 'running', 'Archiving downloaded assets by accepted tag path');
  const archiveLibraryRoot = buildContentTopicArchiveRoot(input.options.archiveRoot);

  for (const asset of downloadBatch.downloadedAssets) {
    const row = requireSheetRow(rowByTaskId, asset.taskId);
    const rowState = resultsByRow.get(row.rowNumber);

    if (
      rowState === undefined ||
      rowState.failure !== undefined ||
      rowState.selectedContentTopicPath === undefined
    ) {
      continue;
    }

    try {
      const archiveRecords = await archiveFileByPlans({
        sourceFilePath: asset.filePath,
        archiveRoot: archiveLibraryRoot,
        placementPlans: buildArchivePlacementPlans({
          acceptedPaths: [rowState.selectedContentTopicPath],
          fileName: asset.fileName
        }),
        placementMode: 'copy',
        taskId: asset.taskId,
        mediaAssetId: asset.mediaAssetId,
        taxonomyVersionId: 'taxonomy-v1',
        fingerprintId: `fingerprint:${asset.taskId}`,
        recordedAt: startedAt
      });
      const primaryArchiveRecord = archiveRecords[0];

      resultsByRow.set(row.rowNumber, {
        ...rowState,
        archiveState: '已归档',
        archiveFileName:
          primaryArchiveRecord === undefined
            ? ''
            : path.basename(path.join(archiveLibraryRoot, primaryArchiveRecord.archivePath))
      });
    } catch (error) {
      const failure = buildFailure({
        row,
        phase: 'archive',
        errorCode: 'archive-failed',
        errorMessage: error instanceof Error ? error.message : 'Archive failed.',
        timestamp: new Date().toISOString()
      });
      failures.push(failure);
      resultsByRow.set(row.rowNumber, {
        ...rowState,
        archiveState: '归档失败',
        failure
      });
    }
  }
  emit('archive', 'succeeded', 'Archive processing completed');

  emit('writeback', 'running', 'Writing results back to spreadsheet targets');
  await writePipelineResults({
    options: input.options,
    headers: sheet.headers,
    archiveLibraryRoot,
    results: [...resultsByRow.values()].sort((left, right) => left.rowNumber - right.rowNumber),
    startedAt
  });
  emit('writeback', 'succeeded', 'Spreadsheet writeback completed');
  emit('audit', 'running', 'Running archive consistency audit');

  const auditIssues = await auditPipelineResults({
    results: [...resultsByRow.values()],
    archiveLibraryRoot
  });
  emit(
    'audit',
    auditIssues.length === 0 ? 'succeeded' : 'failed',
    auditIssues.length === 0
      ? 'Archive consistency audit passed.'
      : `Archive consistency audit found ${auditIssues.length} issue(s).`,
    auditIssues.length === 0
      ? undefined
      : {
          details: {
            issues: auditIssues.join(' | ')
          }
        }
  );

  return finalizePipelineResult({ workflowSessionId, startedAt, totalRows: pendingSheet.rows.length, failures, resultsByRow });
}

function isVideoTooShortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /video file is too short|video modality input does not meet the requirements/iu.test(message);
}
