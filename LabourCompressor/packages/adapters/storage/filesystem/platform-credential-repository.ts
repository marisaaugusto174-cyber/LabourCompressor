import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type PlatformCredentialRepository,
  type PlatformCredentialSummary
} from '../../../features/download/application/platform-credential-service.ts';
import {
  parsePlatformCredentialConfig,
  type PlatformCredentialConfig,
  type SupportedPlatform
} from '../../../features/download/domain/index.ts';

const SUPPORTED_PLATFORMS: readonly SupportedPlatform[] = Object.freeze([
  'bilibili', 'youtube', 'douyin', 'tiktok', 'xiaohongshu'
]);

export function createPlatformCredentialFileRepository(options: {
  readonly configFilePath: string;
  readonly repositoryRoot: string;
}): PlatformCredentialRepository {
  return Object.freeze({
    list: () => loadSummary(options),
    async save(input: Parameters<PlatformCredentialRepository['save']>[0]) {
      const raw = await readJsonObject(options.configFilePath);
      const candidate = raw[input.platform];
      const current: Readonly<Record<string, unknown>> = isRecord(candidate) ? candidate : {};
      raw[input.platform] = {
        ...current,
        cookiesFilePath: input.cookiesFilePath ?? readString(current.cookiesFilePath),
        cookiesFromBrowser: input.cookiesFromBrowser ?? readString(current.cookiesFromBrowser)
      };
      await writeJson(options.configFilePath, raw);
      return loadSummary(options);
    },
    async importFile(input: Parameters<PlatformCredentialRepository['importFile']>[0]) {
      await access(input.sourceCookiesFilePath);
      const platformDirectory = path.join(options.repositoryRoot, input.platform);
      const cookiesFilePath = path.join(platformDirectory, 'cookies.txt');
      await rm(platformDirectory, { recursive: true, force: true });
      await mkdir(platformDirectory, { recursive: true });
      await writeFile(
        cookiesFilePath,
        await normalizeCookiesFile(input.sourceCookiesFilePath),
        'utf8'
      );
      await writeJson(path.join(platformDirectory, 'metadata.json'), {
        platform: input.platform,
        cookiesFilePath,
        sourceFileName: path.basename(input.sourceCookiesFilePath),
        uploadedAt: (input.now ?? new Date()).toISOString()
      });
      await this.save({ platform: input.platform, cookiesFilePath, cookiesFromBrowser: '' });
      return loadSummary(options);
    }
  });
}

async function loadSummary(options: {
  readonly configFilePath: string;
  readonly repositoryRoot: string;
}): Promise<readonly PlatformCredentialSummary[]> {
  const config = await loadConfig(options.configFilePath);
  const summaries = await Promise.all(SUPPORTED_PLATFORMS.map(async (platform) => {
    const entry = config?.[platform];
    const metadata = await loadMetadata(path.join(options.repositoryRoot, platform));
    const active = entry?.cookiesFilePath !== undefined &&
      metadata?.credentialStorePath !== undefined &&
      path.resolve(entry.cookiesFilePath) === path.resolve(metadata.credentialStorePath);
    return Object.freeze({
      platform,
      cookiesFilePath: entry?.cookiesFilePath,
      cookiesFromBrowser: entry?.cookiesFromBrowser,
      ...(active && metadata?.credentialStorePath !== undefined
        ? { credentialStorePath: metadata.credentialStorePath }
        : {}),
      ...(active && metadata?.credentialUploadedAt !== undefined
        ? { credentialUploadedAt: metadata.credentialUploadedAt }
        : {})
    });
  }));
  return Object.freeze(summaries);
}

async function loadConfig(filePath: string): Promise<PlatformCredentialConfig | undefined> {
  try {
    return parsePlatformCredentialConfig(JSON.parse(await readFile(filePath, 'utf8')));
  } catch {
    return undefined;
  }
}

async function loadMetadata(directory: string): Promise<{
  readonly credentialStorePath?: string | undefined;
  readonly credentialUploadedAt?: string | undefined;
} | undefined> {
  try {
    const raw = JSON.parse(await readFile(path.join(directory, 'metadata.json'), 'utf8')) as unknown;
    if (!isRecord(raw)) return undefined;
    return {
      credentialStorePath: readOptionalString(raw.cookiesFilePath) ?? directory,
      credentialUploadedAt: readOptionalString(raw.uploadedAt)
    };
  } catch {
    try {
      return (await readdir(directory)).length > 0 ? { credentialStorePath: directory } : undefined;
    } catch {
      return undefined;
    }
  }
}

async function normalizeCookiesFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf8');
  if (/^\s*#\s*Netscape HTTP Cookie File/iu.test(content)) return content;
  const hasRecord = content.split(/\r?\n/u).some((line) => {
    const value = line.trim().replace(/^#HttpOnly_/u, '');
    return !value.startsWith('#') && value.split('\t').length >= 7;
  });
  return hasRecord ? `# Netscape HTTP Cookie File\n${content}` : content;
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    return isRecord(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
