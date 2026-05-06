import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('lists model options and builds oauth link through cli', () => {
  const listResult = spawnSync(
    'node',
    ['/Users/tianyi/Desktop/codex/jobtask/apps/cli/main.ts', 'list-model-options'],
    {
      cwd: '/Users/tianyi/Desktop/codex/jobtask',
      encoding: 'utf8'
    }
  );
  const oauthResult = spawnSync(
    'node',
    [
      '/Users/tianyi/Desktop/codex/jobtask/apps/cli/main.ts',
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
      cwd: '/Users/tianyi/Desktop/codex/jobtask',
      encoding: 'utf8'
    }
  );

  assert.equal(listResult.status, 0);
  assert.equal(listResult.stdout.includes('"provider": "openai"'), true);
  assert.equal(listResult.stdout.includes('"id": "gemini-3-flash-preview"'), true);
  assert.equal(listResult.stdout.includes('"id": "gemini-3.1-pro-preview"'), true);
  assert.equal(listResult.stdout.includes('"id": "qwen3.6-flash"'), true);
  assert.equal(listResult.stdout.includes('"id": "qwen3.5-plus"'), true);
  assert.equal(oauthResult.status, 0);
  assert.equal(oauthResult.stdout.includes('response_type=code'), true);
});
