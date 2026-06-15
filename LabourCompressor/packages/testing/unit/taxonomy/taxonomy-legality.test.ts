import test from 'node:test';
import assert from 'node:assert/strict';

import {
  lookupTaxonomyPath,
  normalizeTaxonomyPathInput,
  validateTaxonomyPath,
  validateTaxonomyPaths
} from '../../../features/taxonomy/domain/taxonomy-legality.ts';
import { parseTaxonomyMarkdown } from '../../../features/taxonomy/domain/taxonomy-markdown-parser.ts';

const tree = parseTaxonomyMarkdown(`
## 1. 主体对象（末端计数：3）

- 人物（末端计数：2）
  - 年龄
  - 性别
- 动物
`);

test('normalizes taxonomy path input to canonical separator form', () => {
  assert.equal(
    normalizeTaxonomyPathInput('主体对象>人物 > 年龄'),
    '主体对象 > 人物 > 年龄'
  );
});

test('looks up an existing taxonomy path', () => {
  const lookup = lookupTaxonomyPath(tree, '主体对象 > 人物 > 年龄');

  assert.equal(lookup.exists, true);
  assert.equal(lookup.nodeId, 'taxonomy-node:主体对象 > 人物 > 年龄');
});

test('rejects an unknown taxonomy path', () => {
  const validation = validateTaxonomyPath(tree, '主体对象 > 植物');

  assert.equal(validation.isLegal, false);
  assert.equal(validation.reason, 'unknown-path');
});

test('rejects an empty taxonomy path segment', () => {
  const validation = validateTaxonomyPath(tree, '主体对象 >  > 年龄');

  assert.equal(validation.isLegal, false);
  assert.equal(validation.reason, 'contains-empty-segment');
});

test('rejects duplicate paths inside the same input batch', () => {
  const validations = validateTaxonomyPaths(tree, [
    '主体对象 > 人物 > 年龄',
    '主体对象>人物>年龄'
  ]);

  assert.equal(validations[0]?.isLegal, true);
  assert.equal(validations[1]?.isLegal, false);
  assert.equal(validations[1]?.reason, 'duplicate-input');
});
