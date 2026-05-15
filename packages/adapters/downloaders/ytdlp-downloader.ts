import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  type DownloadArtifact,
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

export function createYtDlpDownloaderAdapter(
  options: YtDlpAdapterOptions = {}
): {
  download(request: DownloadRequest): Promise<DownloadExecutionResult>;
} {
  const binaryPath = resolveYtDlpBinaryPath(options.binaryPath);

  return Object.freeze({
    async download(request: DownloadRequest): Promise<DownloadExecutionResult> {
      const args = buildYtDlpArgs(request, options);
      await mkdir(request.outputDirectory, { recursive: true });
      const beforeFiles = new Set(await safeReadDir(request.outputDirectory));
      let stdout = '';

      try {
        const result = await execFileAsync(binaryPath, args, {
          cwd: request.outputDirectory
        });
        stdout = result.stdout;
      } catch (error) {
        throw createStructuredDownloadError(error);
      }

      const artifacts = await collectDownloadedArtifacts({
        outputDirectory: request.outputDirectory,
        outputFileStem: request.outputFileStem,
        beforeFiles,
        reportedFilePaths: extractReportedFilePaths(stdout)
      });

      if (artifacts.length === 0) {
        throw createDownloadProbeError('output-not-detected');
      }

      return Object.freeze({
        request,
        artifacts,
        downloadedAt: new Date().toISOString(),
        mediaMetadata: parseYtDlpMediaMetadata({
          stdout,
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
    '--no-progress',
    '--newline',
    '--no-warnings',
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

  if (cookiesFilePath !== undefined) {
    args.push('--cookies', cookiesFilePath);
  }

  if (cookiesFromBrowser !== undefined) {
    args.push('--cookies-from-browser', cookiesFromBrowser);
  }

  args.push(request.normalizedUrl);

  return Object.freeze(args);
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
  try {
    await execFileAsync(resolveYtDlpBinaryPath(binaryPath), ['--version']);
    return true;
  } catch {
    return false;
  }
}

export interface ResolveYtDlpBinaryPathOptions {
  readonly platform?: NodeJS.Platform;
  readonly projectRoot?: string;
  readonly exists?: (filePath: string) => boolean;
}

export function resolveYtDlpBinaryPath(
  binaryPath?: string,
  options: ResolveYtDlpBinaryPathOptions = {}
): string {
  if (binaryPath !== undefined && binaryPath.trim().length > 0) {
    return binaryPath;
  }

  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const projectRoot = options.projectRoot ?? process.cwd();

  if (platform === 'win32') {
    const localWindowsBinaryPath = resolveFirstExistingPath(
      [
        path.join(projectRoot, '.tools', 'bin', 'yt-dlp.exe'),
        path.join(projectRoot, '.tools', 'bin', 'yt-dlp.cmd'),
        path.join(projectRoot, '.tools', 'bin', 'yt-dlp.bat')
      ],
      exists
    );

    return localWindowsBinaryPath ?? 'yt-dlp';
  }

  const homebrewBinaryPath = '/opt/homebrew/bin/yt-dlp';
  if (exists(homebrewBinaryPath)) {
    return homebrewBinaryPath;
  }

  const intelHomebrewBinaryPath = '/usr/local/bin/yt-dlp';
  if (exists(intelHomebrewBinaryPath)) {
    return intelHomebrewBinaryPath;
  }

  return 'yt-dlp';
}

function resolveFirstExistingPath(
  candidatePaths: readonly string[],
  exists: (filePath: string) => boolean
): string | undefined {
  return candidatePaths.find((candidatePath) => exists(candidatePath));
}

export function classifyYtDlpErrorMessage(
  message: string
): DownloadProbeResult {
  const summarizedMessage = summarizeYtDlpErrorMessage(message);

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

  return errorLine.slice(0, 240);
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
