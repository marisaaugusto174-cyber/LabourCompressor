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
