import {
  type ArchiveRecord,
  type LocalIndexEntry
} from '../../../core/contracts/index.ts';
import { type TaxonomyChangeSet } from './taxonomy-domain.ts';

export interface TaxonomyPathMigration {
  readonly fromPath: string;
  readonly toPath: string;
  readonly reason: 'moved' | 'renamed';
}

export interface ArchiveMigrationPlan {
  readonly archiveRecordId: string;
  readonly mediaAssetId: string;
  readonly fromArchivePath: string;
  readonly toArchivePath: string;
}

export interface IndexMigrationPlan {
  readonly localIndexEntryId: string;
  readonly mediaAssetId: string;
  readonly updatedTagPaths: readonly string[];
  readonly archiveMovePlans: readonly ArchiveMigrationPlan[];
}

export function createTaxonomyPathMigrations(
  changeSet: TaxonomyChangeSet
): readonly TaxonomyPathMigration[] {
  return Object.freeze([
    ...changeSet.movedNodes.map((node) =>
      Object.freeze({
        fromPath: node.fromPath.value,
        toPath: node.toPath.value,
        reason: 'moved' as const
      })
    ),
    ...changeSet.renamedNodes.map((node) =>
      Object.freeze({
        fromPath: replaceLastSegment(node.path.value, node.fromLabel),
        toPath: node.path.value,
        reason: 'renamed' as const
      })
    )
  ]);
}

export function planIndexMigrations(input: {
  readonly localIndexEntries: readonly LocalIndexEntry[];
  readonly archiveRecords: readonly ArchiveRecord[];
  readonly pathMigrations: readonly TaxonomyPathMigration[];
}): readonly IndexMigrationPlan[] {
  const archiveRecordsById = new Map(
    input.archiveRecords.map((record) => [record.id, record] as const)
  );

  return Object.freeze(
    input.localIndexEntries.flatMap((entry) => {
      const updatedTagPaths = entry.tagPaths.map((tagPath) => {
        const migration = input.pathMigrations.find(
          (candidate) => candidate.fromPath === tagPath
        );

        return migration?.toPath ?? tagPath;
      });

      if (updatedTagPaths.join('|') === entry.tagPaths.join('|')) {
        return [];
      }

      const currentArchiveRecord = archiveRecordsById.get(
        entry.currentArchiveRecordId
      );

      if (currentArchiveRecord === undefined) {
        throw new Error(
          `Archive record not found for local index entry: "${entry.id}"`
        );
      }

      const fileName =
        currentArchiveRecord.archivePath.split('/').at(-1) ??
        currentArchiveRecord.archivePath;
      const archiveMovePlans = updatedTagPaths.map((tagPath) =>
        Object.freeze({
          archiveRecordId: currentArchiveRecord.id,
          mediaAssetId: entry.mediaAssetId,
          fromArchivePath: currentArchiveRecord.archivePath,
          toArchivePath: `${tagPath.split(' > ').join('/')}/${fileName}`
        })
      );

      return [
        Object.freeze({
          localIndexEntryId: entry.id,
          mediaAssetId: entry.mediaAssetId,
          updatedTagPaths: Object.freeze(updatedTagPaths),
          archiveMovePlans: Object.freeze(archiveMovePlans)
        })
      ];
    })
  );
}

function replaceLastSegment(pathValue: string, previousLabel: string): string {
  const segments = pathValue.split(' > ');
  segments[segments.length - 1] = previousLabel;
  return segments.join(' > ');
}
