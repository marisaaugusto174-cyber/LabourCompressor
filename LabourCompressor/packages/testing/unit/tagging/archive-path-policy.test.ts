import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ArchivePrimaryTagError,
  selectArchivePathFromStructuredTags,
  type ArchivePathPolicy,
  type StructuredTagCandidate,
  type StructuredTaggingResponse
} from '../../../features/tagging/domain/index.ts';
import { parseTaxonomyMarkdown } from '../../../features/taxonomy/domain/index.ts';

const taxonomyTree = parseTaxonomyMarkdown(
  readFileSync(
    'config/repositories/taxonomies/核心基座_标签提示词_V0.3_戏核增强候选.md',
    'utf8'
  ),
  { rootMode: 'bullet-root' }
);
const policy: ArchivePathPolicy = {
  dimension: '核心动作',
  primaryRole: '主动作',
  requiredCount: 1,
  onInvalid: 'retry-once-then-review'
};

test('returns the unique legal primary core-action path', () => {
  assert.equal(select([tag()]), '核心动作 > 身体动作 > 位移动作 > 跑动');
});

test('ignores secondary actions when selecting the primary path', () => {
  assert.equal(select([
    tag(),
    tag({ tagRole: '次动作', labelPath: ['核心动作', '身体动作', '姿态动作', '转身'] })
  ]), '核心动作 > 身体动作 > 位移动作 > 跑动');
});

test('classifies a missing core-action candidate', () => {
  assertCode([], 'archive-primary-tag-missing');
});

test('classifies core-action candidates without the configured role', () => {
  assertCode([tag({ tagRole: '次动作' })], 'archive-primary-tag-role-invalid');
});

test('classifies two primary actions as a conflict', () => {
  assertCode([
    tag(),
    tag({ labelPath: ['核心动作', '身体动作', '姿态动作', '转身'] })
  ], 'archive-primary-tag-conflict');
});

test('classifies malformed or illegal primary paths', async (t) => {
  const cases: readonly [string, StructuredTagCandidate][] = [
    ['wrong root', tag({ labelPath: ['表现形式', '身体动作', '位移动作', '跑动'] })],
    ['dimension mismatch', tag({ dimension: '表现形式' })],
    ['unknown taxonomy path', tag({ labelPath: ['核心动作', '身体动作', '位移动作', '飞奔'] })],
    ['selected level mismatch', tag({ selectedLevel: 'l3' })]
  ];

  for (const [name, candidate] of cases) {
    await t.test(name, () => assertCode([candidate], 'archive-primary-tag-path-invalid'));
  }
});

test('requires review when the review reason points to the dimension or role', async (t) => {
  for (const reviewReason of ['核心动作证据不足', '主动作冲突待复核']) {
    await t.test(reviewReason, () => assertCode(
      [tag()],
      'archive-primary-tag-review-required',
      reviewReason
    ));
  }
});

test('accepts the legal static-state l4 path', () => {
  assert.equal(select([tag({
    labelPath: ['核心动作', '状态变化', '静态状态', '静止呈现']
  })]), '核心动作 > 状态变化 > 静态状态 > 静止呈现');
});

function tag(overrides: Partial<StructuredTagCandidate> = {}): StructuredTagCandidate {
  return {
    dimension: '核心动作',
    labelPath: ['核心动作', '身体动作', '位移动作', '跑动'],
    selectedLevel: 'l4',
    tagRole: '主动作',
    entityId: 'action-1',
    targetEntityId: 'person-1',
    ...overrides
  };
}

function response(
  tags: readonly StructuredTagCandidate[],
  reviewReason = ''
): StructuredTaggingResponse {
  return { tags, reviewRequired: reviewReason.length > 0, reviewReason };
}

function select(tags: readonly StructuredTagCandidate[]): string {
  return selectArchivePathFromStructuredTags({ structuredResponse: response(tags), policy, taxonomyTree });
}

function assertCode(
  tags: readonly StructuredTagCandidate[],
  code: ArchivePrimaryTagError['code'],
  reviewReason = ''
): void {
  assert.throws(
    () => selectArchivePathFromStructuredTags({
      structuredResponse: response(tags, reviewReason),
      policy,
      taxonomyTree
    }),
    (error) => error instanceof ArchivePrimaryTagError && error.code === code
  );
}
