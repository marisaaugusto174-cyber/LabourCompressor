import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createArchiveRecord,
  createLocalIndexEntry
} from '../../../core/contracts/index.ts';
import { assessTrainingGradeCandidate } from '../../../features/governance/domain/index.ts';

test('accepts training-grade candidate when qa approved and records align', () => {
  const assessment = assessTrainingGradeCandidate({
    tagResultRecord: {
      assignmentId: 'assignment-1',
      taskId: 'task-1',
      mediaAssetId: 'asset-1',
      taxonomyVersionId: 'taxonomy-v1',
      candidateSetId: 'candidate-1',
      fingerprintId: 'fingerprint-1',
      acceptedPaths: ['主体对象 > 人物 > 年龄'],
      source: 'model',
      recordedAt: '2026-04-24T20:10:00.000Z'
    },
    localIndexEntry: createLocalIndexEntry({
      id: 'index-1',
      mediaAssetId: 'asset-1',
      taxonomyVersionId: 'taxonomy-v1',
      currentArchiveRecordId: 'archive-1',
      latestTagResultRecordId: 'assignment-1',
      tagPaths: ['主体对象 > 人物 > 年龄'],
      lastTaskId: 'task-1',
      updatedAt: '2026-04-24T20:10:00.000Z'
    }),
    archiveRecord: createArchiveRecord({
      id: 'archive-1',
      taskId: 'task-1',
      mediaAssetId: 'asset-1',
      taxonomyVersionId: 'taxonomy-v1',
      fingerprintId: 'fingerprint-1',
      archiveRoot: '/tmp/archive',
      archivePath: '主体对象/人物/年龄/file.mp4',
      placementMode: 'copy',
      recordedAt: '2026-04-24T20:10:00.000Z'
    }),
    qaApproved: true
  });

  assert.equal(assessment.isEligible, true);
  assert.equal(assessment.targetGrade, 'training');
});

test('downgrades training candidate when qa approval is missing', () => {
  const assessment = assessTrainingGradeCandidate({
    tagResultRecord: {
      assignmentId: 'assignment-1',
      taskId: 'task-1',
      mediaAssetId: 'asset-1',
      taxonomyVersionId: 'taxonomy-v1',
      candidateSetId: 'candidate-1',
      fingerprintId: 'fingerprint-1',
      acceptedPaths: ['主体对象 > 人物 > 年龄'],
      source: 'model',
      recordedAt: '2026-04-24T20:10:00.000Z'
    },
    localIndexEntry: createLocalIndexEntry({
      id: 'index-1',
      mediaAssetId: 'asset-1',
      taxonomyVersionId: 'taxonomy-v1',
      currentArchiveRecordId: 'archive-1',
      latestTagResultRecordId: 'assignment-1',
      tagPaths: ['主体对象 > 人物 > 年龄'],
      lastTaskId: 'task-1',
      updatedAt: '2026-04-24T20:10:00.000Z'
    }),
    archiveRecord: createArchiveRecord({
      id: 'archive-1',
      taskId: 'task-1',
      mediaAssetId: 'asset-1',
      taxonomyVersionId: 'taxonomy-v1',
      fingerprintId: 'fingerprint-1',
      archiveRoot: '/tmp/archive',
      archivePath: '主体对象/人物/年龄/file.mp4',
      placementMode: 'copy',
      recordedAt: '2026-04-24T20:10:00.000Z'
    }),
    qaApproved: false
  });

  assert.equal(assessment.isEligible, false);
  assert.equal(assessment.targetGrade, 'research');
});
