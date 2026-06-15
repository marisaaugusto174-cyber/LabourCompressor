import { readFile, writeFile } from 'node:fs/promises';

import {
  createYtDlpDownloaderAdapter,
  extractStructuredDownloadError,
  resolveYtDlpCredential
} from '../../packages/adapters/downloaders/ytdlp-downloader.ts';
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
    const adapter = createYtDlpDownloaderAdapter({
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

export async function loadPlatformCredentialSummary(
  filePath: string
): Promise<readonly PlatformCredentialSummaryEntry[]> {
  return summarizePlatformCredentialConfig(
    await loadPlatformCredentialConfig(filePath)
  );
}

export async function savePlatformCredentialConfig(input: {
  readonly filePath: string;
  readonly platform: SupportedPlatform;
  readonly cookiesFilePath?: string;
  readonly cookiesFromBrowser?: string;
}): Promise<readonly PlatformCredentialSummaryEntry[]> {
  const raw = await readJsonObjectFile(input.filePath);
  raw[input.platform] = {
    ...(typeof raw[input.platform] === 'object' &&
    raw[input.platform] !== null &&
    !Array.isArray(raw[input.platform])
      ? (raw[input.platform] as Record<string, unknown>)
      : {}),
    cookiesFilePath: input.cookiesFilePath ?? '',
    cookiesFromBrowser: input.cookiesFromBrowser ?? ''
  };
  await writeFile(input.filePath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  return loadPlatformCredentialSummary(input.filePath);
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

function summarizePlatformCredentialConfig(
  config: PlatformCredentialConfig | undefined
): readonly PlatformCredentialSummaryEntry[] {
  return Object.freeze([
    summarizePlatformCredentialEntry(config, 'bilibili'),
    summarizePlatformCredentialEntry(config, 'youtube'),
    summarizePlatformCredentialEntry(config, 'douyin'),
    summarizePlatformCredentialEntry(config, 'tiktok')
  ]);
}

function summarizePlatformCredentialEntry(
  config: PlatformCredentialConfig | undefined,
  platform: SupportedPlatform
): PlatformCredentialSummaryEntry {
  const entry = config?.[platform];
  return Object.freeze({
    platform,
    cookiesFilePath: entry?.cookiesFilePath,
    cookiesFromBrowser: entry?.cookiesFromBrowser
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
