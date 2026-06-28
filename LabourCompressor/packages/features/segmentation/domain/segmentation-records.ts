export const SEGMENTATION_PROFILES = Object.freeze({
  standardAd: 'standard_ad',
  fastCut: 'fast_cut',
  conservative: 'conservative'
} as const);

export type SegmentationProfileId = string;

export type ProblemClipCategory =
  | 'duration-rule-unsatisfied'
  | 'export-failed'
  | 'detection-result-invalid';

export interface SegmentRecord {
  readonly id: string;
  readonly sourceAssetId: string;
  readonly sourceFilePath: string;
  readonly sourceHash: string;
  readonly segmentIndex: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly durationSeconds: number;
  readonly outputPath: string;
  readonly outputFileName: string;
  readonly profileId: SegmentationProfileId;
  readonly decisionFingerprintId: string;
  readonly status: 'accepted';
}

export interface ProblemClipRecord {
  readonly id: string;
  readonly sourceAssetId: string;
  readonly sourceFilePath: string;
  readonly sourceHash: string;
  readonly segmentIndex: number;
  readonly problemCategory: ProblemClipCategory;
  readonly outputPath: string;
  readonly outputFileName: string;
  readonly profileId: SegmentationProfileId;
  readonly decisionFingerprintId: string;
  readonly status: 'problem';
}

interface SegmentationTraceFields {
  readonly id: string;
  readonly sourceAssetId: string;
  readonly sourceFilePath: string;
  readonly sourceHash: string;
  readonly outputPath: string;
  readonly outputFileName: string;
  readonly decisionFingerprintId: string;
}

export function createSegmentRecord(
  input: Omit<SegmentRecord, 'durationSeconds' | 'status'>
): SegmentRecord {
  const traceFields = normalizeRequiredTraceFields(input);

  assertPositiveInteger(input.segmentIndex, 'Segment index');
  assertSegmentTimeRange(input.startSeconds, input.endSeconds);
  assertSegmentationProfileId(input.profileId);

  return Object.freeze({
    ...input,
    ...traceFields,
    durationSeconds: roundSeconds(input.endSeconds - input.startSeconds),
    status: 'accepted'
  });
}

export function createProblemClipRecord(
  input: Omit<ProblemClipRecord, 'status'>
): ProblemClipRecord {
  const traceFields = normalizeRequiredTraceFields(input);

  assertPositiveInteger(input.segmentIndex, 'Segment index');
  assertProblemClipCategory(input.problemCategory);
  assertSegmentationProfileId(input.profileId);

  return Object.freeze({
    ...input,
    ...traceFields,
    status: 'problem'
  });
}

function normalizeRequiredTraceFields(
  input: SegmentationTraceFields
): SegmentationTraceFields {
  return {
    id: normalizeNonEmptyValue(input.id, 'Segmentation record id'),
    sourceAssetId: normalizeNonEmptyValue(
      input.sourceAssetId,
      'Segmentation record sourceAssetId'
    ),
    sourceFilePath: normalizeNonEmptyValue(
      input.sourceFilePath,
      'Segmentation record sourceFilePath'
    ),
    sourceHash: normalizeNonEmptyValue(
      input.sourceHash,
      'Segmentation record sourceHash'
    ),
    outputPath: normalizeNonEmptyValue(
      input.outputPath,
      'Segmentation record outputPath'
    ),
    outputFileName: normalizeNonEmptyValue(
      input.outputFileName,
      'Segmentation record outputFileName'
    ),
    decisionFingerprintId: normalizeNonEmptyValue(
      input.decisionFingerprintId,
      'Segmentation record decisionFingerprintId'
    )
  };
}

function normalizeNonEmptyValue(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string.`);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }

  return normalizedValue;
}

function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
}

function assertSegmentTimeRange(
  startSeconds: number,
  endSeconds: number
): void {
  if (!Number.isFinite(startSeconds)) {
    throw new Error('Segment startSeconds must be finite.');
  }

  if (!Number.isFinite(endSeconds)) {
    throw new Error('Segment endSeconds must be finite.');
  }

  if (startSeconds < 0) {
    throw new Error('Segment startSeconds must be greater than or equal to 0.');
  }

  if (endSeconds <= startSeconds) {
    throw new Error('Segment endSeconds must be greater than startSeconds.');
  }
}

function assertSegmentationProfileId(value: SegmentationProfileId): void {
  if (value.trim().length === 0) {
    throw new Error('Segmentation profileId must not be empty.');
  }
}

function assertProblemClipCategory(value: ProblemClipCategory): void {
  if (!isProblemClipCategory(value)) {
    throw new Error(
      'Problem clip category must be a known V0.3 problem category.'
    );
  }
}

function isProblemClipCategory(value: string): value is ProblemClipCategory {
  return (
    value === 'duration-rule-unsatisfied' ||
    value === 'export-failed' ||
    value === 'detection-result-invalid'
  );
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}
