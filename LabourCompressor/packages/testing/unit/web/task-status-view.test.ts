import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyTaskControlState,
  bindTaskControlActions,
  deriveActionVisibility,
  deriveTaskControlState,
  initTaskStatusView,
  renderLiveEvent,
  renderStatusMessage,
  renderTaskStatus,
  resetStatusShell,
  updatePlatformLabel,
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

test('task status view displays local media source mode', () => {
  const refs = createRefs();
  initTaskStatusView({
    refs,
    getDefaults: () => ({ modelProfiles: [] }),
    getFieldValue: (name) => name === 'sourceMode' ? 'local' : '',
    getSelectedModelLabel: () => '测试模型'
  });

  updateSourceModeLabel();
  updatePlatformLabel();

  assert.equal(refs.statusSource.textContent, '本地素材导入');
  assert.equal(refs.statusPlatform.textContent, '本地文件');
  assert.equal(refs.statusPlatform.hidden, false);
});

test('task status view labels Xiaohongshu spreadsheet sources', () => {
  const refs = createRefs();
  initTaskStatusView({
    refs,
    getDefaults: () => ({ modelProfiles: [] }),
    getFieldValue: (name) => name === 'spreadsheet'
      ? 'https://www.xiaohongshu.com/explore/abc123'
      : '',
    getSelectedModelLabel: () => '测试模型'
  });

  updatePlatformLabel();

  assert.equal(refs.statusPlatform.textContent, '小红书');
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
  assert.equal(refs.statusNextAction.hidden, false);
});

test('completed task with unfinished rows reports pending work instead of archive success', () => {
  const refs = createRefs();
  initTaskStatusView(createOptions(refs));

  renderTaskStatus({
    id: 'task-1',
    status: 'succeeded',
    options: {},
    result: { results: [{ archiveState: '待归档' }] }
  });

  assert.equal(refs.statusOverall.textContent, '存在待处理项');
  assert.equal(refs.statusNextAction.textContent, '处理待处理项');
  assert.equal(refs.statusNextAction.hidden, false);
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

  assert.equal(refs.statusProgress.textContent, '53 / 55 · 96% · 1.24MiB/s · ETA 00:18');
  assert.equal(refs.statusProgressBar.style.width, '96%');
  assert.equal(refs.statusProgressTrack.attributes['aria-valuenow'], '96');
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

test('task status hides empty presentation before a task starts', () => {
  const refs = createRefs();
  initTaskStatusView(createOptions(refs));
  resetStatusShell();

  assert.equal(refs.taskIdleState.hidden, false);
  assert.equal(refs.taskActiveState.hidden, true);
  assert.equal(refs.statusCurrent.hidden, true);
  assert.equal(refs.statusNextAction.hidden, true);
  assert.equal(refs.statusItem.textContent, '');
  assert.equal(refs.statusProgress.textContent, '');
  assert.equal(refs.debugRecoveryPanel.hidden, true);
});

test('task status renders structured running progress and context', () => {
  const refs = createRefs();
  initTaskStatusView(createOptions(refs));
  renderLiveEvent({
    phase: 'download',
    status: 'running',
    currentItem: 'very-long-video-name.mp4',
    progress: { current: 53, total: 55 }
  });

  assert.equal(refs.taskIdleState.hidden, true);
  assert.equal(refs.taskActiveState.hidden, false);
  assert.equal(refs.statusCurrent.hidden, false);
  assert.equal(refs.statusItem.title, 'very-long-video-name.mp4');
  assert.equal(refs.statusProgress.textContent, '53 / 55 · 96%');
  assert.equal(refs.statusProgressTrack.hidden, false);
  assert.equal(refs.statusProgressBar.style.width, '96%');
  assert.equal(refs.statusProgressTrack.attributes['aria-valuenow'], '96');
  assert.equal(refs.debugRecoveryPanel.hidden, false);
});

test('task status renders queued and failed tasks without waiting for an event', () => {
  const refs = createRefs();
  initTaskStatusView(createOptions(refs));

  renderTaskStatus({ id: 'queued', status: 'queued', options: {}, result: { results: [] } });
  assert.equal(refs.taskIdleState.hidden, true);
  assert.equal(refs.statusOverall.textContent, '等待中');
  assert.equal(refs.statusPhase.textContent, '等待中');

  renderTaskStatus({ id: 'failed', status: 'failed', options: {}, result: { results: [] } });
  assert.equal(refs.statusOverall.textContent, '失败');
  assert.equal(refs.statusPhase.textContent, '失败');
  assert.equal(refs.debugRecoveryPanel.hidden, false);
});

test('restored local task keeps local source and platform context', () => {
  const refs = createRefs();
  initTaskStatusView(createOptions(refs));
  renderTaskStatus({
    id: 'local',
    status: 'queued',
    options: { sourceMode: 'local' },
    result: { results: [] }
  });

  assert.equal(refs.statusSource.textContent, '本地素材导入');
  assert.equal(refs.statusPlatform.textContent, '本地文件');
  assert.equal(refs.statusPlatform.hidden, false);
});

test('startup and preflight failure messages activate the task shell', () => {
  const refs = createRefs();
  initTaskStatusView(createOptions(refs));
  resetStatusShell();

  renderStatusMessage({ overall: '启动中', phase: 'Preflight' });
  assert.equal(refs.taskIdleState.hidden, true);
  assert.equal(refs.taskActiveState.hidden, false);
  assert.equal(refs.statusOverall.textContent, '启动中');
  assert.equal(refs.debugRecoveryPanel.hidden, false);

  renderStatusMessage({ overall: 'Preflight 未通过', phase: '运行检查' });
  assert.equal(refs.statusOverall.textContent, 'Preflight 未通过');
  assert.equal(refs.statusPhase.textContent, '运行检查');
  assert.equal(refs.taskActiveState.hidden, false);

  renderStatusMessage({
    overall: '待继续',
    phase: '等待第二阶段启动',
    currentItem: 'AfterEdit 表格已生成'
  });
  assert.equal(refs.taskIdleState.hidden, true);
  assert.equal(refs.taskActiveState.hidden, false);
  assert.equal(refs.statusOverall.textContent, '待继续');
  assert.equal(refs.statusPhase.textContent, '等待第二阶段启动');
  assert.equal(refs.statusItem.textContent, 'AfterEdit 表格已生成');
});

test('task status hides routine next actions and empty platforms', () => {
  const refs = createRefs();
  initTaskStatusView(createOptions(refs));
  renderTaskStatus({
    id: '1',
    status: 'running',
    options: { selectedModelProfileId: 'test-model' },
    result: { results: [] }
  });

  assert.equal(refs.statusModel.textContent, '测试模型');
  assert.equal(refs.statusSource.textContent, '平台自动识别');
  assert.equal(refs.statusPlatform.hidden, true);
  assert.equal(refs.statusNextAction.hidden, true);
});

test('task control policy only exposes valid actions', () => {
  assert.deepEqual(deriveTaskControlState({ id: '1', status: 'queued' }), {
    pause: true, resume: false, stop: true
  });
  assert.deepEqual(deriveTaskControlState({ id: '1', status: 'running' }), {
    pause: true, resume: false, stop: true
  });
  assert.deepEqual(deriveTaskControlState({ id: '1', status: 'pausing' }), {
    pause: false, resume: true, stop: true
  });
  assert.deepEqual(deriveTaskControlState({ id: '1', status: 'paused' }), {
    pause: false, resume: true, stop: true
  });
  assert.deepEqual(deriveTaskControlState({ id: '1', status: 'succeeded' }), {
    pause: false, resume: false, stop: false
  });
  assert.deepEqual(deriveTaskControlState({ id: '1', status: 'cancelled' }), {
    pause: false, resume: false, stop: false
  });
  assert.deepEqual(deriveTaskControlState({ id: '1', status: 'failed' }), {
    pause: false, resume: false, stop: false
  });
  assert.deepEqual(deriveTaskControlState({ id: '1', status: 'cancelling' }), {
    pause: false, resume: false, stop: true
  });
});

test('action visibility maps one boolean to hidden and disabled state', () => {
  assert.deepEqual(deriveActionVisibility(true), { hidden: false, disabled: false });
  assert.deepEqual(deriveActionVisibility(false), { hidden: true, disabled: true });
});

test('task control state applies hidden and disabled flags to real button refs', () => {
  const buttonRefs = createTaskControlButtonRefs();

  applyTaskControlState(buttonRefs, { id: '1', status: 'running' });
  assert.deepEqual(presentationOf(buttonRefs.pause), { hidden: false, disabled: false });
  assert.deepEqual(presentationOf(buttonRefs.resume), { hidden: true, disabled: true });
  assert.deepEqual(presentationOf(buttonRefs.stop), { hidden: false, disabled: false });
  assert.equal(buttonRefs.container.hidden, false);

  applyTaskControlState(buttonRefs, { id: '1', status: 'paused' });
  assert.deepEqual(presentationOf(buttonRefs.pause), { hidden: true, disabled: true });
  assert.deepEqual(presentationOf(buttonRefs.resume), { hidden: false, disabled: false });
  assert.deepEqual(presentationOf(buttonRefs.stop), { hidden: false, disabled: false });
  assert.equal(buttonRefs.container.hidden, false);

  applyTaskControlState(buttonRefs, { id: '1', status: 'failed' });
  assert.deepEqual(presentationOf(buttonRefs.pause), { hidden: true, disabled: true });
  assert.deepEqual(presentationOf(buttonRefs.resume), { hidden: true, disabled: true });
  assert.deepEqual(presentationOf(buttonRefs.stop), { hidden: true, disabled: true });
  assert.equal(buttonRefs.container.hidden, true);
});

test('task control action bindings invoke each supplied handler once', () => {
  const buttonRefs = createTaskControlButtonRefs();
  const calls = {
    pause: 0,
    resume: 0,
    stop: 0,
    exportFailures: 0,
    partialWriteback: 0
  };
  const handlers = Object.fromEntries(
    Object.keys(calls).map((name) => [name, () => { calls[name] += 1; }])
  );

  bindTaskControlActions(buttonRefs, handlers);
  for (const name of Object.keys(calls)) {
    buttonRefs[name].listeners.click();
  }

  assert.deepEqual(calls, {
    pause: 1,
    resume: 1,
    stop: 1,
    exportFailures: 1,
    partialWriteback: 1
  });
});

function createTaskControlButtonRefs() {
  return {
    container: createFakeButton(),
    pause: createFakeButton(),
    resume: createFakeButton(),
    stop: createFakeButton(),
    exportFailures: createFakeButton(),
    partialWriteback: createFakeButton()
  };
}

function createFakeButton() {
  return {
    hidden: false,
    disabled: false,
    listeners: {},
    addEventListener(type, callback) {
      this.listeners[type] = callback;
    }
  };
}

function presentationOf(button) {
  return { hidden: button.hidden, disabled: button.disabled };
}

function createOptions(refs) {
  return {
    refs,
    getDefaults: () => ({
      modelProfiles: [{ id: 'test-model', label: '测试模型' }]
    }),
    getFieldValue: () => '',
    getSelectedModelLabel: () => '测试模型'
  };
}

function createRefs() {
  return Object.fromEntries([
    'taskIdleState', 'taskActiveState', 'statusOverall', 'statusPhase',
    'statusProgress', 'statusProgressTrack', 'statusProgressBar',
    'statusCurrent', 'statusItem', 'statusContext', 'statusModel',
    'statusSource', 'statusPlatform', 'statusNextAction',
    'runtimeDetailsPanel', 'debugRecoveryPanel'
  ].map((key) => [key, createTextRef()]));
}

function createTextRef() {
  return {
    textContent: '',
    hidden: false,
    title: '',
    style: { width: '' },
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  };
}
