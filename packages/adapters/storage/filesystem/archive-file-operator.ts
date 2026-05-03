import { copyFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  createArchiveRecord,
  type ArchiveRecord
} from '../../../core/contracts/index.ts';
import { type ArchivePlacementPlan } from '../../../features/archive/domain/index.ts';

export async function archiveFileByPlans(input: {
  readonly sourceFilePath: string;
  readonly archiveRoot: string;
  readonly placementPlans: readonly ArchivePlacementPlan[];
  readonly placementMode: 'copy' | 'move';
  readonly taskId: string;
  readonly mediaAssetId: string;
  readonly taxonomyVersionId: string;
  readonly fingerprintId: string;
  readonly recordedAt: string;
}): Promise<readonly ArchiveRecord[]> {
  if (input.placementPlans.length === 0) {
    throw new Error('Archive operation requires at least one placement plan.');
  }

  await stat(input.sourceFilePath);

  if (input.placementMode === 'move' && input.placementPlans.length > 1) {
    throw new Error('Move mode does not support multiple placement plans.');
  }

  const records: ArchiveRecord[] = [];

  for (const [index, plan] of input.placementPlans.entries()) {
    const targetDirectory = path.join(input.archiveRoot, plan.relativeDirectory);
    await mkdir(targetDirectory, { recursive: true });

    const targetFilePath = await ensureUniqueTargetPath(
      path.join(input.archiveRoot, plan.targetRelativePath)
    );

    if (input.placementMode === 'copy') {
      await copyFile(input.sourceFilePath, targetFilePath);
    } else {
      if (index !== 0) {
        throw new Error('Move mode can only place one target.');
      }

      await rename(input.sourceFilePath, targetFilePath);
    }

    records.push(
      createArchiveRecord({
        id: `archive-record:${plan.targetRelativePath}:${index + 1}`,
        taskId: input.taskId,
        mediaAssetId: input.mediaAssetId,
        taxonomyVersionId: input.taxonomyVersionId,
        fingerprintId: input.fingerprintId,
        archiveRoot: input.archiveRoot,
        archivePath: path.relative(input.archiveRoot, targetFilePath),
        placementMode: input.placementMode,
        recordedAt: input.recordedAt
      })
    );
  }

  return Object.freeze(records);
}

export async function verifyArchivedPaths(
  archiveRoot: string,
  archiveRecords: readonly ArchiveRecord[]
): Promise<boolean> {
  for (const record of archiveRecords) {
    await stat(path.join(archiveRoot, record.archivePath));
  }

  return true;
}

async function ensureUniqueTargetPath(targetFilePath: string): Promise<string> {
  let candidatePath = targetFilePath;
  let counter = 1;

  while (await pathExists(candidatePath)) {
    const parsedPath = path.parse(targetFilePath);
    candidatePath = path.join(
      parsedPath.dir,
      `${parsedPath.name} (${counter})${parsedPath.ext}`
    );
    counter += 1;
  }

  return candidatePath;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
