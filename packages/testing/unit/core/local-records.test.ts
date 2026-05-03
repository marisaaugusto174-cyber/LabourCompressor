import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createArchiveRecord,
  createLocalIndexEntry,
  createLocalRecordSnapshot,
  createTagResultRecord
} from '../../../core/contracts/index.ts';
import { createTaskRecord } from '../../../core/contracts/index.ts';
import { createTagAssignment } from '../../../features/tagging/domain/index.ts';

test('creates a tag result record from a tag assignment', () => {
  const assignment = createTagAssignment({
    id: 'assignment-1',
    taskId: 'task-1',
    mediaAssetId: 'asset-1',
    taxonomyVersionId: 'taxonomy-v1',
    candidateSetId: 'candidate-set-1',
    fingerprintId: 'fingerprint-1',
    acceptedPaths: ['主体对象 > 人物 > 年龄'],
    assignedAt: '2026-04-24T15:00:00.000Z',
    source: 'model'
  });

  const record = createTagResultRecord({
    assignment,
    recordedAt: '2026-04-24T15:01:00.000Z'
  });

  assert.equal(record.assignmentId, assignment.id);
  assert.deepEqual(record.acceptedPaths, ['主体对象 > 人物 > 年龄']);
});

test('creates an archive record with normalized relative path', () => {
  const archiveRecord = createArchiveRecord({
    id: 'archive-1',
    taskId: 'task-1',
    mediaAssetId: 'asset-1',
    taxonomyVersionId: 'taxonomy-v1',
    fingerprintId: 'fingerprint-1',
    archiveRoot: '/assets/archive/',
    archivePath: '主体对象//人物/年龄',
    placementMode: 'copy',
    recordedAt: '2026-04-24T15:02:00.000Z'
  });

  assert.equal(archiveRecord.archiveRoot, '/assets/archive');
  assert.equal(archiveRecord.archivePath, '主体对象/人物/年龄');
});

test('rejects archive records with absolute archive path', () => {
  assert.throws(() => {
    createArchiveRecord({
      id: 'archive-2',
      taskId: 'task-1',
      mediaAssetId: 'asset-1',
      taxonomyVersionId: 'taxonomy-v1',
      fingerprintId: 'fingerprint-1',
      archiveRoot: '/assets/archive',
      archivePath: '/主体对象/人物',
      placementMode: 'copy',
      recordedAt: '2026-04-24T15:02:00.000Z'
    });
  }, /archivePath must be relative/);
});

test('creates a local index entry and snapshot', () => {
  const taskRecord = createTaskRecord({
    id: 'task-2',
    kind: 'tagging-and-archive',
    workflowSessionId: 'workflow-2',
    createdAt: '2026-04-24T15:00:00.000Z'
  });
  const indexEntry = createLocalIndexEntry({
    id: 'index-1',
    mediaAssetId: 'asset-1',
    taxonomyVersionId: 'taxonomy-v1',
    currentArchiveRecordId: 'archive-1',
    latestTagResultRecordId: 'assignment-1',
    tagPaths: [
      '主体对象 > 人物 > 年龄',
      '主体对象 > 人物 > 年龄'
    ],
    lastTaskId: 'task-2',
    updatedAt: '2026-04-24T15:03:00.000Z'
  });
  const snapshot = createLocalRecordSnapshot({
    taskRecord,
    localIndexEntry: indexEntry
  });

  assert.deepEqual(indexEntry.tagPaths, ['主体对象 > 人物 > 年龄']);
  assert.equal(snapshot.taskRecord.id, 'task-2');
  assert.equal(snapshot.localIndexEntry?.id, 'index-1');
});
