import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildResultWorkbenchHtml,
  classifyResult
} from '../../../../apps/web/public/results-view.js';

const succeeded = {
  rowNumber: 2,
  archiveFileName: '成功.mp4',
  archivePath: '/archive/成功.mp4',
  archiveState: '已归档'
};

const failed = {
  rowNumber: 3,
  archiveFileName: '失败.mp4',
  archiveState: '下载失败',
  failure: { phase: 'download', errorCode: 'download-failed' }
};

const pending = {
  rowNumber: 4,
  archiveFileName: '待剪辑.mp4',
  archiveState: '已下载待剪辑'
};

test('classifies successful, failed, and pending results', () => {
  assert.equal(classifyResult(succeeded), 'succeeded');
  assert.equal(classifyResult(failed), 'failed');
  assert.equal(classifyResult(pending), 'pending');
});

test('keeps successful complete results collapsed with no empty next-step label', () => {
  const html = buildResultWorkbenchHtml([succeeded], '/tmp/current-results.xlsx');

  assert.match(html, /总数\s*1/u);
  assert.match(html, /成功\s*1/u);
  assert.match(html, /失败\s*0/u);
  assert.match(html, /待处理\s*0/u);
  assert.match(html, /<details class="result-all">/u);
  assert.doesNotMatch(html, /<details class="result-all" open>/u);
  assert.equal(html.includes('本次结果表：/tmp/current-results.xlsx'), true);
  assert.equal(html.includes('无'), false);
  assert.equal(html.includes('无需处理'), false);
});

test('opens problem results and limits them to failed and pending items', () => {
  const html = buildResultWorkbenchHtml([succeeded, failed, pending]);
  const problems = html.match(/<details class="result-problems" open>([\s\S]*?)<\/details>/u)?.[1] ?? '';

  assert.equal(problems.includes('失败.mp4'), true);
  assert.equal(problems.includes('待剪辑.mp4'), true);
  assert.equal(problems.includes('成功.mp4'), false);
  assert.equal(problems.includes('下载未完成'), true);
  assert.equal(problems.includes('等待你把剪辑后的导出文件'), true);
  assert.match(html, /<details class="result-all">/u);
});

test('renders actionable Xiaohongshu download failures', () => {
  const html = buildResultWorkbenchHtml([{
    rowNumber: 5,
    archiveState: '下载失败',
    failure: {
      phase: 'download',
      errorCode: 'xiaohongshu-note-not-video'
    }
  }, {
    rowNumber: 6,
    archiveState: '下载失败',
    failure: {
      phase: 'download',
      errorCode: 'xiaohongshu-play-url-expired'
    }
  }]);

  assert.equal(html.includes('小红书笔记不是视频'), true);
  assert.equal(html.includes('重新运行任务获取新的播放地址'), true);
});
