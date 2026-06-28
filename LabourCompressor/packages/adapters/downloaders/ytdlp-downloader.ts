import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  type DownloadArtifact,
  type DownloadExecutionOptions,
  type DownloadExecutionProgress,
  type DownloadExecutionResult,
  type DownloadRequest,
  getGlobalCredentialEntry,
  getPlatformCredentialEntry,
  type PlatformCredentialConfig,
  type PlatformCredentialEntry
} from '../../features/download/domain/index.ts';
import {
  collectDownloadedArtifacts,
  extractReportedFilePaths
} from './ytdlp-output-artifacts.ts';

const execFileAsync = promisify(execFile);

export interface YtDlpAdapterOptions {
  readonly binaryPath?: string;
  readonly cookiesFilePath?: string;
  readonly cookiesFromBrowser?: string;
  readonly platformCredentialConfig?: PlatformCredentialConfig;
  readonly resolveCredential?: (
    request: DownloadRequest
  ) => PlatformCredentialEntry | undefined;
}

export type DownloadProbeStatus =
  | 'ok'
  | 'needs-fresh-cookies'
  | 'missing-credentials'
  | 'cookies-expired'
  | 'blocked-by-bilibili-412'
  | 'douyin-extractor-challenge'
  | 'douyin-ssr-unavailable'
  | 'douyin-play-url-expired'
  | 'douyin-detail-api-blocked'
  | 'xiaohongshu-no-formats'
  | 'xiaohongshu-note-not-video'
  | 'xiaohongshu-page-unavailable'
  | 'xiaohongshu-video-data-unavailable'
  | 'xiaohongshu-play-url-expired'
  | 'xiaohongshu-media-type-invalid'
  | 'xiaohongshu-media-truncated'
  | 'platform-rate-limited'
  | 'rename-failed'
  | 'output-not-detected'
  | 'unsupported-url'
  | 'runtime-error'
  | 'unknown-error';

export interface DownloadProbeResult {
  readonly status: DownloadProbeStatus;
  readonly message: string;
}

export interface ResolvedYtDlpCredential {
  readonly cookiesFilePath?: string;
  readonly cookiesFromBrowser?: string;
  readonly source:
    | 'platform-cookies-file'
    | 'platform-browser-cookies'
    | 'request-cookies-file'
    | 'request-browser-cookies'
    | 'config-global-cookies-file'
    | 'config-global-browser-cookies'
    | 'none';
}

export interface YtDlpBinaryInspection {
  readonly available: boolean;
  readonly version?: string;
  readonly isStale?: boolean;
}

export function createYtDlpDownloaderAdapter(
  options: YtDlpAdapterOptions = {}
): {
  download(
    request: DownloadRequest,
    executionOptions?: DownloadExecutionOptions
  ): Promise<DownloadExecutionResult>;
} {
  const binaryPath = resolveYtDlpBinaryPath(options.binaryPath);

  return Object.freeze({
    async download(
      request: DownloadRequest,
      executionOptions: DownloadExecutionOptions = {}
    ): Promise<DownloadExecutionResult> {
      const args = buildYtDlpArgs(request, options);
      await mkdir(request.outputDirectory, { recursive: true });
      const beforeFiles = new Set(await safeReadDir(request.outputDirectory));
      let output = '';

      try {
        output = await runYtDlpProcess({
          binaryPath,
          args,
          cwd: request.outputDirectory,
          signal: executionOptions.signal,
          onProgress: executionOptions.onProgress
        });
      } catch (error) {
        if (executionOptions.signal?.aborted === true) {
          throw createDownloadCancelledError();
        }
        throw createStructuredDownloadError(error);
      }

      const artifacts = await collectDownloadedArtifacts({
        outputDirectory: request.outputDirectory,
        outputFileStem: request.outputFileStem,
        beforeFiles,
        reportedFilePaths: extractReportedFilePaths(output)
      });

      if (artifacts.length === 0) {
        throw createDownloadProbeError('output-not-detected');
      }

      return Object.freeze({
        request,
        artifacts,
        downloadedAt: new Date().toISOString(),
        mediaMetadata: parseYtDlpMediaMetadata({
          stdout: output,
          fallbackTitle: request.fallbackTitle
        })
      });
    }
  });
}

export function buildYtDlpArgs(
  request: DownloadRequest,
  options: YtDlpAdapterOptions = {}
): readonly string[] {
  const resolvedCredential = resolveYtDlpCredential(request, options);
  const cookiesFilePath = resolvedCredential.cookiesFilePath;
  const cookiesFromBrowser = resolvedCredential.cookiesFromBrowser;
  const args = [
    '--newline',
    '--no-warnings',
    '--progress-template',
    'download:LCPROGRESS:%(progress._percent_str)s\t%(progress._speed_str)s\t%(progress._eta_str)s\t%(progress.downloaded_bytes)s\t%(progress.total_bytes)s',
    '--print',
    'before_dl:LCMETA:%(title)s\t%(height)s\t%(duration)s',
    '--print',
    'after_move:LCFILE:%(filepath)s',
    '--format',
    'bv*+ba/b',
    '--merge-output-format',
    'mp4',
    '--output',
    path.join(request.outputDirectory, `${request.outputFileStem}.%(ext)s`),
  ];

  if (request.platform === 'xiaohongshu') {
    args.push('--format-sort', 'vcodec:h264,res,br,size');
  }

  if (cookiesFilePath !== undefined) {
    args.push('--cookies', cookiesFilePath);
  }

  if (cookiesFromBrowser !== undefined) {
    args.push('--cookies-from-browser', cookiesFromBrowser);
  }

  args.push(request.normalizedUrl);

  return Object.freeze(args);
}

export function parseYtDlpProgressLine(
  line: string
): DownloadExecutionProgress | undefined {
  if (!line.startsWith('LCPROGRESS:')) {
    return undefined;
  }

  const [percentRaw = '', speedRaw = '', etaRaw = '', downloadedRaw = '', totalRaw = ''] =
    line.slice('LCPROGRESS:'.length).split('\t');
  const percent = Number(percentRaw.replace('%', '').trim());
  const downloadedBytes = Number(downloadedRaw.trim());
  const totalBytes = Number(totalRaw.trim());
  const speedText = speedRaw.trim();
  const etaText = etaRaw.trim();

  return Object.freeze({
    percent: Number.isFinite(percent) ? percent : undefined,
    speedText: speedText.length > 0 && speedText !== 'N/A' ? speedText : undefined,
    etaText: etaText.length > 0 && etaText !== 'N/A' ? etaText : undefined,
    downloadedBytes: Number.isFinite(downloadedBytes) ? downloadedBytes : undefined,
    totalBytes: Number.isFinite(totalBytes) ? totalBytes : undefined
  });
}

export function resolveYtDlpCredential(
  request: DownloadRequest,
  options: YtDlpAdapterOptions = {}
): ResolvedYtDlpCredential {
  const resolvedCredential =
    options.resolveCredential?.(request) ??
    getPlatformCredentialEntry(options.platformCredentialConfig, request.platform);
  const globalCredential = getGlobalCredentialEntry(options.platformCredentialConfig);

  if (resolvedCredential?.cookiesFilePath !== undefined) {
    return Object.freeze({
      cookiesFilePath: resolvedCredential.cookiesFilePath,
      source: 'platform-cookies-file'
    });
  }

  if (resolvedCredential?.cookiesFromBrowser !== undefined) {
    return Object.freeze({
      cookiesFromBrowser: resolvedCredential.cookiesFromBrowser,
      source: 'platform-browser-cookies'
    });
  }

  if (options.cookiesFilePath !== undefined) {
    return Object.freeze({
      cookiesFilePath: options.cookiesFilePath,
      source: 'request-cookies-file'
    });
  }

  if (options.cookiesFromBrowser !== undefined) {
    return Object.freeze({
      cookiesFromBrowser: options.cookiesFromBrowser,
      source: 'request-browser-cookies'
    });
  }

  if (globalCredential?.cookiesFilePath !== undefined) {
    return Object.freeze({
      cookiesFilePath: globalCredential.cookiesFilePath,
      source: 'config-global-cookies-file'
    });
  }

  if (globalCredential?.cookiesFromBrowser !== undefined) {
    return Object.freeze({
      cookiesFromBrowser: globalCredential.cookiesFromBrowser,
      source: 'config-global-browser-cookies'
    });
  }

  return Object.freeze({
    source: 'none'
  });
}

export async function validateYtDlpBinary(
  binaryPath = 'yt-dlp'
): Promise<boolean> {
  return (await inspectYtDlpBinary(binaryPath)).available;
}

export async function inspectYtDlpBinary(
  binaryPath = 'yt-dlp',
  now = new Date()
): Promise<YtDlpBinaryInspection> {
  try {
    const { stdout } = await execFileAsync(resolveYtDlpBinaryPath(binaryPath), ['--version']);
    const version = stdout.trim().split(/\r?\n/u)[0]?.trim();
    return Object.freeze({
      available: true,
      version,
      isStale: version === undefined || version.length === 0
        ? undefined
        : isDateBasedYtDlpVersionStale(version, now)
    });
  } catch {
    return Object.freeze({
      available: false
    });
  }
}

export function resolveYtDlpBinaryPath(binaryPath?: string): string {
  if (binaryPath !== undefined && binaryPath.trim().length > 0) {
    return binaryPath;
  }

  const homebrewBinaryPath = '/opt/homebrew/bin/yt-dlp';
  if (existsSync(homebrewBinaryPath)) {
    return homebrewBinaryPath;
  }

  const intelHomebrewBinaryPath = '/usr/local/bin/yt-dlp';
  if (existsSync(intelHomebrewBinaryPath)) {
    return intelHomebrewBinaryPath;
  }

  return 'yt-dlp';
}

async function runYtDlpProcess(input: {
  readonly binaryPath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: DownloadExecutionProgress) => void;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (input.signal?.aborted === true) {
      reject(createDownloadCancelledError());
      return;
    }

    const child = spawn(input.binaryPath, [...input.args], {
      cwd: input.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let stderr = '';
    let settled = false;
    const flushLine = createLineCollector((line) => {
      output += `${line}\n`;
      const progress = parseYtDlpProgressLine(line);
      if (progress !== undefined) {
        input.onProgress?.(progress);
      }
    });
    const flushErrorLine = createLineCollector((line) => {
      stderr += `${line}\n`;
      output += `${line}\n`;
      const progress = parseYtDlpProgressLine(line);
      if (progress !== undefined) {
        input.onProgress?.(progress);
      }
    });
    const abort = () => {
      if (settled) {
        return;
      }
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, 1500).unref();
    };

    input.signal?.addEventListener('abort', abort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => flushLine(String(chunk)));
    child.stderr.on('data', (chunk) => flushErrorLine(String(chunk)));
    child.on('error', (error) => {
      settled = true;
      input.signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (code, signal) => {
      settled = true;
      input.signal?.removeEventListener('abort', abort);
      flushLine('');
      flushErrorLine('');

      if (input.signal?.aborted === true) {
        reject(createDownloadCancelledError());
        return;
      }

      if (code === 0) {
        resolve(output);
        return;
      }

      reject(new Error((stderr || output || `yt-dlp exited with code ${code ?? signal ?? 'unknown'}`).trim()));
    });
  });
}

function createLineCollector(onLine: (line: string) => void): (chunk: string) => void {
  let pending = '';

  return (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? '';

    for (const line of lines) {
      if (line.length > 0) {
        onLine(line);
      }
    }

    if (chunk.length === 0 && pending.length > 0) {
      onLine(pending);
      pending = '';
    }
  };
}

function createDownloadCancelledError(): Error {
  const error = new Error('Download cancelled.');
  error.name = 'PipelineCancelledError';
  return error;
}

export function classifyYtDlpErrorMessage(
  message: string
): DownloadProbeResult {
  const summarizedMessage = summarizeYtDlpErrorMessage(message);

  if (
    message.includes('[Douyin]') &&
    message.includes('Fresh cookies')
  ) {
    return Object.freeze({
      status: 'douyin-detail-api-blocked',
      message: summarizedMessage
    });
  }

  if (
    message.includes('[XiaoHongShu]') &&
    message.includes('No video formats found')
  ) {
    return Object.freeze({
      status: 'xiaohongshu-no-formats',
      message: summarizedMessage
    });
  }

  if (
    message.includes('Login required') ||
    message.includes('Sign in to confirm') ||
    message.includes('Use --cookies') ||
    message.includes('Requested format is not available')
  ) {
    return Object.freeze({
      status: 'missing-credentials',
      message: summarizedMessage
    });
  }

  if (message.includes('HTTP Error 412')) {
    return Object.freeze({
      status: 'blocked-by-bilibili-412',
      message: summarizedMessage
    });
  }

  if (message.includes('Fresh cookies')) {
    return Object.freeze({
      status: 'needs-fresh-cookies',
      message: summarizedMessage
    });
  }

  if (
    message.includes('cookie') &&
    (message.includes('expired') || message.includes('invalid'))
  ) {
    return Object.freeze({
      status: 'cookies-expired',
      message: summarizedMessage
    });
  }

  if (
    message.includes('Too Many Requests') ||
    message.includes('rate limit') ||
    message.includes('429')
  ) {
    return Object.freeze({
      status: 'platform-rate-limited',
      message: summarizedMessage
    });
  }

  if (message.includes('Unable to rename file')) {
    return Object.freeze({
      status: 'rename-failed',
      message: summarizedMessage
    });
  }

  if (message.includes('without producing detectable output files')) {
    return Object.freeze({
      status: 'output-not-detected',
      message: summarizedMessage
    });
  }

  if (message.includes('Unsupported URL')) {
    return Object.freeze({
      status: 'unsupported-url',
      message: summarizedMessage
    });
  }

  if (message.includes('expat') || message.includes('pyexpat')) {
    return Object.freeze({
      status: 'runtime-error',
      message: summarizedMessage
    });
  }

  if (message.includes('ENOENT') && message.includes('yt-dlp')) {
    return Object.freeze({
      status: 'runtime-error',
      message: summarizedMessage
    });
  }

  return Object.freeze({
    status: 'unknown-error',
    message: summarizedMessage
  });
}

function createStructuredDownloadError(error: unknown): Error {
  const message =
    error instanceof Error
      ? error.message
      : String(error);
  const probe = classifyYtDlpErrorMessage(message);
  const structured = new Error(buildUserFacingDownloadMessage(probe.status, probe.message)) as Error & {
    readonly downloadErrorCode?: string;
    readonly downloadErrorDetail?: string;
  };
  Object.defineProperty(structured, 'downloadErrorCode', {
    value: probe.status,
    enumerable: false
  });
  Object.defineProperty(structured, 'downloadErrorDetail', {
    value: probe.message,
    enumerable: false
  });
  return structured;
}

function createDownloadProbeError(status: DownloadProbeStatus): Error {
  const structured = new Error(buildUserFacingDownloadMessage(status, '')) as Error & {
    readonly downloadErrorCode?: string;
    readonly downloadErrorDetail?: string;
  };
  Object.defineProperty(structured, 'downloadErrorCode', {
    value: status,
    enumerable: false
  });
  Object.defineProperty(structured, 'downloadErrorDetail', {
    value: status,
    enumerable: false
  });
  return structured;
}

export function extractStructuredDownloadError(error: unknown): Readonly<{
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly errorDetail?: string;
}> {
  if (
    typeof error === 'object' &&
    error !== null &&
    'downloadErrorCode' in error &&
    typeof (error as { downloadErrorCode?: unknown }).downloadErrorCode === 'string'
  ) {
    const structuredError = error as Error & {
      readonly downloadErrorCode: string;
      readonly downloadErrorDetail?: string;
    };

    return Object.freeze({
      errorCode: structuredError.downloadErrorCode,
      errorMessage: structuredError.message,
      errorDetail: structuredError.downloadErrorDetail
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  const probe = classifyYtDlpErrorMessage(message);

  return Object.freeze({
    errorCode: probe.status,
    errorMessage: buildUserFacingDownloadMessage(probe.status, probe.message),
    errorDetail: probe.message
  });
}

function parseYtDlpMediaMetadata(input: {
  readonly stdout: string;
  readonly fallbackTitle: string;
}): DownloadExecutionResult['mediaMetadata'] {
  const line = input.stdout
    .split(/\r?\n/u)
    .find((value) => value.startsWith('LCMETA:'));

  if (line === undefined) {
    return Object.freeze({
      sourceTitle: input.fallbackTitle
    });
  }

  const payload = line.slice('LCMETA:'.length);
  const [titleRaw = '', heightRaw = '', durationRaw = ''] = payload.split('\t');
  const height = Number(heightRaw.trim());
  const duration = Number(durationRaw.trim());

  return Object.freeze({
    sourceTitle: titleRaw.trim() || input.fallbackTitle,
    resolutionLabel: Number.isFinite(height) && height > 0 ? `${Math.round(height)}P` : undefined,
    durationSeconds: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : undefined
  });
}
function summarizeYtDlpErrorMessage(message: string): string {
  const lines = message
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const errorLine =
    lines.find((line) => line.startsWith('ERROR:')) ??
    lines.find((line) => line.toLowerCase().includes('error')) ??
    lines[0] ??
    'Download failed.';

  return errorLine
    .replace(/(xsec_token=)[^&\s]+/giu, '$1[REDACTED]')
    .slice(0, 240);
}

async function safeReadDir(directoryPath: string): Promise<readonly string[]> {
  try {
    return Object.freeze(await readdir(directoryPath));
  } catch {
    return Object.freeze([]);
  }
}

function buildUserFacingDownloadMessage(
  status: DownloadProbeStatus,
  detail: string
): string {
  switch (status) {
    case 'missing-credentials':
      return '下载失败：当前平台需要可用的登录态或 Cookies。';
    case 'needs-fresh-cookies':
      return '下载失败：当前平台需要更新后的新鲜 Cookies。';
    case 'cookies-expired':
      return '下载失败：当前平台 Cookies 已过期或失效。';
    case 'blocked-by-bilibili-412':
      return '下载失败：Bilibili 当前触发了 412 风控。';
    case 'douyin-extractor-challenge':
      return '下载失败：抖音当前触发了解析/风控挑战，请更新 yt-dlp 后重试；若仍失败，请换用有效 cookies 或稍后再试。';
    case 'douyin-ssr-unavailable':
      return '下载失败：抖音页面 SSR 中没有可用的视频播放信息。';
    case 'douyin-play-url-expired':
      return '下载失败：抖音播放地址不可用或已过期，请刷新链接后重试。';
    case 'douyin-detail-api-blocked':
      return '下载失败：抖音详情接口返回空数据，当前 yt-dlp 路径被平台风控阻断。';
    case 'xiaohongshu-no-formats':
      return '下载失败：yt-dlp 未解析到小红书视频格式。';
    case 'xiaohongshu-note-not-video':
      return '下载失败：该小红书笔记不包含视频。';
    case 'xiaohongshu-page-unavailable':
      return '下载失败：小红书笔记页面暂时不可用。';
    case 'xiaohongshu-video-data-unavailable':
      return '下载失败：小红书笔记页面中没有可用的视频播放信息。';
    case 'xiaohongshu-play-url-expired':
      return '下载失败：小红书播放地址不可用或已过期。';
    case 'xiaohongshu-media-type-invalid':
      return '下载失败：小红书媒体地址返回了非视频内容。';
    case 'xiaohongshu-media-truncated':
      return '下载失败：小红书视频下载内容不完整。';
    case 'platform-rate-limited':
      return '下载失败：平台当前限制请求频率。';
    case 'rename-failed':
      return '下载失败：下载产物落盘重命名失败。';
    case 'output-not-detected':
      return '下载失败：下载器未产出可识别的视频文件。';
    case 'unsupported-url':
      return '下载失败：当前 URL 不在支持的平台范围内。';
    case 'runtime-error':
      return '下载失败：yt-dlp 或本地运行时环境异常。';
    case 'unknown-error':
      return `下载失败：${detail}`;
    default:
      return detail;
  }
}

function isDateBasedYtDlpVersionStale(version: string, now: Date): boolean | undefined {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})$/u.exec(version);
  if (match === null) {
    return undefined;
  }

  const [, yearRaw, monthRaw, dayRaw] = match;
  const releaseDate = Date.UTC(
    Number(yearRaw),
    Number(monthRaw) - 1,
    Number(dayRaw)
  );
  const ageDays = Math.floor((now.getTime() - releaseDate) / 86_400_000);
  return ageDays > 90;
}
