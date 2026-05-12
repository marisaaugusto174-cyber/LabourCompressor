import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

import { createSimulatedDownloaderAdapter } from '../../packages/adapters/downloaders/simulated-downloader.ts';
import { createYtDlpDownloaderAdapter } from '../../packages/adapters/downloaders/ytdlp-downloader.ts';
import { createFfmpegMergeOperator } from '../../packages/adapters/media/ffmpeg-merge-operator.ts';
import { mergeDownloadedStreams } from '../../packages/adapters/media/local-merge-operator.ts';
import { createPostEditArchiveRecordSpreadsheet, readSpreadsheetTaskSheet } from '../../packages/adapters/spreadsheets/local-spreadsheet.ts';
import { archiveFileByPlans } from '../../packages/adapters/storage/filesystem/archive-file-operator.ts';
import { buildArchivePlacementPlans } from '../../packages/features/archive/domain/index.ts';
import { runSpreadsheetDownloadBatch } from '../../packages/features/download/domain/index.ts';
import { buildContentTopicArchiveRoot, getEnabledProviderConfig, getVideoModelProfile, loadLocalProviderConfigFile, parsePromptLibraryMarkdown } from '../../packages/features/tagging/domain/index.ts';
import { parseTaxonomyMarkdown } from '../../packages/features/taxonomy/domain/index.ts';
import { auditPipelineResults, buildFailure, createStageEmitter, loadCandidateFixtures, loadDownloadFixtures, type PipelineRowState, requireSheetRow, requireValue, writeCurrentRunTaggingSpreadsheet, writePipelineResults } from './local-pipeline-helpers.ts';
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
import { runTaggingBatch } from './local-pipeline-tagging.ts';
import { runAutoSegmentationStage, type AutoSegmentationDependencies } from './local-pipeline-segmentation.ts';
import { type SegmentationProfileId } from '../../packages/features/segmentation/domain/index.ts';

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
  readonly autoSegmentation?: boolean;
  readonly segmentationProfileId?: SegmentationProfileId;
  readonly problemClipsDirectoryName?: string;
}

export async function runLocalPipelineCommand(input: {
  readonly options: RunLocalPipelineOptions;
  readonly report: (event: CliStageEvent) => void;
  readonly segmentationDependencies?: AutoSegmentationDependencies;
}): Promise<RunLocalPipelineResult> {
  const startedAt = input.options.timestamp ?? new Date().toISOString();
  const workflowSessionId =
    input.options.workflowSessionId ?? `workflow:${Date.now()}`;
  const emit = createStageEmitter(input.report);
  const afterEditDirectoryName = input.options.afterEditDirectoryName ?? 'AfterEdit';
  const afterEditDirectoryPath = path.join(input.options.downloadDir, afterEditDirectoryName);
  const problemClipsDirectoryPath = path.join(
    input.options.downloadDir,
    input.options.problemClipsDirectoryName ?? 'ProblemClips'
  );
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

  let activeDownloadedAssets = [...downloadBatch.downloadedAssets];
  const activeRowByTaskId = new Map(rowByTaskId);

  if (input.options.autoSegmentation === true && remoteRows.length > 0) {
    const remoteTaskIds = new Set(remoteRows.map((row) => row.taskId));
    const remoteDownloadedAssets = downloadBatch.downloadedAssets.filter((asset) => remoteTaskIds.has(asset.taskId));
    const nonRemoteAssets = downloadBatch.downloadedAssets.filter((asset) => !remoteTaskIds.has(asset.taskId));

    emit('segmentation', 'running', 'Running automatic segmentation');
    const segmentation = await runAutoSegmentationStage({
      downloadedAssets: remoteDownloadedAssets,
      rowByTaskId,
      afterEditDirectoryPath,
      problemClipsDirectoryPath,
      profileId: input.options.segmentationProfileId ?? 'standard_ad',
      startedAt,
      emit,
      dependencies: input.segmentationDependencies
    });
    activeDownloadedAssets = [...segmentation.segmentedAssets, ...nonRemoteAssets];
    for (const row of segmentation.segmentedRows) {
      activeRowByTaskId.set(row.taskId, row);
    }
    for (const rowState of segmentation.sourceRowStates) {
      resultsByRow.set(rowState.rowNumber, rowState);
    }
    for (const rowState of segmentation.problemRows) {
      resultsByRow.set(rowState.rowNumber, rowState);
    }
    for (const failure of segmentation.failures) {
      failures.push(failure);
    }
    if (segmentation.postEditEntries.length > 0) {
      createPostEditArchiveRecordSpreadsheet({
        filePath: path.join(afterEditDirectoryPath, 'AfterEdit_归档记录表.xlsx'),
        fileEntries: segmentation.postEditEntries
      });
    }
    emit('segmentation', 'succeeded', `Automatic segmentation produced ${segmentation.segmentedAssets.length} clip(s)`);
  }

  const activeDownloadBatch = Object.freeze({
    tasks: downloadBatch.tasks,
    downloadedAssets: Object.freeze(activeDownloadedAssets)
  });

  if (input.options.manualEditGate === true && input.options.autoSegmentation !== true && remoteRows.length > 0) {
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
  await runTaggingBatch({
    assets: activeDownloadBatch.downloadedAssets,
    rowByTaskId: activeRowByTaskId,
    resultsByRow,
    failures,
    startedAt,
    taggingMode: input.options.taggingMode,
    selectedModelProfileId: input.options.selectedModelProfileId,
    selectedVideoModelProfile,
    realModelProviderConfig,
    candidateFixtures,
    taxonomyTree,
    promptLibrary,
    emit
  });
  emit('tagging', 'succeeded', 'Automatic tagging finished');

  emit('archive', 'running', 'Archiving downloaded assets by accepted tag path');
  const archiveLibraryRoot = buildContentTopicArchiveRoot(input.options.archiveRoot);

  for (const asset of activeDownloadBatch.downloadedAssets) {
    const row = requireSheetRow(activeRowByTaskId, asset.taskId);
    const rowState = resultsByRow.get(row.rowNumber);

    if (
      rowState === undefined ||
      rowState.failure !== undefined ||
      rowState.selectedContentTopicPath === undefined
    ) {
      continue;
    }

    try {
      const archiveStartedAt = Date.now();
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
            : path.basename(path.join(archiveLibraryRoot, primaryArchiveRecord.archivePath)),
        timings: rowState.timings === undefined
          ? undefined
          : {
              ...rowState.timings,
              archiveMs: Date.now() - archiveStartedAt,
              totalMs: rowState.timings.totalMs + Date.now() - archiveStartedAt
            }
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
  const sortedResults = [...resultsByRow.values()].sort((left, right) => left.rowNumber - right.rowNumber);
  const currentRunSpreadsheetPath = path.join(
    input.options.downloadDir,
    '本次打标结果',
    `本次打标结果表_${sanitizeFileToken(workflowSessionId)}.xlsx`
  );
  await writePipelineResults({
    options: input.options,
    headers: sheet.headers,
    archiveLibraryRoot,
    results: sortedResults,
    startedAt,
    userWritebackRowNumbers: sheet.rows.map((row) => row.rowNumber)
  });
  await writeCurrentRunTaggingSpreadsheet({
    filePath: currentRunSpreadsheetPath,
    sourceSpreadsheetName: path.basename(input.options.spreadsheet),
    archiveLibraryRoot,
    results: sortedResults.filter((result) => activeDownloadBatch.downloadedAssets.some((asset) => {
      const row = activeRowByTaskId.get(asset.taskId);
      return row?.rowNumber === result.rowNumber;
    })),
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

  return finalizePipelineResult({ workflowSessionId, startedAt, totalRows: pendingSheet.rows.length, failures, resultsByRow, currentRunSpreadsheetPath });
}

function sanitizeFileToken(value: string): string {
  return value.replace(/[^\p{Script=Han}A-Za-z0-9_]+/gu, '_').replace(/^_+|_+$/gu, '') || 'task';
}
