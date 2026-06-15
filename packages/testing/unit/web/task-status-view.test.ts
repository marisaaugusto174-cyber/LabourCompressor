import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initTaskStatusView,
  renderLiveEvent,
  renderTaskStatus,
  updateSourceModeLabel
} from '../../../../apps/web/public/task-status-view.js';

test('task status view displays auto segmentation source and phases', () => {
  const refs = createRefs();
  initTaskStatusView({
    refs,
    getDefaults: () => ({ modelProfiles: [] }),
    getFieldValue: (name) => name === 'autoSegmentation' ? 'true' : '',
    getSelectedModelLabel: () => '测试模型'
  });

  updateSourceModeLabel();
  renderLiveEvent({
    phase: 'segmentation',
    status: 'running',
    message: 'Segmenting',
    currentItem: '样本A.mp4'
  });

  assert.equal(refs.statusSource.textContent, '下载后自动分割');
  assert.equal(refs.statusPhase.textContent, '自动分割中');
  assert.equal(refs.statusOverall.textContent, '自动分割中');
});

test('task status view marks problem clips as pending manual handling', () => {
  const refs = createRefs();
  initTaskStatusView({
    refs,
    getDefaults: () => ({ modelProfiles: [] }),
    getFieldValue: () => '',
    getSelectedModelLabel: () => '测试模型'
  });

  renderTaskStatus({
    status: 'succeeded',
    options: { autoSegmentation: true },
    result: {
      results: [
        {
          archiveState: '自动分割待处理'
        }
      ]
    }
  });

  assert.equal(refs.statusSource.textContent, '下载后自动分割');
  assert.equal(refs.statusOverall.textContent, '自动分割待处理');
  assert.equal(refs.statusNextAction.textContent, '处理问题片段');
});

test('task status view displays download count, speed and eta', () => {
  const refs = createRefs();
  initTaskStatusView({
    refs,
    getDefaults: () => ({ modelProfiles: [] }),
    getFieldValue: () => '',
    getSelectedModelLabel: () => '测试模型'
  });

  renderLiveEvent({
    phase: 'download',
    status: 'running',
    message: 'Downloading row 53 of 55',
    currentItem: '样本A.mp4',
    progress: { current: 53, total: 55 },
    details: {
      downloadSpeed: '1.24MiB/s',
      downloadEta: '00:18'
    }
  });

  assert.equal(refs.statusProgress.textContent, '53/55 (96%) · 1.24MiB/s · ETA 00:18');
});

test('task status view maps paused and cancelled task statuses', () => {
  const refs = createRefs();
  initTaskStatusView({
    refs,
    getDefaults: () => ({ modelProfiles: [] }),
    getFieldValue: () => '',
    getSelectedModelLabel: () => '测试模型'
  });

  renderTaskStatus({ status: 'paused', options: {}, result: { results: [] } });
  assert.equal(refs.statusOverall.textContent, '已暂停');
  assert.equal(refs.statusNextAction.textContent, '恢复任务或强制停止');

  renderTaskStatus({ status: 'cancelled', options: {}, result: { results: [] } });
  assert.equal(refs.statusOverall.textContent, '已取消');
});

function createRefs() {
  return {
    statusOverall: createTextRef(),
    statusPhase: createTextRef(),
    statusItem: createTextRef(),
    statusProgress: createTextRef(),
    statusModel: createTextRef(),
    statusSource: createTextRef(),
    statusPlatform: createTextRef(),
    statusNextAction: createTextRef()
  };
}

function createTextRef() {
  return { textContent: '' };
}
