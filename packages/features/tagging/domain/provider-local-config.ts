import { readFile } from 'node:fs/promises';

import {
  type ModelAuthMode,
  type ModelProvider
} from './model-connection.ts';

export interface LocalProviderOAuthConfig {
  readonly authorizeUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scope: readonly string[];
}

export interface LocalProviderConfig {
  readonly enabled: boolean;
  readonly provider: ModelProvider;
  readonly authMode: ModelAuthMode;
  readonly modelName: string;
  readonly apiKey: string;
  readonly oauth: LocalProviderOAuthConfig;
}

export type LocalProviderConfigMap = Readonly<
  Partial<Record<ModelProvider, LocalProviderConfig>>
>;

export async function loadLocalProviderConfigFile(
  filePath: string
): Promise<LocalProviderConfigMap> {
  const raw = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
  return normalizeLocalProviderConfigMap(raw);
}

export function normalizeLocalProviderConfigMap(
  input: Record<string, unknown>
): LocalProviderConfigMap {
  const entries = Object.entries(input).map(([key, value]) => {
    if (!isModelProvider(key)) {
      throw new Error(`Unsupported provider key in local config: "${key}".`);
    }

    return [key, normalizeLocalProviderConfig(key, value)] as const;
  });

  return Object.freeze(Object.fromEntries(entries));
}

export function getEnabledProviderConfig(
  configMap: LocalProviderConfigMap,
  provider: ModelProvider
): LocalProviderConfig {
  const config = configMap[provider];

  if (config === undefined) {
    throw new Error(`Provider "${provider}" is not present in local config.`);
  }

  if (!config.enabled) {
    throw new Error(`Provider "${provider}" is disabled in local config.`);
  }

  return config;
}

export function sanitizeLocalProviderConfig(
  config: LocalProviderConfig
): Record<string, unknown> {
  return Object.freeze({
    enabled: config.enabled,
    provider: config.provider,
    authMode: config.authMode,
    modelName: config.modelName,
    apiKeyPresent: config.apiKey.trim().length > 0,
    oauth: {
      authorizeUrl: config.oauth.authorizeUrl,
      clientIdPresent: config.oauth.clientId.trim().length > 0,
      redirectUri: config.oauth.redirectUri,
      scopeCount: config.oauth.scope.length
    }
  });
}

function normalizeLocalProviderConfig(
  provider: ModelProvider,
  value: unknown
): LocalProviderConfig {
  if (!isPlainObject(value)) {
    throw new Error(`Provider "${provider}" config must be an object.`);
  }

  const authMode = readString(value.authMode, `${provider}.authMode`);

  if (authMode !== 'api-key' && authMode !== 'oauth') {
    throw new Error(`Provider "${provider}" authMode must be "api-key" or "oauth".`);
  }

  const oauthValue = isPlainObject(value.oauth) ? value.oauth : {};

  return Object.freeze({
    enabled: Boolean(value.enabled),
    provider,
    authMode,
    modelName: readString(value.modelName, `${provider}.modelName`),
    apiKey: readOptionalString(value.apiKey),
    oauth: Object.freeze({
      authorizeUrl: readOptionalString(oauthValue.authorizeUrl),
      clientId: readOptionalString(oauthValue.clientId),
      redirectUri: readOptionalString(oauthValue.redirectUri),
      scope: Object.freeze(readStringArray(oauthValue.scope, `${provider}.oauth.scope`))
    })
  });
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function readOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${fieldName} must be an array of strings.`);
  }

  return value.map((item) => item.trim()).filter(Boolean);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isModelProvider(value: string): value is ModelProvider {
  return [
    'openai',
    'google',
    'anthropic',
    'qwen',
    'zhipu',
    'deepseek',
    'moonshot',
    'baidu',
    'tencent-hunyuan',
    'minimax'
  ].includes(value);
}
