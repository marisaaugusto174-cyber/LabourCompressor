import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGeminiCompatibleClient
} from '../../../adapters/models/gemini-compatible-client.ts';

test('passes thinking config for Gemini 3 Flash Thinking text probe', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody = '';

  globalThis.fetch = (async (_input, init) => {
    capturedBody = String(init?.body ?? '');
    return new Response(
      JSON.stringify({
        modelVersion: 'gemini-3-flash-preview',
        candidates: [
          {
            content: {
              parts: [
                {
                  text: 'OK'
                }
              ]
            }
          }
        ]
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }) as typeof fetch;

  try {
    const client = createGeminiCompatibleClient({
      enabled: true,
      provider: 'google',
      authMode: 'api-key',
      modelName: 'gemini-3-flash-preview',
      apiKey: 'test-key',
      oauth: {
        authorizeUrl: '',
        clientId: '',
        redirectUri: '',
        scope: []
      }
    });

    const result = await client.completeText({
      prompt: 'Return OK.',
      thinkingLevel: 'high'
    });

    assert.equal(result.text, 'OK');
    assert.equal(capturedBody.includes('"thinkingLevel":"high"'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sends native video payload to Gemini video endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedBody = '';

  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedBody = String(init?.body ?? '');
    return new Response(
      JSON.stringify({
        modelVersion: 'gemini-3-pro-preview',
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '["内容题材 > 广告营销 > 产品广告"]'
                }
              ]
            }
          }
        ]
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }) as typeof fetch;

  try {
    const client = createGeminiCompatibleClient({
      enabled: true,
      provider: 'google',
      authMode: 'api-key',
      modelName: 'gemini-3-pro-preview',
      apiKey: 'test-key',
      oauth: {
        authorizeUrl: '',
        clientId: '',
        redirectUri: '',
        scope: []
      }
    });

    const result = await client.completeVideoFile({
      prompt: '请返回标签 JSON 数组',
      videoBase64: 'AAAA',
      mimeType: 'video/mp4'
    });

    assert.equal(
      capturedUrl,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=test-key'
    );
    assert.equal(capturedBody.includes('"mime_type":"video/mp4"'), true);
    assert.equal(capturedBody.includes('"data":"AAAA"'), true);
    assert.equal(result.text, '["内容题材 > 广告营销 > 产品广告"]');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
