import { execFile } from 'node:child_process';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  extractStructuredDownloadError,
  resolveYtDlpBinaryPath,
  resolveYtDlpCredential
} from '../../packages/adapters/downloaders/ytdlp-downloader.ts';
import {
  createPlatformAwareDownloaderAdapter
} from '../../packages/adapters/downloaders/platform-aware-downloader.ts';
import {
  extractDouyinSsrVideo,
  extractDouyinVideoId,
  type DouyinFetch
} from '../../packages/adapters/downloaders/douyin-ssr-downloader.ts';
import {
  createDownloadRequest,
  parsePlatformCredentialConfig,
  type PlatformCredentialConfig,
  type SupportedPlatform
} from '../../packages/features/download/domain/index.ts';
import {
  type PlatformCredentialSummaryEntry,
  type RuntimeCheckResult
} from './runtime-support-types.ts';
import { projectPath } from '../cli/project-paths.ts';

const execFileAsync = promisify(execFile);

const PLATFORM_PROBE_URLS: Readonly<Partial<Record<SupportedPlatform, string>>> = Object.freeze({
  bilibili: 'https://www.bilibili.com/video/BV1xx411c7mD',
  youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  tiktok: 'https://www.tiktok.com/@tiktok/video/7106594312292457771'
});

const PLATFORM_HOMEPAGE_URLS: Readonly<Record<SupportedPlatform, string>> = Object.freeze({
  bilibili: 'https://www.bilibili.com/',
  youtube: 'https://www.youtube.com/',
  douyin: 'https://www.douyin.com/',
  tiktok: 'https://www.tiktok.com/'
});

const PLATFORM_COOKIE_DOMAINS: Readonly<Record<SupportedPlatform, readonly string[]>> = Object.freeze({
  bilibili: ['bilibili.com'],
  youtube: ['youtube.com', 'google.com'],
  douyin: ['douyin.com', 'iesdouyin.com'],
  tiktok: ['tiktok.com']
});

const DEFAULT_DOUYIN_COOKIE_CANDIDATES = Object.freeze([
  path.join(homedir(), 'Downloads', 'douyin.txt')
]);
const PLATFORM_CREDENTIAL_REPOSITORY_ROOT = projectPath('.runtime-credentials/download');
const SUPPORTED_PLATFORMS: readonly SupportedPlatform[] = Object.freeze([
  'bilibili',
  'youtube',
  'douyin',
  'tiktok'
]);

type HomepageFetch = (
  url: string,
  init?: RequestInit
) => Promise<Readonly<{ readonly ok: boolean; readonly text: () => Promise<string> }>>;

type PlatformCredentialProbe = (
  input: Parameters<typeof probePlatformCredentialConnectivity>[0]
) => Promise<RuntimeCheckResult>;

export async function probePlatformDownload(input: {
  readonly url: string;
  readonly outputDirectory: string;
  readonly ytDlpBinary?: string;
  readonly cookiesFilePath?: string;
  readonly cookiesFromBrowser?: string;
  readonly platformCredentialConfigPath?: string;
}): Promise<RuntimeCheckResult> {
  const platformCredentialConfig = await loadPlatformCredentialConfig(input.platformCredentialConfigPath);

  try {
    const request = createDownloadRequest({
      taskId: 'probe-task',
      workflowSessionId: 'probe-workflow',
      rowNumber: 1,
      sourceUrl: input.url,
      outputDirectory: input.outputDirectory,
      outputFileStem: 'probe'
    });
    const resolvedCredential = resolveYtDlpCredential(request, {
      cookiesFilePath: input.cookiesFilePath,
      cookiesFromBrowser: input.cookiesFromBrowser,
      platformCredentialConfig
    });
    const adapter = createPlatformAwareDownloaderAdapter({
      binaryPath: input.ytDlpBinary,
      cookiesFilePath: input.cookiesFilePath,
      cookiesFromBrowser: input.cookiesFromBrowser,
      platformCredentialConfig
    });

    try {
      await adapter.download(request);

      return Object.freeze({
        key: 'download-probe',
        ok: true,
        message: 'Download probe succeeded.',
        details: {
          normalizedUrl: request.normalizedUrl,
          platform: request.platform,
          credentialSource: resolvedCredential.source,
          usesCookiesFile: resolvedCredential.cookiesFilePath !== undefined,
          usesBrowserCookies: resolvedCredential.cookiesFromBrowser !== undefined,
          enteredRealDownloadLayer: true
        }
      });
    } catch (error) {
      const structuredError = extractStructuredDownloadError(error);

      return Object.freeze({
        key: 'download-probe',
        ok: false,
        message: structuredError.errorMessage,
        details: {
          normalizedUrl: request.normalizedUrl,
          platform: request.platform,
          credentialSource: resolvedCredential.source,
          usesCookiesFile: resolvedCredential.cookiesFilePath !== undefined,
          usesBrowserCookies: resolvedCredential.cookiesFromBrowser !== undefined,
          enteredRealDownloadLayer: true,
          errorCode: structuredError.errorCode,
          errorDetail: structuredError.errorDetail ?? null
        }
      });
    }
  } catch (error) {
    return Object.freeze({
      key: 'download-probe',
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      details: {
        platform: null,
        credentialSource: 'none',
        usesCookiesFile: false,
        usesBrowserCookies: false,
        enteredRealDownloadLayer: false
      }
    });
  }
}

export async function probePlatformCredentialConnectivity(input: {
  readonly platform: SupportedPlatform;
  readonly ytDlpBinary?: string;
  readonly cookiesFilePath?: string;
  readonly cookiesFromBrowser?: string;
  readonly sampleUrl?: string;
  readonly fetch?: DouyinFetch;
  readonly now?: Date;
}): Promise<RuntimeCheckResult> {
  const credential = {
    cookiesFilePath: input.cookiesFilePath?.trim() || undefined,
    cookiesFromBrowser: input.cookiesFromBrowser?.trim() || undefined
  };

  if (credential.cookiesFilePath === undefined && credential.cookiesFromBrowser === undefined) {
    return buildCredentialProbeResult({
      ok: false,
      platform: input.platform,
      message: '请先填写 cookies.txt 或 cookies-from-browser。',
      errorCode: 'missing-credentials',
      enteredMetadataProbeLayer: false
    });
  }

  if (credential.cookiesFilePath !== undefined) {
    const staticCheck = await inspectCookiesFileForPlatform({
      filePath: credential.cookiesFilePath,
      platform: input.platform,
      now: input.now ?? new Date()
    });

    if (!staticCheck.ok) {
      return buildCredentialProbeResult({
        ok: false,
        platform: input.platform,
        message: staticCheck.message,
        errorCode: staticCheck.errorCode,
        enteredMetadataProbeLayer: false
      });
    }
  }

  const sampleUrl = input.sampleUrl?.trim() || PLATFORM_PROBE_URLS[input.platform];

  if (sampleUrl === undefined || sampleUrl.length === 0) {
    return buildCredentialProbeResult({
      ok: false,
      platform: input.platform,
      message: '请填写一个当前可访问的测试视频 URL 后再运行连通性测试。',
      errorCode: 'sample-url-required',
      enteredMetadataProbeLayer: false
    });
  }

  if (input.platform === 'douyin') {
    return probeDouyinSsrCredentialConnectivity({
      sampleUrl,
      cookiesFilePath: credential.cookiesFilePath,
      fetch: input.fetch
    });
  }

  try {
    const args = [
      '--skip-download',
      '--dump-single-json',
      '--no-warnings'
    ];

    if (credential.cookiesFilePath !== undefined) {
      args.push('--cookies', credential.cookiesFilePath);
    }

    if (credential.cookiesFromBrowser !== undefined) {
      args.push('--cookies-from-browser', credential.cookiesFromBrowser);
    }

    args.push(sampleUrl);

    const { stdout } = await execFileAsync(
      resolveYtDlpBinaryPath(input.ytDlpBinary),
      args,
      {
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024
      }
    );
    const parsed = JSON.parse(stdout) as Record<string, unknown>;

    if (typeof parsed.id !== 'string') {
      throw new Error('Metadata probe returned JSON without a video id.');
    }

    return buildCredentialProbeResult({
      ok: true,
      platform: input.platform,
      message: 'cookies 连通性测试通过。',
      enteredMetadataProbeLayer: true,
      extraDetails: {
        sampleUrl,
        title: typeof parsed.title === 'string' ? parsed.title : null
      }
    });
  } catch (error) {
    const structuredError = extractStructuredDownloadError(error);
    const reason = describeCredentialProbeFailure(structuredError.errorCode);

    return buildCredentialProbeResult({
      ok: false,
      platform: input.platform,
      message: reason.message,
      errorCode: structuredError.errorCode,
      enteredMetadataProbeLayer: true,
      errorDetail: structuredError.errorDetail,
      extraDetails: {
        sampleUrl,
        reason: reason.reason
      }
    });
  }
}

async function probeDouyinSsrCredentialConnectivity(input: {
  readonly sampleUrl: string;
  readonly cookiesFilePath?: string;
  readonly fetch?: DouyinFetch;
}): Promise<RuntimeCheckResult> {
  const videoId = extractDouyinVideoId(input.sampleUrl);

  if (videoId === undefined) {
    return buildCredentialProbeResult({
      ok: false,
      platform: 'douyin',
      message: '测试 URL 不可用，请换一个当前可访问的视频 URL。',
      errorCode: 'unsupported-url',
      enteredMetadataProbeLayer: false,
      extraDetails: {
        sampleUrl: input.sampleUrl,
        reason: 'sample-url'
      }
    });
  }

  const fetchImpl = input.fetch ?? fetch;
  const ssrUrl = new URL('https://www.douyin.com/jingxuan');
  ssrUrl.searchParams.set('modal_id', videoId);

  try {
    const headers = await buildDouyinProbeHeaders(input.cookiesFilePath);
    const response = await fetchImpl(ssrUrl.toString(), {
      headers
    });

    if (!response.ok) {
      throw createStructuredProbeError(
        'douyin-ssr-unavailable',
        `抖音页面 SSR 请求失败，HTTP ${response.status}。`
      );
    }

    const video = extractDouyinSsrVideo(await response.text());

    return buildCredentialProbeResult({
      ok: true,
      platform: 'douyin',
      message: 'cookies 连通性测试通过。',
      enteredMetadataProbeLayer: true,
      extraDetails: {
        sampleUrl: input.sampleUrl,
        ssrUrl: ssrUrl.toString(),
        reason: 'douyin-ssr',
        title: video.title
      }
    });
  } catch (error) {
    const structuredError = extractStructuredDownloadError(error);
    const reason = describeCredentialProbeFailure(structuredError.errorCode);

    return buildCredentialProbeResult({
      ok: false,
      platform: 'douyin',
      message: reason.message,
      errorCode: structuredError.errorCode,
      enteredMetadataProbeLayer: true,
      errorDetail: structuredError.errorDetail,
      extraDetails: {
        sampleUrl: input.sampleUrl,
        ssrUrl: ssrUrl.toString(),
        reason: reason.reason
      }
    });
  }
}

export async function loadPlatformCredentialSummary(
  filePath: string,
  credentialRepositoryRoot = PLATFORM_CREDENTIAL_REPOSITORY_ROOT
): Promise<readonly PlatformCredentialSummaryEntry[]> {
  const metadataByPlatform = await loadPlatformCredentialMetadataByPlatform(credentialRepositoryRoot);

  return summarizePlatformCredentialConfig(
    await loadPlatformCredentialConfig(filePath),
    metadataByPlatform
  );
}

export async function importPlatformCredentialFile(input: {
  readonly filePath: string;
  readonly platform: SupportedPlatform;
  readonly sourceCookiesFilePath: string;
  readonly credentialRepositoryRoot?: string;
  readonly now?: Date;
}): Promise<readonly PlatformCredentialSummaryEntry[]> {
  const credentialRepositoryRoot = input.credentialRepositoryRoot ?? PLATFORM_CREDENTIAL_REPOSITORY_ROOT;
  const platformDirectoryPath = path.join(credentialRepositoryRoot, input.platform);
  const uploadedAt = (input.now ?? new Date()).toISOString();
  const targetPath = path.join(platformDirectoryPath, 'cookies.txt');
  const metadataPath = path.join(platformDirectoryPath, 'metadata.json');

  await access(input.sourceCookiesFilePath);
  await rm(platformDirectoryPath, { recursive: true, force: true });
  await mkdir(platformDirectoryPath, { recursive: true });
  await writeFile(targetPath, await normalizeImportedCookiesFileContent(input.sourceCookiesFilePath), 'utf8');
  await writeFile(
    metadataPath,
    `${JSON.stringify({
      platform: input.platform,
      cookiesFilePath: targetPath,
      sourceFileName: path.basename(input.sourceCookiesFilePath),
      uploadedAt
    }, null, 2)}\n`,
    'utf8'
  );

  await savePlatformCredentialConfig({
    filePath: input.filePath,
    platform: input.platform,
    cookiesFilePath: targetPath,
    cookiesFromBrowser: ''
  });

  return loadPlatformCredentialSummary(input.filePath, credentialRepositoryRoot);
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
  const raw = await readJsonObjectFile(input.filePath);
  const current =
    typeof raw[input.platform] === 'object' &&
    raw[input.platform] !== null &&
    !Array.isArray(raw[input.platform])
      ? (raw[input.platform] as Record<string, unknown>)
      : {};
  raw[input.platform] = {
    ...current,
    cookiesFilePath: input.cookiesFilePath ?? readExistingCredentialString(current.cookiesFilePath),
    cookiesFromBrowser: input.cookiesFromBrowser ?? readExistingCredentialString(current.cookiesFromBrowser)
  };
  await mkdir(path.dirname(input.filePath), { recursive: true });
  await writeFile(input.filePath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  return loadPlatformCredentialSummary(input.filePath);
}

function readExistingCredentialString(input: unknown): string {
  return typeof input === 'string' ? input : '';
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

async function inspectCookiesFileForPlatform(input: {
  readonly filePath: string;
  readonly platform: SupportedPlatform;
  readonly now: Date;
}): Promise<Readonly<{
  readonly ok: boolean;
  readonly message: string;
  readonly errorCode?: string;
}>> {
  let content = '';

  try {
    content = await readFile(input.filePath, 'utf8');
  } catch {
    return Object.freeze({
      ok: false,
      message: 'cookies.txt 文件不可读，请检查路径和权限。',
      errorCode: 'credential-file-unreadable'
    });
  }

  const records = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map(parseNetscapeCookieLine)
    .filter((record): record is NetscapeCookieRecord => record !== undefined);

  if (records.length === 0) {
    return Object.freeze({
      ok: false,
      message: 'cookies.txt 中没有可识别的 Netscape cookie 记录。',
      errorCode: 'credential-file-empty'
    });
  }

  const domains = PLATFORM_COOKIE_DOMAINS[input.platform];
  const platformRecords = records.filter((record) =>
    domains.some((domain) => cookieDomainMatches(normalizeCookieDomain(record.domain), domain))
  );

  if (platformRecords.length === 0) {
    return Object.freeze({
      ok: false,
      message: 'cookies.txt 不包含当前平台的 cookie 域名。',
      errorCode: 'credential-domain-mismatch'
    });
  }

  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  const hasUsableCookie = platformRecords.some((record) =>
    record.expiresAtSeconds === 0 || record.expiresAtSeconds > nowSeconds
  );

  if (!hasUsableCookie) {
    return Object.freeze({
      ok: false,
      message: '当前平台 cookies 已过期，请重新导出 cookies.txt。',
      errorCode: 'cookies-expired'
    });
  }

  return Object.freeze({
    ok: true,
    message: 'cookies.txt 静态检查通过。'
  });
}

interface NetscapeCookieRecord {
  readonly domain: string;
  readonly expiresAtSeconds: number;
}

function parseNetscapeCookieLine(line: string): NetscapeCookieRecord | undefined {
  const columns = line.split('\t');
  if (columns.length < 7) {
    return undefined;
  }

  const expiresAtSeconds = Number(columns[4]);
  return Object.freeze({
    domain: columns[0] ?? '',
    expiresAtSeconds: Number.isFinite(expiresAtSeconds) ? expiresAtSeconds : 0
  });
}

function normalizeCookieDomain(domain: string): string {
  return domain.trim().replace(/^\./u, '').toLowerCase();
}

function cookieDomainMatches(cookieDomain: string, targetDomain: string): boolean {
  return cookieDomain === targetDomain || cookieDomain.endsWith(`.${targetDomain}`);
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

function describeCredentialProbeFailure(errorCode: string): Readonly<{
  readonly reason: string;
  readonly message: string;
}> {
  switch (errorCode) {
    case 'missing-credentials':
    case 'needs-fresh-cookies':
    case 'cookies-expired':
      return Object.freeze({
        reason: 'cookies',
        message: 'cookies 不可用或不够新，请重新登录平台后导出。'
      });
    case 'douyin-extractor-challenge':
    case 'douyin-detail-api-blocked':
    case 'douyin-ssr-unavailable':
    case 'douyin-play-url-expired':
      return Object.freeze({
        reason: 'douyin-protection',
        message: '抖音页面解析或播放地址探测失败：请刷新测试 URL，必要时重新导出 cookies。'
      });
    case 'platform-rate-limited':
      return Object.freeze({
        reason: 'rate-limit',
        message: '平台限制了当前请求频率，请稍后重试或更换网络环境。'
      });
    case 'runtime-error':
      return Object.freeze({
        reason: 'runtime',
        message: 'yt-dlp 或本地运行时异常，请检查下载器路径和版本。'
      });
    case 'unsupported-url':
    case 'sample-url-required':
      return Object.freeze({
        reason: 'sample-url',
        message: '测试 URL 不可用，请换一个当前可访问的视频 URL。'
      });
    default:
      return Object.freeze({
        reason: 'unknown',
        message: '连通性测试失败，请查看技术详情后重试。'
      });
  }
}

async function loadPlatformCredentialMetadataByPlatform(
  credentialRepositoryRoot: string
): Promise<ReadonlyMap<SupportedPlatform, { readonly credentialStorePath?: string; readonly credentialUploadedAt?: string }>> {
  const metadataByPlatform = new Map<SupportedPlatform, { readonly credentialStorePath?: string; readonly credentialUploadedAt?: string }>();

  for (const platform of SUPPORTED_PLATFORMS) {
    const platformDirectoryPath = path.join(credentialRepositoryRoot, platform);

    try {
      const metadata = JSON.parse(await readFile(path.join(platformDirectoryPath, 'metadata.json'), 'utf8')) as unknown;

      if (isRecord(metadata)) {
        metadataByPlatform.set(platform, Object.freeze({
          credentialStorePath: readOptionalMetadataString(metadata.cookiesFilePath) ?? platformDirectoryPath,
          credentialUploadedAt: readOptionalMetadataString(metadata.uploadedAt)
        }));
      }
    } catch {
      try {
        const entries = await readdir(platformDirectoryPath);
        if (entries.length > 0) {
          metadataByPlatform.set(platform, Object.freeze({
            credentialStorePath: platformDirectoryPath
          }));
        }
      } catch {
        continue;
      }
    }
  }

  return metadataByPlatform;
}

function summarizePlatformCredentialConfig(
  config: PlatformCredentialConfig | undefined,
  metadataByPlatform: ReadonlyMap<SupportedPlatform, {
    readonly credentialStorePath?: string;
    readonly credentialUploadedAt?: string;
  }>
): readonly PlatformCredentialSummaryEntry[] {
  return Object.freeze(
    SUPPORTED_PLATFORMS.map((platform) =>
      summarizePlatformCredentialEntry(config, platform, metadataByPlatform.get(platform))
    )
  );
}

function summarizePlatformCredentialEntry(
  config: PlatformCredentialConfig | undefined,
  platform: SupportedPlatform,
  metadata: { readonly credentialStorePath?: string; readonly credentialUploadedAt?: string } | undefined
): PlatformCredentialSummaryEntry {
  const entry = config?.[platform];
  const activeMetadata =
    entry?.cookiesFilePath !== undefined &&
    metadata?.credentialStorePath !== undefined &&
    path.resolve(entry.cookiesFilePath) === path.resolve(metadata.credentialStorePath)
      ? metadata
      : undefined;

  return Object.freeze({
    platform,
    cookiesFilePath: entry?.cookiesFilePath,
    cookiesFromBrowser: entry?.cookiesFromBrowser,
    ...(activeMetadata?.credentialStorePath === undefined ? {} : { credentialStorePath: activeMetadata.credentialStorePath }),
    ...(activeMetadata?.credentialUploadedAt === undefined ? {} : { credentialUploadedAt: activeMetadata.credentialUploadedAt })
  });
}

async function readJsonObjectFile(
  filePath: string
): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

async function normalizeImportedCookiesFileContent(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf8');

  if (/^\s*#\s*Netscape HTTP Cookie File/iu.test(content)) {
    return content;
  }

  const hasNetscapeCookieRecord = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .some((line) => line.length > 0 && !line.startsWith('#') && parseNetscapeCookieLine(line) !== undefined);

  if (!hasNetscapeCookieRecord) {
    return content;
  }

  return `# Netscape HTTP Cookie File\n${content}`;
}

function readOptionalMetadataString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function buildDouyinProbeHeaders(
  cookiesFilePath: string | undefined
): Promise<Readonly<Record<string, string>>> {
  const headers: Record<string, string> = {
    referer: 'https://www.douyin.com/',
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  };

  if (cookiesFilePath !== undefined) {
    const cookieHeader = await readNetscapeCookieHeader(cookiesFilePath);
    if (cookieHeader.length > 0) {
      headers.cookie = cookieHeader;
    }
  }

  return Object.freeze(headers);
}

async function readNetscapeCookieHeader(filePath: string): Promise<string> {
  try {
    return (await readFile(filePath, 'utf8'))
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => line.split('\t'))
      .filter((columns) => columns.length >= 7)
      .filter((columns) => cookieDomainMatches(normalizeCookieDomain(columns[0] ?? ''), 'douyin.com'))
      .map((columns) => `${columns[5] ?? ''}=${columns[6] ?? ''}`)
      .filter((value) => !value.startsWith('='))
      .join('; ');
  } catch {
    return '';
  }
}

function createStructuredProbeError(code: string, message: string): Error {
  const error = new Error(message);
  Object.defineProperty(error, 'downloadErrorCode', {
    value: code,
    enumerable: false
  });
  Object.defineProperty(error, 'downloadErrorDetail', {
    value: code,
    enumerable: false
  });
  return error;
}
