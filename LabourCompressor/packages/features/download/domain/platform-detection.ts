export type SupportedPlatform =
  | 'bilibili'
  | 'youtube'
  | 'douyin'
  | 'tiktok'
  | 'xiaohongshu';

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
  const platform = detectPlatformFromUrl(parsedUrl);

  return Object.freeze({
    originalUrl: trimmedUrl,
    normalizedUrl,
    platform,
    host
  });
}

export function sanitizePlatformUrlForOutput(inputUrl: string): string {
  try {
    const parsedUrl = new URL(inputUrl.trim());
    const host = parsedUrl.host.toLowerCase();
    if (host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com')) {
      parsedUrl.search = '';
      parsedUrl.hash = '';
    }
    return parsedUrl.toString();
  } catch {
    return inputUrl;
  }
}

function normalizePlatformUrl(parsedUrl: URL): string {
  const host = parsedUrl.host.toLowerCase();

  if (
    isDouyinHost(host) &&
    parsedUrl.pathname.startsWith('/shipin/')
  ) {
    const videoId = parsedUrl.pathname.slice('/shipin/'.length).replace(/\/+$/u, '');
    return buildDouyinVideoUrl(videoId);
  }

  if (
    isDouyinHost(host) &&
    parsedUrl.pathname.startsWith('/share/video/')
  ) {
    const videoId = parsedUrl.pathname.slice('/share/video/'.length).replace(/\/+$/u, '');
    return buildDouyinVideoUrl(videoId);
  }

  return parsedUrl.toString();
}

function detectPlatformFromUrl(parsedUrl: URL): SupportedPlatform {
  const host = parsedUrl.host.toLowerCase();
  if (host === 'b23.tv' || host.endsWith('.bilibili.com')) {
    return 'bilibili';
  }

  if (host === 'youtu.be' || host.endsWith('.youtube.com')) {
    return 'youtube';
  }

  if (isDouyinHost(host)) {
    return 'douyin';
  }

  if (host.endsWith('.tiktok.com')) {
    return 'tiktok';
  }

  if (
    (host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com')) &&
    /^\/(?:explore|discovery\/item)\/[\da-f]+\/?$/u.test(parsedUrl.pathname)
  ) {
    return 'xiaohongshu';
  }

  throw new Error(`Unsupported download platform host: "${host}"`);
}

function isDouyinHost(host: string): boolean {
  return host.endsWith('.douyin.com') || host.endsWith('.iesdouyin.com');
}

function buildDouyinVideoUrl(videoId: string): string {
  return new URL(`/video/${videoId}`, 'https://www.douyin.com').toString();
}
