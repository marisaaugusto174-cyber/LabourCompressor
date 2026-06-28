import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  type DownloadExecutionOptions,
  type DownloadExecutionResult,
  type DownloadRequest
} from '../../features/download/domain/index.ts';
import { readNetscapeCookieHeader } from './netscape-cookies.ts';

export interface XiaohongshuVideoCandidate {
  readonly url: string;
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly bitrate: number;
  readonly fileSize: number;
}

export interface XiaohongshuVideo {
  readonly noteId: string;
  readonly title: string;
  readonly durationSeconds?: number;
  readonly candidates: readonly XiaohongshuVideoCandidate[];
}

export interface XiaohongshuDownloaderOptions {
  readonly cookiesFilePath?: string;
  readonly fetch?: typeof fetch;
  readonly downloadedAt?: () => string;
  readonly maxPageAttempts?: number;
  readonly retryDelayMs?: (attempt: number) => number;
}

type JsonObject = Record<string, unknown>;

export function extractXiaohongshuNoteId(inputUrl: string): string | undefined {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(inputUrl.trim());
  } catch {
    return undefined;
  }

  if (
    parsedUrl.hostname !== 'xiaohongshu.com' &&
    !parsedUrl.hostname.endsWith('.xiaohongshu.com')
  ) {
    return undefined;
  }

  const match = /^\/(?:explore|discovery\/item)\/([\da-f]+)\/?$/u.exec(parsedUrl.pathname);
  return match?.[1];
}

export function extractXiaohongshuVideoFromWebpage(
  html: string,
  noteId: string
): XiaohongshuVideo {
  const initialState = parseInitialState(html);
  const note = readObjectPath(initialState, ['note', 'noteDetailMap', noteId, 'note']);

  if (readString(note.type).toLowerCase() !== 'video') {
    throw createDownloadError(
      'xiaohongshu-note-not-video',
      '下载失败：该小红书笔记不包含视频。'
    );
  }

  const stream = readObjectPath(note, ['video', 'media', 'stream']);
  const candidates = Object.values(stream)
    .flatMap((entries) => Array.isArray(entries) ? entries : [])
    .flatMap((entry) => buildCandidates(entry))
    .sort(compareCandidates);

  if (candidates.length === 0) {
    throw createDownloadError(
      'xiaohongshu-video-data-unavailable',
      '下载失败：小红书笔记页面中没有可用的视频播放信息。'
    );
  }

  const durationMs = candidates
    .map((candidate) => (candidate as XiaohongshuVideoCandidate & { durationMs?: number }).durationMs)
    .find((value) => value !== undefined && value > 0);

  return Object.freeze({
    noteId,
    title: readString(note.title) || readString(note.desc) || noteId,
    durationSeconds: durationMs === undefined ? undefined : durationMs / 1000,
    candidates: Object.freeze(candidates.map(({ durationMs: _durationMs, ...candidate }) =>
      Object.freeze(candidate)
    ))
  });
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

          const mediaResponse = await fetchImpl(selected.url, {
            headers: MEDIA_HEADERS,
            signal: executionOptions.signal
          });

          if (!mediaResponse.ok) {
            throw createDownloadError(
              'xiaohongshu-play-url-expired',
              `下载失败：小红书播放地址不可用或已过期，HTTP ${mediaResponse.status}。`,
              [401, 403, 404].includes(mediaResponse.status)
            );
          }

          return await writeMediaResponse({
            response: mediaResponse,
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

function parseInitialState(html: string): JsonObject {
  const marker = /window\.__INITIAL_STATE__\s*=\s*/u.exec(html);
  if (marker === null || marker.index === undefined) {
    throw createDownloadError(
      'xiaohongshu-page-unavailable',
      '下载失败：小红书笔记页面缺少初始状态。'
    );
  }

  const start = marker.index + marker[0].length;
  const scriptEnd = html.indexOf('</script>', start);
  const source = html
    .slice(start, scriptEnd < 0 ? html.length : scriptEnd)
    .trim()
    .replace(/;\s*$/u, '')
    .replace(/([:\[,]\s*)undefined(?=\s*[,}\]])/gu, '$1null');

  try {
    const parsed = JSON.parse(source);
    if (isObject(parsed)) {
      return parsed;
    }
  } catch {
    throw createDownloadError(
      'xiaohongshu-page-unavailable',
      '下载失败：小红书笔记页面初始状态无法解析。'
    );
  }

  throw createDownloadError(
    'xiaohongshu-page-unavailable',
    '下载失败：小红书笔记页面初始状态结构异常。'
  );
}

function buildCandidates(input: unknown): readonly (XiaohongshuVideoCandidate & {
  readonly durationMs?: number;
})[] {
  if (!isObject(input)) {
    return [];
  }

  const urls = [input.masterUrl, ...(Array.isArray(input.backupUrls) ? input.backupUrls : [])]
    .map(readString)
    .filter(isHttpUrl);
  const codec = readString(input.videoCodec).toLowerCase();
  const durationMs = readPositiveNumber(input.duration);

  return urls.map((url) => Object.freeze({
    url,
    codec,
    width: readPositiveNumber(input.width) ?? 0,
    height: readPositiveNumber(input.height) ?? 0,
    bitrate: readPositiveNumber(input.videoBitrate) ?? readPositiveNumber(input.avgBitrate) ?? 0,
    fileSize: readPositiveNumber(input.size) ?? 0,
    durationMs
  }));
}

function compareCandidates(
  left: XiaohongshuVideoCandidate,
  right: XiaohongshuVideoCandidate
): number {
  return (
    Number(isH264(right.codec)) - Number(isH264(left.codec)) ||
    right.height - left.height ||
    right.width - left.width ||
    right.bitrate - left.bitrate ||
    right.fileSize - left.fileSize
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

function readObjectPath(input: unknown, keys: readonly string[]): JsonObject {
  let current = input;
  for (const key of keys) {
    if (!isObject(current) || !isObject(current[key])) {
      throw createDownloadError(
        'xiaohongshu-page-unavailable',
        '下载失败：小红书笔记页面缺少必要数据。'
      );
    }
    current = current[key];
  }
  return current as JsonObject;
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

function isObject(input: unknown): input is JsonObject {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function readString(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

function readPositiveNumber(input: unknown): number | undefined {
  const value = Number(input);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function isHttpUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isH264(codec: string): boolean {
  return codec.includes('h264') || codec.includes('avc');
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const PAGE_HEADERS = Object.freeze({
  referer: 'https://www.xiaohongshu.com/',
  'user-agent': DEFAULT_USER_AGENT
});
const MEDIA_HEADERS = PAGE_HEADERS;
