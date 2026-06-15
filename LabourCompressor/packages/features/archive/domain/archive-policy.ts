import {
  createLocalIndexEntry,
  type ArchiveRecord,
  type LocalIndexEntry
} from '../../../core/contracts/index.ts';

export interface ArchivePlacementPlan {
  readonly tagPath: string;
  readonly relativeDirectory: string;
  readonly targetFileName: string;
  readonly targetRelativePath: string;
}

export function buildArchivePlacementPlans(input: {
  readonly acceptedPaths: readonly string[];
  readonly fileName: string;
  readonly multiplePlacementMode?: 'copy-all' | 'primary-only';
}): readonly ArchivePlacementPlan[] {
  const acceptedPaths = [...new Set(input.acceptedPaths.map((pathValue) => pathValue.trim()))];

  if (acceptedPaths.length === 0) {
    throw new Error('Archive placement requires at least one accepted path.');
  }

  const fileName = sanitizeFileName(input.fileName);
  const pathsToPlace =
    input.multiplePlacementMode === 'primary-only'
      ? acceptedPaths.slice(0, 1)
      : acceptedPaths;

  return Object.freeze(
    pathsToPlace.map((acceptedPath) => {
      const relativeDirectory = acceptedPath
        .split(' > ')
        .map((segment) => sanitizePathSegment(segment))
        .join('/');

      return Object.freeze({
        tagPath: acceptedPath,
        relativeDirectory,
        targetFileName: fileName,
        targetRelativePath: `${relativeDirectory}/${fileName}`
      });
    })
  );
}

export function createArchiveIndexEntryFromRecords(input: {
  readonly id: string;
  readonly mediaAssetId: string;
  readonly taxonomyVersionId: string;
  readonly archiveRecords: readonly ArchiveRecord[];
  readonly latestTagResultRecordId: string;
  readonly tagPaths: readonly string[];
  readonly lastTaskId: string;
  readonly updatedAt: string;
}): LocalIndexEntry {
  const latestArchiveRecord = input.archiveRecords[0];

  if (latestArchiveRecord === undefined) {
    throw new Error('Archive index entry requires at least one archive record.');
  }

  return createLocalIndexEntry({
    id: input.id,
    mediaAssetId: input.mediaAssetId,
    taxonomyVersionId: input.taxonomyVersionId,
    currentArchiveRecordId: latestArchiveRecord.id,
    latestTagResultRecordId: input.latestTagResultRecordId,
    tagPaths: input.tagPaths,
    lastTaskId: input.lastTaskId,
    updatedAt: input.updatedAt
  });
}

function sanitizePathSegment(segment: string): string {
  const trimmedSegment = segment.trim();

  if (trimmedSegment.length === 0) {
    throw new Error('Archive path segment must not be empty.');
  }

  return trimmedSegment.replace(/[\\/]+/gu, '-');
}

function sanitizeFileName(fileName: string): string {
  const trimmedFileName = fileName.trim();

  if (trimmedFileName.length === 0) {
    throw new Error('Archive file name must not be empty.');
  }

  return trimmedFileName.replace(/[\\/]+/gu, '-');
}
