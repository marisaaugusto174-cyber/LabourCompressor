import { apiGet, apiPost } from './api-client.js';
import {
  collectFormData,
  escapeHtml,
  fieldValue,
  initFormState,
  setField,
  updateFilledState,
  validateRequiredFields
} from './form-state.js';
import { bindDropTargets, bindPickerButtons, initPathInputs } from './path-inputs.js';
import {
  initTaskStatusView,
  renderLiveEvent,
  renderTaskStatus,
  resetStatusShell,
  updateNextActionLabel,
  updatePlatformLabel,
  updateSourceModeLabel
} from './task-status-view.js';
import { renderAfterEditFiles, renderResultCards } from './results-view.js';
import {
  renderEventTimeline,
  renderPreflightChecklist,
  renderPreflightMessage
} from './task-list-view.js';
import {
  initConfigDialogs,
  openPlatformCredentialsDialog,
  openProviderConfigDialog,
  savePlatformCredentials,
  saveProviderConfig
} from './config-dialogs.js';

const form = document.querySelector('#task-form');
const preflightOutput = document.querySelector('#preflight-output');
const eventLog = document.querySelector('#event-log');
const pauseTaskButton = document.querySelector('#pause-task');
const resumeTaskButton = document.querySelector('#resume-task');
const partialWritebackButton = document.querySelector('#partial-writeback');
const stopTaskButton = document.querySelector('#stop-task');
const exportFailuresButton = document.querySelector('#export-failures');
const providerProfile = document.querySelector('#provider-profile');
const fileProtocolWarning = document.querySelector('#file-protocol-warning');
const resultsList = document.querySelector('#results-list');
const statusOverall = document.querySelector('#status-overall');
const statusPhase = document.querySelector('#status-phase');
const statusItem = document.querySelector('#status-item');
const statusProgress = document.querySelector('#status-progress');
const statusModel = document.querySelector('#status-model');
const statusSource = document.querySelector('#status-source');
const statusPlatform = document.querySelector('#status-platform');
const statusNextAction = document.querySelector('#status-next-action');
const taxonomyPreset = document.querySelector('#taxonomy-preset');
const taxonomyPresetDisplay = document.querySelector('#taxonomy-preset-display');
const masterSpreadsheetDisplay = document.querySelector('#master-spreadsheet-display');
const downloadDirDisplay = document.querySelector('#download-dir-display');
const afterEditDirDisplay = document.querySelector('#afteredit-dir-display');
const providerConfigDialog = document.querySelector('#provider-config-dialog');
const providerConfigOutput = document.querySelector('#provider-config-output');
const providerApiKeyInput = document.querySelector('#provider-api-key');
const providerConfigProfileLabel = document.querySelector('#provider-config-profile-label');
const providerConfigProviderLabel = document.querySelector('#provider-config-provider-label');
const providerConfigStatusLabel = document.querySelector('#provider-config-status-label');
const platformCredentialsDialog = document.querySelector('#platform-credentials-dialog');
const platformCredentialsFields = document.querySelector('#platform-credentials-fields');
const platformCredentialsOutput = document.querySelector('#platform-credentials-output');
const preflightList = document.querySelector('#preflight-list');
const timelineList = document.querySelector('#timeline-list');

let currentTaskId = null;
let currentEventSource = null;
let defaultsPayload = null;
let liveEvents = [];

boot();

async function boot() {
  if (location.protocol === 'file:') {
    fileProtocolWarning.classList.remove('hidden');
    return;
  }

  initModules();
  bindActions();
  bindPickerButtons();
  bindDropTargets();
  await loadDefaults();
  await restoreLatestTask();
  updateFilledState();
}

function initModules() {
  initFormState({
    form,
    onFieldChange: (name) => {
      if (name === 'spreadsheet' || name === 'manualEditGate' || name === 'autoSegmentation') {
        updateSourceModeLabel();
        updatePlatformLabel();
        updateNextActionLabel();
      }
      if (name === 'taxonomyPreset') {
        syncPresetDefaults();
        if (taxonomyPresetDisplay) {
          taxonomyPresetDisplay.textContent = resolveTaxonomyPresetLabel(fieldValue('taxonomyPreset'));
        }
      }
    }
  });
  initPathInputs({ outputNode: preflightOutput });
  initTaskStatusView({
    refs: {
      statusOverall,
      statusPhase,
      statusItem,
      statusProgress,
      statusModel,
      statusSource,
      statusPlatform,
      statusNextAction
    },
    getDefaults: () => defaultsPayload,
    getFieldValue: fieldValue,
    getSelectedModelLabel: resolveSelectedModelLabel
  });
  initConfigDialogs({
    bindPickerButtons,
    refs: {
      providerConfigDialog,
      providerConfigOutput,
      providerApiKeyInput,
      providerConfigProfileLabel,
      providerConfigProviderLabel,
      providerConfigStatusLabel,
      platformCredentialsDialog,
      platformCredentialsFields,
      platformCredentialsOutput
    }
  });
}

function bindActions() {
  document
    .querySelector('#open-provider-config')
    .addEventListener('click', () => wrapAction(openProviderConfigDialog, providerConfigOutput));
  document
    .querySelector('#open-platform-credentials')
    .addEventListener('click', () => wrapAction(openPlatformCredentialsDialog, platformCredentialsOutput));
  document
    .querySelector('#preflight-button')
    .addEventListener('click', () => wrapAction(runPreflight, preflightOutput));
  for (const button of document.querySelectorAll('[data-pipeline-stage]')) {
    button.addEventListener('click', () =>
      wrapAction(() => startTask(button.dataset.pipelineStage), eventLog)
    );
  }
  document
    .querySelector('#build-afteredit-sheet')
    .addEventListener('click', () => wrapAction(buildAfterEditSheet, preflightOutput));
  document
    .querySelector('#build-afteredit-batch-sheet')
    .addEventListener('click', () => wrapAction(buildAfterEditBatchSheet, preflightOutput));
  pauseTaskButton.addEventListener('click', () => wrapAction(() => controlTask('pause'), eventLog));
  resumeTaskButton.addEventListener('click', () => wrapAction(() => controlTask('resume'), eventLog));
  partialWritebackButton.addEventListener('click', () => wrapAction(writePartialResults, eventLog));
  stopTaskButton.addEventListener('click', () => wrapAction(() => controlTask('stop'), eventLog));
  document
    .querySelector('#close-provider-config')
    .addEventListener('click', () => providerConfigDialog.close());
  document
    .querySelector('#close-platform-credentials')
    .addEventListener('click', () => platformCredentialsDialog.close());
  document
    .querySelector('#save-provider-config')
    .addEventListener('click', () => wrapAction(saveProviderConfig, providerConfigOutput));
  document
    .querySelector('#save-platform-credentials')
    .addEventListener('click', () => wrapAction(savePlatformCredentials, platformCredentialsOutput));
  exportFailuresButton.addEventListener('click', exportFailures);
  form.addEventListener('input', updateFilledState);
  providerProfile.addEventListener('change', () => {
    statusModel.textContent = resolveSelectedModelLabel();
    if (providerConfigDialog.open) {
      wrapAction(openProviderConfigDialog, providerConfigOutput);
    }
  });
  document.querySelector('#spreadsheet').addEventListener('change', () => {
    updateSourceModeLabel();
    updatePlatformLabel();
    updateNextActionLabel();
  });
}

async function loadDefaults() {
  defaultsPayload = await apiGet('/api/defaults');
  providerProfile.innerHTML = defaultsPayload.modelProfiles
    .map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`)
    .join('');
  taxonomyPreset.innerHTML = defaultsPayload.taxonomyPresets
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`)
    .join('');

  setField('taxonomyPreset', defaultsPayload.defaults.taxonomyPreset);
  setField('selectedModelProfileId', defaultsPayload.defaults.selectedModelProfileId);
  setField('masterSpreadsheetPath', defaultsPayload.defaults.masterSpreadsheetPath);
  setField('writebackTarget', 'both');
  setField('providerConfigPath', defaultsPayload.defaults.providerConfigPath);
  setField('platformCredentialConfigPath', defaultsPayload.defaults.platformCredentialConfigPath);
  setField('downloadDir', defaultsPayload.defaults.downloadDir);
  setField('downloaderMode', 'yt-dlp');
  setField('mergeMode', 'ffmpeg');
  setField('taggingMode', 'qwen');
  setField('archiveRoot', defaultsPayload.defaults.archiveRoot);
  setField('manualEditGate', String(defaultsPayload.defaults.manualEditGate));
  setField('autoSegmentation', defaultsPayload.defaults.autoSegmentation);
  setField('segmentationProfileId', defaultsPayload.defaults.segmentationProfileId);
  setField('afterEditDirectoryName', defaultsPayload.defaults.afterEditDirectoryName);
  setField('problemClipsDirectoryName', defaultsPayload.defaults.problemClipsDirectoryName);

  masterSpreadsheetDisplay.textContent = defaultsPayload.defaults.masterSpreadsheetPath;
  if (taxonomyPresetDisplay) {
    taxonomyPresetDisplay.textContent = resolveTaxonomyPresetLabel(defaultsPayload.defaults.taxonomyPreset);
  }
  downloadDirDisplay.textContent = defaultsPayload.defaults.downloadDir;
  afterEditDirDisplay.textContent = `${defaultsPayload.defaults.downloadDir}/${defaultsPayload.defaults.afterEditDirectoryName}`;
  statusModel.textContent = resolveSelectedModelLabel();
  updateSourceModeLabel();
  updatePlatformLabel();
  updateNextActionLabel();
  syncPresetDefaults();
}

async function restoreLatestTask() {
  const payload = await apiGet('/api/tasks');
  const latestTask = payload.tasks?.[0];

  if (!latestTask) {
    return;
  }

  currentTaskId = latestTask.id;
  renderTask(latestTask);

  if (isControllableTaskStatus(latestTask.status)) {
    openEventStream(latestTask.id);
    if (shouldPollTaskStatus(latestTask.status)) {
      pollTask(latestTask.id);
    }
  }
}

function syncPresetDefaults() {
  const selectedPreset = fieldValue('taxonomyPreset') || defaultsPayload?.defaults?.taxonomyPreset;
  const promptLibraryByPreset = defaultsPayload?.defaults?.promptLibraryByPreset ?? {};
  const promptLibrary =
    promptLibraryByPreset[selectedPreset] ?? defaultsPayload?.defaults?.promptLibrary ?? '';
  setField('promptLibrary', promptLibrary);
}

function resolveTaxonomyPresetLabel(presetId) {
  const preset = defaultsPayload?.taxonomyPresets?.find((item) => item.id === presetId);
  return preset?.label ?? presetId ?? '—';
}

function resolveSelectedModelLabel() {
  const profileId = fieldValue('selectedModelProfileId');
  const profile = defaultsPayload?.modelProfiles?.find((item) => item.id === profileId);
  return profile?.label ?? '—';
}

async function runPreflight() {
  const missingField = validateRequiredFields();

  if (missingField) {
    renderPreflightMessage(missingField.message, preflightList, 'failed');
    preflightOutput.textContent = missingField.message;
    missingField.field?.focus();
    preflightList.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }

  renderPreflightMessage('正在检查运行环境...', preflightList);
  preflightOutput.textContent = '正在检查运行环境...';
  const payload = await apiPost('/api/preflight', collectFormData());
  renderPreflightChecklist(payload.checks ?? [], preflightList);
  preflightOutput.textContent = JSON.stringify(payload.checks, null, 2);
}

async function startTask(pipelineStage = 'all') {
  const missingField = validateRequiredFields();

  if (missingField) {
    eventLog.textContent = missingField.message;
    missingField.field?.focus();
    return;
  }

  liveEvents = [];
  eventLog.textContent = '';
  renderEventTimeline(liveEvents, timelineList);
  resultsList.innerHTML = '<p>任务启动中...</p>';
  resultsList.classList.remove('empty-state');
  exportFailuresButton.disabled = true;
  resetStatusShell();
  statusOverall.textContent = '启动中';
  setField('pipelineStage', pipelineStage);
  const task = await apiPost('/api/tasks', collectFormData());
  currentTaskId = task.id;
  statusOverall.textContent = '运行中';
  updateTaskControls(task);
  openEventStream(task.id);
  pollTask(task.id);
}

async function controlTask(action) {
  if (!currentTaskId) {
    return;
  }

  const task = await apiPost(`/api/tasks/${currentTaskId}/${action}`, {});
  renderTask(task);
  if (isControllableTaskStatus(task.status)) {
    openEventStream(task.id);
  }
  if (shouldPollTaskStatus(task.status)) {
    pollTask(task.id);
  }
}

async function buildAfterEditSheet(options = {}) {
  preflightOutput.textContent = '正在扫描 AfterEdit 并生成标准表格...';
  const payload = await apiPost('/api/post-edit-sheet', {
    downloadDir: fieldValue('downloadDir'),
    afterEditDirectoryName: fieldValue('afterEditDirectoryName'),
    batchSampleFilePath: options.batchSampleFilePath
  });
  if (typeof payload.outputFilePath === 'string' && payload.outputFilePath.length > 0) {
    setField('spreadsheet', payload.outputFilePath);
    statusOverall.textContent = '待继续';
    statusPhase.textContent = '等待第二阶段启动';
    const batchLabel = payload.filterMode === 'batch-sample' && typeof payload.batchKey === 'string'
      ? `批次 ${payload.batchKey}，`
      : '';
    statusItem.textContent = payload.fileCount > 0
      ? `已载入 ${batchLabel}${payload.fileCount} 个剪辑文件，修正 ${payload.renamedCount ?? 0} 个文件名`
      : 'AfterEdit 表格已生成';
    statusProgress.textContent = '—';
    statusSource.textContent = 'AfterEdit 二阶段继续处理';
    statusPlatform.textContent = '本地 AfterEdit 文件';
    statusNextAction.textContent = '启动第二阶段任务';
    renderAfterEditFiles(payload.files ?? [], resultsList);
  }
  preflightOutput.textContent = JSON.stringify(payload, null, 2);
}

async function buildAfterEditBatchSheet() {
  const batchSampleFilePath = fieldValue('afterEditBatchSampleFile').trim();

  if (batchSampleFilePath.length === 0) {
    throw new Error('请先选择一个 AfterEdit 批次样例文件。');
  }

  return buildAfterEditSheet({ batchSampleFilePath });
}

async function writePartialResults() {
  const payload = currentTaskId
    ? await apiPost(`/api/tasks/${currentTaskId}/partial-writeback`, {})
    : await apiPost('/api/partial-writeback', collectFormData());
  const message = [
    `部分回表完成：更新 ${payload.updatedRows ?? 0} 行`,
    `匹配 JSON ${payload.matchedJsonFiles ?? 0} 个`,
    `失败 ${payload.failedRows ?? 0} 行`
  ].join('，');
  eventLog.textContent += `${new Date().toISOString()} [succeeded] writeback: ${message}\n`;
  eventLog.scrollTop = eventLog.scrollHeight;
  statusOverall.textContent = '部分回表完成';
  statusPhase.textContent = '写回表格';
  statusItem.textContent = message;
  statusProgress.textContent = `${payload.updatedRows ?? 0}/${payload.totalRows ?? 0}`;
  preflightOutput.textContent = JSON.stringify(payload, null, 2);
}

function openEventStream(taskId) {
  currentEventSource?.close();
  currentEventSource = new EventSource(`/api/tasks/${taskId}/events`);
  currentEventSource.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    liveEvents.push(payload);
    renderEventTimeline(liveEvents, timelineList);
    eventLog.textContent += `${payload.timestamp} [${payload.status}] ${payload.phase}: ${payload.message}\n`;
    eventLog.scrollTop = eventLog.scrollHeight;
    renderLiveEvent(payload);
  };
}

async function pollTask(taskId) {
  const task = await apiGet(`/api/tasks/${taskId}`);
  renderTask(task);

  if (shouldPollTaskStatus(task.status)) {
    setTimeout(() => pollTask(taskId), 1500);
  }
}

function renderTask(task) {
  renderTaskStatus(task);
  updateTaskControls(task);

  if (!task.result) {
    return;
  }

  exportFailuresButton.disabled = task.result.failedRows === 0;
  renderResultCards(task.result.results, resultsList, task.result.currentRunSpreadsheetPath);
}

function updateTaskControls(task) {
  const status = task?.status;
  const hasTask = Boolean(task?.id);
  pauseTaskButton.disabled = !hasTask || !(status === 'queued' || status === 'running');
  resumeTaskButton.disabled = !hasTask || !(status === 'paused' || status === 'pausing');
  partialWritebackButton.disabled = !hasTask && !fieldValue('spreadsheet');
  stopTaskButton.disabled = !hasTask || !isControllableTaskStatus(status);
}

function isControllableTaskStatus(status) {
  return status === 'queued' ||
    status === 'running' ||
    status === 'pausing' ||
    status === 'paused' ||
    status === 'cancelling';
}

function shouldPollTaskStatus(status) {
  return status === 'queued' ||
    status === 'running' ||
    status === 'pausing' ||
    status === 'cancelling';
}

function exportFailures() {
  if (!currentTaskId) {
    return;
  }

  window.open(`/api/tasks/${currentTaskId}/failures.csv`, '_blank');
}

async function wrapAction(action, outputNode) {
  try {
    await action();
  } catch (error) {
    outputNode.textContent = error instanceof Error ? error.message : String(error);
  }
}
