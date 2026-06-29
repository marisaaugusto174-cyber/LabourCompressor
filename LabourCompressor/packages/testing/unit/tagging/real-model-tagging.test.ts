import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildArchivePolicyInstruction,
  buildModelInstructionText,
  generateModelCandidatePaths,
  listLeafTaxonomyPaths,
  parseCandidatePathsFromModelText,
  parseModelTaggingResponse,
  parsePromptLibraryMarkdown
} from '../../../features/tagging/domain/index.ts';
import {
  parseTaxonomyMarkdown
} from '../../../features/taxonomy/domain/index.ts';

test('lists only leaf taxonomy paths for model instruction', () => {
  const tree = parseTaxonomyMarkdown(
    '## 一级\n\n- A\n  - A1\n  - A2\n- B\n  - B1\n'
  );

  assert.deepEqual(listLeafTaxonomyPaths(tree), ['一级 > A > A1', '一级 > A > A2', '一级 > B > B1']);
});

test('builds an exact structured archive policy instruction', () => {
  const instruction = buildArchivePolicyInstruction({
    dimension: '核心动作',
    primaryRole: '主动作',
    requiredCount: 1,
    onInvalid: 'retry-once-then-review'
  });

  assert.match(instruction, /exactly 1 tag/u);
  assert.match(instruction, /dimension is "核心动作"/u);
  assert.match(instruction, /tag_role is "主动作"/u);
  assert.match(instruction, /Keep all other applicable tags/u);
  assert.match(instruction, /preserve the JSON schema/u);
});

test('injects archive policy once into the final structured provider prompt', () => {
  const policy = {
    dimension: '核心动作', primaryRole: '主动作', requiredCount: 1 as const,
    onInvalid: 'retry-once-then-review' as const
  };
  const prompt = buildModelInstructionText(
    'taxonomy schema', [], 'multi-branch', 'structured-json', '内容领域', policy
  );
  assert.equal(prompt.match(/exactly 1 tag/gu)?.length, 1);
  const legacy = buildModelInstructionText(
    'legacy', ['内容题材 > 生活'], 'multi-branch', 'paths-json-array', '内容题材', policy
  );
  assert.equal(legacy.includes('tag_role'), false);
  assert.match(legacy, /JSON array/u);
});

test('parses candidate path json array from model response', () => {
  assert.deepEqual(
    parseCandidatePathsFromModelText(
      '["内容题材 > 广告营销 > 产品广告","内容题材 > 广告营销 > 产品广告"]'
    ),
    ['内容题材 > 广告营销 > 产品广告']
  );
});

test('parses core v0.1 structured tagging json response into taxonomy paths', () => {
  const parsed = parseModelTaggingResponse(JSON.stringify({
    taxonomy_version: 'Core_Prompt_V0.1',
    segment_id: 'seg-1',
    review_required: false,
    review_reason: '',
    tags: [
      {
        dimension: '表现形式',
        label_path: ['表现形式', '商业传播', '产品转化']
      },
      {
        dimension: '内容领域',
        label_path: ['内容领域', '商业营销', '产品广告']
      }
    ]
  }));

  assert.deepEqual(
    parsed.candidatePaths,
    ['表现形式 > 商业传播 > 产品转化', '内容领域 > 商业营销 > 产品广告']
  );
  assert.deepEqual(parsed.structuredResponse?.tags[0], {
    dimension: '表现形式',
    labelPath: ['表现形式', '商业传播', '产品转化'],
    selectedLevel: '',
    tagRole: '',
    entityId: '',
    targetEntityId: '',
    confidenceScore: undefined
  });
});

test('parses full v0.2 structured tagging json response across all data domains', () => {
  assert.deepEqual(
    parseCandidatePathsFromModelText(JSON.stringify({
      taxonomy_version: 'Full_Prompt_V0.2',
      fact_tags: [
        {
          dimension: '内容领域',
          label_path: ['内容领域', '生活方式', '日常记录']
        }
      ],
      metadata_tags: [
        {
          dimension: '平台来源',
          label_path: ['平台来源', '社媒平台', '短视频平台']
        }
      ],
      production_tags: [
        {
          dimension: '质量状态',
          label_path: ['质量状态', '正常可用']
        }
      ]
    })),
    [
      '内容领域 > 生活方式 > 日常记录',
      '平台来源 > 社媒平台 > 短视频平台',
      '质量状态 > 正常可用'
    ]
  );
});

test('preserves normalized core-action tag roles and label paths', () => {
  const parsed = parseModelTaggingResponse(JSON.stringify({
    review_required: false,
    review_reason: '',
    tags: [
      {
        dimension: '核心动作',
        label_path: ['核心动作', '身体动作', '位移动作', '跑动'],
        selected_level: 'l4',
        tag_role: '主动作',
        entity_id: '',
        target_entity_id: 'ent-1',
        confidence_score: 0.95
      },
      {
        dimension: '核心动作',
        label_path: ['核心动作', '身体动作', '姿态动作', '转身'],
        selected_level: 'l4',
        tag_role: '次动作',
        entity_id: '',
        target_entity_id: 'ent-1'
      }
    ]
  }));

  assert.deepEqual(parsed.candidatePaths, [
    '核心动作 > 身体动作 > 位移动作 > 跑动',
    '核心动作 > 身体动作 > 姿态动作 > 转身'
  ]);
  assert.ok(parsed.structuredResponse);
  assert.deepEqual(parsed.structuredResponse.tags, [
    {
      dimension: '核心动作',
      labelPath: ['核心动作', '身体动作', '位移动作', '跑动'],
      selectedLevel: 'l4',
      tagRole: '主动作',
      entityId: '',
      targetEntityId: 'ent-1',
      confidenceScore: 0.95
    },
    {
      dimension: '核心动作',
      labelPath: ['核心动作', '身体动作', '姿态动作', '转身'],
      selectedLevel: 'l4',
      tagRole: '次动作',
      entityId: '',
      targetEntityId: 'ent-1',
      confidenceScore: undefined
    }
  ]);
  assert.equal(Object.isFrozen(parsed.structuredResponse), true);
  assert.equal(Object.isFrozen(parsed.structuredResponse.tags), true);
  assert.equal(Object.isFrozen(parsed.structuredResponse.tags[0]), true);
  assert.equal(Object.isFrozen(parsed.structuredResponse.tags[0]?.labelPath), true);
});

test('keeps structured response undefined for legacy path arrays', () => {
  const parsed = parseModelTaggingResponse(
    '["核心动作 > 身体动作 > 位移动作 > 跑动"]'
  );

  assert.deepEqual(parsed.candidatePaths, [
    '核心动作 > 身体动作 > 位移动作 > 跑动'
  ]);
  assert.equal(parsed.structuredResponse, undefined);
});

test('rejects malformed structured tag selection fields', () => {
  for (const malformedTag of [
    { dimension: 1, label_path: ['核心动作'] },
    { dimension: '核心动作', label_path: ['核心动作'], tag_role: 1 },
    { dimension: '核心动作', label_path: ['核心动作'], selected_level: 1 },
    { dimension: '核心动作', label_path: ['核心动作', 1] }
  ]) {
    assert.throws(
      () => parseModelTaggingResponse(JSON.stringify({ tags: [malformedTag] })),
      /must be (?:a string|an array of strings)/u
    );
  }
});

test('rejects non-boolean review_required when present', () => {
  assert.throws(
    () => parseModelTaggingResponse(JSON.stringify({
      review_required: 'false',
      tags: [{ dimension: '核心动作', label_path: ['核心动作'] }]
    })),
    /review_required must be a boolean/u
  );
});

test('defaults review_required to false when absent', () => {
  const parsed = parseModelTaggingResponse(JSON.stringify({
    tags: [{ dimension: '核心动作', label_path: ['核心动作'] }]
  }));

  assert.equal(parsed.structuredResponse?.reviewRequired, false);
});

test('rejects a present structured tag collection that is not an array', () => {
  for (const key of ['tags', 'fact_tags', 'metadata_tags', 'production_tags']) {
    assert.throws(
      () => parseModelTaggingResponse(JSON.stringify({
        [key]: { dimension: '核心动作', label_path: ['核心动作'] }
      })),
      new RegExp(`${key} must be an array`, 'u')
    );
  }
});

test('rejects primitive members in structured tag collections', () => {
  for (const key of ['tags', 'fact_tags', 'metadata_tags', 'production_tags']) {
    assert.throws(
      () => parseModelTaggingResponse(JSON.stringify({
        [key]: [
          { dimension: '核心动作', label_path: ['核心动作'] },
          'malformed'
        ]
      })),
      new RegExp(`${key} must contain only objects`, 'u')
    );
  }
});

test('rejects too-short videos before provider request', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-real-model-'));
  const sourceFilePath = path.join(tempDir, 'short.mp4');

  try {
    execFileSync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x180:rate=10:duration=1',
      '-pix_fmt',
      'yuv420p',
      sourceFilePath
    ]);

    await assert.rejects(
      generateModelCandidatePaths({
        mediaFilePath: sourceFilePath,
        mediaAssetId: 'asset-short',
        taxonomyTree: parseTaxonomyMarkdown(
          '## 1. 内容题材（末端计数：1）\n\n- 广告营销\n  - 产品广告\n'
        ),
        promptLibrary: parsePromptLibraryMarkdown(
          '# 标注提示词库\n\n## 规则\n- 只能输出标签库中的标签\n'
        ),
        providerConfig: {
          enabled: true,
          provider: 'qwen',
          authMode: 'api-key',
          modelName: 'qwen3.6-flash',
          apiKey: 'test-key',
          oauth: {
            authorizeUrl: '',
            clientId: '',
            redirectUri: '',
            scope: []
          }
        },
        videoCacheDirectory: path.join(tempDir, '.cache', 'video-tagging'),
        selectedModelProfileId: 'qwen-3.6-flash'
      }),
      /video file is too short/iu
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
