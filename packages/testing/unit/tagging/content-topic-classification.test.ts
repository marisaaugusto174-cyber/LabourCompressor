import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStructuredLevelValues,
  selectUniqueContentTopicPath
} from '../../../features/tagging/domain/index.ts';

test('selects deepest content-topic path as the unique archive path', () => {
  const decision = selectUniqueContentTopicPath([
    '内容题材 > 广告营销 > 产品广告',
    '内容题材 > 广告营销 > 产品广告 > 产品功能演示'
  ]);

  assert.equal(
    decision.selectedPath,
    '内容题材 > 广告营销 > 产品广告 > 产品功能演示'
  );
});

test('builds structured level values across multiple root branches while keeping 内容题材 unique', () => {
  const values = buildStructuredLevelValues([
    '内容题材 > 广告营销 > 产品广告',
    '内容题材 > 广告营销 > 品牌宣传',
    '主体 > 人物',
    '环境和场景 > 室内场景',
    '情绪基调 > 正向情绪'
  ]);

  assert.equal(
    values['一级标签'],
    '内容题材: 广告营销 | 主体: 人物 | 环境和场景: 室内场景 | 情绪基调: 正向情绪'
  );
  assert.equal(values['二级标签'], '内容题材: 产品广告');
  assert.equal(values['三级标签'], '');
  assert.equal(values['四级标签'], '');
});
