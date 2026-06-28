import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createDouyinSsrDownloaderAdapter,
  extractDouyinSsrVideo,
  extractDouyinVideoId
} from '../../../adapters/downloaders/douyin-ssr-downloader.ts';
import {
  extractStructuredDownloadError
} from '../../../adapters/downloaders/ytdlp-downloader.ts';
import {
  createPlatformAwareDownloaderAdapter
} from '../../../adapters/downloaders/platform-aware-downloader.ts';
import {
  createDownloadRequest,
  type DownloadExecutionResult,
  type DownloadRequest
} from '../../../features/download/domain/index.ts';

function renderSsrHtml(videoDetail: Record<string, unknown>): string {
  return `<html><body><script id="RENDER_DATA" type="application/json">${encodeURIComponent(
    JSON.stringify({
      app: {
        videoDetail
      }
    })
  )}</script></body></html>`;
}

function buildVideoDetail(input: {
  readonly awemeId?: string;
  readonly bitRateList?: readonly Record<string, unknown>[];
  readonly video?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  return {
    awemeId: input.awemeId ?? '7626356963336670504',
    desc: '自学剪辑二十二天，一分钟学会蒙版雨刷转场',
    video: {
      duration: 79000,
      width: 1920,
      height: 1080,
      playAddr: [
        {
          src: 'https://v.example.com/default-1080.mp4'
        }
      ],
      ...(input.video ?? {}),
      bitRateList: input.bitRateList ?? [
        {
          width: 1920,
          height: 1080,
          dataSize: 1000,
          bitRate: 1000,
          isH265: 0,
          format: 'mp4',
          playAddr: [
            {
              src: 'https://v.example.com/1080-h264.mp4'
            }
          ]
        },
        {
          width: 2560,
          height: 1440,
          dataSize: 900,
          bitRate: 900,
          isH265: 1,
          format: 'mp4',
          playAddr: [
            {
              src: 'https://v.example.com/1440-h265.mp4'
            }
          ]
        },
        {
          width: 2560,
          height: 1440,
          dataSize: 1200,
          bitRate: 1200,
          isH265: 0,
          format: 'mp4',
          playAddr: [
            {
              src: 'https://v.example.com/1440-h264.mp4'
            }
          ]
        }
      ]
    }
  };
}

test('extracts douyin video ids from supported url shapes', () => {
  assert.equal(
    extractDouyinVideoId('https://www.douyin.com/jingxuan?modal_id=7626356963336670504'),
    '7626356963336670504'
  );
  assert.equal(
    extractDouyinVideoId('https://www.douyin.com/video/7626356963336670504'),
    '7626356963336670504'
  );
  assert.equal(
    extractDouyinVideoId('https://www.douyin.com/shipin/7626356963336670504'),
    '7626356963336670504'
  );
  assert.equal(
    extractDouyinVideoId('https://www.iesdouyin.com/share/video/7626356963336670504/?region=CN'),
    '7626356963336670504'
  );
});

test('extracts ssr video metadata and selects the best mp4 playback url', () => {
  const parsed = extractDouyinSsrVideo(renderSsrHtml(buildVideoDetail()));

  assert.equal(parsed.awemeId, '7626356963336670504');
  assert.equal(parsed.title, '自学剪辑二十二天，一分钟学会蒙版雨刷转场');
  assert.equal(parsed.durationSeconds, 79);
  assert.equal(parsed.resolutionLabel, '1440P');
  assert.equal(parsed.playUrl, 'https://v.example.com/1440-h264.mp4');
});

test('falls back to top-level playAddr when ssr bitrate list is absent', () => {
  const parsed = extractDouyinSsrVideo(renderSsrHtml(buildVideoDetail({
    bitRateList: [],
    video: {
      playAddr: [
        {
          src: 'https://v.example.com/fallback.mp4'
        }
      ]
    }
  })));

  assert.equal(parsed.playUrl, 'https://v.example.com/fallback.mp4');
});

test('douyin ssr downloader writes a muxed mp4 artifact', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'labour-compressor-douyin-'));
  const request = createDownloadRequest({
    taskId: 'task-1',
    workflowSessionId: 'workflow-1',
    rowNumber: 1,
    sourceUrl: 'https://www.douyin.com/jingxuan?modal_id=7626356963336670504',
    outputDirectory: tempDir,
    outputFileStem: '1-douyin'
  });
  const fetchLog: string[] = [];
  const adapter = createDouyinSsrDownloaderAdapter({
    fetch: async (url) => {
      fetchLog.push(url);
      if (url.includes('jingxuan')) {
        return createTextResponse(renderSsrHtml(buildVideoDetail()));
      }
      return createBinaryResponse(Buffer.from('mp4-bytes'));
    },
    downloadedAt: () => '2026-06-25T03:19:00.000Z'
  });

  try {
    const result = await adapter.download(request);

    assert.equal(fetchLog[0], 'https://www.douyin.com/jingxuan?modal_id=7626356963336670504');
    assert.equal(fetchLog[1], 'https://v.example.com/1440-h264.mp4');
    assert.equal(result.artifacts[0]?.kind, 'muxed-video');
    assert.equal(result.mediaMetadata.resolutionLabel, '1440P');
    assert.equal(await readFile(result.artifacts[0]?.filePath ?? '', 'utf8'), 'mp4-bytes');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('douyin ssr downloader reports unavailable ssr and expired playback urls', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'labour-compressor-douyin-'));
  const request = createDownloadRequest({
    taskId: 'task-1',
    workflowSessionId: 'workflow-1',
    rowNumber: 1,
    sourceUrl: 'https://www.douyin.com/video/7626356963336670504',
    outputDirectory: tempDir,
    outputFileStem: '1-douyin'
  });

  try {
    await assert.rejects(
      createDouyinSsrDownloaderAdapter({
        fetch: async () => createTextResponse('<html></html>')
      }).download(request),
      (error) => extractStructuredDownloadError(error).errorCode === 'douyin-ssr-unavailable'
    );

    await assert.rejects(
      createDouyinSsrDownloaderAdapter({
        fetch: async (url) => url.includes('jingxuan')
          ? createTextResponse(renderSsrHtml(buildVideoDetail()))
          : createTextResponse('forbidden', { ok: false, status: 403 })
      }).download(request),
      (error) => extractStructuredDownloadError(error).errorCode === 'douyin-play-url-expired'
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('douyin ssr downloader retries transient missing render data before failing over', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'labour-compressor-douyin-retry-'));
  const request = createDownloadRequest({
    taskId: 'task-1',
    workflowSessionId: 'workflow-1',
    rowNumber: 1,
    sourceUrl: 'https://www.douyin.com/video/7626356963336670504',
    outputDirectory: tempDir,
    outputFileStem: '1-douyin'
  });
  let ssrCalls = 0;

  try {
    const result = await createDouyinSsrDownloaderAdapter({
      fetch: async (url) => {
        if (url.includes('jingxuan')) {
          ssrCalls += 1;
          return ssrCalls < 3
            ? createTextResponse('<html></html>')
            : createTextResponse(renderSsrHtml(buildVideoDetail()));
        }

        return createBinaryResponse(Buffer.from('retry-mp4'));
      },
      retryDelayMs: () => 0,
      downloadedAt: () => '2026-06-25T04:00:00.000Z'
    }).download(request);

    assert.equal(ssrCalls, 3);
    assert.equal(await readFile(result.artifacts[0]?.filePath ?? '', 'utf8'), 'retry-mp4');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('platform aware downloader uses douyin ssr first and falls back to yt-dlp', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'labour-compressor-platform-'));
  const douyinRequest = createDownloadRequest({
    taskId: 'task-1',
    workflowSessionId: 'workflow-1',
    rowNumber: 1,
    sourceUrl: 'https://www.douyin.com/video/7626356963336670504',
    outputDirectory: tempDir,
    outputFileStem: '1-douyin'
  });
  const youtubeRequest = createDownloadRequest({
    taskId: 'task-2',
    workflowSessionId: 'workflow-1',
    rowNumber: 2,
    sourceUrl: 'https://www.youtube.com/watch?v=abc',
    outputDirectory: tempDir,
    outputFileStem: '2-youtube'
  });
  const fallbackCalls: string[] = [];
  const fallback = {
    async download(request: DownloadRequest): Promise<DownloadExecutionResult> {
      fallbackCalls.push(request.normalizedUrl);
      const filePath = path.join(request.outputDirectory, `${request.outputFileStem}.mp4`);
      await writeFile(filePath, 'fallback-mp4', 'utf8');
      return {
        request,
        artifacts: [
          {
            kind: 'muxed-video',
            filePath,
            fileName: path.basename(filePath),
            container: 'mp4'
          }
        ],
        downloadedAt: '2026-06-25T03:20:00.000Z',
        mediaMetadata: {
          sourceTitle: request.fallbackTitle
        }
      };
    }
  };

  try {
    const adapter = createPlatformAwareDownloaderAdapter({
      douyin: createDouyinSsrDownloaderAdapter({
        fetch: async (url) => url.includes('jingxuan')
          ? createTextResponse(renderSsrHtml(buildVideoDetail()))
          : createBinaryResponse(Buffer.from('ssr-mp4')),
        downloadedAt: () => '2026-06-25T03:19:00.000Z'
      }),
      fallback
    });
    const douyinResult = await adapter.download(douyinRequest);
    const youtubeResult = await adapter.download(youtubeRequest);

    assert.equal(await readFile(douyinResult.artifacts[0]?.filePath ?? '', 'utf8'), 'ssr-mp4');
    assert.equal(youtubeResult.artifacts[0]?.fileName, '2-youtube.mp4');
    assert.deepEqual(fallbackCalls, ['https://www.youtube.com/watch?v=abc']);

    const fallbackAdapter = createPlatformAwareDownloaderAdapter({
      cookiesFilePath: '/tmp/douyin.txt',
      douyin: createDouyinSsrDownloaderAdapter({
        fetch: async () => createTextResponse('<html></html>')
      }),
      fallback
    });
    await fallbackAdapter.download(douyinRequest);
    assert.deepEqual(fallbackCalls, [
      'https://www.youtube.com/watch?v=abc',
      'https://www.douyin.com/video/7626356963336670504'
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('platform aware downloader reports missing credentials when douyin ssr needs cookies before yt-dlp fallback', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'labour-compressor-douyin-credentials-'));
  const request = createDownloadRequest({
    taskId: 'task-1',
    workflowSessionId: 'workflow-1',
    rowNumber: 1,
    sourceUrl: 'https://www.douyin.com/video/7626356963336670504',
    outputDirectory: tempDir,
    outputFileStem: '1-douyin'
  });
  let fallbackCalled = false;

  try {
    const adapter = createPlatformAwareDownloaderAdapter({
      douyin: createDouyinSsrDownloaderAdapter({
        fetch: async () => createTextResponse('<html></html>')
      }),
      fallback: {
        async download(): Promise<DownloadExecutionResult> {
          fallbackCalled = true;
          throw new Error('fallback should not run');
        }
      }
    });

    await assert.rejects(
      adapter.download(request),
      (error) => extractStructuredDownloadError(error).errorCode === 'missing-credentials'
    );
    assert.equal(fallbackCalled, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function createTextResponse(
  body: string,
  input: { readonly ok?: boolean; readonly status?: number } = {}
) {
  return {
    ok: input.ok ?? true,
    status: input.status ?? 200,
    async text() {
      return body;
    },
    async arrayBuffer() {
      return Buffer.from(body).buffer;
    }
  };
}

function createBinaryResponse(body: Buffer) {
  return {
    ok: true,
    status: 200,
    async text() {
      return body.toString('utf8');
    },
    async arrayBuffer() {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    }
  };
}
