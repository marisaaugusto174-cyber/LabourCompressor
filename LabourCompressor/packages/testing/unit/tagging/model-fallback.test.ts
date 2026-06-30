import test from 'node:test';
import assert from 'node:assert/strict';

import { ModelProviderRequestError } from '../../../adapters/models/model-provider-error.ts';
import {
  ManualReviewRequiredError,
  ModelFallbackFailedError,
  runModelRequestWithFallback
} from '../../../features/tagging/domain/model-fallback.ts';

test('uses Gemini once after Qwen content rejection', async () => {
  let fallbackCalls = 0;
  const result = await runModelRequestWithFallback({
    primaryProfileId: 'qwen-3.7-plus',
    primary: async () => { throw rejected('qwen', 'DataInspectionFailed'); },
    fallbackProfileId: 'gemini-3.5-flash',
    fallback: async () => { fallbackCalls += 1; return 'gemini-result'; }
  });
  assert.equal(result.value, 'gemini-result');
  assert.equal(result.trace.fallbackStatus, 'succeeded');
  assert.equal(fallbackCalls, 1);
});

test('requires manual review when Gemini is not configured', async () => {
  await assert.rejects(runModelRequestWithFallback({
    primaryProfileId: 'qwen-3.7-plus',
    primary: async () => { throw rejected('qwen', 'DataInspectionFailed'); }
  }), (error: unknown) => {
    assert.ok(error instanceof ManualReviewRequiredError);
    assert.equal(error.trace.fallbackStatus, 'not-configured');
    return true;
  });
});

test('requires manual review when Gemini also rejects content', async () => {
  await assert.rejects(runModelRequestWithFallback({
    primaryProfileId: 'qwen-3.7-plus',
    primary: async () => { throw rejected('qwen', 'DataInspectionFailed'); },
    fallbackProfileId: 'gemini-3.5-flash',
    fallback: async () => { throw rejected('google', 'PROHIBITED_CONTENT'); }
  }), (error: unknown) => {
    assert.ok(error instanceof ManualReviewRequiredError);
    assert.equal(error.trace.fallbackStatus, 'rejected');
    return true;
  });
});

test('does not fallback for a non-content Qwen failure', async () => {
  let fallbackCalls = 0;
  const error = new ModelProviderRequestError({
    provider: 'qwen', statusCode: 429, providerCode: 'Throttled', message: 'rate limit'
  });
  await assert.rejects(runModelRequestWithFallback({
    primaryProfileId: 'qwen-3.7-plus', primary: async () => { throw error; },
    fallbackProfileId: 'gemini-3.5-flash', fallback: async () => { fallbackCalls += 1; }
  }), error);
  assert.equal(fallbackCalls, 0);
});

test('keeps transient Gemini failure retryable', async () => {
  await assert.rejects(runModelRequestWithFallback({
    primaryProfileId: 'qwen-3.7-plus',
    primary: async () => { throw rejected('qwen', 'DataInspectionFailed'); },
    fallbackProfileId: 'gemini-3.5-flash',
    fallback: async () => {
      throw new ModelProviderRequestError({
        provider: 'google', statusCode: 503, providerCode: 'UNAVAILABLE', message: 'unavailable'
      });
    }
  }), ModelFallbackFailedError);
});

function rejected(provider: 'qwen' | 'google', providerCode: string) {
  return new ModelProviderRequestError({
    provider, statusCode: provider === 'qwen' ? 400 : 200, providerCode,
    message: `${provider} content rejected`
  });
}
