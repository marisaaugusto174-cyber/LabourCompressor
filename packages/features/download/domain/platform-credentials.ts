import { type SupportedPlatform } from './platform-detection.ts';

export interface PlatformCredentialEntry {
  readonly cookiesFilePath?: string;
  readonly cookiesFromBrowser?: string;
}

export interface PlatformCredentialConfig {
  readonly global?: PlatformCredentialEntry;
  readonly bilibili?: PlatformCredentialEntry;
  readonly youtube?: PlatformCredentialEntry;
  readonly douyin?: PlatformCredentialEntry;
  readonly tiktok?: PlatformCredentialEntry;
}

const SUPPORTED_PLATFORMS = Object.freeze([
  'bilibili',
  'youtube',
  'douyin',
  'tiktok'
] satisfies readonly SupportedPlatform[]);

export function parsePlatformCredentialConfig(
  input: unknown
): PlatformCredentialConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return Object.freeze({});
  }

  const raw = input as Record<string, unknown>;
  const global = parsePlatformCredentialEntry(raw.global);
  const entries = SUPPORTED_PLATFORMS.flatMap((platform) => {
    const parsed = parsePlatformCredentialEntry(raw[platform]);

    return parsed === undefined ? [] : ([[platform, parsed]] as const);
  });

  return Object.freeze({
    ...(global === undefined ? {} : { global }),
    ...Object.fromEntries(entries)
  });
}

export function getPlatformCredentialEntry(
  config: PlatformCredentialConfig | undefined,
  platform: SupportedPlatform
): PlatformCredentialEntry | undefined {
  if (config === undefined) {
    return undefined;
  }

  return config[platform];
}

export function getGlobalCredentialEntry(
  config: PlatformCredentialConfig | undefined
): PlatformCredentialEntry | undefined {
  return config?.global;
}

function parsePlatformCredentialEntry(
  input: unknown
): PlatformCredentialEntry | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const raw = input as Record<string, unknown>;
  const cookiesFilePath = readOptionalString(raw.cookiesFilePath);
  const cookiesFromBrowser = readOptionalString(raw.cookiesFromBrowser);

  if (cookiesFilePath === undefined && cookiesFromBrowser === undefined) {
    return undefined;
  }

  return Object.freeze({
    cookiesFilePath,
    cookiesFromBrowser
  });
}

function readOptionalString(input: unknown): string | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }

  const trimmed = input.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
