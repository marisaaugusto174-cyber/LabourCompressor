import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type DownloadExecutionOptions,
  type DownloadExecutionResult,
  type DownloadRequest
} from '../../features/download/domain/index.ts';
import { readNetscapeCookieHeader } from './netscape-cookies.ts';

export interface DouyinSsrVideo {
  readonly awemeId: string;
  readonly title: string;
  readonly durationSeconds?: number | undefined;
  readonly resolutionLabel?: string | undefined;
  readonly playUrl: string;
}

export interface DouyinSsrDownloaderOptions {
  readonly cookiesFilePath?: string | undefined;
  readonly fetch?: DouyinFetch | undefined;
  readonly downloadedAt?: (() => string) | undefined;
  readonly maxSsrAttempts?: number | undefined;
  readonly retryDelayMs?: ((attempt: number) => number) | undefined;
}

export type DouyinFetch = (
  url: string,
  init?: {
    readonly headers?: Readonly<Record<string, string>> | undefined;
    readonly signal?: AbortSignal | undefined;
  }
) => Promise<DouyinFetchResponse>;

export interface DouyinFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface VideoCandidate {
  readonly playUrl: string;
  readonly width: number;
  readonly height: number;
  readonly dataSize: number;
  readonly bitRate: number;
  readonly isH265: boolean;
}

type JsonObject = Record<string, unknown>;

export function extractDouyinVideoId(inputUrl: string): string | undefined {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(inputUrl.trim());
  } catch {
    return undefined;
  }

  const modalId = parsedUrl.searchParams.get('modal_id')?.trim();
  if (modalId !== undefined && /^\d+$/u.test(modalId)) {
    return modalId;
  }

  for (const prefix of ['/video/', '/shipin/', '/share/video/']) {
    if (parsedUrl.pathname.startsWith(prefix)) {
      const value = parsedUrl.pathname.slice(prefix.length).replace(/\/+$/u, '');
      return /^\d+$/u.test(value) ? value : undefined;
    }
  }

  return undefined;
}

export function extractDouyinSsrVideo(html: string): DouyinSsrVideo {
  const renderData = parseRenderDataScript(html);
  const videoDetail = getObject(getObject(renderData, 'app'), 'videoDetail');
  const video = getObject(videoDetail, 'video');
  const candidate = selectBestCandidate(video);
  const awemeId = readString(videoDetail.awemeId);
  const title =
    readString(videoDetail.desc) ||
    readString(videoDetail.caption) ||
    readString(videoDetail.itemTitle) ||
    awemeId ||
    'douyin';

  if (awemeId.length === 0 || candidate === undefined) {
    throw createDownloadError(
      'douyin-ssr-unavailable',
      '下载失败：抖音页面 SSR 中没有可用的视频播放信息。'
    );
  }

  const durationMs = Number(video.duration);
  return Object.freeze({
    awemeId,
    title,
    durationSeconds:
      Number.isFinite(durationMs) && durationMs > 0
        ? Math.round(durationMs / 1000)
        : undefined,
    resolutionLabel: candidate.height > 0 ? `${candidate.height}P` : undefined,
    playUrl: candidate.playUrl
  });
}

export function createDouyinSsrDownloaderAdapter(
  options: DouyinSsrDownloaderOptions = {}
): {
  download(
    request: DownloadRequest,
    executionOptions?: DownloadExecutionOptions
  ): Promise<DownloadExecutionResult>;
} {
  const fetchImpl = options.fetch ?? nativeDouyinFetch;

  return Object.freeze({
    async download(
      request: DownloadRequest,
      executionOptions: DownloadExecutionOptions = {}
    ): Promise<DownloadExecutionResult> {
      const videoId = extractDouyinVideoId(request.normalizedUrl);
      if (videoId === undefined) {
        throw createDownloadError(
          'unsupported-url',
          '下载失败：当前抖音 URL 不包含可识别的视频 ID。'
        );
      }

      const headers = await buildDouyinRequestHeaders(options.cookiesFilePath);
      const video = await fetchDouyinSsrVideoWithRetry({
        videoId,
        headers,
        fetchImpl,
        signal: executionOptions.signal,
        maxAttempts: options.maxSsrAttempts ?? 4,
        retryDelayMs: options.retryDelayMs ?? defaultRetryDelayMs
      });
      const mediaResponse = await fetchImpl(video.playUrl, {
        headers: {
          referer: 'https://www.douyin.com/',
          'user-agent': DEFAULT_USER_AGENT
        },
        signal: executionOptions.signal
      });

      if (!mediaResponse.ok) {
        throw createDownloadError(
          'douyin-play-url-expired',
          `下载失败：抖音播放地址不可用或已过期，HTTP ${mediaResponse.status}。`
        );
      }

      await mkdir(request.outputDirectory, { recursive: true });
      const fileName = `${request.outputFileStem}.mp4`;
      const filePath = path.join(request.outputDirectory, fileName);
      await writeFile(filePath, Buffer.from(await mediaResponse.arrayBuffer()));

      return Object.freeze({
        request,
        artifacts: Object.freeze([
          Object.freeze({
            kind: 'muxed-video' as const,
            filePath,
            fileName,
            container: 'mp4'
          })
        ]),
        downloadedAt: options.downloadedAt?.() ?? new Date().toISOString(),
        mediaMetadata: Object.freeze({
          sourceTitle: video.title || request.fallbackTitle,
          resolutionLabel: video.resolutionLabel,
          durationSeconds: video.durationSeconds
        })
      });
    }
  });
}

async function fetchDouyinSsrVideoWithRetry(input: {
  readonly videoId: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly fetchImpl: DouyinFetch;
  readonly signal?: AbortSignal | undefined;
  readonly maxAttempts: number;
  readonly retryDelayMs: (attempt: number) => number;
}): Promise<DouyinSsrVideo> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    try {
      const ssrUrl = buildDouyinJingxuanUrl(input.videoId, attempt);
      const ssrResponse = await input.fetchImpl(ssrUrl, {
        headers: input.headers,
        signal: input.signal
      });

      if (!ssrResponse.ok) {
        throw createDownloadError(
          'douyin-ssr-unavailable',
          `下载失败：抖音页面 SSR 请求失败，HTTP ${ssrResponse.status}。`
        );
      }

      return extractDouyinSsrVideo(await ssrResponse.text());
    } catch (error) {
      lastError = error;
      if (!isRetryableDouyinSsrError(error) || attempt >= input.maxAttempts) {
        throw error;
      }

      await delay(input.retryDelayMs(attempt), input.signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : createDownloadError('douyin-ssr-unavailable', '下载失败：抖音页面 SSR 不可用。');
}

function buildDouyinJingxuanUrl(videoId: string, attempt = 1): string {
  const url = new URL('https://www.douyin.com/jingxuan');
  url.searchParams.set('modal_id', videoId);
  if (attempt > 1) {
    url.searchParams.set('_lc_retry', String(attempt));
  }
  return url.toString();
}

function isRetryableDouyinSsrError(error: unknown): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'downloadErrorCode' in error &&
    (error as { downloadErrorCode?: unknown }).downloadErrorCode === 'douyin-ssr-unavailable';
}

function nativeDouyinFetch(
  url: string,
  init?: Parameters<DouyinFetch>[1]
): Promise<DouyinFetchResponse> {
  return fetch(url, {
    ...(init?.headers === undefined ? {} : { headers: init.headers }),
    ...(init?.signal === undefined ? {} : { signal: init.signal })
  });
}

function defaultRetryDelayMs(attempt: number): number {
  return Math.min(250 * attempt, 1000);
}

async function delay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  if (milliseconds <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    if (signal !== undefined) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(signal.reason instanceof Error ? signal.reason : new Error('Download aborted.'));
      }, { once: true });
    }
  });
}

function parseRenderDataScript(html: string): JsonObject {
  const match = /<script\b[^>]*\bid=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/u.exec(html);
  if (match?.[1] === undefined) {
    throw createDownloadError(
      'douyin-ssr-unavailable',
      '下载失败：抖音页面缺少 SSR RENDER_DATA。'
    );
  }

  try {
    const decoded = decodeURIComponent(match[1]);
    const parsed = JSON.parse(decoded);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    throw createDownloadError(
      'douyin-ssr-unavailable',
      '下载失败：抖音页面 SSR RENDER_DATA 无法解析。'
    );
  }

  throw createDownloadError(
    'douyin-ssr-unavailable',
    '下载失败：抖音页面 SSR RENDER_DATA 结构异常。'
  );
}

function selectBestCandidate(video: JsonObject): VideoCandidate | undefined {
  const candidates: VideoCandidate[] = [];
  const bitRateList = Array.isArray(video.bitRateList) ? video.bitRateList : [];

  for (const item of bitRateList) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      candidates.push(...buildCandidates(item as JsonObject));
    }
  }

  if (candidates.length === 0) {
    candidates.push(...buildCandidates(video));
  }

  return candidates
    .filter((candidate) => candidate.playUrl.length > 0)
    .sort(compareVideoCandidates)[0];
}

function buildCandidates(input: JsonObject): readonly VideoCandidate[] {
  const playAddr = Array.isArray(input.playAddr) ? input.playAddr : [];
  const candidates = playAddr
    .map((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return undefined;
      }
      const playUrl = readString((entry as JsonObject).src);
      if (playUrl.length === 0) {
        return undefined;
      }
      return Object.freeze({
        playUrl,
        width: readNumber(input.width),
        height: readNumber(input.height),
        dataSize: readNumber(input.dataSize),
        bitRate: readNumber(input.bitRate) || readNumber(input.realBitrate),
        isH265: input.isH265 === 1 || input.isH265 === true
      });
    })
    .filter((candidate): candidate is VideoCandidate => candidate !== undefined);

  return Object.freeze(candidates);
}

function compareVideoCandidates(left: VideoCandidate, right: VideoCandidate): number {
  return (
    right.height - left.height ||
    right.width - left.width ||
    Number(left.isH265) - Number(right.isH265) ||
    right.bitRate - left.bitRate ||
    right.dataSize - left.dataSize
  );
}

function getObject(input: unknown, key: string): JsonObject {
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    const value = (input as JsonObject)[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as JsonObject;
    }
  }

  throw createDownloadError(
    'douyin-ssr-unavailable',
    '下载失败：抖音页面 SSR 中没有可用的视频详情。'
  );
}

async function buildDouyinRequestHeaders(
  cookiesFilePath: string | undefined
): Promise<Readonly<Record<string, string>>> {
  const headers: Record<string, string> = {
    referer: 'https://www.douyin.com/',
    'user-agent': DEFAULT_USER_AGENT
  };

  if (cookiesFilePath !== undefined) {
    const cookieHeader = await readNetscapeCookieHeader(cookiesFilePath, ['douyin.com']);
    if (cookieHeader.length > 0) {
      headers.cookie = cookieHeader;
    }
  }

  return Object.freeze(headers);
}

function readString(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

function readNumber(input: unknown): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : 0;
}

function createDownloadError(code: string, message: string): Error {
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

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
