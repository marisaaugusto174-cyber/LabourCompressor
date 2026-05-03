import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTaxonomyMarkdown } from '../../../features/taxonomy/domain/taxonomy-markdown-parser.ts';

test('parses headings and bullets into taxonomy nodes', () => {
  const tree = parseTaxonomyMarkdown(`
# 示例

## 1. 主体对象（末端计数：3）

- 人物（末端计数：2）
  - 年龄
  - 性别
- 动物
`);

  assert.deepEqual(tree.rootNodeIds, ['taxonomy-node:主体对象']);
  assert.equal(tree.nodes.length, 5);
  assert.equal(tree.nodeIdsByPath['主体对象 > 人物 > 年龄'] !== undefined, true);
});

test('keeps non-count parentheses while stripping terminal count text', () => {
  const tree = parseTaxonomyMarkdown(`
## 1. 主体对象（末端计数：2）

- 动物
  - 哺乳类（家畜/野生/宠物）
`);

  const mammalNodeId =
    tree.nodeIdsByPath['主体对象 > 动物 > 哺乳类（家畜/野生/宠物）'];

  assert.equal(mammalNodeId !== undefined, true);
});

test('parses mixed chinese and english heading labels', () => {
  const tree = parseTaxonomyMarkdown(`
## 5. 内容领域 (Content Domains) —— 通用全量版（末端计数：1）

- 生活方式与消费 (Lifestyle & Consumption)
`);

  assert.equal(
    tree.rootNodeIds[0],
    'taxonomy-node:内容领域 (Content Domains) —— 通用全量版'
  );
  assert.equal(
    tree.nodeIdsByPath[
      '内容领域 (Content Domains) —— 通用全量版 > 生活方式与消费 (Lifestyle & Consumption)'
    ] !== undefined,
    true
  );
});

test('rejects invalid indentation jumps', () => {
  assert.throws(() => {
    parseTaxonomyMarkdown(`
## 1. 主体对象

    - 非法缩进
`);
  }, /nested node without parent|depth jump is invalid/);
});
