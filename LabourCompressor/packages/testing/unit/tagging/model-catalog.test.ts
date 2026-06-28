import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getProviderCatalogEntry,
  listProviderCatalog,
  validateProviderModelSelection
} from '../../../features/tagging/domain/index.ts';

test('lists 10 provider catalog entries with tier grouping', () => {
  const catalog = listProviderCatalog();

  assert.equal(catalog.length, 10);
  assert.equal(catalog.filter((entry) => entry.tier === 'tier-1').length, 5);
  assert.equal(catalog.filter((entry) => entry.tier === 'tier-2').length, 5);
});

test('returns provider catalog entry and validates model selection', () => {
  const provider = getProviderCatalogEntry('openai');

  assert.equal(provider.models.length, 3);
  assert.doesNotThrow(() =>
    validateProviderModelSelection({
      provider: 'qwen',
      modelId: 'qwen3.6-flash',
      authMode: 'api-key'
    })
  );
  assert.doesNotThrow(() =>
    validateProviderModelSelection({
      provider: 'google',
      modelId: 'gemini-3.5-flash',
      authMode: 'api-key'
    })
  );
});

test('rejects invalid model selection for provider', () => {
  assert.throws(
    () =>
      validateProviderModelSelection({
        provider: 'google',
        modelId: 'gpt-5.4',
        authMode: 'api-key'
      }),
    /is not available under provider/
  );
});
