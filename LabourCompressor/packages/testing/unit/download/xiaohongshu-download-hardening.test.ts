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
