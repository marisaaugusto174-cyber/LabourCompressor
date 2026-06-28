import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  type DownloadExecutionOptions,
  type DownloadExecutionResult,
  type DownloadRequest
} from '../../features/download/domain/index.ts';
import { readNetscapeCookieHeader } from './netscape-cookies.ts';
import {
  extractXiaohongshuNoteId,
  extractXiaohongshuVideoFromWebpage,
  type XiaohongshuVideo,
  type XiaohongshuVideoCandidate
} from './xiaohongshu-page-parser.ts';

export {
  extractXiaohongshuNoteId,
  extractXiaohongshuVideoFromWebpage,
  type XiaohongshuVideo,
  type XiaohongshuVideoCandidate
} from './xiaohongshu-page-parser.ts';

export interface XiaohongshuDownloaderOptions {
  readonly cookiesFilePath?: string;
  readonly fetch?: typeof fetch;
  readonly downloadedAt?: () => string;
  readonly maxPageAttempts?: number;
  readonly retryDelayMs?: (attempt: number) => number;
}

export function createXiaohongshuDownloaderAdapter(
  options: XiaohongshuDownloaderOptions = {}
): {
  download(
    request: DownloadRequest,
    executionOptions?: DownloadExecutionOptions
  ): Promise<DownloadExecutionResult>;
} {
  const fetchImpl = options.fetch ?? fetch;

  return Object.freeze({
    async download(
      request: DownloadRequest,
      executionOptions: DownloadExecutionOptions = {}
    ): Promise<DownloadExecutionResult> {
      const noteId = extractXiaohongshuNoteId(request.normalizedUrl);
      if (noteId === undefined) {
        throw createDownloadError(
          'unsupported-url',
          '下载失败：当前小红书 URL 不包含可识别的笔记 ID。'
        );
      }

      const pageHeaders = await buildPageHeaders(options.cookiesFilePath);
      const maxAttempts = options.maxPageAttempts ?? 3;
      let lastError: unknown;
      let mediaRefreshes = 0;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        throwIfAborted(executionOptions.signal);

        try {
          const pageResponse = await fetchImpl(request.normalizedUrl, {
            headers: pageHeaders,
            signal: executionOptions.signal
          });

          if (!pageResponse.ok) {
            throw createDownloadError(
              'xiaohongshu-page-unavailable',
              `下载失败：小红书笔记页面请求失败，HTTP ${pageResponse.status}。`,
              pageResponse.status === 429 || pageResponse.status >= 500
            );
          }

          const video = extractXiaohongshuVideoFromWebpage(await pageResponse.text(), noteId);
          const selected = video.candidates[0];
          if (selected === undefined) {
            throw createDownloadError(
              'xiaohongshu-video-data-unavailable',
              '下载失败：小红书笔记没有可用视频流。'
            );
          }

          return await downloadSelectedCandidate({
            fetch: fetchImpl,
            request,
            video,
            selected,
            executionOptions,
            downloadedAt: options.downloadedAt?.() ?? new Date().toISOString()
          });
        } catch (error) {
          lastError = error;
          if (readErrorCode(error) === 'xiaohongshu-play-url-expired') {
            if (mediaRefreshes >= 1) {
              throw error;
            }
            mediaRefreshes += 1;
          }
          if (!isRetryable(error) || attempt >= maxAttempts) {
            throw error;
          }
          await delay(
            options.retryDelayMs?.(attempt) ?? (attempt === 1 ? 250 : 750),
            executionOptions.signal
          );
        }
      }

      throw lastError instanceof Error
        ? lastError
        : createDownloadError(
            'xiaohongshu-page-unavailable',
            '下载失败：小红书笔记页面不可用。'
          );
    }
  });
}

async function downloadSelectedCandidate(input: {
  readonly fetch: typeof fetch;
  readonly request: DownloadRequest;
  readonly video: XiaohongshuVideo;
  readonly selected: XiaohongshuVideoCandidate;
  readonly executionOptions: DownloadExecutionOptions;
  readonly downloadedAt: string;
}): Promise<DownloadExecutionResult> {
  let lastError: unknown;

  for (const url of input.selected.urls) {
    throwIfAborted(input.executionOptions.signal);
    try {
      const response = await input.fetch(url, {
        headers: MEDIA_HEADERS,
        signal: input.executionOptions.signal
      });
      if (!response.ok) {
        throw createMediaHttpError(response.status);
      }
      return await writeMediaResponse({ ...input, response });
    } catch (error) {
      throwIfAborted(input.executionOptions.signal);
      const candidateError = normalizeMediaCandidateError(error);
      if (!isRetryable(candidateError)) {
        throw candidateError;
      }
      lastError = candidateError;
    }
  }

  throw lastError ?? createDownloadError(
    'xiaohongshu-video-data-unavailable',
    '下载失败：小红书笔记没有可用视频流。',
    true
  );
}

function createMediaHttpError(status: number): Error {
  if (status === 429) {
    return createDownloadError(
      'platform-rate-limited',
      '下载失败：平台当前限制请求频率。',
      false
    );
  }
  return createDownloadError(
    'xiaohongshu-play-url-expired',
    `下载失败：小红书播放地址不可用或已过期，HTTP ${status}。`,
    [401, 403, 404].includes(status) || status >= 500
  );
}

function normalizeMediaCandidateError(error: unknown): Error {
  if (readErrorCode(error) !== undefined && error instanceof Error) {
    return error;
  }
  return createDownloadError(
    'xiaohongshu-play-url-expired',
    '下载失败：小红书视频流请求失败。',
    true
  );
}

async function writeMediaResponse(input: {
  readonly response: Response;
  readonly request: DownloadRequest;
  readonly video: XiaohongshuVideo;
  readonly selected: XiaohongshuVideoCandidate;
  readonly executionOptions: DownloadExecutionOptions;
  readonly downloadedAt: string;
}): Promise<DownloadExecutionResult> {
  if (input.response.body === null) {
    throw createDownloadError(
      'xiaohongshu-video-data-unavailable',
      '下载失败：小红书视频响应没有媒体内容。'
    );
  }

  await mkdir(input.request.outputDirectory, { recursive: true });
  const fileName = `${input.request.outputFileStem}.mp4`;
  const filePath = path.join(input.request.outputDirectory, fileName);
  const partialPath = `${filePath}.part`;
  const handle = await open(partialPath, 'w');
  const reader = input.response.body.getReader();
  const totalBytes = readPositiveNumber(input.response.headers.get('content-length'));
  let downloadedBytes = 0;

  try {
    while (true) {
      throwIfAborted(input.executionOptions.signal);
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      throwIfAborted(input.executionOptions.signal);
      await handle.write(value);
      downloadedBytes += value.byteLength;
      input.executionOptions.onProgress?.({
        percent: totalBytes === undefined ? undefined : downloadedBytes / totalBytes * 100,
        downloadedBytes,
        totalBytes
      });
    }
    await handle.close();
    await rename(partialPath, filePath);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await handle.close().catch(() => undefined);
    await rm(partialPath, { force: true });
    throw error;
  }

  return Object.freeze({
    request: input.request,
    artifacts: Object.freeze([Object.freeze({
      kind: 'muxed-video' as const,
      filePath,
      fileName,
      container: 'mp4'
    })]),
    downloadedAt: input.downloadedAt,
    mediaMetadata: Object.freeze({
      sourceTitle: input.video.title || input.request.fallbackTitle,
      resolutionLabel: input.selected.height > 0 ? `${input.selected.height}P` : undefined,
      durationSeconds: input.video.durationSeconds
    })
  });
}

async function buildPageHeaders(
  cookiesFilePath: string | undefined
): Promise<Readonly<Record<string, string>>> {
  const headers: Record<string, string> = { ...PAGE_HEADERS };
  if (cookiesFilePath !== undefined) {
    const cookieHeader = await readNetscapeCookieHeader(cookiesFilePath, ['xiaohongshu.com']);
    if (cookieHeader.length > 0) {
      headers.cookie = cookieHeader;
    }
  }
  return Object.freeze(headers);
}

function isRetryable(error: unknown): boolean {
  if (isObject(error) && typeof error.retryable === 'boolean') {
    return error.retryable;
  }
  const code = readErrorCode(error);
  return code === 'xiaohongshu-page-unavailable' ||
    code === 'xiaohongshu-video-data-unavailable' ||
    code === 'xiaohongshu-play-url-expired';
}

function readErrorCode(error: unknown): string | undefined {
  return isObject(error) && typeof error.downloadErrorCode === 'string'
    ? error.downloadErrorCode
    : undefined;
}

function createDownloadError(code: string, message: string, retryable?: boolean): Error {
  const error = new Error(message);
  Object.defineProperty(error, 'downloadErrorCode', { value: code, enumerable: false });
  Object.defineProperty(error, 'downloadErrorDetail', { value: code, enumerable: false });
  if (retryable !== undefined) {
    Object.defineProperty(error, 'retryable', { value: retryable, enumerable: false });
  }
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    const error = new Error('Download cancelled.');
    error.name = 'PipelineCancelledError';
    throw error;
  }
}

async function delay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  if (milliseconds <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new Error('Download cancelled.'));
    }, { once: true });
  });
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function readPositiveNumber(input: unknown): number | undefined {
  const value = Number(input);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const PAGE_HEADERS = Object.freeze({
  referer: 'https://www.xiaohongshu.com/',
  'user-agent': DEFAULT_USER_AGENT
});
const MEDIA_HEADERS = PAGE_HEADERS;
