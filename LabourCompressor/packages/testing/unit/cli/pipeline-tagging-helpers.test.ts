import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRequiredArchivePath,
  resolveRequiredContentTopic,
  resolveTaggingConcurrency,
  runConcurrentInOrder,
  withRateLimitRetry,
  type RequiredContentTopicResolution
} from '../../../../apps/cli/local-pipeline-tagging.ts';
import {
  ArchivePrimaryTagError,
  type ArchivePathPolicy,
  type StructuredTaggingResponse
} from '../../../features/tagging/domain/index.ts';
import { parseTaxonomyMarkdown } from '../../../features/taxonomy/domain/index.ts';

const archivePolicy: ArchivePathPolicy = Object.freeze({
  dimension: '核心动作',
  primaryRole: '主动作',
  requiredCount: 1,
  onInvalid: 'retry-once-then-review'
});

const archiveTaxonomy = parseTaxonomyMarkdown([
  '## 核心动作',
  '',
  '- 身体动作',
  '  - 位移动作',
  '    - 跑动',
  '    - 行走',
  '  - 姿态动作',
  '    - 转身',
  '',
  '## 内容领域',
  '',
  '- 生活方式',
  '  - 日常记录'
].join('\n'));

function response(tags: StructuredTaggingResponse['tags']): StructuredTaggingResponse {
  return Object.freeze({ reviewRequired: false, reviewReason: '', tags: Object.freeze(tags) });
}

const mainAction = Object.freeze({
  dimension: '核心动作',
  labelPath: Object.freeze(['核心动作', '身体动作', '位移动作', '跑动']),
  selectedLevel: 'l4',
  tagRole: '主动作',
  entityId: '',
  targetEntityId: '',
  confidenceScore: 0.9
});

const contentTag = Object.freeze({
  dimension: '内容领域',
  labelPath: Object.freeze(['内容领域', '生活方式', '日常记录']),
  selectedLevel: 'l3',
  tagRole: '',
  entityId: 'entity-1',
  targetEntityId: '',
  confidenceScore: 0.8
});

const secondaryAction = Object.freeze({
  dimension: '核心动作',
  labelPath: Object.freeze(['核心动作', '身体动作', '位移动作', '行走']),
  selectedLevel: 'l4',
  tagRole: '次动作',
  entityId: 'action-2',
  targetEntityId: '',
  confidenceScore: 0.7
});

test('keeps a legal primary archive action without repair', async () => {
  let repairs = 0;
  const structuredResponse = response([mainAction, contentTag]);
  const result = await resolveRequiredArchivePath({
    acceptedPaths: structuredResponse.tags.map((tag) => tag.labelPath.join(' > ')),
    structuredResponse,
    modelJson: { marker: 'original', tags: [{ dimension: '核心动作' }] },
    policy: archivePolicy,
    taxonomyTree: archiveTaxonomy,
    requestRepair: async () => {
      repairs += 1;
      throw new Error('repair should not run');
    }
  });

  assert.equal(repairs, 0);
  assert.equal(result.repairApplied, false);
  assert.equal(result.selectedArchivePath, '核心动作 > 身体动作 > 位移动作 > 跑动');
  assert.equal(result.structuredResponse, structuredResponse);
});

test('repairs only the primary action and preserves secondary actions and unrelated json', async () => {
  const preservedTag = {
    dimension: '内容领域',
    label_path: ['内容领域', '生活方式', '日常记录'],
    evidence: { source: 'frame-8' }
  };
  const originalJson = {
    taxonomy_version: 'v0.3',
    segment_id: 'segment-1',
    tags: [preservedTag, {
      dimension: '核心动作',
      label_path: [...secondaryAction.labelPath],
      selected_level: 'l4',
      tag_role: '次动作',
      evidence: { source: 'frame-4' }
    }]
  };
  let repairs = 0;
  const result = await resolveRequiredArchivePath({
    acceptedPaths: [
      '内容领域 > 生活方式 > 日常记录',
      secondaryAction.labelPath.join(' > ')
    ],
    structuredResponse: response([contentTag, secondaryAction]),
    modelJson: originalJson,
    policy: archivePolicy,
    taxonomyTree: archiveTaxonomy,
    requestRepair: async () => {
      repairs += 1;
      return {
        structuredResponse: response([mainAction, secondaryAction]),
        modelJson: {
          tags: [{
            dimension: '核心动作',
            label_path: [...mainAction.labelPath],
            selected_level: 'l4',
            tag_role: '主动作'
          }, {
            dimension: '核心动作',
            label_path: [...secondaryAction.labelPath],
            selected_level: 'l4',
            tag_role: '次动作'
          }]
        }
      };
    }
  });

  assert.equal(repairs, 1);
  assert.equal(result.repairApplied, true);
  assert.deepEqual(result.acceptedPaths, [
    '内容领域 > 生活方式 > 日常记录',
    '核心动作 > 身体动作 > 位移动作 > 行走',
    '核心动作 > 身体动作 > 位移动作 > 跑动'
  ]);
  assert.deepEqual(result.structuredResponse?.tags, [contentTag, secondaryAction, mainAction]);
  const merged = result.mergedModelJson as typeof originalJson;
  assert.equal(merged.taxonomy_version, originalJson.taxonomy_version);
  assert.equal(merged.segment_id, originalJson.segment_id);
  assert.deepEqual(merged.tags[0], preservedTag);
  assert.notEqual(merged.tags[0], preservedTag);
  assert.deepEqual(merged.tags[1], originalJson.tags[1]);
  assert.equal(merged.tags.filter((tag) => tag.dimension === '核心动作').length, 2);
  assert.deepEqual(
    merged.tags.filter((tag) => tag.dimension === '核心动作').map((tag) => tag.tag_role),
    ['次动作', '主动作']
  );
  assert.deepEqual(originalJson.tags[0], preservedTag);
  assert.equal(originalJson.tags.length, 2);
});

test('repairs duplicate primary actions only once and propagates the classified retry failure', async () => {
  let repairs = 0;
  await assert.rejects(
    resolveRequiredArchivePath({
      acceptedPaths: [mainAction.labelPath.join(' > ')],
      structuredResponse: response([mainAction, mainAction]),
      modelJson: { tags: [] },
      policy: archivePolicy,
      taxonomyTree: archiveTaxonomy,
      requestRepair: async () => {
        repairs += 1;
        return { structuredResponse: response([]), modelJson: { tags: [] } };
      }
    }),
    (error: unknown) => error instanceof ArchivePrimaryTagError &&
      error.code === 'archive-primary-tag-missing'
  );
  assert.equal(repairs, 1);
});

test('does not synthesize a real structured response before its single repair', async () => {
  let repairs = 0;
  const result = await resolveRequiredArchivePath({
    acceptedPaths: [mainAction.labelPath.join(' > ')],
    policy: archivePolicy,
    taxonomyTree: archiveTaxonomy,
    requestRepair: async () => {
      repairs += 1;
      return { structuredResponse: response([mainAction]), modelJson: { tags: [] } };
    }
  });

  assert.equal(repairs, 1);
  assert.equal(result.repairApplied, true);
});

test('synthesizes one configured primary action only for simulated path fixtures', async () => {
  const result = await resolveRequiredArchivePath({
    acceptedPaths: [
      '核心动作 > 身体动作 > 位移动作 > 跑动',
      '内容领域 > 生活方式 > 日常记录'
    ],
    policy: archivePolicy,
    taxonomyTree: archiveTaxonomy,
    allowPathSynthesis: true,
    requestRepair: async () => {
      throw new Error('repair should not run');
    }
  });

  assert.equal(result.selectedArchivePath, '核心动作 > 身体动作 > 位移动作 > 跑动');
  await assert.rejects(resolveRequiredArchivePath({
    acceptedPaths: [],
    policy: archivePolicy,
    taxonomyTree: archiveTaxonomy,
    allowPathSynthesis: true,
    requestRepair: async () => { throw new Error('repair should not run'); }
  }), (error: unknown) => error instanceof ArchivePrimaryTagError && error.code === 'archive-primary-tag-missing');
  await assert.rejects(resolveRequiredArchivePath({
    acceptedPaths: [
      '核心动作 > 身体动作 > 位移动作 > 跑动',
      '核心动作 > 身体动作 > 姿态动作 > 转身'
    ],
    policy: archivePolicy,
    taxonomyTree: archiveTaxonomy,
    allowPathSynthesis: true,
    requestRepair: async () => { throw new Error('repair should not run'); }
  }), (error: unknown) => error instanceof ArchivePrimaryTagError && error.code === 'archive-primary-tag-conflict');
});

test('keeps existing unique content topic without fallback', async () => {
  const result = await resolveRequiredContentTopic({
    acceptedPaths: [
      '视觉风格 > 真实感',
      '内容题材 > 生活方式 > 日常记录'
    ],
    requestFallbackPaths: async () => {
      throw new Error('fallback should not run');
    }
  });

  assert.equal(result.selectedContentTopicPath, '内容题材 > 生活方式 > 日常记录');
  assert.equal(result.fallbackApplied, false);
  assert.deepEqual(result.acceptedPaths, [
    '视觉风格 > 真实感',
    '内容题材 > 生活方式 > 日常记录'
  ]);
});

test('retries provider rate-limit errors a finite number of times', async () => {
  let attempts = 0;
  const result = await withRateLimitRetry({
    delayMs: 1,
    operation: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error('429 rate limit');
      }
      return 'ok';
    }
  });

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('runs content-topic fallback when model output has no archive branch', async () => {
  const result = await resolveRequiredContentTopic({
    acceptedPaths: ['视觉风格 > 真实感'],
    requestFallbackPaths: async () => ['内容题材 > 广告营销 > 产品广告']
  });

  assert.equal(result.fallbackApplied, true);
  assert.equal(result.selectedContentTopicPath, '内容题材 > 广告营销 > 产品广告');
  assert.deepEqual(result.acceptedPaths, [
    '视觉风格 > 真实感',
    '内容题材 > 广告营销 > 产品广告'
  ]);
});

test('fails tagging when fallback still cannot provide content topic', async () => {
  await assert.rejects(
    resolveRequiredContentTopic({
      acceptedPaths: ['视觉风格 > 真实感'],
      requestFallbackPaths: async () => ['环境和场景 > 室内']
    }),
    /缺少内容题材/iu
  );
});

test('runs concurrent workers while returning results in input order', async () => {
  let active = 0;
  let maxActive = 0;
  const outputs = await runConcurrentInOrder(
    [30, 5, 20, 1],
    3,
    async (value, index): Promise<RequiredContentTopicResolution> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return {
        acceptedPaths: [`内容题材 > 分支 > ${index}`],
        selectedContentTopicPath: `内容题材 > 分支 > ${index}`,
        fallbackApplied: false
      };
    }
  );

  assert.equal(maxActive, 3);
  assert.deepEqual(
    outputs.map((item) => item.selectedContentTopicPath),
    [
      '内容题材 > 分支 > 0',
      '内容题材 > 分支 > 1',
      '内容题材 > 分支 > 2',
      '内容题材 > 分支 > 3'
    ]
  );
});

test('resolves explicit tagging concurrency before profile default', () => {
  assert.equal(resolveTaggingConcurrency({
    explicitConcurrency: 31,
    profileDefaultConcurrency: 16,
    itemCount: 100
  }), 31);
  assert.equal(resolveTaggingConcurrency({
    explicitConcurrency: undefined,
    profileDefaultConcurrency: 24,
    itemCount: 100
  }), 24);
  assert.equal(resolveTaggingConcurrency({
    explicitConcurrency: 99,
    profileDefaultConcurrency: 24,
    itemCount: 100
  }), 64);
});
