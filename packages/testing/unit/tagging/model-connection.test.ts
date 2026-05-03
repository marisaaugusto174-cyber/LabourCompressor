import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createModelConnectionConfig,
  createModelOnboardingGuide,
  validateModelConnectionConfig
} from '../../../features/tagging/domain/index.ts';

test('creates a valid api-key model connection config', () => {
  const config = createModelConnectionConfig({
    provider: 'chatgpt',
    authMode: 'api-key',
    modelName: 'gpt-5.4',
    apiKeyConfig: {
      apiKey: 'sk-test'
    }
  });

  assert.equal(config.provider, 'chatgpt');
  assert.equal(config.apiKeyConfig?.apiKey, 'sk-test');
});

test('validates oauth model connection config issues', () => {
  const result = validateModelConnectionConfig({
    provider: 'gemini',
    authMode: 'oauth',
    modelName: 'gemini-2.5',
    oauthConfig: {
      clientId: '',
      redirectUri: ''
    }
  });

  assert.equal(result.isValid, false);
  assert.equal(result.issues.length >= 2, true);
});

test('creates onboarding guide steps for provider and auth mode', () => {
  const steps = createModelOnboardingGuide('qwen', 'oauth');

  assert.equal(steps.length, 4);
  assert.equal(steps[0]?.title, 'Choose provider');
});
