import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRequiredContentTopic,
  runConcurrentInOrder,
  withRateLimitRetry,
  type RequiredContentTopicResolution
} from '../../../../apps/cli/local-pipeline-tagging.ts';

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
