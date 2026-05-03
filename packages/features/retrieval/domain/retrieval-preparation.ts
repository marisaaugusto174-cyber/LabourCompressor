import {
  type ArchiveRecord,
  type LocalIndexEntry
} from '../../../core/contracts/index.ts';

export interface RetrievalManifestItem {
  readonly mediaAssetId: string;
  readonly tagPaths: readonly string[];
  readonly archivePath: string;
}

export interface RetrievalManifest {
  readonly retrievalId: string;
  readonly requestedTags: readonly string[];
  readonly matchedItems: readonly RetrievalManifestItem[];
  readonly identificationCode: string;
  readonly createdAt: string;
}

export function filterLocalIndexEntriesByTags(input: {
  readonly localIndexEntries: readonly LocalIndexEntry[];
  readonly requestedTags: readonly string[];
  readonly matchMode?: 'any' | 'all';
}): readonly LocalIndexEntry[] {
  const normalizedTags = input.requestedTags.map((tagPath) => tagPath.trim());

  return Object.freeze(
    input.localIndexEntries.filter((entry) =>
      input.matchMode === 'all'
        ? normalizedTags.every((tagPath) => entry.tagPaths.includes(tagPath))
        : normalizedTags.some((tagPath) => entry.tagPaths.includes(tagPath))
    )
  );
}

export function createRetrievalManifest(input: {
  readonly retrievalId: string;
  readonly requestedTags: readonly string[];
  readonly matchedEntries: readonly LocalIndexEntry[];
  readonly archiveRecords: readonly ArchiveRecord[];
  readonly createdAt: string;
}): RetrievalManifest {
  const archiveRecordsById = new Map(
    input.archiveRecords.map((record) => [record.id, record] as const)
  );
  const matchedItems = input.matchedEntries.map((entry) => {
    const archiveRecord = archiveRecordsById.get(entry.currentArchiveRecordId);

    if (archiveRecord === undefined) {
      throw new Error(
        `Archive record not found for local index entry: "${entry.id}"`
      );
    }

    return Object.freeze({
      mediaAssetId: entry.mediaAssetId,
      tagPaths: entry.tagPaths,
      archivePath: archiveRecord.archivePath
    });
  });

  return Object.freeze({
    retrievalId: input.retrievalId,
    requestedTags: Object.freeze([...input.requestedTags]),
    matchedItems: Object.freeze(matchedItems),
    identificationCode: `${input.retrievalId}:${input.requestedTags.join('|')}:${input.createdAt}`,
    createdAt: input.createdAt
  });
}
