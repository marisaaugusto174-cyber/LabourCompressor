import test from 'node:test';
import assert from 'node:assert/strict';

import {
  diffTaxonomyTrees,
  parseTaxonomyMarkdown
} from '../../../features/taxonomy/domain/index.ts';

test('detects added, moved, and renamed taxonomy changes', () => {
  const previousTree = parseTaxonomyMarkdown(`
## 1. 主体对象

- 人物
  - 年龄
- 动物
`);
  const nextTree = parseTaxonomyMarkdown(`
## 1. 主体对象

- 人物
  - 年龄阶段

## 2. 分类对象

- 动物
- 植物
`);
  const diff = diffTaxonomyTrees({
    previousTree,
    nextTree
  });

  assert.equal(diff.addedPaths.some((path) => path.value === '分类对象'), true);
  assert.equal(
    diff.movedNodes.some((node) => node.fromPath.value === '主体对象 > 动物'),
    true
  );
  assert.equal(
    diff.renamedNodes.some((node) => node.fromLabel === '年龄'),
    true
  );
});
