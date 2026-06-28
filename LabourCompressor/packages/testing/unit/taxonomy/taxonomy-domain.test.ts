import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTaxonomyChangeSet,
  createTaxonomyNode,
  createTaxonomyPath,
  createTaxonomyVersion,
  hasTaxonomyChanges,
  isDirectChildNode
} from '../../../features/taxonomy/domain/index.ts';

test('creates a taxonomy node hierarchy with matching depth and parent', () => {
  const rootPath = createTaxonomyPath({
    segments: ['内容题材']
  });
  const childPath = createTaxonomyPath({
    segments: ['内容题材', '广告营销']
  });

  const rootNode = createTaxonomyNode({
    id: 'root-topic',
    label: '内容题材',
    depth: 0,
    path: rootPath,
    childIds: ['child-marketing']
  });
  const childNode = createTaxonomyNode({
    id: 'child-marketing',
    label: '广告营销',
    depth: 1,
    path: childPath,
    parentId: 'root-topic'
  });

  assert.equal(rootNode.depth, 0);
  assert.equal(childNode.parentId, rootNode.id);
  assert.equal(isDirectChildNode(rootNode, childNode), true);
});

test('creates a taxonomy version with identity and root nodes', () => {
  const version = createTaxonomyVersion({
    id: 'taxonomy-v1',
    versionLabel: 'v1.0.0',
    sourceDocumentPath: '/taxonomy/current.md',
    checksum: 'abc123',
    createdAt: '2026-04-24T10:00:00.000Z',
    rootNodeIds: ['root-topic']
  });

  assert.equal(version.id, 'taxonomy-v1');
  assert.equal(version.versionLabel, 'v1.0.0');
  assert.deepEqual(version.rootNodeIds, ['root-topic']);
  assert.equal(hasTaxonomyChanges(version.changeSet), false);
});

test('summarizes taxonomy change counts for version diff basics', () => {
  const changeSet = createTaxonomyChangeSet({
    addedPaths: [
      createTaxonomyPath({
        segments: ['内容题材', '广告营销']
      })
    ],
    renamedNodes: [
      {
        nodeId: 'node-1',
        fromLabel: '旧标签',
        toLabel: '新标签',
        path: createTaxonomyPath({
          segments: ['内容题材', '新标签']
        })
      }
    ]
  });

  assert.equal(changeSet.addedPaths.length, 1);
  assert.equal(changeSet.renamedNodes.length, 1);
  assert.equal(changeSet.totalChanges, 2);
  assert.equal(hasTaxonomyChanges(changeSet), true);
});

test('rejects a non-root node without a parent id', () => {
  assert.throws(() => {
    createTaxonomyNode({
      id: 'broken-node',
      label: '广告营销',
      depth: 1,
      path: createTaxonomyPath({
        segments: ['内容题材', '广告营销']
      })
    });
  }, /Non-root taxonomy node must define a parent id/);
});
