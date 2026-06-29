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
  }, {
    rowNumber: 7,
    archiveState: '下载失败',
    failure: {
      phase: 'download',
      errorCode: 'xiaohongshu-media-type-invalid'
    }
  }, {
    rowNumber: 8,
    archiveState: '下载失败',
    failure: {
      phase: 'download',
      errorCode: 'xiaohongshu-media-truncated'
    }
  }]);

  assert.equal(html.includes('小红书笔记不是视频'), true);
  assert.equal(html.includes('重新运行任务获取新的播放地址'), true);
  assert.equal(html.includes('小红书媒体类型异常'), true);
  assert.equal(html.includes('小红书视频内容不完整'), true);
});

test('renders explicit actions for every classified primary action review failure', () => {
  const cases = [
    ['archive-primary-tag-missing', '待复核：核心动作主动作缺失', '补充唯一的核心动作主动作标签'],
    ['archive-primary-tag-conflict', '待复核：存在多个核心动作主动作', '只保留一个核心动作主动作标签'],
    ['archive-primary-tag-role-invalid', '待复核：核心动作角色不合法', '将核心动作标签角色修正为主动作'],
    ['archive-primary-tag-path-invalid', '待复核：核心动作路径不合法', '从当前标签体系中选择合法的核心动作路径'],
    ['archive-primary-tag-review-required', '待复核：核心动作无法确定', '人工确认唯一的核心动作主动作']
  ];
  const html = buildResultWorkbenchHtml(cases.map(([errorCode, archiveState], index) => ({
    rowNumber: 10 + index,
    archiveState,
    archivePath: '',
    archiveFileName: '',
    failure: { phase: 'tagging', errorCode }
  })));

  for (const [, archiveState, action] of cases) {
    assert.equal(html.includes(archiveState), true);
    assert.equal(html.includes(action), true);
  }
});
