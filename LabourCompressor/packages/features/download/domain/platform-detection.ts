export type SupportedPlatform =
  | 'bilibili'
  | 'youtube'
  | 'douyin'
  | 'tiktok';

export interface DetectedPlatformUrl {
  readonly originalUrl: string;
  readonly normalizedUrl: string;
  readonly platform: SupportedPlatform;
  readonly host: string;
}

export function detectSupportedPlatformUrl(
  inputUrl: string
): DetectedPlatformUrl {
  const trimmedUrl = inputUrl.trim();

  if (trimmedUrl.length === 0) {
    throw new Error('Source URL must not be empty.');
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new Error(`Invalid source URL: "${inputUrl}"`);
  }

  const host = parsedUrl.host.toLowerCase();
  const normalizedUrl = normalizePlatformUrl(parsedUrl);
  const platform = detectPlatformFromHost(host);

  return Object.freeze({
    originalUrl: trimmedUrl,
    normalizedUrl,
    platform,
    host
  });
}

function normalizePlatformUrl(parsedUrl: URL): string {
  if (
    parsedUrl.host.toLowerCase().endsWith('.douyin.com') &&
    parsedUrl.pathname.startsWith('/shipin/')
  ) {
    const videoId = parsedUrl.pathname.slice('/shipin/'.length).replace(/\/+$/u, '');
    return new URL(`/video/${videoId}`, parsedUrl.origin).toString();
  }

  return parsedUrl.toString();
}

function detectPlatformFromHost(host: string): SupportedPlatform {
  if (host === 'b23.tv' || host.endsWith('.bilibili.com')) {
    return 'bilibili';
  }

  if (host === 'youtu.be' || host.endsWith('.youtube.com')) {
    return 'youtube';
  }

  if (host.endsWith('.douyin.com')) {
    return 'douyin';
  }

  if (host.endsWith('.tiktok.com')) {
    return 'tiktok';
  }

  throw new Error(`Unsupported download platform host: "${host}"`);
}
