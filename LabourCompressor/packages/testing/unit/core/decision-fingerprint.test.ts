import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDecisionFingerprint,
  getDecisionSourceMarkers,
  hasTaxonomyBinding
} from '../../../core/contracts/index.ts';

test('creates a valid decision fingerprint with taxonomy and model markers', () => {
  const fingerprint = createDecisionFingerprint({
    id: 'fingerprint-1',
    taskId: 'task-1',
    entityId: 'asset-1',
    entityType: 'tag-assignment',
    taxonomyVersionId: 'taxonomy-v1',
    modelAdapterVersion: 'openai:gpt-5.4',
    decisionClass: 'tag-acceptance',
    timestamp: '2026-04-24T12:00:00.000Z'
  });

  assert.equal(fingerprint.entityType, 'tag-assignment');
  assert.equal(hasTaxonomyBinding(fingerprint), true);
  assert.deepEqual(getDecisionSourceMarkers(fingerprint), [
    'taxonomy-v1',
    'openai:gpt-5.4'
  ]);
});

test('rejects a fingerprint with empty required fields', () => {
  assert.throws(() => {
    createDecisionFingerprint({
      id: '   ',
      taskId: 'task-1',
      entityId: 'asset-1',
      entityType: 'archive-record',
      integrationVersion: 'filesystem:v1',
      decisionClass: 'archive-placement',
      timestamp: '2026-04-24T12:00:00.000Z'
    });
  }, /Decision fingerprint id must not be empty/);
});

test('rejects a fingerprint without any source marker', () => {
  assert.throws(() => {
    createDecisionFingerprint({
      id: 'fingerprint-2',
      taskId: 'task-2',
      entityId: 'asset-2',
      entityType: 'retrieval-report',
      decisionClass: 'report-generation',
      timestamp: '2026-04-24T12:00:00.000Z'
    });
  }, /must include at least one source marker/);
});
