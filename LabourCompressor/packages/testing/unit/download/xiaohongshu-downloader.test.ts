import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createXiaohongshuDownloaderAdapter,
  extractXiaohongshuNoteId,
  extractXiaohongshuVideoFromWebpage
} from '../../../adapters/downloaders/xiaohongshu-downloader.ts';
import { extractStructuredDownloadError } from '../../../adapters/downloaders/ytdlp-downloader.ts';
import { createPlatformAwareDownloaderAdapter } from '../../../adapters/downloaders/platform-aware-downloader.ts';
import {
  createDownloadRequest,
  type DownloadExecutionResult,
  type DownloadRequest,
  type DownloaderAdapter
} from '../../../features/download/domain/index.ts';

const NOTE_ID = 'abcdef0123456789abcdef01';

function renderNotePage(input: {
  readonly type?: string;
  readonly streams?: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  readonly withUndefined?: boolean;
} = {}): string {
  let state = JSON.stringify({
    note: {
      noteDetailMap: {
        [NOTE_ID]: {
          note: {
            noteId: NOTE_ID,
            type: input.type ?? 'video',
            title: '测试标题',
            optional: null,
            video: {
              media: {
                stream: input.streams ?? {
                  h265: [{
                    masterUrl: 'https://media.example/1440-hevc.mp4',
                    videoCodec: 'hevc',
                    width: 1080,
                    height: 1440,
                    videoBitrate: 5000000,
                    size: 30000000,
                    duration: 55520
                  }],
                  h264: [{
                    masterUrl: 'https://media.example/1080-h264.mp4',
                    videoCodec: 'h264',
                    width: 1080,
                    height: 1080,
                    videoBitrate: 3000000,
                    size: 20000000,
                    duration: 55520
                  }]
                }
              }
            }
          }
        }
      }
    }
  });
  if (input.withUndefined === true) {
    state = state.replace('"optional":null', '"optional":undefined');
  }
  return `<html><script>window.__INITIAL_STATE__=${state};</script></html>`;
}

test('extracts note ids from supported Xiaohongshu note paths only', () => {
  assert.equal(
    extractXiaohongshuNoteId(`https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=redacted`),
    NOTE_ID
  );
  assert.equal(
    extractXiaohongshuNoteId(`https://www.xiaohongshu.com/discovery/item/${NOTE_ID}`),
    NOTE_ID
  );
  assert.equal(extractXiaohongshuNoteId('https://www.xiaohongshu.com/user/profile/demo'), undefined);
});

test('parses initial state with undefined values and prioritizes H.264 before resolution', () => {
  const video = extractXiaohongshuVideoFromWebpage(
    renderNotePage({ withUndefined: true }),
    NOTE_ID
  );

  assert.equal(video.title, '测试标题');
  assert.equal(video.candidates[0]?.url, 'https://media.example/1080-h264.mp4');
  assert.equal(video.candidates[0]?.codec, 'h264');
  assert.equal(video.durationSeconds, 55.52);
});

test('uses backup urls and rejects image notes with a structured error', () => {
  const video = extractXiaohongshuVideoFromWebpage(renderNotePage({
    streams: {
      h264: [{
        masterUrl: 'javascript:invalid',
        backupUrls: ['https://media.example/backup.mp4'],
        videoCodec: 'h264',
        width: 720,
        height: 960
      }]
    }
  }), NOTE_ID);
  assert.equal(video.candidates[0]?.url, 'https://media.example/backup.mp4');

  assert.throws(
    () => extractXiaohongshuVideoFromWebpage(renderNotePage({ type: 'normal' }), NOTE_ID),
    (error) => extractStructuredDownloadError(error).errorCode === 'xiaohongshu-note-not-video'
  );
});

test('streams a selected Xiaohongshu MP4 into a muxed artifact and reports progress', async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'lc-xhs-'));
  const progress: number[] = [];
  const adapter = createXiaohongshuDownloaderAdapter({
    fetch: async (url) => url.includes('xiaohongshu.com')
      ? new Response(renderNotePage(), { status: 200 })
      : new Response('video-bytes', {
          status: 200,
          headers: { 'content-length': '11' }
        }),
    retryDelayMs: () => 0,
    downloadedAt: () => '2026-06-28T00:00:00.000Z'
  });
  const request = createDownloadRequest({
    taskId: 'task-xhs',
    workflowSessionId: 'workflow-xhs',
    rowNumber: 1,
    sourceUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`,
    outputDirectory,
    outputFileStem: '1-xhs'
  });

  try {
    const result = await adapter.download(request, {
      onProgress: (event) => progress.push(event.downloadedBytes ?? 0)
    });

    assert.equal(result.artifacts[0]?.kind, 'muxed-video');
    assert.equal(result.mediaMetadata.resolutionLabel, '1080P');
    assert.equal(await readFile(result.artifacts[0]?.filePath ?? '', 'utf8'), 'video-bytes');
    assert.equal(progress.at(-1), 11);
    assert.deepEqual((await readdir(outputDirectory)).filter((name) => name.endsWith('.part')), []);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('retries missing page state and refreshes expired media urls', async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'lc-xhs-retry-'));
  let pageCalls = 0;
  let mediaCalls = 0;
  const adapter = createXiaohongshuDownloaderAdapter({
    fetch: async (url) => {
      if (url.includes('xiaohongshu.com')) {
        pageCalls += 1;
        if (pageCalls === 1) {
          return new Response('<html></html>', { status: 200 });
        }
        return new Response(renderNotePage(), { status: 200 });
      }
      mediaCalls += 1;
      return mediaCalls === 1
        ? new Response('expired', { status: 403 })
        : new Response('fresh-video', { status: 200 });
    },
    retryDelayMs: () => 0
  });
  const request = createDownloadRequest({
    taskId: 'task-xhs',
    workflowSessionId: 'workflow-xhs',
    rowNumber: 1,
    sourceUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`,
    outputDirectory,
    outputFileStem: '1-xhs'
  });

  try {
    const result = await adapter.download(request);
    assert.equal(await readFile(result.artifacts[0]?.filePath ?? '', 'utf8'), 'fresh-video');
    assert.equal(pageCalls, 3);
    assert.equal(mediaCalls, 2);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('does not retry a missing Xiaohongshu note page', async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'lc-xhs-404-'));
  let pageCalls = 0;
  const adapter = createXiaohongshuDownloaderAdapter({
    fetch: async () => {
      pageCalls += 1;
      return new Response('missing', { status: 404 });
    },
    retryDelayMs: () => 0
  });
  const request = createDownloadRequest({
    taskId: 'task-xhs',
    workflowSessionId: 'workflow-xhs',
    rowNumber: 1,
    sourceUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`,
    outputDirectory,
    outputFileStem: '1-xhs'
  });

  try {
    await assert.rejects(adapter.download(request));
    assert.equal(pageCalls, 1);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('refreshes an expired Xiaohongshu media url only once', async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'lc-xhs-expired-'));
  let pageCalls = 0;
  let mediaCalls = 0;
  const adapter = createXiaohongshuDownloaderAdapter({
    fetch: async (url) => {
      if (url.includes('xiaohongshu.com')) {
        pageCalls += 1;
        return new Response(renderNotePage(), { status: 200 });
      }
      mediaCalls += 1;
      return new Response('expired', { status: 403 });
    },
    retryDelayMs: () => 0
  });
  const request = createDownloadRequest({
    taskId: 'task-xhs',
    workflowSessionId: 'workflow-xhs',
    rowNumber: 1,
    sourceUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`,
    outputDirectory,
    outputFileStem: '1-xhs'
  });

  try {
    await assert.rejects(adapter.download(request));
    assert.equal(pageCalls, 2);
    assert.equal(mediaCalls, 2);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('removes partial files when a Xiaohongshu download is cancelled', async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'lc-xhs-cancel-'));
  const controller = new AbortController();
  const adapter = createXiaohongshuDownloaderAdapter({
    fetch: async (url) => {
      if (url.includes('xiaohongshu.com')) {
        return new Response(renderNotePage(), { status: 200 });
      }
      const stream = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode('partial'));
          controller.abort();
        }
      });
      return new Response(stream, { status: 200 });
    },
    retryDelayMs: () => 0
  });
  const request = createDownloadRequest({
    taskId: 'task-xhs',
    workflowSessionId: 'workflow-xhs',
    rowNumber: 1,
    sourceUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`,
    outputDirectory,
    outputFileStem: '1-xhs'
  });

  try {
    await assert.rejects(adapter.download(request, { signal: controller.signal }), /cancel|abort/iu);
    assert.deepEqual(await readdir(outputDirectory), []);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('uses the Xiaohongshu page adapter only after yt-dlp reports no formats', async () => {
  const request = createDownloadRequest({
    taskId: 'task-xhs',
    workflowSessionId: 'workflow-xhs',
    rowNumber: 1,
    sourceUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`,
    outputDirectory: '/tmp',
    outputFileStem: '1-xhs'
  });
  const calls: string[] = [];
  const adapter = createPlatformAwareDownloaderAdapter({
    fallback: createThrowingAdapter('xiaohongshu-no-formats', calls, 'yt-dlp'),
    xiaohongshu: createResultAdapter(calls, 'page')
  });

  const result = await adapter.download(request);

  assert.equal(result.request.platform, 'xiaohongshu');
  assert.deepEqual(calls, ['yt-dlp', 'page']);
});

test('does not use the Xiaohongshu page adapter for unrelated yt-dlp failures', async () => {
  const request = createDownloadRequest({
    taskId: 'task-xhs',
    workflowSessionId: 'workflow-xhs',
    rowNumber: 1,
    sourceUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`,
    outputDirectory: '/tmp',
    outputFileStem: '1-xhs'
  });
  const calls: string[] = [];
  const adapter = createPlatformAwareDownloaderAdapter({
    fallback: createThrowingAdapter('platform-rate-limited', calls, 'yt-dlp'),
    xiaohongshu: createResultAdapter(calls, 'page')
  });

  await assert.rejects(
    adapter.download(request),
    (error) => extractStructuredDownloadError(error).errorCode === 'platform-rate-limited'
  );
  assert.deepEqual(calls, ['yt-dlp']);
});

function createThrowingAdapter(
  code: string,
  calls: string[],
  label: string
): DownloaderAdapter {
  return {
    async download(): Promise<DownloadExecutionResult> {
      calls.push(label);
      const error = new Error(code);
      Object.defineProperty(error, 'downloadErrorCode', { value: code });
      throw error;
    }
  };
}

function createResultAdapter(calls: string[], label: string): DownloaderAdapter {
  return {
    async download(request: DownloadRequest): Promise<DownloadExecutionResult> {
      calls.push(label);
      return {
        request,
        artifacts: [],
        downloadedAt: '2026-06-28T00:00:00.000Z',
        mediaMetadata: { sourceTitle: request.fallbackTitle }
      };
    }
  };
}
