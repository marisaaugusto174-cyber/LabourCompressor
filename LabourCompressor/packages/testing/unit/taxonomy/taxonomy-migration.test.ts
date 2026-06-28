import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createArchiveRecord,
  createLocalIndexEntry
} from '../../../core/contracts/index.ts';
import {
  createTaxonomyPathMigrations,
  diffTaxonomyTrees,
  parseTaxonomyMarkdown,
  planIndexMigrations
} from '../../../features/taxonomy/domain/index.ts';

test('plans index migrations from taxonomy rename mappings', () => {
  const diff = diffTaxonomyTrees({
    previousTree: parseTaxonomyMarkdown(`
## 1. 主体对象

- 人物
  - 年龄
`),
    nextTree: parseTaxonomyMarkdown(`
## 1. 主体对象

- 人物
  - 年龄阶段
`)
  });
  const migrations = createTaxonomyPathMigrations(diff);
  const plans = planIndexMigrations({
    localIndexEntries: [
      createLocalIndexEntry({
        id: 'index-1',
        mediaAssetId: 'asset-1',
        taxonomyVersionId: 'taxonomy-v1',
        currentArchiveRecordId: 'archive-1',
        latestTagResultRecordId: 'assignment-1',
        tagPaths: ['主体对象 > 人物 > 年龄'],
        lastTaskId: 'task-1',
        updatedAt: '2026-04-24T20:00:00.000Z'
      })
    ],
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
        recordedAt: '2026-04-24T20:00:00.000Z'
      })
    ],
    pathMigrations: migrations
  });

  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.updatedTagPaths[0], '主体对象 > 人物 > 年龄阶段');
  assert.equal(
    plans[0]?.archiveMovePlans[0]?.toArchivePath,
    '主体对象/人物/年龄阶段/file.mp4'
  );
});
