import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  inspectCookiesFileForPlatform,
  probePlatformCredentialConnectivity,
  probePlatformDownload
} from '../../packages/adapters/downloaders/platform-connectivity-probe.ts';
import {
  parsePlatformCredentialConfig,
  type PlatformCredentialConfig,
  type SupportedPlatform
} from '../../packages/features/download/domain/index.ts';
import { createPlatformCredentialFileRepository } from '../../packages/adapters/storage/filesystem/platform-credential-repository.ts';
import {
  type PlatformCredentialSummaryEntry,
  type RuntimeCheckResult
} from './runtime-support-types.ts';
import { projectPath } from '../cli/project-paths.ts';

export { probePlatformCredentialConnectivity, probePlatformDownload };

const PLATFORM_PROBE_URLS: Readonly<Partial<Record<SupportedPlatform, string>>> = Object.freeze({
  bilibili: 'https://www.bilibili.com/video/BV1xx411c7mD',
  youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  tiktok: 'https://www.tiktok.com/@tiktok/video/7106594312292457771'
});

const PLATFORM_HOMEPAGE_URLS: Readonly<Record<SupportedPlatform, string>> = Object.freeze({
  bilibili: 'https://www.bilibili.com/',
  youtube: 'https://www.youtube.com/',
  douyin: 'https://www.douyin.com/',
  tiktok: 'https://www.tiktok.com/',
  xiaohongshu: 'https://www.xiaohongshu.com/'
});

const DEFAULT_DOUYIN_COOKIE_CANDIDATES = Object.freeze([
  path.join(homedir(), 'Downloads', 'douyin.txt')
]);
const PLATFORM_CREDENTIAL_REPOSITORY_ROOT = projectPath('.runtime-credentials/download');
type HomepageFetch = (
  url: string,
  init?: RequestInit
) => Promise<Readonly<{ readonly ok: boolean; readonly text: () => Promise<string> }>>;

type PlatformCredentialProbe = (
  input: Parameters<typeof probePlatformCredentialConnectivity>[0]
) => Promise<RuntimeCheckResult>;

export async function loadPlatformCredentialSummary(
  filePath: string,
  credentialRepositoryRoot = PLATFORM_CREDENTIAL_REPOSITORY_ROOT
): Promise<readonly PlatformCredentialSummaryEntry[]> {
  return createPlatformCredentialFileRepository({
    configFilePath: filePath,
    repositoryRoot: credentialRepositoryRoot
  }).list();
}

export async function importPlatformCredentialFile(input: {
  readonly filePath: string;
  readonly platform: SupportedPlatform;
  readonly sourceCookiesFilePath: string;
  readonly credentialRepositoryRoot?: string;
  readonly now?: Date;
}): Promise<readonly PlatformCredentialSummaryEntry[]> {
  return createPlatformCredentialFileRepository({
    configFilePath: input.filePath,
    repositoryRoot: input.credentialRepositoryRoot ?? PLATFORM_CREDENTIAL_REPOSITORY_ROOT
  }).importFile(input);
}

export async function importAndProbePlatformCredentialFile(input: {
  readonly filePath: string;
  readonly platform: SupportedPlatform;
  readonly sourceCookiesFilePath: string;
  readonly credentialRepositoryRoot?: string;
  readonly ytDlpBinary?: string;
  readonly now?: Date;
  readonly homepageFetch?: HomepageFetch;
  readonly probe?: PlatformCredentialProbe;
}): Promise<Readonly<{
  readonly summary: readonly PlatformCredentialSummaryEntry[];
  readonly probe: RuntimeCheckResult;
}>> {
  const credentialRepositoryRoot = input.credentialRepositoryRoot ?? PLATFORM_CREDENTIAL_REPOSITORY_ROOT;
  const summary = await importPlatformCredentialFile({
    filePath: input.filePath,
    platform: input.platform,
    sourceCookiesFilePath: input.sourceCookiesFilePath,
    credentialRepositoryRoot,
    now: input.now
  });
  const entry = summary.find((item) => item.platform === input.platform);
  if (input.platform === 'xiaohongshu') {
    const probe = await (input.probe ?? probePlatformCredentialConnectivity)({
      platform: input.platform,
      ytDlpBinary: input.ytDlpBinary,
      cookiesFilePath: entry?.cookiesFilePath,
      cookiesFromBrowser: entry?.cookiesFromBrowser,
      now: input.now
    });
    return Object.freeze({ summary, probe });
  }
  const sampleUrl = await resolvePlatformHomepageSampleUrl({
    platform: input.platform,
    fetch: input.homepageFetch
  });

  if (sampleUrl === undefined) {
    return Object.freeze({
      summary,
      probe: buildCredentialProbeResult({
        ok: false,
        platform: input.platform,
        message: '凭证已导入，但没有从平台首页解析到可测试视频。',
        errorCode: 'homepage-video-not-found',
        enteredMetadataProbeLayer: false
      })
    });
  }

  try {
    const probe = await (input.probe ?? probePlatformCredentialConnectivity)({
      platform: input.platform,
      ytDlpBinary: input.ytDlpBinary,
      cookiesFilePath: entry?.cookiesFilePath,
      cookiesFromBrowser: entry?.cookiesFromBrowser,
      sampleUrl,
      now: input.now
    });

    return Object.freeze({ summary, probe });
  } catch (error) {
    return Object.freeze({
      summary,
      probe: buildCredentialProbeResult({
        ok: false,
        platform: input.platform,
        message: error instanceof Error ? error.message : String(error),
        errorCode: 'runtime-error',
        enteredMetadataProbeLayer: true,
        extraDetails: { sampleUrl }
      })
    });
  }
}

export async function ensureDouyinCredentialFallback(input: {
  readonly platformCredentialConfigPath?: string;
  readonly candidateCookiesPaths?: readonly string[];
  readonly now?: Date;
}): Promise<Readonly<{
  readonly applied: boolean;
  readonly cookiesFilePath?: string;
}>> {
  const filePath = input.platformCredentialConfigPath?.trim();
  if (filePath === undefined || filePath.length === 0) {
    return Object.freeze({ applied: false });
  }

  const config = await loadPlatformCredentialConfig(filePath);
  const existing = config?.douyin ?? config?.global;
  if (existing?.cookiesFilePath !== undefined || existing?.cookiesFromBrowser !== undefined) {
    return Object.freeze({ applied: false });
  }

  for (const candidatePath of input.candidateCookiesPaths ?? DEFAULT_DOUYIN_COOKIE_CANDIDATES) {
    try {
      await access(candidatePath);
    } catch {
      continue;
    }

    const staticCheck = await inspectCookiesFileForPlatform({
      filePath: candidatePath,
      platform: 'douyin',
      now: input.now ?? new Date()
    });

    if (!staticCheck.ok) {
      continue;
    }

    await savePlatformCredentialConfig({
      filePath,
      platform: 'douyin',
      cookiesFilePath: candidatePath
    });
    return Object.freeze({ applied: true, cookiesFilePath: candidatePath });
  }

  return Object.freeze({ applied: false });
}

export async function savePlatformCredentialConfig(input: {
  readonly filePath: string;
  readonly platform: SupportedPlatform;
  readonly cookiesFilePath?: string;
  readonly cookiesFromBrowser?: string;
}): Promise<readonly PlatformCredentialSummaryEntry[]> {
  return createPlatformCredentialFileRepository({
    configFilePath: input.filePath,
    repositoryRoot: PLATFORM_CREDENTIAL_REPOSITORY_ROOT
  }).save(input);
}

export async function loadPlatformCredentialConfig(
  filePath: string | undefined
): Promise<PlatformCredentialConfig | undefined> {
  if (filePath === undefined || filePath.trim().length === 0) {
    return undefined;
  }

  try {
    return parsePlatformCredentialConfig(
      JSON.parse(await readFile(filePath, 'utf8'))
    );
  } catch {
    return undefined;
  }
}

async function resolvePlatformHomepageSampleUrl(input: {
  readonly platform: SupportedPlatform;
  readonly fetch?: HomepageFetch;
}): Promise<string | undefined> {
  const homepageUrl = PLATFORM_HOMEPAGE_URLS[input.platform];
  const fetchHomepage = input.fetch ?? defaultHomepageFetch;

  try {
    const response = await fetchHomepage(homepageUrl, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      return PLATFORM_PROBE_URLS[input.platform];
    }

    return extractFirstHomepageVideoUrl({
      platform: input.platform,
      homepageUrl,
      html: await response.text()
    }) ?? PLATFORM_PROBE_URLS[input.platform];
  } catch {
    return PLATFORM_PROBE_URLS[input.platform];
  }
}

async function defaultHomepageFetch(url: string, init?: RequestInit): Promise<Readonly<{
  readonly ok: boolean;
  readonly text: () => Promise<string>;
}>> {
  const response = await fetch(url, init);
  return Object.freeze({
    ok: response.ok,
    text: () => response.text()
  });
}

function extractFirstHomepageVideoUrl(input: {
  readonly platform: SupportedPlatform;
  readonly homepageUrl: string;
  readonly html: string;
}): string | undefined {
  const html = normalizeHomepageHtml(input.html);
  const patterns = getHomepageVideoUrlPatterns(input.platform);

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    const rawUrl = match?.[1] ?? match?.[0];
    const normalizedUrl = normalizeHomepageVideoUrl(rawUrl, input.homepageUrl);

    if (normalizedUrl !== undefined) {
      return normalizedUrl;
    }
  }

  return undefined;
}

function normalizeHomepageHtml(html: string): string {
  return html
    .replace(/\\u002F/gu, '/')
    .replace(/\\\//gu, '/')
    .replace(/&amp;/gu, '&');
}

function getHomepageVideoUrlPatterns(platform: SupportedPlatform): readonly RegExp[] {
  switch (platform) {
    case 'bilibili':
      return [
        /https?:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]+/u,
        /href=["'](\/video\/BV[0-9A-Za-z]+[^"']*)["']/u
      ];
    case 'youtube':
      return [
        /https?:\/\/www\.youtube\.com\/watch\?v=[0-9A-Za-z_-]+/u,
        /href=["'](\/watch\?v=[0-9A-Za-z_-]+[^"']*)["']/u,
        /href=["'](\/shorts\/[0-9A-Za-z_-]+[^"']*)["']/u
      ];
    case 'douyin':
      return [
        /https?:\/\/www\.douyin\.com\/video\/\d+/u,
        /href=["'](\/video\/\d+[^"']*)["']/u,
        /modal_id=(\d{8,})/u
      ];
    case 'tiktok':
      return [
        /https?:\/\/www\.tiktok\.com\/@[^/"']+\/video\/\d+/u,
        /href=["'](\/@[^/"']+\/video\/\d+[^"']*)["']/u
      ];
    case 'xiaohongshu':
      return [
        /https?:\/\/www\.xiaohongshu\.com\/(?:explore|discovery\/item)\/[\da-f]+/u,
        /href=["'](\/(?:explore|discovery\/item)\/[\da-f]+[^"']*)["']/u
      ];
  }
}

function normalizeHomepageVideoUrl(rawUrl: string | undefined, homepageUrl: string): string | undefined {
  if (rawUrl === undefined || rawUrl.trim().length === 0) {
    return undefined;
  }

  const value = rawUrl.trim();

  if (/^\d{8,}$/u.test(value)) {
    return `https://www.douyin.com/video/${value}`;
  }

  try {
    return new URL(value, homepageUrl).toString();
  } catch {
    return undefined;
  }
}

function buildCredentialProbeResult(input: {
  readonly ok: boolean;
  readonly platform: SupportedPlatform;
  readonly message: string;
  readonly enteredMetadataProbeLayer: boolean;
  readonly errorCode?: string;
  readonly errorDetail?: string;
  readonly extraDetails?: Readonly<Record<string, string | number | boolean | null>>;
}): RuntimeCheckResult {
  return Object.freeze({
    key: 'platform-credential-probe',
    ok: input.ok,
    message: input.message,
    details: {
      platform: input.platform,
      enteredMetadataProbeLayer: input.enteredMetadataProbeLayer,
      errorCode: input.errorCode ?? null,
      errorDetail: input.errorDetail ?? null,
      ...(input.extraDetails ?? {})
    }
  });
}

