import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { type MediaInfoProbeResult } from '../../packages/adapters/media/ffprobe-media-info.ts';
import { type PostEditArchiveRecordFileEntry } from '../../packages/adapters/spreadsheets/local-spreadsheet.ts';
import { type DownloadedMediaAsset } from '../../packages/features/download/domain/index.ts';
import {
  enforceSegmentDurations,
  type CandidateShot,
  type SegmentTimeRange,
  type SegmentationProfileId
} from '../../packages/features/segmentation/domain/index.ts';
import { type SpreadsheetTaskRow } from '../../packages/features/spreadsheet-tasks/domain/index.ts';
import {
  buildFailure,
  createFailureRowState,
  requireSheetRow,
  type PipelineRowState
} from './local-pipeline-helpers.ts';
import { resolveSegmentationDependencies } from './local-pipeline-segmentation-dependencies.ts';
import { type RunLocalPipelineFailure } from './pipeline-result.ts';
import { type CliStageEvent } from './status-reporter.ts';

export interface AutoSegmentationDependencies {
  readonly mediaInfoReader?: {
    readMediaInfo(filePath: string): Promise<MediaInfoProbeResult>;
  };
  readonly boundaryDetector?: {
    detectShots(input: {
      readonly inputFilePath: string;
      readonly outputDirectoryPath: string;
      readonly detector: 'adaptive' | 'content';
    }): Promise<readonly CandidateShot[]>;
  };
  readonly segmentExporter?: {
    exportSegment(input: {
      readonly inputFilePath: string;
      readonly outputFilePath: string;
      readonly startSeconds: number;
      readonly endSeconds: number;
    }): Promise<{ readonly outputFilePath: string }>;
  };
}

export interface AutoSegmentationStageResult {
  readonly segmentedAssets: readonly DownloadedMediaAsset[];
  readonly segmentedRows: readonly SpreadsheetTaskRow[];
  readonly sourceRowStates: readonly PipelineRowState[];
  readonly problemRows: readonly PipelineRowState[];
  readonly postEditEntries: readonly PostEditArchiveRecordFileEntry[];
  readonly failures: readonly RunLocalPipelineFailure[];
}
interface SegmentationProfileRules {
  readonly detector: 'adaptive' | 'content';
  readonly minimumSeconds: number;
  readonly preferredMinimumSeconds: number;
  readonly maximumSeconds: number;
}
const PROFILE_RULES: Readonly<Record<SegmentationProfileId, SegmentationProfileRules>> = Object.freeze({
  standard_ad: Object.freeze({
    detector: 'adaptive',
    minimumSeconds: 3,
    preferredMinimumSeconds: 5,
    maximumSeconds: 30
  }),
  fast_cut: Object.freeze({
    detector: 'content',
    minimumSeconds: 3,
    preferredMinimumSeconds: 5,
    maximumSeconds: 30
  }),
  conservative: Object.freeze({
    detector: 'adaptive',
    minimumSeconds: 3,
    preferredMinimumSeconds: 8,
    maximumSeconds: 30
  })
});

export async function runAutoSegmentationStage(input: {
  readonly downloadedAssets: readonly DownloadedMediaAsset[];
  readonly rowByTaskId: ReadonlyMap<string, SpreadsheetTaskRow>;
  readonly afterEditDirectoryPath: string;
  readonly problemClipsDirectoryPath: string;
  readonly profileId: SegmentationProfileId;
  readonly startedAt: string;
  readonly emit: (
    stage: string,
    status: CliStageEvent['status'],
    message: string,
    extras?: Omit<CliStageEvent, 'stage' | 'status' | 'message' | 'timestamp'>
  ) => void;
  readonly dependencies?: AutoSegmentationDependencies;
}): Promise<AutoSegmentationStageResult> {
  const dependencies = resolveSegmentationDependencies(input.dependencies);
  const rules = resolveProfileRules(input.profileId);
  const state = createSegmentationState();

  await mkdir(input.afterEditDirectoryPath, { recursive: true });
  await runAssetsInOrder(input, dependencies, rules, state);

  return Object.freeze({
    segmentedAssets: Object.freeze(state.segmentedAssets),
    segmentedRows: Object.freeze(state.segmentedRows),
    sourceRowStates: Object.freeze(state.sourceRowStates),
    problemRows: Object.freeze(state.problemRows),
    postEditEntries: Object.freeze(state.postEditEntries),
    failures: Object.freeze(state.failures)
  });
}

async function runAssetsInOrder(
  input: Parameters<typeof runAutoSegmentationStage>[0],
  dependencies: Required<AutoSegmentationDependencies>,
  rules: SegmentationProfileRules,
  state: ReturnType<typeof createSegmentationState>
): Promise<void> {
  for (const [assetIndex, asset] of input.downloadedAssets.entries()) {
    input.emit('segmentation-item', 'running', `Segmenting ${asset.fileName}`, {
      currentItem: asset.fileName,
      progress: { current: assetIndex + 1, total: input.downloadedAssets.length }
    });
    await segmentAsset({ input, dependencies, rules, state, asset });
  }
}

async function segmentAsset(input: {
  readonly input: Parameters<typeof runAutoSegmentationStage>[0];
  readonly dependencies: Required<AutoSegmentationDependencies>;
  readonly rules: SegmentationProfileRules;
  readonly state: ReturnType<typeof createSegmentationState>;
  readonly asset: DownloadedMediaAsset;
}): Promise<void> {
  const row = requireSheetRow(input.input.rowByTaskId, input.asset.taskId);

  try {
    const mediaInfo = await input.dependencies.mediaInfoReader.readMediaInfo(input.asset.filePath);
    const shots = await detectNormalizedShots({ input, mediaInfo });
    const governed = enforceSegmentDurations({
      segments: shots,
      minimumSeconds: input.rules.minimumSeconds,
      preferredMinimumSeconds: input.rules.preferredMinimumSeconds,
      maximumSeconds: input.rules.maximumSeconds
    });

    await exportAcceptedSegments({ input, row, segments: governed.accepted });
    await exportProblemSegments({ input, row, segments: governed.problems.map((problem) => problem.segment) });
    pushSourceState({ input, row, hasProblems: governed.problems.length > 0 });
    input.input.emit('segmentation-item', 'succeeded', `${input.asset.fileName}: ${governed.accepted.length} clip(s)`);
  } catch (error) {
    await pushProblemForWholeAsset({
      input,
      row,
      error,
      errorCode: 'detection-result-invalid'
    });
  }
}

async function detectNormalizedShots(input: {
  readonly input: Parameters<typeof segmentAsset>[0];
  readonly mediaInfo: MediaInfoProbeResult;
}): Promise<readonly SegmentTimeRange[]> {
  const shots = await input.input.dependencies.boundaryDetector.detectShots({
    inputFilePath: input.input.asset.filePath,
    outputDirectoryPath: path.join(
      path.dirname(input.input.asset.filePath),
      '.segmentation',
      sanitizeFileToken(path.parse(input.input.asset.fileName).name)
    ),
    detector: input.input.rules.detector
  });

  if (shots.length === 0) {
    return Object.freeze([{ startSeconds: 0, endSeconds: input.mediaInfo.durationSeconds }]);
  }

  validateDetectedShots(shots, input.mediaInfo.durationSeconds);
  return Object.freeze(shots.map((shot) => Object.freeze({
    startSeconds: shot.startSeconds,
    endSeconds: Math.min(shot.endSeconds, input.mediaInfo.durationSeconds)
  })));
}

async function exportAcceptedSegments(input: {
  readonly input: Parameters<typeof segmentAsset>[0];
  readonly row: SpreadsheetTaskRow;
  readonly segments: readonly (SegmentTimeRange & { readonly forced?: boolean })[];
}): Promise<void> {
  for (const [segmentOffset, segment] of input.segments.entries()) {
    const segmentIndex = segmentOffset + 1;
    const outputFileName = buildSegmentFileName({
      sourceFileName: input.input.asset.fileName,
      segment,
      segmentIndex
    });
    const outputFilePath = path.join(input.input.input.afterEditDirectoryPath, outputFileName);

    try {
      await input.input.dependencies.segmentExporter.exportSegment({
        inputFilePath: input.input.asset.filePath,
        outputFilePath,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds
      });
      input.input.state.segmentedAssets.push(createSegmentedAsset({
        asset: input.input.asset,
        outputFilePath,
        outputFileName,
        segmentIndex
      }));
      input.input.state.segmentedRows.push(createSegmentedRow({
        row: input.row,
        taskId: `${input.input.asset.taskId}::segment-${segmentIndex}`,
        rowNumber: createSyntheticRowNumber(input.row.rowNumber, segmentIndex),
        outputFileName,
        segmentIndex
      }));
      input.input.state.postEditEntries.push({
        fileName: outputFileName,
        relativePath: outputFileName,
        originalFileName: input.input.asset.fileName,
        sourceUrl: input.row.url
      });
    } catch (error) {
      await pushProblemForSegment({
        input: input.input,
        row: input.row,
        segment,
        segmentIndex,
        error,
        errorCode: 'export-failed'
      });
    }
  }
}

async function exportProblemSegments(input: {
  readonly input: Parameters<typeof segmentAsset>[0];
  readonly row: SpreadsheetTaskRow;
  readonly segments: readonly SegmentTimeRange[];
}): Promise<void> {
  const problemBaseIndex = input.input.state.problemRows.length;

  for (const [segmentOffset, segment] of input.segments.entries()) {
    await pushProblemForSegment({
      input: input.input,
      row: input.row,
      segment,
      segmentIndex: problemBaseIndex + segmentOffset + 1,
      error: new Error('Segment cannot satisfy 3-30s duration rule.'),
      errorCode: 'duration-rule-unsatisfied'
    });
  }
}

async function pushProblemForSegment(input: {
  readonly input: Parameters<typeof segmentAsset>[0];
  readonly row: SpreadsheetTaskRow;
  readonly segment: SegmentTimeRange;
  readonly segmentIndex: number;
  readonly error: unknown;
  readonly errorCode: 'duration-rule-unsatisfied' | 'export-failed';
}): Promise<void> {
  const outputFileName = buildProblemFileName(input.input.asset.fileName, input.segmentIndex);
  const outputFilePath = path.join(input.input.input.problemClipsDirectoryPath, outputFileName);
  await mkdir(path.dirname(outputFilePath), { recursive: true });
  await input.input.dependencies.segmentExporter.exportSegment({
    inputFilePath: input.input.asset.filePath,
    outputFilePath,
    startSeconds: input.segment.startSeconds,
    endSeconds: input.segment.endSeconds
  }).catch(() => copyFile(input.input.asset.filePath, outputFilePath));
  pushProblemState({ ...input, outputFilePath, outputFileName });
}

async function pushProblemForWholeAsset(input: {
  readonly input: Parameters<typeof segmentAsset>[0];
  readonly row: SpreadsheetTaskRow;
  readonly error: unknown;
  readonly errorCode: 'detection-result-invalid';
}): Promise<void> {
  const outputFileName = buildProblemFileName(input.input.asset.fileName, 1);
  const outputFilePath = path.join(input.input.input.problemClipsDirectoryPath, outputFileName);
  await mkdir(path.dirname(outputFilePath), { recursive: true });
  await copyFile(input.input.asset.filePath, outputFilePath).catch(() => undefined);
  pushProblemState({ ...input, outputFilePath, outputFileName });
}

function pushProblemState(input: {
  readonly input: Parameters<typeof segmentAsset>[0];
  readonly row: SpreadsheetTaskRow;
  readonly error: unknown;
  readonly errorCode: 'duration-rule-unsatisfied' | 'export-failed' | 'detection-result-invalid';
  readonly outputFilePath: string;
  readonly outputFileName: string;
}): void {
  const problemMessage = createProblemFailureMessage(input.errorCode, input.error);
  const failure = buildFailure({
    row: input.row,
    phase: 'segmentation',
    errorCode: input.errorCode,
    errorMessage: problemMessage,
    timestamp: input.input.input.startedAt
  });
  input.input.state.failures.push(failure);
  input.input.state.problemRows.push(createFailureRowState({
    row: input.row,
    archiveState: '自动分割待处理',
    failure
  }));
  input.input.state.postEditEntries.push({
    fileName: input.outputFileName,
    relativePath: toPortableRelativePath(
      input.input.input.afterEditDirectoryPath,
      input.outputFilePath
    ),
    originalFileName: input.input.asset.fileName,
    sourceUrl: input.row.url,
    archiveState: '自动分割待处理',
    failureMessage: problemMessage
  });
}

function pushSourceState(input: {
  readonly input: Parameters<typeof segmentAsset>[0];
  readonly row: SpreadsheetTaskRow;
  readonly hasProblems: boolean;
}): void {
  input.input.state.sourceRowStates.push({
    rowNumber: input.row.rowNumber,
    url: input.row.url,
    collector: input.row.values['采集人'] ?? '',
    archiveState: input.hasProblems ? '自动分割完成，含问题片段' : '自动分割完成',
    levelValues: Object.freeze({
      一级标签: '',
      二级标签: '',
      三级标签: '',
      四级标签: ''
    }),
    archivePath: '',
    archiveFileName: '',
    acceptedPaths: Object.freeze([]),
    selectedContentTopicPath: undefined
  });
}

function createSegmentedAsset(input: {
  readonly asset: DownloadedMediaAsset;
  readonly outputFilePath: string;
  readonly outputFileName: string;
  readonly segmentIndex: number;
}): DownloadedMediaAsset {
  return Object.freeze({
    ...input.asset,
    mediaAssetId: `${input.asset.mediaAssetId}::segment-${input.segmentIndex}`,
    taskId: `${input.asset.taskId}::segment-${input.segmentIndex}`,
    filePath: input.outputFilePath,
    fileName: input.outputFileName
  });
}

function createSegmentedRow(input: {
  readonly row: SpreadsheetTaskRow;
  readonly taskId: string;
  readonly rowNumber: number;
  readonly outputFileName: string;
  readonly segmentIndex: number;
}): SpreadsheetTaskRow {
  const clipUrl = `${input.row.url}#clip=${String(input.segmentIndex).padStart(2, '0')}`;

  return Object.freeze({
    ...input.row,
    taskId: input.taskId,
    rowNumber: input.rowNumber,
    url: clipUrl,
    values: Object.freeze({
      ...input.row.values,
      URL: clipUrl,
      url: clipUrl,
      title: path.parse(input.outputFileName).name,
      文件名: input.outputFileName
    })
  });
}

function resolveProfileRules(profileId: SegmentationProfileId): SegmentationProfileRules {
  const rules = PROFILE_RULES[profileId];
  if (rules === undefined) {
    throw new Error(`Unknown segmentation profile: ${profileId}`);
  }
  return rules;
}

function createSegmentationState(): {
  readonly segmentedAssets: DownloadedMediaAsset[];
  readonly segmentedRows: SpreadsheetTaskRow[];
  readonly sourceRowStates: PipelineRowState[];
  readonly problemRows: PipelineRowState[];
  readonly postEditEntries: PostEditArchiveRecordFileEntry[];
  readonly failures: RunLocalPipelineFailure[];
} {
  return {
    segmentedAssets: [],
    segmentedRows: [],
    sourceRowStates: [],
    problemRows: [],
    postEditEntries: [],
    failures: []
  };
}

function validateDetectedShots(
  shots: readonly SegmentTimeRange[],
  durationSeconds: number
): void {
  for (const [shotIndex, shot] of shots.entries()) {
    if (
      !Number.isFinite(shot.startSeconds) ||
      !Number.isFinite(shot.endSeconds) ||
      shot.startSeconds < 0 ||
      shot.endSeconds <= shot.startSeconds ||
      shot.startSeconds > durationSeconds
    ) {
      throw new Error('Scene detection returned invalid time ranges.');
    }

    if (shotIndex > 0 && shot.startSeconds < shots[shotIndex - 1].endSeconds) {
      throw new Error('Scene detection returned overlapping time ranges.');
    }
  }
}

function buildSegmentFileName(input: {
  readonly sourceFileName: string;
  readonly segment: SegmentTimeRange;
  readonly segmentIndex: number;
}): string {
  const extension = path.extname(input.sourceFileName) || '.mp4';
  const stem = path.basename(input.sourceFileName, extension);
  const durationLabel = String(Math.round(input.segment.endSeconds - input.segment.startSeconds)).padStart(6, '0');
  const segmentLabel = String(input.segmentIndex).padStart(2, '0');
  const match = /^(.*_[A-Z0-9]+P_\d{6})_\d{6}$/u.exec(stem);
  const nextStem = match === null
    ? `${stem}_${durationLabel}_${segmentLabel}`
    : `${match[1]}_${durationLabel}_${segmentLabel}`;

  return `${nextStem}${extension}`;
}

function buildProblemFileName(sourceFileName: string, problemIndex: number): string {
  const extension = path.extname(sourceFileName) || '.mp4';
  const stem = path.basename(sourceFileName, extension);
  const problemLabel = String(problemIndex).padStart(2, '0');
  return `${stem}_problem_${problemLabel}${extension}`;
}

function createSyntheticRowNumber(rowNumber: number, segmentIndex: number): number {
  return rowNumber * 10000 + segmentIndex;
}

function createProblemFailureMessage(
  errorCode: 'duration-rule-unsatisfied' | 'export-failed' | 'detection-result-invalid',
  error: unknown
): string {
  const category = humanizeProblemCategory(errorCode);
  const detail = error instanceof Error ? error.message : '';
  return detail.length === 0 ? category : `${category}：${detail}`;
}

function humanizeProblemCategory(
  errorCode: 'duration-rule-unsatisfied' | 'export-failed' | 'detection-result-invalid'
): string {
  if (errorCode === 'duration-rule-unsatisfied') {
    return '无法满足 3-30s';
  }
  if (errorCode === 'export-failed') {
    return '导出失败';
  }
  return '检测结果异常';
}

function toPortableRelativePath(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).split(path.sep).join('/');
}

function sanitizeFileToken(value: string): string {
  return value.replace(/[^\p{Script=Han}A-Za-z0-9_]+/gu, '_').replace(/^_+|_+$/gu, '') || 'asset';
}
