import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildProviderCheckFailure,
  checkProvider,
  loadVideoModelProviderSummaries,
  saveSelectedProviderApiKey
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

test('model provider summary reports API key presence per model profile without leaking keys', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-provider-summary-'));
  const providerConfigPath = path.join(tempDir, 'providers.local.json');

  try {
    writeFileSync(
      providerConfigPath,
      `${JSON.stringify({
        qwen: {
          enabled: true,
          provider: 'qwen',
          authMode: 'api-key',
          modelName: 'qwen3.7-plus',
          apiKey: 'sk-secret-test',
          oauth: { authorizeUrl: '', clientId: '', redirectUri: '', scope: [] }
        },
        google: {
          enabled: false,
          provider: 'google',
          authMode: 'api-key',
          modelName: 'gemini-3.5-flash',
          apiKey: '',
          oauth: { authorizeUrl: '', clientId: '', redirectUri: '', scope: [] }
        }
      }, null, 2)}\n`
    );

    const summary = await loadVideoModelProviderSummaries({ providerConfigPath });
    const qwenProfiles = summary.models.filter((item) => item.provider === 'qwen');
    const gemini = summary.models.find((item) => item.profileId === 'gemini-3.5-flash');

    assert.equal(qwenProfiles.length >= 2, true);
    assert.equal(qwenProfiles.every((item) => item.apiKeyPresent === true), true);
    assert.equal(qwenProfiles.every((item) => item.providerEnabled === true), true);
    assert.equal(JSON.stringify(summary).includes('sk-secret-test'), false);
    assert.equal(gemini?.apiKeyPresent, false);
    assert.equal(gemini?.providerEnabled, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('saving provider API key returns structured probe failure without dropping saved key', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-provider-save-'));
  const providerConfigPath = path.join(tempDir, 'providers.local.json');

  try {
    writeFileSync(
      providerConfigPath,
      `${JSON.stringify({
        qwen: {
          enabled: false,
          provider: 'qwen',
          authMode: 'api-key',
          modelName: 'qwen3.7-plus',
          apiKey: '',
          oauth: { authorizeUrl: '', clientId: '', redirectUri: '', scope: [] }
        }
      }, null, 2)}\n`
    );

    const result = await saveSelectedProviderApiKey({
      providerConfigPath,
      selectedModelProfileId: 'qwen-3.7-plus',
      apiKey: 'sk-secret-test',
      probe: async () => {
        throw new Error('API key invalid: sk-secret-test');
      }
    });

    assert.equal(result.saved, true);
    assert.equal(result.probe.ok, false);
    assert.equal(result.probe.details?.reason, 'provider-probe-failed');
    assert.equal(JSON.stringify(result).includes('sk-secret-test'), false);

    const summary = await loadVideoModelProviderSummaries({ providerConfigPath });
    const qwen = summary.models.find((item) => item.profileId === 'qwen-3.7-plus');

    assert.equal(qwen?.apiKeyPresent, true);
    assert.equal(qwen?.providerEnabled, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('provider preflight exposes Gemini 3.5 Flash stable video profile', () => {
  const profile = getVideoModelProfile('gemini-3.5-flash');

  assert.equal(profile.label, 'Gemini 3.5 Flash');
  assert.equal(profile.provider, 'google');
  assert.equal(profile.modelName, 'gemini-3.5-flash');
  assert.equal(profile.defaultTaggingConcurrency, 4);
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
      modelName: 'qwen3.7-plus',
      label: 'Qwen3.7Plus'
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.details?.reason, 'provider-connectivity');
});
