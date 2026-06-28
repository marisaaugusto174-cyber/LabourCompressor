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
    ['qwen-3.7-plus', 'qwen-3.6-flash', 'gemini-3.5-flash']
  );
  assert.deepEqual(
    profiles.map((item) => item.defaultTaggingConcurrency),
    [16, 24, 4]
  );
});

test('defaults to Qwen3.7Plus', () => {
  const profile = getVideoModelProfile(undefined);

  assert.equal(profile.id, 'qwen-3.7-plus');
  assert.equal(profile.label, 'Qwen3.7Plus');
  assert.equal(profile.provider, 'qwen');
  assert.equal(profile.modelName, 'qwen3.7-plus');
  assert.equal(profile.defaultTaggingConcurrency, 16);
});

test('resolves curated Gemini latest multimodal profile to provider and model id', () => {
  const profile = getVideoModelProfile('gemini-3.5-flash');

  assert.equal(profile.provider, 'google');
  assert.equal(profile.label, 'Gemini 3.5 Flash');
  assert.equal(profile.modelName, 'gemini-3.5-flash');
});

test('rejects unsupported video model profile ids', () => {
  assert.throws(
    () => getVideoModelProfile('gpt-5.4'),
    /Unsupported video model profile/
  );
});
