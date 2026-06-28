import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import {
  createDownloadRequest,
  parsePlatformCredentialConfig,
  sanitizePlatformUrlForOutput,
  type SupportedPlatform
} from '../../features/download/domain/index.ts';
import { extractDouyinSsrVideo, extractDouyinVideoId, type DouyinFetch } from './douyin-ssr-downloader.ts';
import { readNetscapeCookieHeader } from './netscape-cookies.ts';
import { createPlatformAwareDownloaderAdapter } from './platform-aware-downloader.ts';
import {
  extractStructuredDownloadError,
  resolveYtDlpBinaryPath,
  resolveYtDlpCredential
} from './ytdlp-downloader.ts';

const execFileAsync = promisify(execFile);
const PROBE_URLS: Readonly<Partial<Record<SupportedPlatform, string>>> = Object.freeze({
  bilibili: 'https://www.bilibili.com/video/BV1xx411c7mD',
  youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  tiktok: 'https://www.tiktok.com/@tiktok/video/7106594312292457771'
});
const COOKIE_DOMAINS: Readonly<Record<SupportedPlatform, readonly string[]>> = Object.freeze({
  bilibili: ['bilibili.com'], youtube: ['youtube.com', 'google.com'],
  douyin: ['douyin.com', 'iesdouyin.com'], tiktok: ['tiktok.com'], xiaohongshu: ['xiaohongshu.com']
});

export interface PlatformProbeResult {
  readonly key: string;
  readonly ok: boolean;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>> | undefined;
}

export async function probePlatformDownload(input: {
  readonly url: string;
  readonly outputDirectory: string;
  readonly ytDlpBinary?: string | undefined;
  readonly cookiesFilePath?: string | undefined;
  readonly cookiesFromBrowser?: string | undefined;
  readonly platformCredentialConfigPath?: string | undefined;
}): Promise<PlatformProbeResult> {
  const platformCredentialConfig = await loadConfig(input.platformCredentialConfigPath);
  try {
    const request = createDownloadRequest({
      taskId: 'probe-task', workflowSessionId: 'probe-workflow', rowNumber: 1,
      sourceUrl: input.url, outputDirectory: input.outputDirectory, outputFileStem: 'probe'
    });
    const credentialOptions = {
      cookiesFilePath: input.cookiesFilePath,
      cookiesFromBrowser: input.cookiesFromBrowser,
      platformCredentialConfig
    };
    const resolved = resolveYtDlpCredential(request, credentialOptions);
    try {
      await createPlatformAwareDownloaderAdapter({ binaryPath: input.ytDlpBinary, ...credentialOptions }).download(request);
      return result('download-probe', true, 'Download probe succeeded.', {
        normalizedUrl: sanitizePlatformUrlForOutput(request.normalizedUrl), platform: request.platform,
        credentialSource: resolved.source, usesCookiesFile: resolved.cookiesFilePath !== undefined,
        usesBrowserCookies: resolved.cookiesFromBrowser !== undefined, enteredRealDownloadLayer: true
      });
    } catch (error) {
      const structured = extractStructuredDownloadError(error);
      return result('download-probe', false, structured.errorMessage, {
        normalizedUrl: sanitizePlatformUrlForOutput(request.normalizedUrl), platform: request.platform,
        credentialSource: resolved.source, usesCookiesFile: resolved.cookiesFilePath !== undefined,
        usesBrowserCookies: resolved.cookiesFromBrowser !== undefined, enteredRealDownloadLayer: true,
        errorCode: structured.errorCode, errorDetail: structured.errorDetail ?? null
      });
    }
  } catch (error) {
    return result('download-probe', false, error instanceof Error ? error.message : String(error), {
      platform: null, credentialSource: 'none', usesCookiesFile: false,
      usesBrowserCookies: false, enteredRealDownloadLayer: false
    });
  }
}

export async function probePlatformCredentialConnectivity(input: {
  readonly platform: SupportedPlatform;
  readonly ytDlpBinary?: string | undefined;
  readonly cookiesFilePath?: string | undefined;
  readonly cookiesFromBrowser?: string | undefined;
  readonly sampleUrl?: string | undefined;
  readonly fetch?: DouyinFetch | undefined;
  readonly now?: Date | undefined;
}): Promise<PlatformProbeResult> {
  const cookiesFilePath = input.cookiesFilePath?.trim() || undefined;
  const cookiesFromBrowser = input.cookiesFromBrowser?.trim() || undefined;
  if (cookiesFilePath === undefined && cookiesFromBrowser === undefined) {
    return credentialResult(input.platform, false, '请先填写 cookies.txt 或 cookies-from-browser。', false, 'missing-credentials');
  }
  if (cookiesFilePath !== undefined) {
    const check = await inspectCookiesFileForPlatform({ filePath: cookiesFilePath, platform: input.platform, now: input.now ?? new Date() });
    if (!check.ok) return credentialResult(input.platform, false, check.message, false, check.errorCode);
  }
  if (input.platform === 'xiaohongshu') {
    return probeXiaohongshu(cookiesFilePath, input.fetch);
  }
  const sampleUrl = input.sampleUrl?.trim() || PROBE_URLS[input.platform];
  if (sampleUrl === undefined) {
    return credentialResult(input.platform, false, '请填写一个当前可访问的测试视频 URL 后再运行连通性测试。', false, 'sample-url-required');
  }
  if (input.platform === 'douyin') return probeDouyin(sampleUrl, cookiesFilePath, input.fetch);
  try {
    const args = ['--skip-download', '--dump-single-json', '--no-warnings'];
    if (cookiesFilePath !== undefined) args.push('--cookies', cookiesFilePath);
    if (cookiesFromBrowser !== undefined) args.push('--cookies-from-browser', cookiesFromBrowser);
    args.push(sampleUrl);
    const { stdout } = await execFileAsync(resolveYtDlpBinaryPath(input.ytDlpBinary), args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    if (typeof parsed.id !== 'string') throw new Error('Metadata probe returned JSON without a video id.');
    return credentialResult(input.platform, true, 'cookies 连通性测试通过。', true, undefined, {
      sampleUrl, title: typeof parsed.title === 'string' ? parsed.title : null
    });
  } catch (error) {
    const structured = extractStructuredDownloadError(error);
    const failure = describeFailure(structured.errorCode);
    return credentialResult(input.platform, false, failure.message, true, structured.errorCode, {
      sampleUrl, reason: failure.reason, errorDetail: structured.errorDetail ?? null
    });
  }
}

async function probeXiaohongshu(cookiesFilePath: string | undefined, fetchImpl?: DouyinFetch): Promise<PlatformProbeResult> {
  try {
    const headers: Record<string, string> = { referer: 'https://www.xiaohongshu.com/', 'user-agent': USER_AGENT };
    if (cookiesFilePath !== undefined) {
      const cookie = await readNetscapeCookieHeader(cookiesFilePath, ['xiaohongshu.com']);
      if (cookie.length > 0) headers.cookie = cookie;
    }
    const response = await (fetchImpl ?? nativeProbeFetch)('https://www.xiaohongshu.com/', { headers });
    if (!response.ok) throw structuredError('xiaohongshu-page-unavailable', `小红书首页请求失败，HTTP ${response.status}。`);
    await response.text();
    return credentialResult('xiaohongshu', true, 'cookies 静态检查与平台连通性测试通过。', true, undefined, { reason: 'xiaohongshu-homepage' });
  } catch (error) {
    const structured = extractStructuredDownloadError(error);
    return credentialResult('xiaohongshu', false, '小红书平台连通性测试失败，请稍后重试或更新 cookies。', true, structured.errorCode, {
      reason: 'xiaohongshu-homepage', errorDetail: structured.errorDetail ?? null
    });
  }
}

async function probeDouyin(sampleUrl: string, cookiesFilePath: string | undefined, fetchImpl?: DouyinFetch): Promise<PlatformProbeResult> {
  const videoId = extractDouyinVideoId(sampleUrl);
  if (videoId === undefined) return credentialResult('douyin', false, '测试 URL 不可用，请换一个当前可访问的视频 URL。', false, 'unsupported-url', { sampleUrl, reason: 'sample-url' });
  const ssrUrl = new URL('https://www.douyin.com/jingxuan');
  ssrUrl.searchParams.set('modal_id', videoId);
  try {
    const headers: Record<string, string> = { referer: 'https://www.douyin.com/', 'user-agent': USER_AGENT };
    if (cookiesFilePath !== undefined) {
      const cookie = await readNetscapeCookieHeader(cookiesFilePath, ['douyin.com']);
      if (cookie.length > 0) headers.cookie = cookie;
    }
    const response = await (fetchImpl ?? nativeProbeFetch)(ssrUrl.toString(), { headers });
    if (!response.ok) throw structuredError('douyin-ssr-unavailable', `抖音页面 SSR 请求失败，HTTP ${response.status}。`);
    const video = extractDouyinSsrVideo(await response.text());
    return credentialResult('douyin', true, 'cookies 连通性测试通过。', true, undefined, { sampleUrl, ssrUrl: ssrUrl.toString(), reason: 'douyin-ssr', title: video.title });
  } catch (error) {
    const structured = extractStructuredDownloadError(error);
    const failure = describeFailure(structured.errorCode);
    return credentialResult('douyin', false, failure.message, true, structured.errorCode, { sampleUrl, ssrUrl: ssrUrl.toString(), reason: failure.reason, errorDetail: structured.errorDetail ?? null });
  }
}

function nativeProbeFetch(
  url: string,
  init?: Parameters<DouyinFetch>[1]
): ReturnType<DouyinFetch> {
  return fetch(url, {
    ...(init?.headers === undefined ? {} : { headers: init.headers }),
    ...(init?.signal === undefined ? {} : { signal: init.signal })
  });
}

export async function inspectCookiesFileForPlatform(input: { readonly filePath: string; readonly platform: SupportedPlatform; readonly now: Date }) {
  let content: string;
  try { content = await readFile(input.filePath, 'utf8'); }
  catch { return { ok: false, message: 'cookies.txt 文件不可读，请检查路径和权限。', errorCode: 'credential-file-unreadable' }; }
  const records = content.split(/\r?\n/u).map((line) => line.trim().replace(/^#HttpOnly_/u, ''))
    .filter((line) => line.length > 0 && !line.startsWith('#')).map(parseCookie).filter(Boolean);
  if (records.length === 0) return { ok: false, message: 'cookies.txt 中没有可识别的 Netscape cookie 记录。', errorCode: 'credential-file-empty' };
  const platformRecords = records.filter((record) => COOKIE_DOMAINS[input.platform].some((domain) => domainMatches(record!.domain, domain)));
  if (platformRecords.length === 0) return { ok: false, message: 'cookies.txt 不包含当前平台的 cookie 域名。', errorCode: 'credential-domain-mismatch' };
  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  if (!platformRecords.some((record) => record!.expires === 0 || record!.expires > nowSeconds)) {
    return { ok: false, message: '当前平台 cookies 已过期，请重新导出 cookies.txt。', errorCode: 'cookies-expired' };
  }
  return { ok: true, message: 'cookies.txt 静态检查通过。' };
}

function parseCookie(line: string): { domain: string; expires: number } | undefined {
  const columns = line.split('\t');
  if (columns.length < 7) return undefined;
  const expires = Number(columns[4]);
  return { domain: (columns[0] ?? '').replace(/^\./u, '').toLowerCase(), expires: Number.isFinite(expires) ? expires : 0 };
}

function domainMatches(cookieDomain: string, target: string): boolean {
  return cookieDomain === target || cookieDomain.endsWith(`.${target}`);
}

function credentialResult(platform: SupportedPlatform, ok: boolean, message: string, entered: boolean, errorCode?: string, extra: Record<string, string | number | boolean | null> = {}): PlatformProbeResult {
  return result('platform-credential-probe', ok, message, { platform, enteredMetadataProbeLayer: entered, errorCode: errorCode ?? null, ...extra });
}

function result(key: string, ok: boolean, message: string, details: Record<string, string | number | boolean | null>): PlatformProbeResult {
  return Object.freeze({ key, ok, message, details: Object.freeze(details) });
}

function describeFailure(code: string): { reason: string; message: string } {
  if (['missing-credentials', 'needs-fresh-cookies', 'cookies-expired'].includes(code)) return { reason: 'cookies', message: 'cookies 不可用或不够新，请重新登录平台后导出。' };
  if (code.startsWith('douyin-')) return { reason: 'douyin-protection', message: '抖音页面解析或播放地址探测失败：请刷新测试 URL，必要时重新导出 cookies。' };
  if (code === 'platform-rate-limited') return { reason: 'rate-limit', message: '平台限制了当前请求频率，请稍后重试或更换网络环境。' };
  if (code === 'runtime-error') return { reason: 'runtime', message: 'yt-dlp 或本地运行时异常，请检查下载器路径和版本。' };
  if (code === 'unsupported-url' || code === 'sample-url-required') return { reason: 'sample-url', message: '测试 URL 不可用，请换一个当前可访问的视频 URL。' };
  return { reason: 'unknown', message: '连通性测试失败，请查看技术详情后重试。' };
}

async function loadConfig(filePath: string | undefined) {
  if (filePath === undefined || filePath.trim().length === 0) return undefined;
  try { return parsePlatformCredentialConfig(JSON.parse(await readFile(filePath, 'utf8'))); }
  catch { return undefined; }
}

function structuredError(code: string, message: string): Error {
  const error = new Error(message);
  Object.defineProperty(error, 'downloadErrorCode', { value: code });
  Object.defineProperty(error, 'downloadErrorDetail', { value: code });
  return error;
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
