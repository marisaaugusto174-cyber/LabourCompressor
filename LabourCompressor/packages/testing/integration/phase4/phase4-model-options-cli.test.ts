import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../../..');
const CLI_PATH = path.join(PROJECT_ROOT, 'apps/cli/main.ts');

test('lists model options and builds oauth link through cli', () => {
  const listResult = spawnSync(
    'node',
    [CLI_PATH, 'list-model-options'],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8'
    }
  );
  const oauthResult = spawnSync(
    'node',
    [
      CLI_PATH,
      'build-oauth-link',
      '--provider',
      'google',
      '--authorize-url',
      'https://accounts.example.com/o/oauth2/v2/auth',
      '--client-id',
      'client-1',
      '--redirect-uri',
      'https://localhost/callback',
      '--state',
      'state-1',
      '--scope',
      'openid,profile'
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8'
    }
  );

  assert.equal(listResult.status, 0);
  assert.equal(listResult.stdout.includes('"provider": "openai"'), true);
  assert.equal(listResult.stdout.includes('"id": "gemini-3.5-flash"'), true);
  assert.equal(listResult.stdout.includes('"id": "qwen3.7-plus"'), true);
  assert.equal(listResult.stdout.includes('"id": "qwen3.6-flash"'), true);
  assert.equal(listResult.stdout.includes('"id": "qwen3.5-plus"'), false);
  assert.equal(oauthResult.status, 0);
  assert.equal(oauthResult.stdout.includes('response_type=code'), true);
});
