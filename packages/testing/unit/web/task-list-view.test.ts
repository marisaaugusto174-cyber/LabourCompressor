import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEventTimelineHtml,
  buildPreflightChecklistHtml
} from '../../../../apps/web/public/task-list-view.js';

test('renders only failed preflight checks by default', () => {
  const html = buildPreflightChecklistHtml([
    {
      key: 'provider',
      ok: false,
      message: 'Qwen provider is not reachable.',
      details: { model: 'qwen3.6-plus' }
    },
    {
      key: 'yt-dlp',
      ok: true,
      message: 'yt-dlp is available.'
    }
  ]);

  assert.equal(html.includes('"key":'), false);
  assert.equal(html.includes('模型 API'), true);
  assert.equal(html.includes('未通过'), true);
  assert.equal(html.includes('检查模型 API Key、额度和网络连通性。'), true);
  assert.equal(html.includes('下载器'), false);
});

test('renders all-green preflight as a single success message', () => {
  const html = buildPreflightChecklistHtml([
    {
      key: 'provider',
      ok: true,
      message: 'Qwen provider is reachable.'
    },
    {
      key: 'yt-dlp',
      ok: true,
      message: 'yt-dlp is available.'
    }
  ]);

  assert.equal(html.includes('Preflight 通过，可以启动任务'), true);
  assert.equal(html.includes('yt-dlp is available'), false);
  assert.equal(html.includes('Qwen provider is reachable'), false);
});

test('renders task events as compact phase timeline', () => {
  const html = buildEventTimelineHtml([
    {
      phase: 'download',
      status: 'running',
      message: 'Downloading row 2',
      currentItem: '样本A.mp4',
      progress: { current: 1, total: 20 },
      timestamp: '2026-05-04T10:00:00.000Z'
    },
    {
      phase: 'tagging-item',
      status: 'running',
      message: 'Tagging row 2',
      currentItem: '样本A.mp4',
      timestamp: '2026-05-04T10:01:00.000Z'
    },
    {
      phase: 'segmentation',
      status: 'running',
      message: 'Segmenting row 2',
      currentItem: '样本A.mp4',
      timestamp: '2026-05-04T10:01:10.000Z'
    }
  ]);

  assert.equal(html.includes('[running]'), false);
  assert.equal(html.includes('查看阶段详情'), true);
  assert.equal(html.includes('下载中'), true);
  assert.equal(html.includes('1/20'), true);
  assert.equal(html.includes('打标中'), true);
  assert.equal(html.includes('自动分割中'), true);
  assert.equal(html.includes('样本A.mp4'), true);
});
