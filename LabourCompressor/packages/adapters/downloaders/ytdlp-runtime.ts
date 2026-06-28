import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

import {
  getGlobalCredentialEntry,
  getPlatformCredentialEntry,
  type DownloadRequest
} from '../../features/download/domain/index.ts';
import {
  type ResolvedYtDlpCredential,
  type YtDlpAdapterOptions,
  type YtDlpBinaryInspection
} from './ytdlp-downloader.ts';

const execFileAsync = promisify(execFile);

export function resolveYtDlpCredential(
  request: DownloadRequest,
  options: YtDlpAdapterOptions = {}
): ResolvedYtDlpCredential {
  const credential = options.resolveCredential?.(request) ??
    getPlatformCredentialEntry(options.platformCredentialConfig, request.platform);
  const globalCredential = getGlobalCredentialEntry(options.platformCredentialConfig);
  if (credential?.cookiesFilePath !== undefined) {
    return Object.freeze({ cookiesFilePath: credential.cookiesFilePath, source: 'platform-cookies-file' });
  }
  if (credential?.cookiesFromBrowser !== undefined) {
    return Object.freeze({ cookiesFromBrowser: credential.cookiesFromBrowser, source: 'platform-browser-cookies' });
  }
  if (options.cookiesFilePath !== undefined) {
    return Object.freeze({ cookiesFilePath: options.cookiesFilePath, source: 'request-cookies-file' });
  }
  if (options.cookiesFromBrowser !== undefined) {
    return Object.freeze({ cookiesFromBrowser: options.cookiesFromBrowser, source: 'request-browser-cookies' });
  }
  if (globalCredential?.cookiesFilePath !== undefined) {
    return Object.freeze({ cookiesFilePath: globalCredential.cookiesFilePath, source: 'config-global-cookies-file' });
  }
  if (globalCredential?.cookiesFromBrowser !== undefined) {
    return Object.freeze({ cookiesFromBrowser: globalCredential.cookiesFromBrowser, source: 'config-global-browser-cookies' });
  }
  return Object.freeze({ source: 'none' });
}

export async function validateYtDlpBinary(binaryPath = 'yt-dlp'): Promise<boolean> {
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
    return Object.freeze({ available: false });
  }
}

export function resolveYtDlpBinaryPath(binaryPath?: string): string {
  if (binaryPath !== undefined && binaryPath.trim().length > 0) return binaryPath;
  if (existsSync('/opt/homebrew/bin/yt-dlp')) return '/opt/homebrew/bin/yt-dlp';
  if (existsSync('/usr/local/bin/yt-dlp')) return '/usr/local/bin/yt-dlp';
  return 'yt-dlp';
}

function isDateBasedYtDlpVersionStale(version: string, now: Date): boolean | undefined {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})$/u.exec(version);
  if (match === null) return undefined;
  const [, yearRaw, monthRaw, dayRaw] = match;
  const releaseDate = Date.UTC(Number(yearRaw), Number(monthRaw) - 1, Number(dayRaw));
  return Math.floor((now.getTime() - releaseDate) / 86_400_000) > 90;
}
