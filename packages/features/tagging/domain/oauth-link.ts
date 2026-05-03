import {
  getProviderCatalogEntry,
  type ExtendedModelProvider
} from './model-catalog.ts';

export interface OAuthLinkConfig {
  readonly provider: ExtendedModelProvider;
  readonly authorizeUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes?: readonly string[];
  readonly state: string;
}

export function buildOAuthAuthorizationUrl(
  config: OAuthLinkConfig
): string {
  getProviderCatalogEntry(config.provider);
  assertAbsoluteUrl(config.authorizeUrl, 'OAuth authorizeUrl');
  assertNonEmptyValue(config.clientId, 'OAuth clientId');
  assertAbsoluteUrl(config.redirectUri, 'OAuth redirectUri');
  assertNonEmptyValue(config.state, 'OAuth state');

  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId.trim());
  url.searchParams.set('redirect_uri', config.redirectUri.trim());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', config.state.trim());

  if ((config.scopes?.length ?? 0) > 0) {
    url.searchParams.set(
      'scope',
      config.scopes!.map((scope) => scope.trim()).filter(Boolean).join(' ')
    );
  }

  return url.toString();
}

export function validateOAuthAuthorizationUrl(urlString: string): void {
  const url = new URL(urlString);

  if (url.searchParams.get('client_id') === null) {
    throw new Error('OAuth URL must contain client_id.');
  }

  if (url.searchParams.get('redirect_uri') === null) {
    throw new Error('OAuth URL must contain redirect_uri.');
  }

  if (url.searchParams.get('response_type') !== 'code') {
    throw new Error('OAuth URL must use response_type=code.');
  }

  if (url.searchParams.get('state') === null) {
    throw new Error('OAuth URL must contain state.');
  }
}

function assertAbsoluteUrl(urlString: string, fieldName: string): void {
  try {
    const url = new URL(urlString.trim());

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error();
    }
  } catch {
    throw new Error(`${fieldName} must be a valid absolute HTTP(S) URL.`);
  }
}

function assertNonEmptyValue(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }
}
