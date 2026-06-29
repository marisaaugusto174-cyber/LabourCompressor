import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  resolveRequiredArchivePath,
  resolveRequiredContentTopic,
  resolveTaggingFailurePresentation,
  resolveTaggingConcurrency,
  runTaggingBatch,
  runConcurrentInOrder,
  withRateLimitRetry,
  type RequiredContentTopicResolution
} from '../../../../apps/cli/local-pipeline-tagging.ts';
import {
  ArchivePrimaryTagError,
  parsePromptLibraryMarkdown,
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
  const repeatedPreservedTag = {
    dimension: '内容领域',
    label_path: ['内容领域', '生活方式', '日常记录'],
    evidence: { source: 'frame-9' }
  };
  const originalJson = {
    taxonomy_version: 'v0.3',
    segment_id: 'segment-1',
    tags: [preservedTag, repeatedPreservedTag, {
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
    structuredResponse: response([contentTag, contentTag, secondaryAction]),
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
  assert.deepEqual(result.structuredResponse?.tags, [
    contentTag,
    contentTag,
    secondaryAction,
    mainAction
  ]);
  const merged = result.mergedModelJson as typeof originalJson;
  assert.equal(merged.taxonomy_version, originalJson.taxonomy_version);
  assert.equal(merged.segment_id, originalJson.segment_id);
  assert.deepEqual(merged.tags[0], preservedTag);
  assert.notEqual(merged.tags[0], preservedTag);
  assert.deepEqual(merged.tags[1], repeatedPreservedTag);
  assert.deepEqual(merged.tags[2], originalJson.tags[2]);
  assert.equal(merged.tags.filter((tag) => tag.dimension === '核心动作').length, 2);
  assert.deepEqual(
    merged.tags.filter((tag) => tag.dimension === '核心动作').map((tag) => tag.tag_role),
    ['次动作', '主动作']
  );
  assert.deepEqual(originalJson.tags[0], preservedTag);
  assert.deepEqual(originalJson.tags[1], repeatedPreservedTag);
  assert.equal(originalJson.tags.length, 3);
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

test('rejects duplicate identical primary actions returned by the single repair', async () => {
  let repairs = 0;
  await assert.rejects(
    resolveRequiredArchivePath({
      acceptedPaths: [contentTag.labelPath.join(' > ')],
      structuredResponse: response([contentTag]),
      modelJson: { tags: [] },
      policy: archivePolicy,
      taxonomyTree: archiveTaxonomy,
      requestRepair: async () => {
        repairs += 1;
        return {
          structuredResponse: response([mainAction, mainAction]),
          modelJson: { tags: [] }
        };
      }
    }),
    (error: unknown) => error instanceof ArchivePrimaryTagError &&
      error.code === 'archive-primary-tag-conflict'
  );
  assert.equal(repairs, 1);
});

test('merges repaired primary actions into their raw domain collection', async () => {
  const originalFact = {
    dimension: '内容领域',
    label_path: ['内容领域', '生活方式', '日常记录'],
    evidence: 'fact'
  };
  const originalMetadata = {
    dimension: '平台来源',
    label_path: ['平台来源', '社媒平台'],
    evidence: 'metadata'
  };
  const result = await resolveRequiredArchivePath({
    acceptedPaths: [contentTag.labelPath.join(' > ')],
    structuredResponse: response([contentTag]),
    modelJson: {
      taxonomy_version: 'v0.3',
      fact_tags: [originalFact],
      metadata_tags: [originalMetadata]
    },
    policy: archivePolicy,
    taxonomyTree: archiveTaxonomy,
    requestRepair: async () => ({
      structuredResponse: response([mainAction]),
      modelJson: {
        fact_tags: [{
          dimension: '核心动作',
          label_path: [...mainAction.labelPath],
          selected_level: 'l4',
          tag_role: '主动作'
        }]
      }
    })
  });
  const merged = result.mergedModelJson as Record<string, unknown>;
  assert.deepEqual(merged.fact_tags, [originalFact, {
    dimension: '核心动作',
    label_path: [...mainAction.labelPath],
    selected_level: 'l4',
    tag_role: '主动作'
  }]);
  assert.deepEqual(merged.metadata_tags, [originalMetadata]);
  assert.equal(merged.taxonomy_version, 'v0.3');
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

test('uses repaired raw json for the sidecar when initial json is a legacy path array', async () => {
  const originalJson = ['核心动作 > 身体动作 > 位移动作 > 行走'];
  const repairedRawTag = {
    dimension: '核心动作',
    label_path: [...mainAction.labelPath],
    selected_level: 'l4',
    tag_role: '主动作'
  };
  const repairJson = { taxonomy_version: 'v0.3', tags: [repairedRawTag] };
  let repairs = 0;
  const result = await resolveRequiredArchivePath({
    acceptedPaths: originalJson,
    modelJson: originalJson,
    policy: archivePolicy,
    taxonomyTree: archiveTaxonomy,
    requestRepair: async () => {
      repairs += 1;
      return { structuredResponse: response([mainAction]), modelJson: repairJson };
    }
  });

  assert.equal(repairs, 1);
  assert.equal(result.repairApplied, true);
  assert.equal(result.selectedArchivePath, mainAction.labelPath.join(' > '));
  assert.deepEqual(result.structuredResponse?.tags, [mainAction]);
  assert.equal(Array.isArray(result.mergedModelJson), false);
  assert.deepEqual(result.mergedModelJson, repairJson);
  assert.notEqual(result.mergedModelJson, repairJson);
  assert.notEqual((result.mergedModelJson as typeof repairJson).tags, repairJson.tags);
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

test('runTaggingBatch preserves classified archive primary tag errors', async () => {
  const failures: Array<{ readonly errorCode: string }> = [];
  const resultsByRow = new Map();
  await runTaggingBatch({
    assets: [{
      mediaAssetId: 'asset-1', taskId: 'task-1', rowNumber: 2,
      sourceUrl: 'https://example.com/video', platform: 'direct',
      filePath: '/tmp/not-written.mp4', fileName: 'video.mp4', downloadedAt: '2026-06-29T00:00:00.000Z'
    }],
    rowByTaskId: new Map([['task-1', {
      taskId: 'task-1', rowNumber: 2, url: 'https://example.com/video',
      sourceKind: 'url' as const, values: {}
    }]]),
    resultsByRow,
    failures,
    startedAt: '2026-06-29T00:00:00.000Z',
    taggingMode: 'simulated',
    candidateFixtures: {
      'https://example.com/video': [
        '核心动作 > 身体动作 > 位移动作 > 跑动',
        '核心动作 > 身体动作 > 位移动作 > 行走'
      ]
    },
    taxonomyTree: archiveTaxonomy,
    promptLibrary: parsePromptLibraryMarkdown('# 提示\n\n## 规则\n- 仅合法路径\n'),
    archivePathPolicy: archivePolicy,
    emit: () => undefined
  });
  assert.equal(failures[0]?.errorCode, 'archive-primary-tag-conflict');
  assert.equal(resultsByRow.get(2)?.archiveState, '待复核：存在多个核心动作主动作');
  assert.equal(resultsByRow.get(2)?.archivePath, '');
  assert.equal(resultsByRow.get(2)?.archiveFileName, '');
});

test('maps every classified primary action failure to an explicit review archive state', () => {
  const cases = [
    ['archive-primary-tag-missing', '待复核：核心动作主动作缺失'],
    ['archive-primary-tag-conflict', '待复核：存在多个核心动作主动作'],
    ['archive-primary-tag-role-invalid', '待复核：核心动作角色不合法'],
    ['archive-primary-tag-path-invalid', '待复核：核心动作路径不合法'],
    ['archive-primary-tag-review-required', '待复核：核心动作无法确定']
  ] as const;

  for (const [errorCode, archiveState] of cases) {
    const result = resolveTaggingFailurePresentation(new ArchivePrimaryTagError(errorCode));
    assert.equal(result.errorCode, errorCode);
    assert.equal(result.archiveState, archiveState);
  }
});

test('runTaggingBatch preserves sidecars and reports every primary action failure code', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'primary-action-failures-'));
  const invalidPath = Object.freeze({ ...mainAction, selectedLevel: 'l3' });
  const reviewResponse = Object.freeze({
    reviewRequired: true,
    reviewReason: '核心动作主动作无法确定',
    tags: Object.freeze([mainAction])
  });
  const cases = [
    ['archive-primary-tag-missing', '待复核：核心动作主动作缺失', response([])],
    ['archive-primary-tag-conflict', '待复核：存在多个核心动作主动作', response([mainAction, mainAction])],
    ['archive-primary-tag-role-invalid', '待复核：核心动作角色不合法', response([secondaryAction])],
    ['archive-primary-tag-path-invalid', '待复核：核心动作路径不合法', response([invalidPath])],
    ['archive-primary-tag-review-required', '待复核：核心动作无法确定', reviewResponse]
  ] as const;

  try {
    for (const [errorCode, archiveState, repairedResponse] of cases) {
      const sourceUrl = `https://example.com/${errorCode}`;
      const mediaPath = path.join(directory, `${errorCode}.mp4`);
      const resultsByRow = new Map();
      const failures: Array<{ readonly errorCode: string }> = [];
      let modelCalls = 0;
      await runTaggingBatch({
        assets: [{
          mediaAssetId: errorCode, taskId: errorCode, rowNumber: 2,
          sourceUrl, platform: 'direct', filePath: mediaPath,
          fileName: `${errorCode}.mp4`, downloadedAt: '2026-06-29T00:00:00.000Z'
        }],
        rowByTaskId: new Map([[errorCode, {
          taskId: errorCode, rowNumber: 2, url: sourceUrl,
          sourceKind: 'url' as const, values: {}
        }]]),
        resultsByRow,
        failures,
        startedAt: '2026-06-29T00:00:00.000Z',
        taggingMode: 'qwen',
        taxonomyTree: archiveTaxonomy,
        promptLibrary: parsePromptLibraryMarkdown('# 提示\n\n## 规则\n- 仅合法路径\n'),
        archivePathPolicy: archivePolicy,
        generateModelCandidates: async () => {
          modelCalls += 1;
          const structuredResponse = modelCalls === 1 ? response([]) : repairedResponse;
          const parsedJson = { marker: `${errorCode}:${modelCalls}`, tags: [] };
          return {
            candidatePaths: [], rawText: '', promptInstruction: '',
            structuredResponse, parsedJson
          };
        },
        emit: () => undefined
      });

      const row = resultsByRow.get(2);
      assert.equal(modelCalls, 2);
      assert.equal(failures[0]?.errorCode, errorCode);
      assert.equal(row?.failure?.errorCode, errorCode);
      assert.equal(row?.archiveState, archiveState);
      assert.equal(row?.archivePath, '');
      assert.equal(row?.archiveFileName, '');
      assert.equal(row?.taggingJsonFileName, `${errorCode}.json`);
      assert.equal(row?.taggingJsonArchivePath, '');
      assert.deepEqual(row?.taggingJsonPayload, { marker: `${errorCode}:2`, tags: [] });
      assert.deepEqual(
        JSON.parse(await readFile(path.join(directory, `${errorCode}.json`), 'utf8')),
        row?.taggingJsonPayload
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeps the existing fallback for unknown tagging failures', () => {
  assert.deepEqual(resolveTaggingFailurePresentation(new Error('provider unavailable')), {
    errorCode: 'tagging-failed',
    archiveState: '打标失败'
  });
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
