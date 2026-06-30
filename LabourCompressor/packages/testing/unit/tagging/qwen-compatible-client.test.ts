import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createQwenCompatibleClient,
  extractAssistantText
} from '../../../adapters/models/qwen-compatible-client.ts';
import { ModelProviderRequestError } from '../../../adapters/models/model-provider-error.ts';

test('extracts string assistant content from qwen compatible response', () => {
  const text = extractAssistantText({
    choices: [
      {
        message: {
          content: 'OK'
        }
      }
    ]
  });

  assert.equal(text, 'OK');
});

test('extracts array-based assistant content from qwen compatible response', () => {
  const text = extractAssistantText({
    choices: [
      {
        message: {
          content: [
            {
              type: 'text',
              text: 'OK'
            }
          ]
        }
      }
    ]
  });

  assert.equal(text, 'OK');
});

test('passes an abort signal timeout to qwen fetch request', async () => {
  const originalFetch = globalThis.fetch;
  let capturedSignal: AbortSignal | undefined;

  globalThis.fetch = (async (_input, init) => {
    capturedSignal = init?.signal as AbortSignal | undefined;
    return new Response(
      JSON.stringify({
        model: 'qwen3.6-plus',
        choices: [
          {
            message: {
              content: 'OK'
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
    const client = createQwenCompatibleClient({
      enabled: true,
      provider: 'qwen',
      authMode: 'api-key',
      modelName: 'qwen3.6-plus',
      apiKey: 'test-key',
      oauth: {
        authorizeUrl: '',
        clientId: '',
        redirectUri: '',
        scope: []
      }
    });

    await client.probe({
      prompt: 'OK'
    });

    assert.ok(capturedSignal instanceof AbortSignal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sends native video payload to qwen multimodal endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedBody = '';

  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedBody = String(init?.body ?? '');
    return new Response(
      JSON.stringify({
        output: {
          choices: [
            {
              message: {
                content: [
                  {
                    text: '["内容题材 > 广告营销 > 产品广告"]'
                  }
                ]
              }
            }
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15
          }
        }
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
    const client = createQwenCompatibleClient({
      enabled: true,
      provider: 'qwen',
      authMode: 'api-key',
      modelName: 'qwen3.6-plus',
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
      videoDataUrl: 'data:video/mp4;base64,AAAA',
      fps: 2
    });

    assert.equal(
      capturedUrl,
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
    );
    assert.equal(capturedBody.includes('"video":"data:video/mp4;base64,AAAA"'), true);
    assert.equal(capturedBody.includes('"fps":2'), true);
    assert.equal(result.text, '["内容题材 > 广告营销 > 产品广告"]');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('classifies Qwen DataInspectionFailed as content rejected', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    code: 'DataInspectionFailed',
    message: 'Input video data may contain inappropriate content.'
  }), { status: 400, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  try {
    const client = createQwenCompatibleClient(createQwenConfig());
    await assert.rejects(client.probe({ prompt: 'test' }), (error: unknown) => {
      assert.ok(error instanceof ModelProviderRequestError);
      assert.equal(error.category, 'content-rejected');
      assert.equal(error.providerCode, 'DataInspectionFailed');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createQwenConfig() {
  return {
    enabled: true as const, provider: 'qwen' as const, authMode: 'api-key' as const,
    modelName: 'qwen3.7-plus', apiKey: 'test-key',
    oauth: { authorizeUrl: '', clientId: '', redirectUri: '', scope: [] }
  };
}
