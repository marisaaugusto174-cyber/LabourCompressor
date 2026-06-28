import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEventTimelineHtml,
  buildPreflightChecklistHtml,
  renderEventTimeline
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
  assert.equal((html.match(/<div class="task-list-row/gu) ?? []).length, 1);
  assert.equal(html.includes('<details'), false);
});

test('returns no markup for empty runtime sections', () => {
  assert.equal(buildPreflightChecklistHtml([]), '');
  assert.equal(buildEventTimelineHtml([]), '');
});

test('renders stale yt-dlp preflight with update guidance', () => {
  const html = buildPreflightChecklistHtml([
    {
      key: 'yt-dlp',
      ok: false,
      message: 'yt-dlp 2026.03.17 is older than 90 days; update yt-dlp before downloading Douyin videos.',
      details: {
        version: '2026.03.17',
        isStale: true,
        staleYtDlpIsNonBlocking: false
      }
    }
  ]);

  assert.equal(html.includes('更新 yt-dlp'), true);
  assert.equal(html.includes('请确认 yt-dlp 已安装并可执行。'), false);
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

test('preserves an expanded stage timeline across live updates', () => {
  const details = { open: true };
  const target = {
    innerHTML: '',
    scrollTop: 0,
    scrollHeight: 100,
    classList: { add() {}, remove() {} },
    querySelector() { return details; }
  };

  renderEventTimeline([{ phase: 'download', status: 'running', message: '下载中' }], target);

  assert.equal(details.open, true);
});
