import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOAuthAuthorizationUrl,
  validateOAuthAuthorizationUrl
} from '../../../features/tagging/domain/index.ts';

test('builds oauth authorization url with expected query params', () => {
  const url = buildOAuthAuthorizationUrl({
    provider: 'google',
    authorizeUrl: 'https://accounts.example.com/o/oauth2/v2/auth',
    clientId: 'client-1',
    redirectUri: 'https://localhost/callback',
    scopes: ['openid', 'profile'],
    state: 'state-1'
  });

  const parsedUrl = new URL(url);

  assert.equal(parsedUrl.searchParams.get('client_id'), 'client-1');
  assert.equal(parsedUrl.searchParams.get('response_type'), 'code');
  assert.equal(parsedUrl.searchParams.get('state'), 'state-1');
  assert.equal(parsedUrl.searchParams.get('scope'), 'openid profile');
});

test('validates oauth authorization url structure', () => {
  assert.doesNotThrow(() =>
    validateOAuthAuthorizationUrl(
      'https://accounts.example.com/o/oauth2/v2/auth?client_id=1&redirect_uri=https%3A%2F%2Flocalhost%2Fcallback&response_type=code&state=abc'
    )
  );
});

test('rejects oauth url without code flow params', () => {
  assert.throws(
    () =>
      validateOAuthAuthorizationUrl(
        'https://accounts.example.com/o/oauth2/v2/auth?client_id=1'
      ),
    /redirect_uri/
  );
});
