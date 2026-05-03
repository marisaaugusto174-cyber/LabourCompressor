import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePromptLibraryMarkdown,
  runAutomaticTagging
} from '../../../features/tagging/domain/index.ts';
import { parseTaxonomyMarkdown } from '../../../features/taxonomy/domain/index.ts';

const taxonomyTree = parseTaxonomyMarkdown(`
## 1. 主体对象（末端计数：2）

- 人物
  - 年龄
`);

const promptLibrary = parsePromptLibraryMarkdown(`
# 标注提示词库

## 规则
- 只能输出标签库中的标签
`);

test('runs automatic tagging and keeps only legal accepted paths', () => {
  const result = runAutomaticTagging({
    taskId: 'task-1',
    mediaAssetId: 'asset-1',
    taxonomyVersionId: 'taxonomy-v1',
    fingerprintId: 'fingerprint-1',
    candidateSetId: 'candidate-set-1',
    assignmentId: 'assignment-1',
    generatedAt: '2026-04-24T16:00:00.000Z',
    assignedAt: '2026-04-24T16:01:00.000Z',
    candidatePaths: [
      '主体对象 > 人物 > 年龄',
      '主体对象 > 植物'
    ],
    taxonomyTree,
    promptLibrary
  });

  assert.equal(result.assignment !== undefined, true);
  assert.deepEqual(result.acceptedPaths, ['主体对象 > 人物 > 年龄']);
  assert.deepEqual(result.rejectedPaths, ['主体对象 > 植物']);
});

test('returns prompt instruction even when candidate paths are empty', () => {
  const result = runAutomaticTagging({
    taskId: 'task-2',
    mediaAssetId: 'asset-2',
    taxonomyVersionId: 'taxonomy-v1',
    fingerprintId: 'fingerprint-2',
    candidateSetId: 'candidate-set-2',
    assignmentId: 'assignment-2',
    generatedAt: '2026-04-24T16:00:00.000Z',
    assignedAt: '2026-04-24T16:01:00.000Z',
    candidatePaths: [],
    taxonomyTree,
    promptLibrary
  });

  assert.equal(result.assignment, undefined);
  assert.equal(result.promptInstruction.includes('Prompt Library'), true);
});

test('accepts a candidate path that uniquely matches a taxonomy leaf by suffix', () => {
  const contentTaxonomyTree = parseTaxonomyMarkdown(`
## 内容题材

- 广告营销
  - 产品广告
`);
  const result = runAutomaticTagging({
    taskId: 'task-3',
    mediaAssetId: 'asset-3',
    taxonomyVersionId: 'taxonomy-v1',
    fingerprintId: 'fingerprint-3',
    candidateSetId: 'candidate-set-3',
    assignmentId: 'assignment-3',
    generatedAt: '2026-04-24T16:00:00.000Z',
    assignedAt: '2026-04-24T16:01:00.000Z',
    candidatePaths: ['广告营销 > 产品广告'],
    taxonomyTree: contentTaxonomyTree,
    promptLibrary
  });

  assert.deepEqual(result.acceptedPaths, ['内容题材 > 广告营销 > 产品广告']);
});
