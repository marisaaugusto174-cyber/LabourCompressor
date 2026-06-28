import { type DecisionFingerprintId } from './decision-fingerprint.ts';
import {
  type TaskId,
  type TaskRecord,
  type TaxonomyVersionId
} from './index.ts';
import {
  type MediaAssetId,
  type TagAssignment,
  type TagAssignmentId,
  type TagCandidateSetId
} from '../../features/tagging/domain/index.ts';

export type ArchiveRecordId = string;
export type LocalIndexEntryId = string;

export interface TagResultRecord {
  readonly assignmentId: TagAssignmentId;
  readonly taskId: TaskId;
  readonly mediaAssetId: MediaAssetId;
  readonly taxonomyVersionId: TaxonomyVersionId;
  readonly candidateSetId: TagCandidateSetId;
  readonly fingerprintId: DecisionFingerprintId;
  readonly acceptedPaths: readonly string[];
  readonly source: TagAssignment['source'];
  readonly recordedAt: string;
}

export interface ArchiveRecord {
  readonly id: ArchiveRecordId;
  readonly taskId: TaskId;
  readonly mediaAssetId: MediaAssetId;
  readonly taxonomyVersionId: TaxonomyVersionId;
  readonly fingerprintId: DecisionFingerprintId;
  readonly archiveRoot: string;
  readonly archivePath: string;
  readonly placementMode: 'copy' | 'move';
  readonly recordedAt: string;
}

export interface LocalIndexEntry {
  readonly id: LocalIndexEntryId;
  readonly mediaAssetId: MediaAssetId;
  readonly taxonomyVersionId: TaxonomyVersionId;
  readonly currentArchiveRecordId: ArchiveRecordId;
  readonly latestTagResultRecordId: TagAssignmentId;
  readonly tagPaths: readonly string[];
  readonly lastTaskId: TaskId;
  readonly updatedAt: string;
}

export interface LocalRecordSnapshot {
  readonly taskRecord: TaskRecord;
  readonly tagResultRecord?: TagResultRecord | undefined;
  readonly archiveRecord?: ArchiveRecord | undefined;
  readonly localIndexEntry?: LocalIndexEntry | undefined;
}

export function createTagResultRecord(input: {
  readonly assignment: TagAssignment;
  readonly recordedAt: string;
}): TagResultRecord {
  assertNonEmptyValue(input.recordedAt, 'Tag result record recordedAt');

  return Object.freeze({
    assignmentId: input.assignment.id,
    taskId: input.assignment.taskId,
    mediaAssetId: input.assignment.mediaAssetId,
    taxonomyVersionId: input.assignment.taxonomyVersionId,
    candidateSetId: input.assignment.candidateSetId,
    fingerprintId: input.assignment.fingerprintId,
    acceptedPaths: Object.freeze([...input.assignment.acceptedPaths]),
    source: input.assignment.source,
    recordedAt: input.recordedAt.trim()
  });
}

export function createArchiveRecord(input: {
  readonly id: ArchiveRecordId;
  readonly taskId: TaskId;
  readonly mediaAssetId: MediaAssetId;
  readonly taxonomyVersionId: TaxonomyVersionId;
  readonly fingerprintId: DecisionFingerprintId;
  readonly archiveRoot: string;
  readonly archivePath: string;
  readonly placementMode: 'copy' | 'move';
  readonly recordedAt: string;
}): ArchiveRecord {
  assertNonEmptyValue(input.id, 'Archive record id');
  assertNonEmptyValue(input.taskId, 'Archive record taskId');
  assertNonEmptyValue(input.mediaAssetId, 'Archive record mediaAssetId');
  assertNonEmptyValue(
    input.taxonomyVersionId,
    'Archive record taxonomyVersionId'
  );
  assertNonEmptyValue(
    input.fingerprintId,
    'Archive record fingerprintId'
  );
  assertNonEmptyValue(input.archiveRoot, 'Archive record archiveRoot');
  assertNonEmptyValue(input.archivePath, 'Archive record archivePath');
  assertNonEmptyValue(input.recordedAt, 'Archive record recordedAt');

  return Object.freeze({
    id: input.id.trim(),
    taskId: input.taskId.trim(),
    mediaAssetId: input.mediaAssetId.trim(),
    taxonomyVersionId: input.taxonomyVersionId.trim(),
    fingerprintId: input.fingerprintId.trim(),
    archiveRoot: trimTrailingSlash(input.archiveRoot),
    archivePath: normalizeArchivePath(input.archivePath),
    placementMode: input.placementMode,
    recordedAt: input.recordedAt.trim()
  });
}

export function createLocalIndexEntry(input: {
  readonly id: LocalIndexEntryId;
  readonly mediaAssetId: MediaAssetId;
  readonly taxonomyVersionId: TaxonomyVersionId;
  readonly currentArchiveRecordId: ArchiveRecordId;
  readonly latestTagResultRecordId: TagAssignmentId;
  readonly tagPaths: readonly string[];
  readonly lastTaskId: TaskId;
  readonly updatedAt: string;
}): LocalIndexEntry {
  assertNonEmptyValue(input.id, 'Local index entry id');
  assertNonEmptyValue(input.mediaAssetId, 'Local index entry mediaAssetId');
  assertNonEmptyValue(
    input.taxonomyVersionId,
    'Local index entry taxonomyVersionId'
  );
  assertNonEmptyValue(
    input.currentArchiveRecordId,
    'Local index entry currentArchiveRecordId'
  );
  assertNonEmptyValue(
    input.latestTagResultRecordId,
    'Local index entry latestTagResultRecordId'
  );
  assertNonEmptyValue(input.lastTaskId, 'Local index entry lastTaskId');
  assertNonEmptyValue(input.updatedAt, 'Local index entry updatedAt');

  const tagPaths = normalizeUniquePaths(input.tagPaths, 'Local index entry tagPaths');

  if (tagPaths.length === 0) {
    throw new Error('Local index entry must contain at least one tag path.');
  }

  return Object.freeze({
    id: input.id.trim(),
    mediaAssetId: input.mediaAssetId.trim(),
    taxonomyVersionId: input.taxonomyVersionId.trim(),
    currentArchiveRecordId: input.currentArchiveRecordId.trim(),
    latestTagResultRecordId: input.latestTagResultRecordId.trim(),
    tagPaths,
    lastTaskId: input.lastTaskId.trim(),
    updatedAt: input.updatedAt.trim()
  });
}

export function createLocalRecordSnapshot(input: {
  readonly taskRecord: TaskRecord;
  readonly tagResultRecord?: TagResultRecord | undefined;
  readonly archiveRecord?: ArchiveRecord | undefined;
  readonly localIndexEntry?: LocalIndexEntry | undefined;
}): LocalRecordSnapshot {
  return Object.freeze({
    taskRecord: input.taskRecord,
    tagResultRecord: input.tagResultRecord,
    archiveRecord: input.archiveRecord,
    localIndexEntry: input.localIndexEntry
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

function normalizeArchivePath(path: string): string {
  const normalizedPath = path.trim().replace(/\/+/gu, '/');

  if (normalizedPath.startsWith('/')) {
    throw new Error('Archive record archivePath must be relative.');
  }

  return normalizedPath;
}

function trimTrailingSlash(path: string): string {
  return path.trim().replace(/\/+$/gu, '');
}

function assertNonEmptyValue(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }
}
