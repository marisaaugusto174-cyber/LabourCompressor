import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getEnabledProviderConfig,
  normalizeLocalProviderConfigMap,
  sanitizeLocalProviderConfig
} from '../../../features/tagging/domain/index.ts';

test('normalizes local provider config map and reads enabled qwen config', () => {
  const configMap = normalizeLocalProviderConfigMap({
    qwen: {
      enabled: true,
      provider: 'qwen',
      authMode: 'api-key',
      modelName: 'qwen3.6-plus',
      apiKey: 'sk-test',
      oauth: {
        authorizeUrl: '',
        clientId: '',
        redirectUri: '',
        scope: []
      }
    }
  });

  const qwen = getEnabledProviderConfig(configMap, 'qwen');

  assert.equal(qwen.provider, 'qwen');
  assert.equal(qwen.modelName, 'qwen3.6-plus');
  assert.equal(qwen.apiKey, 'sk-test');
});

test('sanitizes provider config without leaking api key', () => {
  const configMap = normalizeLocalProviderConfigMap({
    qwen: {
      enabled: true,
      provider: 'qwen',
      authMode: 'api-key',
      modelName: 'qwen3.6-plus',
      apiKey: 'sk-test',
      oauth: {
        authorizeUrl: '',
        clientId: '',
        redirectUri: '',
        scope: []
      }
    }
  });

  const sanitized = sanitizeLocalProviderConfig(
    getEnabledProviderConfig(configMap, 'qwen')
  );

  assert.equal(sanitized.apiKeyPresent, true);
  assert.equal(JSON.stringify(sanitized).includes('sk-test'), false);
});
