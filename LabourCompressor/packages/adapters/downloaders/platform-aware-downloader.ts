import {
  type DownloadExecutionOptions,
  type DownloadExecutionResult,
  type DownloadRequest,
  type DownloaderAdapter
} from '../../features/download/domain/index.ts';
import {
  createDouyinSsrDownloaderAdapter
} from './douyin-ssr-downloader.ts';
import {
  createYtDlpDownloaderAdapter,
  extractStructuredDownloadError,
  resolveYtDlpCredential,
  type YtDlpAdapterOptions
} from './ytdlp-downloader.ts';

export interface PlatformAwareDownloaderOptions extends YtDlpAdapterOptions {
  readonly douyin?: DownloaderAdapter;
  readonly fallback?: DownloaderAdapter;
}

export function createPlatformAwareDownloaderAdapter(
  options: PlatformAwareDownloaderOptions = {}
): DownloaderAdapter {
  const fallback = options.fallback ?? createYtDlpDownloaderAdapter(options);

  return Object.freeze({
    async download(
      request: DownloadRequest,
      executionOptions: DownloadExecutionOptions = {}
    ): Promise<DownloadExecutionResult> {
      if (request.platform !== 'douyin') {
        return fallback.download(request, executionOptions);
      }

      const credential = resolveYtDlpCredential(request, options);
      const douyin = options.douyin ?? createDouyinSsrDownloaderAdapter({
        cookiesFilePath: credential.cookiesFilePath
      });

      try {
        return await douyin.download(request, executionOptions);
      } catch (error) {
        if (credential.cookiesFilePath === undefined && credential.cookiesFromBrowser === undefined) {
          const structured = extractStructuredDownloadError(error);
          if (structured.errorCode === 'douyin-ssr-unavailable') {
            throw createMissingDouyinCredentialError();
          }
        }

        return fallback.download(request, executionOptions);
      }
    }
  });
}

function createMissingDouyinCredentialError(): Error {
  const error = new Error(
    '下载失败：抖音 SSR 页面需要有效 cookies，请先在“配置下载凭证”中设置 douyin cookies.txt。'
  );
  Object.defineProperty(error, 'downloadErrorCode', {
    value: 'missing-credentials',
    enumerable: false
  });
  Object.defineProperty(error, 'downloadErrorDetail', {
    value: 'douyin SSR unavailable without cookies',
    enumerable: false
  });
  return error;
}
