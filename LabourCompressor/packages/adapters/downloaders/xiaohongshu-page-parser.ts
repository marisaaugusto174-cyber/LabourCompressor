export interface XiaohongshuVideoCandidate {
  readonly urls: readonly string[];
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly bitrate: number;
  readonly fileSize: number;
}

export interface XiaohongshuVideo {
  readonly noteId: string;
  readonly title: string;
  readonly durationSeconds?: number | undefined;
  readonly candidates: readonly XiaohongshuVideoCandidate[];
}

type JsonObject = Record<string, unknown>;
type StreamCandidate = XiaohongshuVideoCandidate & {
  readonly durationMs?: number | undefined;
};

export function extractXiaohongshuNoteId(inputUrl: string): string | undefined {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(inputUrl.trim());
  } catch {
    return undefined;
  }

  if (!isXiaohongshuHostname(parsedUrl.hostname)) {
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
    .map(buildCandidate)
    .filter((candidate): candidate is StreamCandidate => candidate !== undefined)
    .sort(compareCandidates);

  if (candidates.length === 0) {
    throw createDownloadError(
      'xiaohongshu-video-data-unavailable',
      '下载失败：小红书笔记页面中没有可用的视频播放信息。'
    );
  }

  const durationMs = candidates
    .map((candidate) => candidate.durationMs)
    .find((value) => value !== undefined && value > 0);

  return Object.freeze({
    noteId,
    title: readString(note.title) || readString(note.desc) || noteId,
    durationSeconds: durationMs === undefined ? undefined : durationMs / 1000,
    candidates: Object.freeze(candidates.map(toPublicCandidate))
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

function buildCandidate(input: unknown): StreamCandidate | undefined {
  if (!isObject(input)) {
    return undefined;
  }

  const urls = [...new Set(
    [input.masterUrl, ...(Array.isArray(input.backupUrls) ? input.backupUrls : [])]
      .map(readString)
      .filter(isHttpUrl)
  )];
  if (urls.length === 0) {
    return undefined;
  }

  return Object.freeze({
    urls: Object.freeze(urls),
    codec: readString(input.videoCodec).toLowerCase(),
    width: readPositiveNumber(input.width) ?? 0,
    height: readPositiveNumber(input.height) ?? 0,
    bitrate: readPositiveNumber(input.videoBitrate) ?? readPositiveNumber(input.avgBitrate) ?? 0,
    fileSize: readPositiveNumber(input.size) ?? 0,
    durationMs: readPositiveNumber(input.duration)
  });
}

function toPublicCandidate(candidate: StreamCandidate): XiaohongshuVideoCandidate {
  return Object.freeze({
    urls: candidate.urls,
    codec: candidate.codec,
    width: candidate.width,
    height: candidate.height,
    bitrate: candidate.bitrate,
    fileSize: candidate.fileSize
  });
}

function compareCandidates(left: StreamCandidate, right: StreamCandidate): number {
  return (
    Number(isH264(right.codec)) - Number(isH264(left.codec)) ||
    right.height - left.height ||
    right.width - left.width ||
    right.bitrate - left.bitrate ||
    right.fileSize - left.fileSize
  );
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

function createDownloadError(code: string, message: string): Error {
  const error = new Error(message);
  Object.defineProperty(error, 'downloadErrorCode', { value: code, enumerable: false });
  Object.defineProperty(error, 'downloadErrorDetail', { value: code, enumerable: false });
  return error;
}

function isXiaohongshuHostname(hostname: string): boolean {
  return hostname === 'xiaohongshu.com' || hostname.endsWith('.xiaohongshu.com');
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
