import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildProviderCheckFailure,
  checkProvider
} from '../../../../apps/web/runtime-support-provider.ts';
import { getVideoModelProfile } from '../../../features/tagging/domain/index.ts';

test('provider preflight distinguishes disabled provider config', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-provider-'));
  const providerConfigPath = path.join(tempDir, 'providers.local.json');

  try {
    writeFileSync(
      providerConfigPath,
      `${JSON.stringify({
        qwen: {
          enabled: false,
          provider: 'qwen',
          authMode: 'api-key',
          modelName: 'qwen3.6-flash',
          apiKey: '',
          oauth: { authorizeUrl: '', clientId: '', redirectUri: '', scope: [] }
        }
      }, null, 2)}\n`
    );

    const result = await checkProvider({
      spreadsheet: '/tmp/tasks.xlsx',
      downloadDir: '/tmp/downloads',
      taxonomy: '/tmp/taxonomy.md',
      promptLibrary: '/tmp/prompts.md',
      archiveRoot: '/tmp/archive',
      taggingMode: 'qwen',
      selectedModelProfileId: 'qwen-3.6-flash',
      providerConfigPath
    });

    assert.equal(result.ok, false);
    assert.equal(result.details?.reason, 'provider-not-enabled');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('provider preflight distinguishes auth or quota failures without leaking keys', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-provider-'));
  const providerConfigPath = path.join(tempDir, 'providers.local.json');
  const originalFetch = globalThis.fetch;

  try {
    writeFileSync(
      providerConfigPath,
      `${JSON.stringify({
        qwen: {
          enabled: true,
          provider: 'qwen',
          authMode: 'api-key',
          modelName: 'qwen3.6-flash',
          apiKey: 'sk-secret-test',
          oauth: { authorizeUrl: '', clientId: '', redirectUri: '', scope: [] }
        }
      }, null, 2)}\n`
    );
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ code: 'InvalidApiKey', message: 'API key invalid: sk-secret-test' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    const result = await checkProvider({
      spreadsheet: '/tmp/tasks.xlsx',
      downloadDir: '/tmp/downloads',
      taxonomy: '/tmp/taxonomy.md',
      promptLibrary: '/tmp/prompts.md',
      archiveRoot: '/tmp/archive',
      taggingMode: 'qwen',
      selectedModelProfileId: 'qwen-3.6-flash',
      providerConfigPath
    });

    assert.equal(result.ok, false);
    assert.equal(result.details?.reason, 'provider-auth-or-quota');
    assert.equal(String(result.details?.error).includes('sk-secret-test'), false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('provider preflight keeps Gemini Flash Thinking fixed to high thinking config', () => {
  const profile = getVideoModelProfile('gemini-3-flash-thinking');

  assert.equal(profile.label, 'Gemini 3 Flash Thinking');
  assert.equal(profile.provider, 'google');
  assert.equal(profile.modelName, 'gemini-3-flash-preview');
  assert.equal(profile.thinkingLevel, 'high');
});

test('provider preflight distinguishes model-no-video branch', () => {
  const result = buildProviderCheckFailure(
    new Error('Selected model does not support video input.'),
    {
      provider: 'google',
      modelName: 'gemini-3-pro',
      label: 'Gemini 3 Pro'
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.details?.reason, 'model-no-video');
});

test('provider preflight distinguishes connectivity branch', () => {
  const result = buildProviderCheckFailure(
    new Error('fetch failed: connect ECONNREFUSED 127.0.0.1'),
    {
      provider: 'qwen',
      modelName: 'qwen3.6-plus',
      label: 'Qwen 3.6 Plus'
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.details?.reason, 'provider-connectivity');
});
