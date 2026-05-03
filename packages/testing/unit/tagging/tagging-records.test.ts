import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTagAssignment,
  createTagAssignmentFromCandidateSet,
  createTagCandidateSet,
  partitionAcceptedAndRejectedPaths
} from '../../../features/tagging/domain/index.ts';

test('creates a candidate set with unique candidate paths', () => {
  const candidateSet = createTagCandidateSet({
    id: 'candidate-set-1',
    taskId: 'task-1',
    mediaAssetId: 'asset-1',
    taxonomyVersionId: 'taxonomy-v1',
    fingerprintId: 'fingerprint-1',
    candidatePaths: [
      '主体对象 > 人物 > 年龄',
      '主体对象 > 人物 > 年龄',
      '主体对象 > 人物 > 性别'
    ],
    generatedAt: '2026-04-24T13:00:00.000Z'
  });

  assert.deepEqual(candidateSet.candidatePaths, [
    '主体对象 > 人物 > 年龄',
    '主体对象 > 人物 > 性别'
  ]);
  assert.equal(candidateSet.rejectedSummary.rejectedCount, 0);
});

test('creates an accepted tag assignment from a candidate set', () => {
  const candidateSet = createTagCandidateSet({
    id: 'candidate-set-2',
    taskId: 'task-2',
    mediaAssetId: 'asset-2',
    taxonomyVersionId: 'taxonomy-v1',
    fingerprintId: 'fingerprint-2',
    candidatePaths: [
      '主体对象 > 人物 > 年龄',
      '主体对象 > 人物 > 性别'
    ],
    generatedAt: '2026-04-24T13:00:00.000Z'
  });

  const assignment = createTagAssignmentFromCandidateSet({
    id: 'assignment-1',
    candidateSet,
    acceptedPaths: ['主体对象 > 人物 > 性别'],
    assignedAt: '2026-04-24T13:01:00.000Z',
    source: 'model'
  });

  assert.equal(assignment.candidateSetId, candidateSet.id);
  assert.deepEqual(assignment.acceptedPaths, ['主体对象 > 人物 > 性别']);
  assert.equal(assignment.fingerprintId, candidateSet.fingerprintId);
});

test('rejects accepted paths that do not come from candidate paths', () => {
  const candidateSet = createTagCandidateSet({
    id: 'candidate-set-3',
    taskId: 'task-3',
    mediaAssetId: 'asset-3',
    taxonomyVersionId: 'taxonomy-v1',
    fingerprintId: 'fingerprint-3',
    candidatePaths: ['主体对象 > 人物 > 年龄'],
    generatedAt: '2026-04-24T13:00:00.000Z'
  });

  assert.throws(() => {
    createTagAssignmentFromCandidateSet({
      id: 'assignment-2',
      candidateSet,
      acceptedPaths: ['主体对象 > 动物'],
      assignedAt: '2026-04-24T13:01:00.000Z',
      source: 'model'
    });
  }, /Accepted path must come from candidate set/);
});

test('partitions accepted and rejected paths from a candidate set', () => {
  const candidateSet = createTagCandidateSet({
    id: 'candidate-set-4',
    taskId: 'task-4',
    mediaAssetId: 'asset-4',
    taxonomyVersionId: 'taxonomy-v1',
    fingerprintId: 'fingerprint-4',
    candidatePaths: [
      '主体对象 > 人物 > 年龄',
      '主体对象 > 人物 > 性别',
      '主体对象 > 动物'
    ],
    generatedAt: '2026-04-24T13:00:00.000Z'
  });

  const result = partitionAcceptedAndRejectedPaths(candidateSet, [
    '主体对象 > 人物 > 性别'
  ]);

  assert.deepEqual(result.acceptedPaths, ['主体对象 > 人物 > 性别']);
  assert.deepEqual(result.rejectedPaths, [
    '主体对象 > 人物 > 年龄',
    '主体对象 > 动物'
  ]);
});

test('rejects direct tag assignments with empty accepted paths', () => {
  assert.throws(() => {
    createTagAssignment({
      id: 'assignment-3',
      taskId: 'task-5',
      mediaAssetId: 'asset-5',
      taxonomyVersionId: 'taxonomy-v1',
      candidateSetId: 'candidate-set-5',
      fingerprintId: 'fingerprint-5',
      acceptedPaths: [],
      assignedAt: '2026-04-24T13:01:00.000Z',
      source: 'manual'
    });
  }, /must contain at least one accepted path/);
});
