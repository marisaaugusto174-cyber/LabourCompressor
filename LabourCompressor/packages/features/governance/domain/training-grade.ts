import {
  type ArchiveRecord,
  type LocalIndexEntry,
  type TagResultRecord
} from '../../../core/contracts/index.ts';

export type DataGrade =
  | 'operational'
  | 'research'
  | 'training';

export interface TrainingGradeAssessment {
  readonly isEligible: boolean;
  readonly targetGrade: DataGrade;
  readonly reasons: readonly string[];
}

export function assessTrainingGradeCandidate(input: {
  readonly tagResultRecord: TagResultRecord;
  readonly localIndexEntry: LocalIndexEntry;
  readonly archiveRecord: ArchiveRecord;
  readonly qaApproved: boolean;
}): TrainingGradeAssessment {
  const reasons: string[] = [];

  if (input.tagResultRecord.acceptedPaths.length === 0) {
    reasons.push('Accepted tag paths are required.');
  }

  if (
    input.localIndexEntry.taxonomyVersionId !==
    input.tagResultRecord.taxonomyVersionId
  ) {
    reasons.push('Local index entry taxonomy version must match tag result.');
  }

  if (
    input.archiveRecord.taxonomyVersionId !==
    input.tagResultRecord.taxonomyVersionId
  ) {
    reasons.push('Archive record taxonomy version must match tag result.');
  }

  if (input.localIndexEntry.mediaAssetId !== input.tagResultRecord.mediaAssetId) {
    reasons.push('Local index entry media asset must match tag result.');
  }

  if (input.archiveRecord.mediaAssetId !== input.tagResultRecord.mediaAssetId) {
    reasons.push('Archive record media asset must match tag result.');
  }

  if (!input.qaApproved) {
    reasons.push('QA approval is required for training-grade data.');
  }

  return Object.freeze({
    isEligible: reasons.length === 0,
    targetGrade: reasons.length === 0 ? 'training' : 'research',
    reasons: Object.freeze(reasons)
  });
}
