import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createArchiveRecord,
  createLocalIndexEntry
} from '../../../core/contracts/index.ts';
import {
  createRetrievalManifest,
  filterLocalIndexEntriesByTags
} from '../../../features/retrieval/domain/index.ts';

test('filters local index entries by any requested tags', () => {
  const matches = filterLocalIndexEntriesByTags({
    localIndexEntries: [
      createLocalIndexEntry({
        id: 'index-1',
        mediaAssetId: 'asset-1',
        taxonomyVersionId: 'taxonomy-v1',
        currentArchiveRecordId: 'archive-1',
        latestTagResultRecordId: 'assignment-1',
        tagPaths: ['主体对象 > 人物 > 年龄'],
        lastTaskId: 'task-1',
        updatedAt: '2026-04-24T20:20:00.000Z'
      }),
      createLocalIndexEntry({
        id: 'index-2',
        mediaAssetId: 'asset-2',
        taxonomyVersionId: 'taxonomy-v1',
        currentArchiveRecordId: 'archive-2',
        latestTagResultRecordId: 'assignment-2',
        tagPaths: ['内容题材 > 广告营销 > 产品广告'],
        lastTaskId: 'task-2',
        updatedAt: '2026-04-24T20:20:00.000Z'
      })
    ],
    requestedTags: ['内容题材 > 广告营销 > 产品广告']
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.mediaAssetId, 'asset-2');
});

test('creates retrieval manifest with identification code and archive paths', () => {
  const entry = createLocalIndexEntry({
    id: 'index-1',
    mediaAssetId: 'asset-1',
    taxonomyVersionId: 'taxonomy-v1',
    currentArchiveRecordId: 'archive-1',
    latestTagResultRecordId: 'assignment-1',
    tagPaths: ['主体对象 > 人物 > 年龄'],
    lastTaskId: 'task-1',
    updatedAt: '2026-04-24T20:20:00.000Z'
  });
  const manifest = createRetrievalManifest({
    retrievalId: 'retrieval-1',
    requestedTags: ['主体对象 > 人物 > 年龄'],
    matchedEntries: [entry],
    archiveRecords: [
      createArchiveRecord({
        id: 'archive-1',
        taskId: 'task-1',
        mediaAssetId: 'asset-1',
        taxonomyVersionId: 'taxonomy-v1',
        fingerprintId: 'fingerprint-1',
        archiveRoot: '/tmp/archive',
        archivePath: '主体对象/人物/年龄/file.mp4',
        placementMode: 'copy',
        recordedAt: '2026-04-24T20:20:00.000Z'
      })
    ],
    createdAt: '2026-04-24T20:21:00.000Z'
  });

  assert.equal(manifest.matchedItems.length, 1);
  assert.equal(
    manifest.matchedItems[0]?.archivePath,
    '主体对象/人物/年龄/file.mp4'
  );
  assert.equal(manifest.identificationCode.includes('retrieval-1'), true);
});
