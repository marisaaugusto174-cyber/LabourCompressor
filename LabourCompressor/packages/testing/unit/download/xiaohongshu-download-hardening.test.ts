import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createXiaohongshuDownloaderAdapter
} from '../../../adapters/downloaders/xiaohongshu-downloader.ts';
import { extractStructuredDownloadError } from '../../../adapters/downloaders/ytdlp-downloader.ts';
import { createDownloadRequest } from '../../../features/download/domain/index.ts';

const NOTE_ID = 'abcdef0123456789abcdef01';
const MASTER_URL = 'https://media.example/master.mp4';
const BACKUP_URL = 'https://media.example/backup.mp4';

test('uses a same-page backup url after the master url expires', async () => {
  await withOutputDirectory(async (outputDirectory) => {
    let pageCalls = 0;
    const mediaUrls: string[] = [];
    const adapter = createXiaohongshuDownloaderAdapter({
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('xiaohongshu.com')) {
          pageCalls += 1;
          return new Response(renderNotePage(), { status: 200 });
        }
        mediaUrls.push(url);
        return url === MASTER_URL
          ? new Response('expired', { status: 403 })
          : new Response('backup-video', { status: 200 });
      },
      retryDelayMs: () => 0
    });

    const result = await adapter.download(createRequest(outputDirectory));

    assert.equal(await readFile(result.artifacts[0]?.filePath ?? '', 'utf8'), 'backup-video');
    assert.equal(pageCalls, 1);
    assert.deepEqual(mediaUrls, [MASTER_URL, BACKUP_URL]);
  });
});

test('refreshes the page only once after all media urls fail', async () => {
  await withOutputDirectory(async (outputDirectory) => {
    let pageCalls = 0;
    let mediaCalls = 0;
    const adapter = createXiaohongshuDownloaderAdapter({
      fetch: async (input) => {
        if (String(input).includes('xiaohongshu.com')) {
          pageCalls += 1;
          return new Response(renderNotePage(), { status: 200 });
        }
        mediaCalls += 1;
        return new Response('expired', { status: 403 });
      },
      retryDelayMs: () => 0
    });

    await assert.rejects(adapter.download(createRequest(outputDirectory)));

    assert.equal(pageCalls, 2);
    assert.equal(mediaCalls, 4);
    assert.deepEqual(await readdir(outputDirectory), []);
  });
});

test('reports media HTTP 429 as platform rate limiting without refreshing the page', async () => {
  await withOutputDirectory(async (outputDirectory) => {
    let pageCalls = 0;
    let mediaCalls = 0;
    const adapter = createXiaohongshuDownloaderAdapter({
      fetch: async (input) => {
        if (String(input).includes('xiaohongshu.com')) {
          pageCalls += 1;
          return new Response(renderNotePage(), { status: 200 });
        }
        mediaCalls += 1;
        return new Response('limited', { status: 429 });
      },
      retryDelayMs: () => 0
    });

    await assert.rejects(
      adapter.download(createRequest(outputDirectory)),
      (error) => extractStructuredDownloadError(error).errorCode === 'platform-rate-limited'
    );
    assert.equal(pageCalls, 1);
    assert.equal(mediaCalls, 1);
  });
});

test('rejects an HTML challenge response and uses the backup media url', async () => {
  await withOutputDirectory(async (outputDirectory) => {
    const mediaUrls: string[] = [];
    const progress: number[] = [];
    const adapter = createXiaohongshuDownloaderAdapter({
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('xiaohongshu.com')) {
          return new Response(renderNotePage(), { status: 200 });
        }
        mediaUrls.push(url);
        return url === MASTER_URL
          ? new Response('<html>challenge</html>', {
              status: 200,
              headers: { 'content-type': 'text/html' }
            })
          : new Response('backup-video', {
              status: 200,
              headers: { 'content-type': 'video/mp4' }
            });
      },
      retryDelayMs: () => 0
    });

    const result = await adapter.download(createRequest(outputDirectory), {
      onProgress: (event) => progress.push(event.downloadedBytes ?? 0)
    });

    assert.equal(await readFile(result.artifacts[0]?.filePath ?? '', 'utf8'), 'backup-video');
    assert.deepEqual(mediaUrls, [MASTER_URL, BACKUP_URL]);
    assert.deepEqual(progress.slice(0, 2), [0, 0]);
  });
});

test('rejects JSON challenge responses without creating a final artifact', async () => {
  await withOutputDirectory(async (outputDirectory) => {
    let mediaCalls = 0;
    const adapter = createXiaohongshuDownloaderAdapter({
      fetch: async (input) => {
        if (String(input).includes('xiaohongshu.com')) {
          return new Response(renderNotePage(), { status: 200 });
        }
        mediaCalls += 1;
        return new Response('{"challenge":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      },
      retryDelayMs: () => 0
    });

    await assert.rejects(
      adapter.download(createRequest(outputDirectory)),
      (error) => extractStructuredDownloadError(error).errorCode ===
        'xiaohongshu-media-type-invalid'
    );

    assert.equal(mediaCalls, 4);
    assert.deepEqual(await readdir(outputDirectory), []);
  });
});

test('rejects truncated media, caps progress, and removes partial files', async () => {
  await withOutputDirectory(async (outputDirectory) => {
    let mediaCalls = 0;
    const progress: number[] = [];
    const adapter = createXiaohongshuDownloaderAdapter({
      fetch: async (input) => {
        if (String(input).includes('xiaohongshu.com')) {
          return new Response(renderNotePage(), { status: 200 });
        }
        mediaCalls += 1;
        return new Response('short', {
          status: 200,
          headers: {
            'content-type': 'video/mp4',
            'content-length': '4'
          }
        });
      },
      retryDelayMs: () => 0
    });

    await assert.rejects(
      adapter.download(createRequest(outputDirectory), {
        onProgress: (event) => progress.push(event.percent ?? 0)
      }),
      (error) => extractStructuredDownloadError(error).errorCode ===
        'xiaohongshu-media-truncated'
    );

    assert.equal(mediaCalls, 4);
    assert.equal(progress.every((percent) => percent <= 100), true);
    assert.deepEqual(await readdir(outputDirectory), []);
  });
});

test('removes abort listeners after retry delay and media streaming complete', async () => {
  await withOutputDirectory(async (outputDirectory) => {
    const controller = new AbortController();
    const signal = controller.signal;
    const originalAdd = signal.addEventListener.bind(signal);
    const originalRemove = signal.removeEventListener.bind(signal);
    let added = 0;
    let removed = 0;
    let pageCalls = 0;

    Object.defineProperty(signal, 'addEventListener', {
      value: (...args: Parameters<AbortSignal['addEventListener']>) => {
        if (args[0] === 'abort') added += 1;
        return originalAdd(...args);
      }
    });
    Object.defineProperty(signal, 'removeEventListener', {
      value: (...args: Parameters<AbortSignal['removeEventListener']>) => {
        if (args[0] === 'abort') removed += 1;
        return originalRemove(...args);
      }
    });

    const adapter = createXiaohongshuDownloaderAdapter({
      fetch: async (input) => {
        if (String(input).includes('xiaohongshu.com')) {
          pageCalls += 1;
          return pageCalls === 1
            ? new Response('<html></html>', { status: 200 })
            : new Response(renderNotePage(), { status: 200 });
        }
        return new Response('video', {
          status: 200,
          headers: { 'content-type': 'video/mp4' }
        });
      },
      retryDelayMs: () => 1
    });

    await adapter.download(createRequest(outputDirectory), { signal });

    assert.equal(added > 0, true);
    assert.equal(removed, added);
  });
});

test('does not retry another media url after download cancellation', async () => {
  await withOutputDirectory(async (outputDirectory) => {
    const controller = new AbortController();
    let mediaCalls = 0;
    const adapter = createXiaohongshuDownloaderAdapter({
      fetch: async (input) => {
        if (String(input).includes('xiaohongshu.com')) {
          return new Response(renderNotePage(), { status: 200 });
        }
        mediaCalls += 1;
        const stream = new ReadableStream<Uint8Array>({
          start(streamController) {
            streamController.enqueue(new TextEncoder().encode('partial'));
            controller.abort();
          }
        });
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'video/mp4' }
        });
      },
      retryDelayMs: () => 0
    });

    await assert.rejects(
      adapter.download(createRequest(outputDirectory), { signal: controller.signal }),
      /cancel|abort/iu
    );

    assert.equal(mediaCalls, 1);
    assert.deepEqual(await readdir(outputDirectory), []);
  });
});

function renderNotePage(): string {
  const state = {
    note: {
      noteDetailMap: {
        [NOTE_ID]: {
          note: {
            noteId: NOTE_ID,
            type: 'video',
            title: '测试标题',
            video: {
              media: {
                stream: {
                  h264: [{
                    masterUrl: MASTER_URL,
                    backupUrls: [BACKUP_URL],
                    videoCodec: 'h264',
                    width: 1080,
                    height: 1440
                  }]
                }
              }
            }
          }
        }
      }
    }
  };
  return `<html><script>window.__INITIAL_STATE__=${JSON.stringify(state)};</script></html>`;
}

function createRequest(outputDirectory: string) {
  return createDownloadRequest({
    taskId: 'task-xhs-hardening',
    workflowSessionId: 'workflow-xhs-hardening',
    rowNumber: 1,
    sourceUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`,
    outputDirectory,
    outputFileStem: '1-xhs'
  });
}

async function withOutputDirectory(
  run: (outputDirectory: string) => Promise<void>
): Promise<void> {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'lc-xhs-hardening-'));
  try {
    await run(outputDirectory);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}
