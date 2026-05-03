import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildArchivePlacementPlans,
  createArchiveIndexEntryFromRecords
} from '../../../features/archive/domain/index.ts';
import { createArchiveRecord } from '../../../core/contracts/index.ts';

test('builds archive placement plans from accepted tag paths', () => {
  const plans = buildArchivePlacementPlans({
    acceptedPaths: [
      '主体对象 > 人物 > 年龄',
      '主体对象 > 人物 > 性别'
    ],
    fileName: 'sample.mp4'
  });

  assert.equal(plans.length, 2);
  assert.equal(
    plans[0]?.targetRelativePath,
    '主体对象/人物/年龄/sample.mp4'
  );
});

test('creates local index entry from archive records', () => {
  const archiveRecord = createArchiveRecord({
    id: 'archive-1',
    taskId: 'task-1',
    mediaAssetId: 'asset-1',
    taxonomyVersionId: 'taxonomy-v1',
    fingerprintId: 'fingerprint-1',
    archiveRoot: '/archive',
    archivePath: '主体对象/人物/年龄/sample.mp4',
    placementMode: 'copy',
    recordedAt: '2026-04-24T16:00:00.000Z'
  });

  const indexEntry = createArchiveIndexEntryFromRecords({
    id: 'index-1',
    mediaAssetId: 'asset-1',
    taxonomyVersionId: 'taxonomy-v1',
    archiveRecords: [archiveRecord],
    latestTagResultRecordId: 'assignment-1',
    tagPaths: ['主体对象 > 人物 > 年龄'],
    lastTaskId: 'task-1',
    updatedAt: '2026-04-24T16:01:00.000Z'
  });

  assert.equal(indexEntry.currentArchiveRecordId, 'archive-1');
});
