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
  applyTaskControlState,
  bindTaskControlActions,
  deriveActionVisibility,
  initTaskStatusView,
  renderLiveEvent,
  renderStatusMessage,
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
  openProviderConfigDialog
} from './config-dialogs.js';
import { initWorkbenchMode } from './workbench-mode.js';

const form = document.querySelector('#task-form');
const preflightOutput = document.querySelector('#preflight-output');
const eventLog = document.querySelector('#event-log');
const pauseTaskButton = document.querySelector('#pause-task');
const resumeTaskButton = document.querySelector('#resume-task');
const partialWritebackButton = document.querySelector('#partial-writeback');
const stopTaskButton = document.querySelector('#stop-task');
const exportFailuresButton = document.querySelector('#export-failures');
const providerProfile = document.querySelector('#provider-profile');
const taggingConcurrency = document.querySelector('#tagging-concurrency');
const taggingConcurrencyValue = document.querySelector('#tagging-concurrency-value');
const sourceModeInputs = [...document.querySelectorAll('input[name="sourceMode"]')];
const fileProtocolWarning = document.querySelector('#file-protocol-warning');
const resultsList = document.querySelector('#results-list');
const statusOverall = document.querySelector('#status-overall');
const statusPhase = document.querySelector('#status-phase');
const statusItem = document.querySelector('#status-item');
const statusProgress = document.querySelector('#status-progress');
const statusContext = document.querySelector('#status-context');
const taskIdleState = document.querySelector('#task-idle-state');
const taskActiveState = document.querySelector('#task-active-state');
const taskControlActions = document.querySelector('#task-control-actions');
const statusProgressTrack = document.querySelector('#status-progress-track');
const statusProgressBar = document.querySelector('#status-progress-bar');
const statusCurrent = document.querySelector('#status-current');
const statusModel = document.querySelector('#status-model');
const statusSource = document.querySelector('#status-source');
const statusPlatform = document.querySelector('#status-platform');
const statusNextAction = document.querySelector('#status-next-action');
const runtimeDetailsPanel = document.querySelector('#runtime-details-panel');
const debugRecoveryPanel = document.querySelector('#debug-recovery-panel');
const taxonomyPreset = document.querySelector('#taxonomy-preset');
const taxonomyPresetDisplay = document.querySelector('#taxonomy-preset-display');
const importTaxonomyPresetButton = document.querySelector('#import-taxonomy-preset');
const segmentationProfile = document.querySelector('#segmentation-profile');
const masterSpreadsheetDisplay = document.querySelector('#master-spreadsheet-display');
const downloadDirDisplay = document.querySelector('#download-dir-display');
const afterEditDirDisplay = document.querySelector('#afteredit-dir-display');
const providerConfigDialog = document.querySelector('#provider-config-dialog');
const providerConfigOutput = document.querySelector('#provider-config-output');
const providerModelList = document.querySelector('#provider-model-list');
const providerConfigBanner = document.querySelector('#provider-config-banner');
const platformCredentialsDialog = document.querySelector('#platform-credentials-dialog');
const platformCredentialsFields = document.querySelector('#platform-credentials-fields');
const platformCredentialsOutput = document.querySelector('#platform-credentials-output');
const platformCredentialsBanner = document.querySelector('#platform-credentials-banner');
const preflightList = document.querySelector('#preflight-list');
const timelineList = document.querySelector('#timeline-list');
const workbench = document.querySelector('#workbench');
const workbenchModeButtons = [...document.querySelectorAll('[data-workbench-mode][type="button"]')];
const providerReadiness = document.querySelector('#provider-readiness strong');
const credentialReadiness = document.querySelector('#credential-readiness strong');
const advancedDiagnostics = document.querySelector('#advanced-diagnostics');
const taskControlButtonRefs = {
  container: taskControlActions,
  pause: pauseTaskButton,
  resume: resumeTaskButton,
  stop: stopTaskButton,
  exportFailures: exportFailuresButton,
  partialWriteback: partialWritebackButton
};

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

  initWorkbenchLayout();
  initModules();
  bindActions();
  bindPickerButtons();
  bindDropTargets();
  await loadDefaults();
  await refreshReadinessSummaries();
  await restoreLatestTask();
  updateFilledState();
}

function initWorkbenchLayout() {
  const readinessCore = document.querySelector('#readiness-core');
  for (const id of ['configuration-actions', 'model-config', 'taxonomy-config', 'primary-run-action']) {
    const node = document.querySelector(`#${id}`);
    if (node) readinessCore.append(node);
  }

  moveInto('#advanced-execution-content', ['#stage-controls', '#diagnostic-controls']);
  moveInto('#advanced-tagging-content', ['#more-settings']);
  moveInto('#advanced-authorization-content', ['#archive-paths-panel']);
  moveInto('#advanced-diagnostics-content', ['#runtime-details-panel', '#debug-recovery-panel']);
  const advancedTools = document.querySelector('.advanced-tools');
  if (advancedTools) workbench.append(advancedTools);
  initWorkbenchMode({ root: workbench, buttons: workbenchModeButtons });
}

function moveInto(targetSelector, sourceSelectors) {
  const target = document.querySelector(targetSelector);
  for (const selector of sourceSelectors) {
    const node = document.querySelector(selector);
    if (target && node) target.append(node);
  }
}

function initModules() {
  initFormState({
    form,
    onFieldChange: (name) => {
      if (
        name === 'spreadsheet' ||
        name === 'sourceIntakeDirectory' ||
        name === 'sourceMode' ||
        name === 'manualEditGate' ||
        name === 'autoSegmentation'
      ) {
        if (name === 'sourceMode') {
          syncSourceMode();
        }
        updateSourceModeLabel();
        updatePlatformLabel();
        updateNextActionLabel();
      }
      if (name === 'taxonomyPreset') {
        syncPresetDefaults();
        if (taxonomyPresetDisplay) {
          taxonomyPresetDisplay.textContent = resolveTaxonomyLabel();
        }
      }
    }
  });
  initPathInputs({ outputNode: preflightOutput });
  initTaskStatusView({
    refs: {
      taskIdleState,
      taskActiveState,
      statusOverall,
      statusPhase,
      statusItem,
      statusProgress,
      statusProgressTrack,
      statusProgressBar,
      statusCurrent,
      statusContext,
      statusModel,
      statusSource,
      statusPlatform,
      statusNextAction,
      runtimeDetailsPanel,
      debugRecoveryPanel
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
      providerModelList,
      providerConfigBanner,
      platformCredentialsDialog,
      platformCredentialsFields,
      platformCredentialsOutput,
      platformCredentialsBanner
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
  importTaxonomyPresetButton?.addEventListener('click', () => wrapAction(importTaxonomyPreset, preflightOutput));
  document
    .querySelector('#preflight-button')
    .addEventListener('click', () => wrapAction(runPreflight, preflightOutput));
  for (const button of document.querySelectorAll('[data-pipeline-stage]')) {
    button.addEventListener('click', () =>
      wrapAction(() => startTask(button.dataset.pipelineStage), eventLog)
    );
  }
  document
    .querySelector('#build-afteredit-batch-sheet')
    ?.addEventListener('click', () => wrapAction(buildAfterEditBatchSheet, preflightOutput));
  document
    .querySelector('#import-source-directory')
    .addEventListener('click', () => wrapAction(importSourceDirectory, eventLog));
  bindTaskControlActions(taskControlButtonRefs, {
    pause: () => wrapAction(() => controlTask('pause'), eventLog),
    resume: () => wrapAction(() => controlTask('resume'), eventLog),
    stop: () => wrapAction(() => controlTask('stop'), eventLog),
    exportFailures,
    partialWriteback: () => wrapAction(writePartialResults, eventLog)
  });
  document
    .querySelector('#close-provider-config')
    .addEventListener('click', () => providerConfigDialog.close());
  document
    .querySelector('#close-platform-credentials')
    .addEventListener('click', () => platformCredentialsDialog.close());
  providerConfigDialog.addEventListener('close', refreshReadinessSummaries);
  platformCredentialsDialog.addEventListener('close', refreshReadinessSummaries);
  form.addEventListener('input', updateFilledState);
  providerProfile.addEventListener('change', () => {
    if (!currentTaskId) {
      resetStatusShell();
    }
    setTaggingConcurrency(resolveSelectedModelConcurrency());
    refreshProviderReadiness();
    if (providerConfigDialog.open) {
      wrapAction(openProviderConfigDialog, providerConfigOutput);
    }
  });
  taggingConcurrency.addEventListener('input', () => {
    updateTaggingConcurrencyLabel();
  });
  for (const input of sourceModeInputs) {
    input.addEventListener('change', () => {
      syncSourceMode();
      updateSourceModeLabel();
      updatePlatformLabel();
      updateNextActionLabel();
    });
  }
  document.querySelector('#spreadsheet').addEventListener('change', () => {
    updateSourceModeLabel();
    updatePlatformLabel();
    updateNextActionLabel();
  });
}

async function loadDefaults() {
  defaultsPayload = await apiGet('/api/defaults');
  providerProfile.innerHTML = defaultsPayload.modelProfiles
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`)
    .join('');
  renderTaxonomyPresetOptions(defaultsPayload.defaults.taxonomyPreset);
  segmentationProfile.innerHTML = (defaultsPayload.segmentationProfiles ?? [])
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label ?? item.id)}</option>`)
    .join('');

  setField('selectedModelProfileId', defaultsPayload.defaults.selectedModelProfileId);
  setField('masterSpreadsheetPath', defaultsPayload.defaults.masterSpreadsheetPath);
  setField('writebackTarget', 'both');
  setField('providerConfigPath', defaultsPayload.defaults.providerConfigPath);
  setField('platformCredentialConfigPath', defaultsPayload.defaults.platformCredentialConfigPath);
  setField('downloadDir', defaultsPayload.defaults.downloadDir);
  setField('sourceMode', 'spreadsheet');
  setField('downloaderMode', 'yt-dlp');
  setField('mergeMode', 'ffmpeg');
  setField('taggingMode', 'qwen');
  setField('archiveRoot', defaultsPayload.defaults.archiveRoot);
  setField('manualEditGate', String(defaultsPayload.defaults.manualEditGate));
  setField('autoSegmentation', defaultsPayload.defaults.autoSegmentation);
  setField('segmentationProfileId', defaultsPayload.defaults.segmentationProfileId);
  setField('afterEditDirectoryName', defaultsPayload.defaults.afterEditDirectoryName);
  setField('problemClipsDirectoryName', defaultsPayload.defaults.problemClipsDirectoryName);
  setTaggingConcurrency(defaultsPayload.defaults.taggingConcurrency);

  masterSpreadsheetDisplay.textContent = defaultsPayload.defaults.masterSpreadsheetPath;
  if (taxonomyPresetDisplay) {
    taxonomyPresetDisplay.textContent = resolveTaxonomyLabel();
  }
  downloadDirDisplay.textContent = defaultsPayload.defaults.downloadDir;
  afterEditDirDisplay.textContent = `${defaultsPayload.defaults.downloadDir}/${defaultsPayload.defaults.afterEditDirectoryName}`;
  resetStatusShell();
  updateTaskControls(null);
  syncSourceMode();
  updateSourceModeLabel();
  updatePlatformLabel();
  updateNextActionLabel();
  syncPresetDefaults();
}

async function refreshReadinessSummaries() {
  await Promise.allSettled([refreshProviderReadiness(), refreshCredentialReadiness()]);
}

async function refreshProviderReadiness() {
  providerReadiness.textContent = '检查中';
  try {
    const payload = await apiPost('/api/provider-config/model-summary', {
      providerConfigPath: fieldValue('providerConfigPath')
    });
    const selectedId = fieldValue('selectedModelProfileId');
    const selected = payload.models?.find((model) => model.profileId === selectedId);
    providerReadiness.textContent = selected?.apiKeyPresent ? '已就绪' : '未配置';
    providerReadiness.className = selected?.apiKeyPresent ? 'readiness-ok' : 'readiness-warning';
  } catch {
    providerReadiness.textContent = '检查失败';
    providerReadiness.className = 'readiness-warning';
  }
}

async function refreshCredentialReadiness() {
  credentialReadiness.textContent = '检查中';
  try {
    const entries = await apiGet(
      `/api/platform-credentials?platformCredentialConfigPath=${encodeURIComponent(fieldValue('platformCredentialConfigPath'))}`
    );
    const configured = entries.filter((entry) => entry.credentialStorePath || entry.cookiesFilePath).length;
    credentialReadiness.textContent = `${configured}/${entries.length} 已配置`;
    credentialReadiness.className = configured > 0 ? 'readiness-ok' : 'readiness-warning';
  } catch {
    credentialReadiness.textContent = '检查失败';
    credentialReadiness.className = 'readiness-warning';
  }
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

function syncSourceMode() {
  const mode = fieldValue('sourceMode') || 'spreadsheet';
  for (const panel of document.querySelectorAll('[data-source-panel]')) {
    panel.classList.toggle('hidden', panel.dataset.sourcePanel !== mode);
  }
}

function resolveTaxonomyPresetLabel(presetId) {
  const preset = defaultsPayload?.taxonomyPresets?.find((item) => item.id === presetId);
  return preset?.label ?? presetId ?? '—';
}

function resolveTaxonomyLabel() {
  return resolveTaxonomyPresetLabel(fieldValue('taxonomyPreset'));
}

function renderTaxonomyPresetOptions(selectedPresetId) {
  taxonomyPreset.innerHTML = defaultsPayload.taxonomyPresets
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`)
    .join('');
  setField('taxonomyPreset', selectedPresetId || defaultsPayload.defaults.taxonomyPreset);
}

async function importTaxonomyPreset() {
  preflightOutput.textContent = '请选择要导入的标签库文件...';
  const pickerPayload = await apiPost('/api/dialog/open-file', {
    prompt: '选择标签库文件'
  });

  if (pickerPayload.cancelled === true || typeof pickerPayload.path !== 'string' || pickerPayload.path.length === 0) {
    preflightOutput.textContent = '已取消导入标签库。';
    return;
  }

  preflightOutput.textContent = '正在导入标签库...';
  const payload = await apiPost('/api/taxonomy-presets/import', {
    taxonomyFilePath: pickerPayload.path
  });
  const importedPresetId = payload.preset?.id;
  defaultsPayload = await apiGet('/api/defaults');
  renderTaxonomyPresetOptions(importedPresetId);
  syncPresetDefaults();

  if (taxonomyPresetDisplay) {
    taxonomyPresetDisplay.textContent = resolveTaxonomyLabel();
  }
  preflightOutput.textContent = `已导入标签库：${payload.preset?.label ?? importedPresetId ?? pickerPayload.path}`;
}

function resolveSelectedModelLabel() {
  const profileId = fieldValue('selectedModelProfileId');
  const profile = defaultsPayload?.modelProfiles?.find((item) => item.id === profileId);
  return profile?.label ?? '—';
}

function resolveSelectedModelConcurrency() {
  const profileId = fieldValue('selectedModelProfileId');
  const profile = defaultsPayload?.modelProfiles?.find((item) => item.id === profileId);
  return profile?.defaultTaggingConcurrency ?? defaultsPayload?.defaults?.taggingConcurrency ?? 1;
}

function setTaggingConcurrency(value) {
  setField('taggingConcurrency', String(clampTaggingConcurrency(value)));
  updateTaggingConcurrencyLabel();
}

function updateTaggingConcurrencyLabel() {
  if (!taggingConcurrencyValue) {
    return;
  }

  taggingConcurrencyValue.textContent = String(clampTaggingConcurrency(taggingConcurrency.value));
}

function clampTaggingConcurrency(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Math.min(64, Math.max(1, Number.isNaN(parsed) ? 1 : parsed));
}

async function runPreflight() {
  const missingField = validateRequiredFields();

  if (missingField) {
    renderStatusMessage({ overall: '检查未通过', phase: 'Preflight' });
    renderPreflightMessage(missingField.message, preflightList, 'failed');
    syncRuntimeDetailsPanel(true);
    preflightOutput.textContent = missingField.message;
    missingField.field?.focus();
    preflightList.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }

  renderStatusMessage({ overall: '检查中', phase: 'Preflight' });
  renderPreflightMessage('正在检查运行环境...', preflightList);
  syncRuntimeDetailsPanel();
  preflightOutput.textContent = '正在检查运行环境...';
  const payload = await runPreflightChecks();
  const checks = payload.checks ?? [];
  renderPreflightChecklist(checks, preflightList);
  syncRuntimeDetailsPanel(checks.some((check) => check.ok === false));
  renderStatusMessage({
    overall: checks.some((check) => check.ok === false) ? 'Preflight 未通过' : '检查完成',
    phase: 'Preflight'
  });
  preflightOutput.textContent = JSON.stringify(payload.checks, null, 2);
}

async function runPreflightChecks() {
  return apiPost('/api/preflight', collectFormData());
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
  syncRuntimeDetailsPanel();
  resultsList.innerHTML = '<p>任务启动中...</p>';
  resultsList.classList.remove('empty-state');
  setActionVisibility(exportFailuresButton, false);
  resetStatusShell();
  updateTaskControls(null);
  renderStatusMessage({ overall: '启动中', phase: 'Preflight' });
  setField('pipelineStage', pipelineStage);
  renderPreflightMessage('正在检查运行环境...', preflightList);
  syncRuntimeDetailsPanel();
  const preflightPayload = await runPreflightChecks();
  const checks = preflightPayload.checks ?? [];
  renderPreflightChecklist(checks, preflightList);
  syncRuntimeDetailsPanel(checks.some((check) => check.ok === false));
  preflightOutput.textContent = JSON.stringify(checks, null, 2);
  const failedChecks = checks.filter((check) => check.ok === false);
  if (failedChecks.length > 0) {
    renderStatusMessage({ overall: 'Preflight 未通过', phase: '运行检查' });
    eventLog.textContent = `Preflight 未通过：${failedChecks.map((check) => check.label).join('，')}`;
    resultsList.innerHTML = '<p>Preflight 未通过，任务未启动。</p>';
    return;
  }
  const task = await apiPost('/api/tasks', collectFormData());
  currentTaskId = task.id;
  renderTaskStatus(task);
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
  try {
    const payload = await apiPost('/api/post-edit-sheet', {
      downloadDir: fieldValue('downloadDir'),
      afterEditDirectoryName: fieldValue('afterEditDirectoryName'),
      batchSampleFilePath: options.batchSampleFilePath,
      videoDirectoryPath: options.videoDirectoryPath
    });
    if (typeof payload.outputFilePath === 'string' && payload.outputFilePath.length > 0) {
      setField('spreadsheet', payload.outputFilePath);
      const batchLabel = payload.filterMode === 'batch-sample' && typeof payload.batchKey === 'string'
        ? `批次 ${payload.batchKey}，`
        : '';
      renderStatusMessage({
        overall: '待继续',
        phase: '等待第二阶段启动',
        currentItem: payload.fileCount > 0
          ? `已载入 ${batchLabel}${payload.fileCount} 个剪辑文件，修正 ${payload.renamedCount ?? 0} 个文件名`
          : 'AfterEdit 表格已生成'
      });
      updateSourceModeLabel();
      updatePlatformLabel();
      updateNextActionLabel();
      renderAfterEditFiles(payload.files ?? [], resultsList);
    }
    preflightOutput.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    renderStatusMessage({ overall: 'AfterEdit 表格生成失败', phase: '需要处理' });
    throw error;
  }
}

async function importSourceDirectory() {
  const sourceDirectoryPath = fieldValue('sourceIntakeDirectory').trim();

  if (sourceDirectoryPath.length === 0) {
    throw new Error('请先选择素材目录。');
  }

  preflightOutput.textContent = '正在复制素材并生成标准表格...';
  const payload = await apiPost('/api/source-intake/import', {
    sourceDirectoryPath,
    downloadDir: fieldValue('downloadDir'),
    afterEditDirectoryName: fieldValue('afterEditDirectoryName')
  });

  if (typeof payload.outputFilePath === 'string' && payload.outputFilePath.length > 0) {
    setField('spreadsheet', payload.outputFilePath);
    statusOverall.textContent = '待继续';
    statusPhase.textContent = '素材导入';
    statusItem.textContent = `已复制 ${payload.copiedCount ?? 0} 个素材，修正 ${payload.renamedCount ?? 0} 个文件名`;
    statusProgress.textContent = '—';
    updateSourceModeLabel();
    updatePlatformLabel();
    updateNextActionLabel();
    renderAfterEditFiles(payload.files ?? [], resultsList);
  }

  preflightOutput.textContent = JSON.stringify(payload, null, 2);
  await startTask('resume-cache');
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
    syncRuntimeDetailsPanel();
    eventLog.textContent += `${payload.timestamp} [${payload.status}] ${payload.phase}: ${payload.message}\n`;
    eventLog.scrollTop = eventLog.scrollHeight;
    renderLiveEvent(payload);
  };
}

function syncRuntimeDetailsPanel(preflightFailed = false) {
  const hasPreflight = preflightList.innerHTML.trim().length > 0;
  const hasTimeline = timelineList.innerHTML.trim().length > 0;
  runtimeDetailsPanel.hidden = !hasPreflight && !hasTimeline;
  if (preflightFailed) {
    runtimeDetailsPanel.open = true;
  }
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
  syncRuntimeDetailsPanel();
  if (!task.result) {
    return;
  }

  if (task.status === 'failed' || task.result.results?.some((item) => item.failure)) {
    advancedDiagnostics.open = true;
  }

  setActionVisibility(exportFailuresButton, task.result.failedRows > 0);
  renderResultCards(task.result.results, resultsList, task.result.currentRunSpreadsheetPath);
}

function updateTaskControls(task) {
  applyTaskControlState(taskControlButtonRefs, task);

  const canWriteBack = Boolean(task?.id || fieldValue('spreadsheet'));
  setActionVisibility(partialWritebackButton, canWriteBack);
}

function setActionVisibility(button, visible) {
  const state = deriveActionVisibility(visible);
  button.hidden = state.hidden;
  button.disabled = state.disabled;
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
    debugRecoveryPanel.hidden = false;
    outputNode.textContent = error instanceof Error ? error.message : String(error);
  }
}
