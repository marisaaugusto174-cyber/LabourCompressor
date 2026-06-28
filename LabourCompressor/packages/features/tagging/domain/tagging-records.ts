import {
  type DecisionFingerprintId,
  type TaskId,
  type TaxonomyVersionId
} from '../../../core/contracts/index.ts';

export type MediaAssetId = string;
export type TagCandidateSetId = string;
export type TagAssignmentId = string;

export type TagAssignmentSource =
  | 'model'
  | 'manual'
  | 'migration';

export interface RejectedCandidateSummary {
  readonly rejectedCount: number;
  readonly rejectionReasons: readonly string[];
}

export interface TagCandidateSet {
  readonly id: TagCandidateSetId;
  readonly taskId: TaskId;
  readonly mediaAssetId: MediaAssetId;
  readonly taxonomyVersionId: TaxonomyVersionId;
  readonly fingerprintId: DecisionFingerprintId;
  readonly candidatePaths: readonly string[];
  readonly rejectedSummary: RejectedCandidateSummary;
  readonly confidence?: number | undefined;
  readonly generatedAt: string;
}

export interface TagAssignment {
  readonly id: TagAssignmentId;
  readonly taskId: TaskId;
  readonly mediaAssetId: MediaAssetId;
  readonly taxonomyVersionId: TaxonomyVersionId;
  readonly candidateSetId: TagCandidateSetId;
  readonly fingerprintId: DecisionFingerprintId;
  readonly acceptedPaths: readonly string[];
  readonly assignedAt: string;
  readonly source: TagAssignmentSource;
  readonly confidence?: number | undefined;
}

interface CreateTagCandidateSetInput {
  readonly id: TagCandidateSetId;
  readonly taskId: TaskId;
  readonly mediaAssetId: MediaAssetId;
  readonly taxonomyVersionId: TaxonomyVersionId;
  readonly fingerprintId: DecisionFingerprintId;
  readonly candidatePaths: readonly string[];
  readonly rejectedSummary?: RejectedCandidateSummary | undefined;
  readonly confidence?: number | undefined;
  readonly generatedAt: string;
}

interface CreateTagAssignmentInput {
  readonly id: TagAssignmentId;
  readonly taskId: TaskId;
  readonly mediaAssetId: MediaAssetId;
  readonly taxonomyVersionId: TaxonomyVersionId;
  readonly candidateSetId: TagCandidateSetId;
  readonly fingerprintId: DecisionFingerprintId;
  readonly acceptedPaths: readonly string[];
  readonly assignedAt: string;
  readonly source: TagAssignmentSource;
  readonly confidence?: number | undefined;
}

interface CreateTagAssignmentFromCandidateSetInput {
  readonly id: TagAssignmentId;
  readonly candidateSet: TagCandidateSet;
  readonly acceptedPaths: readonly string[];
  readonly assignedAt: string;
  readonly source: Extract<TagAssignmentSource, 'model' | 'migration'>;
  readonly confidence?: number | undefined;
}

export function createTagCandidateSet(
  input: CreateTagCandidateSetInput
): TagCandidateSet {
  assertNonEmptyValue(input.id, 'Tag candidate set id');
  assertNonEmptyValue(input.taskId, 'Tag candidate set taskId');
  assertNonEmptyValue(input.mediaAssetId, 'Tag candidate set mediaAssetId');
  assertNonEmptyValue(
    input.taxonomyVersionId,
    'Tag candidate set taxonomyVersionId'
  );
  assertNonEmptyValue(
    input.fingerprintId,
    'Tag candidate set fingerprintId'
  );
  assertNonEmptyValue(input.generatedAt, 'Tag candidate set generatedAt');

  const candidatePaths = normalizeUniquePaths(
    input.candidatePaths,
    'Tag candidate set candidatePaths'
  );

  if (candidatePaths.length === 0) {
    throw new Error(
      'Tag candidate set must contain at least one candidate path.'
    );
  }

  return Object.freeze({
    id: input.id.trim(),
    taskId: input.taskId.trim(),
    mediaAssetId: input.mediaAssetId.trim(),
    taxonomyVersionId: input.taxonomyVersionId.trim(),
    fingerprintId: input.fingerprintId.trim(),
    candidatePaths,
    rejectedSummary: normalizeRejectedSummary(input.rejectedSummary),
    confidence: input.confidence,
    generatedAt: input.generatedAt.trim()
  });
}

export function createTagAssignment(
  input: CreateTagAssignmentInput
): TagAssignment {
  assertNonEmptyValue(input.id, 'Tag assignment id');
  assertNonEmptyValue(input.taskId, 'Tag assignment taskId');
  assertNonEmptyValue(input.mediaAssetId, 'Tag assignment mediaAssetId');
  assertNonEmptyValue(
    input.taxonomyVersionId,
    'Tag assignment taxonomyVersionId'
  );
  assertNonEmptyValue(
    input.candidateSetId,
    'Tag assignment candidateSetId'
  );
  assertNonEmptyValue(input.fingerprintId, 'Tag assignment fingerprintId');
  assertNonEmptyValue(input.assignedAt, 'Tag assignment assignedAt');

  const acceptedPaths = normalizeUniquePaths(
    input.acceptedPaths,
    'Tag assignment acceptedPaths'
  );

  if (acceptedPaths.length === 0) {
    throw new Error('Tag assignment must contain at least one accepted path.');
  }

  return Object.freeze({
    id: input.id.trim(),
    taskId: input.taskId.trim(),
    mediaAssetId: input.mediaAssetId.trim(),
    taxonomyVersionId: input.taxonomyVersionId.trim(),
    candidateSetId: input.candidateSetId.trim(),
    fingerprintId: input.fingerprintId.trim(),
    acceptedPaths,
    assignedAt: input.assignedAt.trim(),
    source: input.source,
    confidence: input.confidence
  });
}

export function createTagAssignmentFromCandidateSet(
  input: CreateTagAssignmentFromCandidateSetInput
): TagAssignment {
  const acceptedPaths = normalizeUniquePaths(
    input.acceptedPaths,
    'Tag assignment acceptedPaths'
  );

  if (acceptedPaths.length === 0) {
    throw new Error('Accepted paths must not be empty.');
  }

  for (const acceptedPath of acceptedPaths) {
    if (!input.candidateSet.candidatePaths.includes(acceptedPath)) {
      throw new Error(
        `Accepted path must come from candidate set: "${acceptedPath}"`
      );
    }
  }

  return createTagAssignment({
    id: input.id,
    taskId: input.candidateSet.taskId,
    mediaAssetId: input.candidateSet.mediaAssetId,
    taxonomyVersionId: input.candidateSet.taxonomyVersionId,
    candidateSetId: input.candidateSet.id,
    fingerprintId: input.candidateSet.fingerprintId,
    acceptedPaths,
    assignedAt: input.assignedAt,
    source: input.source,
    confidence: input.confidence ?? input.candidateSet.confidence
  });
}

export function partitionAcceptedAndRejectedPaths(
  candidateSet: TagCandidateSet,
  acceptedPaths: readonly string[]
): {
  readonly acceptedPaths: readonly string[];
  readonly rejectedPaths: readonly string[];
} {
  const normalizedAcceptedPaths = normalizeUniquePaths(
    acceptedPaths,
    'Accepted paths'
  );
  const rejectedPaths = candidateSet.candidatePaths.filter(
    (candidatePath) => !normalizedAcceptedPaths.includes(candidatePath)
  );

  return Object.freeze({
    acceptedPaths: normalizedAcceptedPaths,
    rejectedPaths: Object.freeze(rejectedPaths)
  });
}

function normalizeRejectedSummary(
  summary: RejectedCandidateSummary | undefined
): RejectedCandidateSummary {
  if (summary === undefined) {
    return Object.freeze({
      rejectedCount: 0,
      rejectionReasons: Object.freeze([])
    });
  }

  if (summary.rejectedCount < 0) {
    throw new Error('Rejected candidate count must not be negative.');
  }

  return Object.freeze({
    rejectedCount: summary.rejectedCount,
    rejectionReasons: Object.freeze(
      summary.rejectionReasons.map((reason) => {
        assertNonEmptyValue(reason, 'Rejected candidate reason');
        return reason.trim();
      })
    )
  });
}

function normalizeUniquePaths(
  paths: readonly string[],
  fieldName: string
): readonly string[] {
  const normalizedPaths = paths.map((path) => {
    assertNonEmptyValue(path, fieldName);
    return path.trim();
  });

  return Object.freeze([...new Set(normalizedPaths)]);
}

function assertNonEmptyValue(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }
}
