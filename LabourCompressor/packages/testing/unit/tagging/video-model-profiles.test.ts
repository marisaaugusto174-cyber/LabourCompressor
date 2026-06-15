import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getVideoModelProfile,
  listVideoModelProfiles
} from '../../../features/tagging/domain/index.ts';

test('lists curated video model profiles in fixed default order', () => {
  const profiles = listVideoModelProfiles();

  assert.deepEqual(
    profiles.map((item) => item.id),
    ['qwen-3.6-flash', 'qwen-3.5-plus', 'qwen-3.6-plus', 'gemini-3-flash-thinking', 'gemini-3-pro']
  );
  assert.equal(profiles[3]?.thinkingLevel, 'high');
  assert.deepEqual(
    profiles.map((item) => item.defaultTaggingConcurrency),
    [10, 10, 10, 2, 2]
  );
});

test('resolves curated Gemini thinking profile to provider and model id', () => {
  const profile = getVideoModelProfile('gemini-3-flash-thinking');

  assert.equal(profile.provider, 'google');
  assert.equal(profile.modelName, 'gemini-3-flash-preview');
  assert.equal(profile.thinkingLevel, 'high');
});

test('rejects unsupported video model profile ids', () => {
  assert.throws(
    () => getVideoModelProfile('gpt-5.4'),
    /Unsupported video model profile/
  );
});

test('resolves Gemini Pro to current preview model id', () => {
  const profile = getVideoModelProfile('gemini-3-pro');

  assert.equal(profile.provider, 'google');
  assert.equal(profile.modelName, 'gemini-3.1-pro-preview');
  assert.equal(profile.defaultTaggingConcurrency, 2);
});
