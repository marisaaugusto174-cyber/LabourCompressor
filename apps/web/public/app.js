const form = document.querySelector('#task-form');
const preflightOutput = document.querySelector('#preflight-output');
const eventLog = document.querySelector('#event-log');
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

let currentTaskId = null;
let currentEventSource = null;
let defaultsPayload = null;

boot();

async function boot() {
  if (location.protocol === 'file:') {
    fileProtocolWarning.classList.remove('hidden');
    return;
  }

  bindActions();
  bindPickerButtons();
  bindDropTargets();
  await loadDefaults();
  await restoreLatestTask();
  updateFilledState();
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
  document
    .querySelector('#run-button')
    .addEventListener('click', () => wrapAction(startTask, eventLog));
  document
    .querySelector('#build-afteredit-sheet')
    .addEventListener('click', () => wrapAction(buildAfterEditSheet, preflightOutput));
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

function bindPickerButtons() {
  for (const button of document.querySelectorAll('.picker-button')) {
    if (button.dataset.bound === 'true') {
      continue;
    }
    button.dataset.bound = 'true';
    button.addEventListener('click', async () => {
      const targetName = button.dataset.target;
      const dialogKind = button.dataset.dialogKind;

      if (!targetName || !dialogKind) {
        return;
      }

      const field = findNamedField(targetName);
      const defaultPath =
        field instanceof HTMLInputElement && field.value.trim().length > 0
          ? field.value.trim()
          : undefined;
      const payload = await apiPost(
        dialogKind === 'folder' ? '/api/dialog/open-folder' : '/api/dialog/open-file',
        {
          prompt: button.dataset.prompt ?? '选择路径',
          defaultPath
        }
      );

      if (payload.cancelled) {
        return;
      }

      if (!payload.cancelled && typeof payload.path === 'string' && payload.path.length > 0) {
        setField(targetName, payload.path);
      }
    });
  }
}

function bindDropTargets() {
  for (const target of document.querySelectorAll('.drop-target')) {
    target.addEventListener('dragover', (event) => {
      event.preventDefault();
      target.classList.add('is-dragover');
    });
    target.addEventListener('dragleave', () => {
      target.classList.remove('is-dragover');
    });
    target.addEventListener('drop', (event) => {
      event.preventDefault();
      target.classList.remove('is-dragover');
      const targetName = target.dataset.target;
      if (targetName) {
        handleDropAssignment(event, targetName, target.dataset.kind ?? 'file').catch((error) => {
          preflightOutput.textContent =
            error instanceof Error ? error.message : String(error);
        });
      }
    });
  }
}

async function loadDefaults() {
  defaultsPayload = await apiGet('/api/defaults');
  providerProfile.innerHTML = defaultsPayload.modelProfiles
    .map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`)
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
  setField('afterEditDirectoryName', defaultsPayload.defaults.afterEditDirectoryName);

  masterSpreadsheetDisplay.textContent = defaultsPayload.defaults.masterSpreadsheetPath;
  taxonomyPresetDisplay.textContent = resolveTaxonomyPresetLabel(defaultsPayload.defaults.taxonomyPreset);
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

  if (latestTask.status === 'running' || latestTask.status === 'queued') {
    openEventStream(latestTask.id);
    pollTask(latestTask.id);
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

function updateSourceModeLabel() {
  const spreadsheetPath = fieldValue('spreadsheet');

  if (spreadsheetPath.includes('AfterEdit')) {
    statusSource.textContent = 'AfterEdit 二阶段继续处理';
    return;
  }

  statusSource.textContent = fieldValue('manualEditGate') === 'true' ? '下载后进入人工剪辑' : '平台自动识别';
}

function updatePlatformLabel() {
  const spreadsheetPath = fieldValue('spreadsheet');
  const candidateText = spreadsheetPath;
  statusPlatform.textContent = derivePlatformLabelFromText(candidateText);
}

function updateNextActionLabel(task) {
  statusNextAction.textContent = inferNextAction(task);
}

async function runPreflight() {
  const missingField = validateRequiredFields();

  if (missingField) {
    preflightOutput.textContent = missingField.message;
    missingField.field?.focus();
    preflightOutput.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }

  preflightOutput.textContent = '正在检查运行环境...';
  const payload = await apiPost('/api/preflight', collectFormData());
  preflightOutput.textContent = JSON.stringify(payload.checks, null, 2);
}

async function startTask() {
  const missingField = validateRequiredFields();

  if (missingField) {
    eventLog.textContent = missingField.message;
    missingField.field?.focus();
    return;
  }

  eventLog.textContent = '';
  resultsList.innerHTML = '<p>任务启动中...</p>';
  resultsList.classList.remove('empty-state');
  exportFailuresButton.disabled = true;
  resetStatusShell();
  statusOverall.textContent = '启动中';
  const task = await apiPost('/api/tasks', collectFormData());
  currentTaskId = task.id;
  statusOverall.textContent = '运行中';
  openEventStream(task.id);
  pollTask(task.id);
}

async function buildAfterEditSheet() {
  preflightOutput.textContent = '正在扫描 AfterEdit 并生成标准表格...';
  const payload = await apiPost('/api/post-edit-sheet', {
    downloadDir: fieldValue('downloadDir'),
    afterEditDirectoryName: fieldValue('afterEditDirectoryName')
  });
  if (typeof payload.outputFilePath === 'string' && payload.outputFilePath.length > 0) {
    setField('spreadsheet', payload.outputFilePath);
    statusOverall.textContent = '待继续';
    statusPhase.textContent = '等待第二阶段启动';
    statusItem.textContent = payload.fileCount > 0
      ? `已载入 ${payload.fileCount} 个剪辑文件，修正 ${payload.renamedCount ?? 0} 个文件名`
      : 'AfterEdit 表格已生成';
    statusProgress.textContent = '—';
    statusSource.textContent = 'AfterEdit 二阶段继续处理';
    statusPlatform.textContent = '本地 AfterEdit 文件';
    statusNextAction.textContent = '启动第二阶段任务';
    renderAfterEditFiles(payload.files ?? []);
  }
  preflightOutput.textContent = JSON.stringify(payload, null, 2);
}

function renderAfterEditFiles(files) {
  if (!files.length) {
    return;
  }

  resultsList.classList.remove('empty-state');
  resultsList.innerHTML = files
    .map((file) => `
      <article class="result-card">
        <div class="result-card-header">
          <strong>${escapeHtml(file.fileName ?? '剪辑文件')}</strong>
          <span class="stage-pill stage-running">等待打标</span>
        </div>
        <p class="result-meta"><span>当前环节</span>剪辑后回表待处理</p>
        <p class="result-meta"><span>相对路径</span>${escapeHtml(file.relativePath ?? '—')}</p>
        <p class="result-meta"><span>原路径</span>${escapeHtml(file.originalRelativePath ?? '—')}</p>
        <p class="result-meta"><span>文件名修正</span>${file.renamed ? '已修正' : '无需修正'}</p>
      </article>
    `)
    .join('');
}

async function openProviderConfigDialog() {
  const payload = await apiPost('/api/provider-config/summary', {
    providerConfigPath: fieldValue('providerConfigPath'),
    selectedModelProfileId: fieldValue('selectedModelProfileId')
  });

  providerConfigProfileLabel.textContent = payload.profile.label;
  providerConfigProviderLabel.textContent = `${payload.profile.provider} / ${payload.profile.modelName}`;
  providerConfigStatusLabel.textContent = payload.summary.enabled
    ? `${payload.summary.provider} 已启用，当前 model = ${payload.summary.modelName}${payload.summary.apiKeyPresent ? '，已配置 API key' : '，未配置 API key'}`
    : `${payload.summary.provider} 未启用`;
  providerApiKeyInput.value = '';
  providerConfigOutput.textContent = buildDebugJson(payload);
  providerConfigDialog.showModal();
}

async function saveProviderConfig() {
  const apiKey = providerApiKeyInput.value.trim();

  if (apiKey.length === 0) {
    providerConfigOutput.textContent = '请先填写 API key。';
    providerApiKeyInput.focus();
    return;
  }

  providerConfigOutput.textContent = '正在保存配置并测试连通性...';
  const payload = await apiPost('/api/provider-config/save-api-key', {
    providerConfigPath: fieldValue('providerConfigPath'),
    selectedModelProfileId: fieldValue('selectedModelProfileId'),
    apiKey
  });
  providerApiKeyInput.value = '';
  providerConfigOutput.textContent = buildDebugJson(payload);
  await openProviderConfigDialog();
}

async function openPlatformCredentialsDialog() {
  const payload = await apiGet(
    `/api/platform-credentials?platformCredentialConfigPath=${encodeURIComponent(fieldValue('platformCredentialConfigPath'))}`
  );
  renderPlatformCredentialFields(payload);
  platformCredentialsOutput.textContent = buildDebugJson(payload);
  platformCredentialsDialog.showModal();
}

async function savePlatformCredentials() {
  const rows = [...platformCredentialsFields.querySelectorAll('[data-platform]')];
  const results = [];

  for (const row of rows) {
    const platform = row.dataset.platform;
    if (!platform) {
      continue;
    }

    const cookiesFilePath = row.querySelector(`[name="${CSS.escape(platform)}-cookies-file"]`)?.value?.trim() ?? '';
    const cookiesFromBrowser = row.querySelector(`[name="${CSS.escape(platform)}-cookies-browser"]`)?.value?.trim() ?? '';

    results.push(
      await apiPost('/api/platform-credentials/save', {
        platformCredentialConfigPath: fieldValue('platformCredentialConfigPath'),
        platform,
        cookiesFilePath,
        cookiesFromBrowser
      })
    );
  }

  const latest = results.at(-1) ?? [];
  renderPlatformCredentialFields(latest);
  platformCredentialsOutput.textContent = buildDebugJson(latest);
}

function openEventStream(taskId) {
  currentEventSource?.close();
  currentEventSource = new EventSource(`/api/tasks/${taskId}/events`);
  currentEventSource.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    eventLog.textContent += `${payload.timestamp} [${payload.status}] ${payload.phase}: ${payload.message}\n`;
    eventLog.scrollTop = eventLog.scrollHeight;
    renderLiveEvent(payload);
  };
}

async function pollTask(taskId) {
  const task = await apiGet(`/api/tasks/${taskId}`);
  renderTask(task);

  if (task.status === 'running' || task.status === 'queued') {
    setTimeout(() => pollTask(taskId), 1500);
  }
}

function renderLiveEvent(event) {
  statusOverall.textContent = deriveOverallStatusFromEvent(event);
  statusPhase.textContent = humanizePhase(event.phase ?? event.stage, event.status);
  statusItem.textContent = event.currentItem || '—';
  statusProgress.textContent = event.progress
    ? `${event.progress.current}/${event.progress.total} (${Math.round((event.progress.current / Math.max(1, event.progress.total)) * 100)}%)`
    : '—';
}

function renderTask(task) {
  statusModel.textContent = resolveTaskModelLabel(task);
  statusSource.textContent = inferTaskSourceLabel(task);
  statusPlatform.textContent = inferTaskPlatformLabel(task);
  statusNextAction.textContent = inferNextAction(task);
  if (task.latestEvent) {
    renderLiveEvent(task.latestEvent);
  }

  statusOverall.textContent = deriveOverallStatusFromTask(task);

  if (!task.result) {
    return;
  }

  exportFailuresButton.disabled = task.result.failedRows === 0;
  renderResultCards(task.result.results);
}

function renderResultCards(results) {
  if (!results.length) {
    resultsList.innerHTML = '<p>当前没有可显示的结果。</p>';
    resultsList.classList.add('empty-state');
    return;
  }

  resultsList.classList.remove('empty-state');
  resultsList.innerHTML = results
    .map((item) => {
      const phaseLabel = deriveResultStage(item);
      const fileName = deriveResultFileName(item);
      const pathMarkup = `<p class="result-meta"><span>归档路径</span>${escapeHtml(item.archivePath || '—')}</p>`;
      const failureTypeMarkup = item.failure
        ? `<p class="result-meta"><span>失败类型</span>${escapeHtml(humanizeFailureCode(item.failure.errorCode, item.failure.phase))}</p>`
        : '';
      const failureMarkup = item.failure?.errorMessage
        ? `<p class="result-error">${escapeHtml(item.failure.errorMessage)}</p>`
        : '';
      const failureHintMarkup = item.failure
        ? `<p class="result-hint">${escapeHtml(humanizeFailureHint(item.failure.errorCode, item.failure.phase))}</p>`
        : '';
      const waitingHintMarkup =
        item.archiveState === '已下载待剪辑'
          ? `<p class="result-hint">等待你把剪辑后的导出文件放进 AfterEdit 目录，再继续第二阶段任务。</p>`
          : '';
      return `
        <article class="result-card">
          <div class="result-card-header">
            <strong>${escapeHtml(fileName)}</strong>
            <span class="stage-pill stage-${stageClassName(item)}">${escapeHtml(phaseLabel)}</span>
          </div>
          <p class="result-meta"><span>当前环节</span>${escapeHtml(phaseLabel)}</p>
          <p class="result-url">${escapeHtml(item.url)}</p>
          ${pathMarkup}
          ${failureTypeMarkup}
          ${failureMarkup}
          ${failureHintMarkup}
          ${waitingHintMarkup}
        </article>
      `;
    })
    .join('');
}

function deriveResultStage(item) {
  if (item.failure?.phase === 'download') {
    return '下载失败';
  }
  if (item.failure?.phase === 'tagging') {
    return '打标失败';
  }
  if (item.failure?.phase === 'archive') {
    return '归档失败';
  }
  if (item.archiveState === '已归档') {
    return '归档成功';
  }
  if (item.archiveState === '已下载待剪辑') {
    return '等待剪辑';
  }
  if (item.archiveState === '已跳过：视频过短') {
    return '已跳过：视频过短';
  }
  if (item.archiveState === '已下载未归档') {
    return '等待人工确认归档类目';
  }
  if (item.archiveState === '待归档') {
    return '等待打标';
  }
  if (item.archiveState === '下载失败') {
    return '下载失败';
  }
  return item.archiveState || '处理中';
}

function deriveResultFileName(item) {
  if (item.archiveFileName) {
    return item.archiveFileName;
  }

  const normalizedUrl = String(item.url ?? '');

  if (/\.(mp4|mov|m4v|mkv|avi|webm)$/iu.test(normalizedUrl)) {
    return normalizedUrl.split('/').at(-1) ?? normalizedUrl;
  }

  return `第 ${item.rowNumber} 行待生成文件`;
}

function stageClassName(item) {
  if (item.failure) {
    return 'failed';
  }
  if (item.archiveState === '已归档') {
    return 'succeeded';
  }
  if (item.archiveState === '已跳过：视频过短') {
    return 'succeeded';
  }
  return 'running';
}

function exportFailures() {
  if (!currentTaskId) {
    return;
  }

  window.open(`/api/tasks/${currentTaskId}/failures.csv`, '_blank');
}

function resolveTaskModelLabel(task) {
  const profileId = task?.options?.selectedModelProfileId;
  const profile = defaultsPayload?.modelProfiles?.find((item) => item.id === profileId);
  return profile?.label ?? resolveSelectedModelLabel();
}

function inferTaskSourceLabel(task) {
  const spreadsheetPath = task?.options?.spreadsheet ?? '';
  if (spreadsheetPath.includes('AfterEdit')) {
    return 'AfterEdit 二阶段继续处理';
  }
  return task?.options?.manualEditGate ? '下载后进入人工剪辑' : '平台自动识别';
}

function inferTaskPlatformLabel(task) {
  const results = task?.result?.results ?? [];

  for (const item of results) {
    const label = derivePlatformLabelFromText(item.url);
    if (label !== '—') {
      return label;
    }
  }

  return derivePlatformLabelFromText(task?.options?.spreadsheet ?? '');
}

function inferNextAction(task) {
  const results = task?.result?.results ?? [];

  if (results.some((item) => item.archiveState === '已下载待剪辑')) {
    return '等待人工剪辑';
  }

  if (results.some((item) => item.archiveState === '已下载未归档')) {
    return '确认归档类目';
  }

  if (results.some((item) => item.failure?.errorCode === 'missing-credentials')) {
    return '补充下载凭证';
  }

  if (results.some((item) => item.failure?.errorCode === 'needs-fresh-cookies' || item.failure?.errorCode === 'cookies-expired')) {
    return '更新 Cookies';
  }

  if (results.some((item) => item.failure)) {
    return '处理失败项后重试';
  }

  if (task?.status === 'running' || task?.status === 'queued') {
    return '等待当前任务完成';
  }

  if (task?.status === 'succeeded') {
    return '无';
  }

  return '运行 Preflight 或启动任务';
}

function derivePlatformLabelFromText(text) {
  const normalized = String(text ?? '').toLowerCase();

  if (normalized.includes('afteredit')) {
    return '本地 AfterEdit 文件';
  }
  if (normalized.includes('bilibili.com') || normalized.includes('b23.tv')) {
    return 'Bilibili';
  }
  if (normalized.includes('youtube.com') || normalized.includes('youtu.be')) {
    return 'YouTube';
  }
  if (normalized.includes('douyin.com')) {
    return '抖音';
  }
  if (normalized.includes('tiktok.com')) {
    return 'TikTok';
  }

  return '—';
}

function humanizeFailureCode(errorCode, phase) {
  const mapping = {
    'missing-credentials': '缺少平台下载凭证',
    'needs-fresh-cookies': 'Cookies 需要重新获取',
    'cookies-expired': 'Cookies 已过期',
    'blocked-by-bilibili-412': '平台风控拦截',
    'platform-rate-limited': '平台请求过频',
    'rename-failed': '下载文件重命名失败',
    'output-not-detected': '未识别到下载产物',
    'download-failed': '下载失败',
    'tagging-failed': '打标失败',
    'archive-failed': '归档失败',
    'edited-file-missing': '未找到剪辑后文件',
    'edited-file-invalid-name': '剪辑文件名不符合规范',
    'edited-file-duplicate-name': '剪辑文件名重复',
    'local-file-missing': '未找到剪辑后文件'
  };

  return mapping[errorCode] ?? humanizePhase(phase, 'failed');
}

function humanizeFailureHint(errorCode, phase) {
  if (phase === 'download') {
    const mapping = {
      'missing-credentials': '请打开“配置下载凭证”，为当前平台补充 cookies.txt 或 cookies-from-browser。',
      'needs-fresh-cookies': '当前 cookies 不够新鲜，请重新导出后再运行。',
      'cookies-expired': '当前 cookies 已失效，请重新登录并更新凭证。',
      'blocked-by-bilibili-412': '平台当前触发了风控。优先检查该平台的登录态，必要时稍后重试。',
      'platform-rate-limited': '平台当前限制请求频率。请稍后重试，避免短时间批量重跑。',
      'rename-failed': '下载阶段已产生临时文件，但落盘重命名失败。请检查下载目录权限与磁盘状态。',
      'output-not-detected': '下载器运行结束，但程序未确认最终产物。建议重试一次；若持续出现，再检查平台凭证。',
      'download-failed': '下载未完成。请先检查平台凭证、网络状态和目标目录。'
    };

    return mapping[errorCode] ?? '下载未完成。请检查平台凭证、网络状态和目标目录。';
  }

  if (errorCode === 'edited-file-invalid-name') {
    return '剪辑导出文件名不符合规范。请保持“标题_分辨率_日期_时长秒数”格式后再继续。';
  }

  if (errorCode === 'edited-file-duplicate-name') {
    return 'AfterEdit 中出现重复文件名。请先整理为唯一文件名，再继续第二阶段任务。';
  }

  if (errorCode === 'edited-file-missing' || errorCode === 'local-file-missing') {
    return '表格里登记的剪辑文件在 AfterEdit 目录中不存在。请先补齐文件，再继续第二阶段任务。';
  }

  if (phase === 'tagging') {
    return '视频已准备好，但模型打标阶段失败。优先检查模型 API 配置、额度和连通性。';
  }

  if (phase === 'archive') {
    return '标签结果已生成，但归档阶段失败。请检查归档根目录权限与目标路径。';
  }

  return '当前条目未完成，请根据失败阶段处理后重新运行。';
}

function collectFormData() {
  const payload = {};

  for (const field of form.querySelectorAll('[name]')) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) {
      continue;
    }

    payload[field.name] = field.value;
  }

  return payload;
}

function renderPlatformCredentialFields(entries) {
  platformCredentialsFields.innerHTML = entries
    .map((entry) => {
      const platformLabel = {
        bilibili: 'Bilibili',
        youtube: 'YouTube',
        douyin: '抖音',
        tiktok: 'TikTok'
      }[entry.platform] ?? entry.platform;

      return `
        <section class="platform-credential-card" data-platform="${escapeHtml(entry.platform)}">
          <h3>${escapeHtml(platformLabel)}</h3>
          <div class="path-field is-filled">
            <div class="path-meta">
              <label for="${escapeHtml(entry.platform)}-cookies-file">cookies.txt</label>
              <span>优先用于需要登录态、最高码率或风控更严的内容。</span>
            </div>
            <div class="path-control">
              <input id="${escapeHtml(entry.platform)}-cookies-file" name="${escapeHtml(entry.platform)}-cookies-file" value="${escapeHtml(entry.cookiesFilePath ?? '')}" />
              <button
                class="picker-button"
                type="button"
                data-dialog-kind="file"
                data-target="${escapeHtml(entry.platform)}-cookies-file"
                data-prompt="选择 ${escapeHtml(platformLabel)} cookies.txt"
              >
                选择文件
              </button>
            </div>
          </div>
          <label>
            cookies-from-browser
            <input id="${escapeHtml(entry.platform)}-cookies-browser" name="${escapeHtml(entry.platform)}-cookies-browser" value="${escapeHtml(entry.cookiesFromBrowser ?? '')}" placeholder="例如 chrome / safari / firefox" />
          </label>
        </section>
      `;
    })
    .join('');
  bindPickerButtons();
  updateFilledState();
}

async function handleDropAssignment(event, targetName, kind) {
  const resolvedPath = resolveDroppedPath(event);

  if (resolvedPath) {
    setField(targetName, resolvedPath);
    return;
  }

  const droppedFiles = [...(event.dataTransfer?.files ?? [])];
  const firstFile = droppedFiles[0];

  if (kind === 'folder') {
    preflightOutput.textContent = '当前浏览器拖拽目录仍不能稳定拿到绝对路径。目录请改用“选择目录”。';
    return;
  }

  if (!firstFile) {
    preflightOutput.textContent = '未能从拖拽内容中解析出本地绝对路径。请改用“选择文件/目录”。';
    return;
  }

  preflightOutput.textContent = `正在接收拖拽文件：${firstFile.name}`;
  const storedPath = await uploadDroppedFile(firstFile);
  setField(targetName, storedPath);
  preflightOutput.textContent = `已接收拖拽文件并写入本地临时路径：${storedPath}`;
}

function resolveDroppedPath(event) {
  const droppedFiles = [...(event.dataTransfer?.files ?? [])];
  const firstFile = droppedFiles[0];

  if (firstFile && typeof firstFile.path === 'string' && firstFile.path.startsWith('/')) {
    return firstFile.path;
  }

  const uriList = event.dataTransfer?.getData('text/uri-list')?.trim();

  if (uriList) {
    const firstUri = uriList
      .split(/\r?\n/u)
      .find((line) => line.length > 0 && !line.startsWith('#'));

    if (firstUri?.startsWith('file://')) {
      return decodeFileUri(firstUri);
    }
  }

  const plainText = event.dataTransfer?.getData('text/plain')?.trim();

  if (plainText?.startsWith('file://')) {
    return decodeFileUri(plainText);
  }

  if (plainText?.startsWith('/')) {
    return plainText;
  }

  return null;
}

async function uploadDroppedFile(file) {
  const response = await fetch(`/api/upload-file?fileName=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream'
    },
    body: await file.arrayBuffer()
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = await response.json();
  return payload.storedPath;
}

function decodeFileUri(value) {
  try {
    return decodeURIComponent(value.replace(/^file:\/\//u, ''));
  } catch {
    return null;
  }
}

async function apiGet(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function apiPost(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

function setField(name, value) {
  const field = findNamedField(name);

  if (field) {
    field.value = value ?? '';
    updateFilledState();
    if (name === 'spreadsheet' || name === 'manualEditGate') {
      updateSourceModeLabel();
      updatePlatformLabel();
      updateNextActionLabel();
    }
  }
}

function fieldValue(name) {
  const field = findNamedField(name);
  return field?.value ?? '';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function updateFilledState() {
  for (const field of document.querySelectorAll('.drop-target')) {
    const targetName = field.dataset.target;
    const input = targetName ? findNamedField(targetName) : null;
    const hasValue =
      input instanceof HTMLInputElement && input.value.trim().length > 0;
    field.classList.toggle('is-filled', hasValue);
  }
}

function validateRequiredFields() {
  const requiredFieldNames = [
    'spreadsheet',
    'promptLibrary',
    'providerConfigPath',
    'downloadDir',
    'archiveRoot'
  ];

  for (const fieldName of requiredFieldNames) {
    const field = findNamedField(fieldName);

    if (field instanceof HTMLInputElement && field.value.trim().length === 0) {
      return {
        field,
        message: `请先填写必填项：${fieldName}`
      };
    }
  }

  return null;
}

function findNamedField(name) {
  const field = form.querySelector(`[name="${CSS.escape(name)}"]`);

  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
    return field;
  }

  return null;
}

function humanizePhase(phase, status) {
  if (phase === 'task') {
    return status === 'failed' ? '任务失败' : '任务完成';
  }

  return {
    spreadsheet: '读取表格',
    fixtures: '准备配置',
    download: '下载中',
    archive: '归档中',
    taxonomy: '加载标签库',
    tagging: '等待打标',
    'tagging-item': '打标中',
    'video-preprocess': '视频预处理中',
    writeback: '回填中',
    audit: '校验中'
  }[phase] ?? phase;
}

function mapTaskStatus(status) {
  return {
    pending: '等待中',
    running: '运行中',
    succeeded: '已完成',
    failed: '失败'
  }[status] ?? status;
}

function deriveOverallStatusFromEvent(event) {
  const phase = event?.phase ?? event?.stage;

  if (event?.status === 'failed') {
    return '失败';
  }

  if (phase === 'download' || phase === 'spreadsheet' || phase === 'fixtures') {
    return '下载中';
  }

  if (phase === 'taxonomy' || phase === 'tagging' || phase === 'tagging-item' || phase === 'video-preprocess') {
    return '等待打标';
  }

  return mapTaskStatus(event?.status);
}

function deriveOverallStatusFromTask(task) {
  const results = task?.result?.results ?? [];

  if (task?.status === 'failed' || results.some((item) => item.failure)) {
    return '失败';
  }

  if (results.some((item) => item.archiveState === '已下载待剪辑')) {
    return '等待剪辑';
  }

  if (task?.status === 'succeeded' && results.length > 0) {
    return '归档成功';
  }

  if (task?.status === 'running' || task?.status === 'queued') {
    return deriveOverallStatusFromEvent(task?.latestEvent);
  }

  return '未开始';
}

function resetStatusShell() {
  statusPhase.textContent = '待机';
  statusItem.textContent = '—';
  statusProgress.textContent = '—';
  statusOverall.textContent = '未开始';
  statusModel.textContent = resolveSelectedModelLabel();
  updateSourceModeLabel();
  updatePlatformLabel();
  updateNextActionLabel();
}

function buildDebugJson(payload) {
  return JSON.stringify(payload, null, 2);
}

async function wrapAction(action, outputNode) {
  try {
    await action();
  } catch (error) {
    outputNode.textContent = error instanceof Error ? error.message : String(error);
  }
}
