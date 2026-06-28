let refs = {};
let getDefaults = () => null;
let getFieldValue = () => '';
let getSelectedModelLabel = () => '—';
let contextState = {
  model: '—',
  source: '平台自动识别',
  platform: '—',
  nextAction: '运行 Preflight 或启动任务'
};

export function initTaskStatusView(options) {
  refs = options.refs;
  getDefaults = options.getDefaults;
  getFieldValue = options.getFieldValue;
  getSelectedModelLabel = options.getSelectedModelLabel;
  contextState = {
    model: '—',
    source: '平台自动识别',
    platform: '—',
    nextAction: '运行 Preflight 或启动任务'
  };
  renderStatusContext();
}

export function deriveTaskControlState(task) {
  const status = task?.status;
  const hasTask = Boolean(task?.id);

  return {
    pause: hasTask && (status === 'queued' || status === 'running'),
    resume: hasTask && (status === 'paused' || status === 'pausing'),
    stop: hasTask && ['queued', 'running', 'pausing', 'paused', 'cancelling'].includes(status)
  };
}

export function deriveActionVisibility(visible) {
  return {
    hidden: !visible,
    disabled: !visible
  };
}

export function applyTaskControlState(buttonRefs, task) {
  const controls = deriveTaskControlState(task);

  applyActionVisibility(buttonRefs.pause, controls.pause);
  applyActionVisibility(buttonRefs.resume, controls.resume);
  applyActionVisibility(buttonRefs.stop, controls.stop);
  buttonRefs.container.hidden = !controls.pause && !controls.resume && !controls.stop;
}

export function bindTaskControlActions(buttonRefs, handlers) {
  for (const action of ['pause', 'resume', 'stop', 'exportFailures', 'partialWriteback']) {
    buttonRefs[action].addEventListener('click', handlers[action]);
  }
}

function applyActionVisibility(button, visible) {
  const state = deriveActionVisibility(visible);
  button.hidden = state.hidden;
  button.disabled = state.disabled;
}

export function updateSourceModeLabel() {
  if (getFieldValue('sourceMode') === 'local') {
    contextState.source = '本地素材导入';
    renderStatusContext();
    return;
  }

  const spreadsheetPath = getFieldValue('spreadsheet');

  if (spreadsheetPath.includes('AfterEdit')) {
    contextState.source = 'AfterEdit 二阶段继续处理';
    renderStatusContext();
    return;
  }

  if (getFieldValue('autoSegmentation') === 'true') {
    contextState.source = '下载后自动分割';
    renderStatusContext();
    return;
  }

  contextState.source = getFieldValue('manualEditGate') === 'true' ? '下载后进入人工剪辑' : '平台自动识别';
  renderStatusContext();
}

export function updatePlatformLabel() {
  if (getFieldValue('sourceMode') === 'local') {
    contextState.platform = '本地文件';
    renderStatusContext();
    return;
  }

  contextState.platform = derivePlatformLabelFromText(getFieldValue('spreadsheet'));
  renderStatusContext();
}

export function updateNextActionLabel(task) {
  contextState.nextAction = inferNextAction(task);
  renderStatusContext();
}

export function renderLiveEvent(event) {
  showActiveStatus();
  refs.statusOverall.textContent = deriveOverallStatusFromEvent(event);
  refs.statusPhase.textContent = humanizePhase(event.phase ?? event.stage, event.status);
  setCurrentItem(event.currentItem);
  renderProgress(event);
}

export function renderStatusMessage({ overall, phase, currentItem = '' }) {
  showActiveStatus();
  refs.statusOverall.textContent = String(overall ?? '');
  refs.statusPhase.textContent = String(phase ?? '');
  setCurrentItem(currentItem);
  clearProgress();
}

export function renderTaskStatus(task) {
  contextState = {
    model: resolveTaskModelLabel(task),
    source: inferTaskSourceLabel(task),
    platform: inferTaskPlatformLabel(task),
    nextAction: inferNextAction(task)
  };
  showActiveStatus();
  renderStatusContext();
  if (task.latestEvent) {
    renderLiveEvent(task.latestEvent);
  } else {
    refs.statusPhase.textContent = mapTaskStatus(task?.status) ?? '';
    setCurrentItem('');
    clearProgress();
  }

  refs.statusOverall.textContent = deriveOverallStatusFromTask(task);
}

export function resetStatusShell() {
  refs.taskIdleState.hidden = false;
  refs.taskActiveState.hidden = true;
  if (refs.runtimeDetailsPanel) {
    refs.runtimeDetailsPanel.hidden = true;
  }
  if (refs.debugRecoveryPanel) {
    refs.debugRecoveryPanel.hidden = true;
  }
  refs.statusPhase.textContent = '';
  refs.statusItem.textContent = '';
  refs.statusItem.title = '';
  refs.statusCurrent.hidden = true;
  refs.statusProgress.textContent = '';
  refs.statusProgressTrack.hidden = true;
  refs.statusProgressBar.style.width = '0%';
  refs.statusProgressTrack.setAttribute('aria-valuenow', '0');
  refs.statusOverall.textContent = '';
  contextState.model = getSelectedModelLabel();
  updateSourceModeLabel();
  updatePlatformLabel();
  updateNextActionLabel();
}

export function resolveTaskModelLabel(task) {
  const profileId = task?.options?.selectedModelProfileId;
  const profile = getDefaults()?.modelProfiles?.find((item) => item.id === profileId);
  return profile?.label ?? getSelectedModelLabel();
}

function renderStatusContext() {
  if (!refs.statusContext || !refs.statusModel) {
    return;
  }

  setOptionalText(refs.statusModel, contextState.model, '—');
  setOptionalText(refs.statusSource, contextState.source);
  setOptionalText(refs.statusPlatform, contextState.platform, '—');
  const nextAction = isActionableNextAction(contextState.nextAction) ? contextState.nextAction : '';
  setOptionalText(refs.statusNextAction, nextAction);
  refs.statusContext.hidden = refs.statusModel.hidden && refs.statusSource.hidden && refs.statusPlatform.hidden;
}

function setOptionalText(node, value, emptyValue = '') {
  const text = String(value ?? '').trim();
  node.textContent = text;
  node.hidden = text.length === 0 || text === emptyValue;
}

function isActionableNextAction(value) {
  return ![
    '',
    '无',
    '等待当前任务完成',
    '等待当前处理项完成后暂停',
    '正在取消任务',
    '运行 Preflight 或启动任务'
  ].includes(String(value ?? '').trim());
}

function showActiveStatus() {
  refs.taskIdleState.hidden = true;
  refs.taskActiveState.hidden = false;
  if (refs.runtimeDetailsPanel) {
    refs.runtimeDetailsPanel.hidden = false;
  }
  if (refs.debugRecoveryPanel) {
    refs.debugRecoveryPanel.hidden = false;
  }
}

function setCurrentItem(currentItem) {
  const item = String(currentItem ?? '').trim();
  refs.statusItem.textContent = item;
  refs.statusItem.title = item;
  refs.statusCurrent.hidden = item.length === 0;
}

function inferTaskSourceLabel(task) {
  if (task?.options?.sourceMode === 'local') {
    return '本地素材导入';
  }

  const spreadsheetPath = task?.options?.spreadsheet ?? '';
  if (spreadsheetPath.includes('AfterEdit')) {
    return 'AfterEdit 二阶段继续处理';
  }
  if (task?.options?.autoSegmentation) {
    return '下载后自动分割';
  }
  return task?.options?.manualEditGate ? '下载后进入人工剪辑' : '平台自动识别';
}

function inferTaskPlatformLabel(task) {
  if (task?.options?.sourceMode === 'local') {
    return '本地文件';
  }

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

  if (results.some((item) => item.archiveState === '自动分割待处理')) {
    return '处理问题片段';
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

  if (results.some((item) => [
    'douyin-detail-api-blocked',
    'douyin-ssr-unavailable',
    'douyin-play-url-expired'
  ].includes(item.failure?.errorCode))) {
    return '刷新抖音链接或凭证';
  }

  if (results.some((item) => [
    'xiaohongshu-no-formats',
    'xiaohongshu-page-unavailable',
    'xiaohongshu-video-data-unavailable',
    'xiaohongshu-play-url-expired',
    'xiaohongshu-media-type-invalid',
    'xiaohongshu-media-truncated'
  ].includes(item.failure?.errorCode))) {
    return '重试小红书下载或更新凭证';
  }

  if (results.some((item) => item.failure)) {
    return '处理失败项后重试';
  }

  if (results.some(isPendingResult)) {
    return '处理待处理项';
  }

  if (task?.status === 'running' || task?.status === 'queued') {
    return '等待当前任务完成';
  }

  if (task?.status === 'pausing') {
    return '等待当前处理项完成后暂停';
  }

  if (task?.status === 'paused') {
    return '恢复任务或强制停止';
  }

  if (task?.status === 'cancelling') {
    return '正在取消任务';
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
  if (normalized.includes('xiaohongshu.com')) {
    return '小红书';
  }

  return '—';
}

function humanizePhase(phase, status) {
  if (phase === 'task') {
    if (status === 'failed') {
      return '任务失败';
    }
    return status === 'succeeded' ? '任务完成' : '任务控制';
  }

  return {
    spreadsheet: '读取表格',
    fixtures: '准备配置',
    download: '下载中',
    segmentation: status === 'succeeded' ? '自动分割完成' : '自动分割中',
    'segmentation-item': '自动分割中',
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
    queued: '等待中',
    running: '运行中',
    pausing: '暂停中',
    paused: '已暂停',
    cancelling: '取消中',
    cancelled: '已取消',
    succeeded: '已完成',
    failed: '失败'
  }[status] ?? status;
}

function deriveOverallStatusFromEvent(event) {
  const phase = event?.phase ?? event?.stage;

  if (event?.status === 'failed') {
    return '失败';
  }

  if (phase === 'segmentation' || phase === 'segmentation-item') {
    return event?.status === 'succeeded' ? '自动分割完成' : '自动分割中';
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

  if (results.some((item) => item.archiveState === '自动分割待处理')) {
    return '自动分割待处理';
  }

  if (results.some((item) => item.archiveState === '已下载待剪辑')) {
    return '等待剪辑';
  }

  if (task?.status === 'failed' || results.some((item) => item.failure)) {
    return '失败';
  }

  if (task?.status === 'succeeded' && results.some(isPendingResult)) {
    return '存在待处理项';
  }

  if (task?.status === 'cancelled') {
    return '已取消';
  }

  if (task?.status === 'paused') {
    return '已暂停';
  }

  if (task?.status === 'pausing') {
    return '暂停中';
  }

  if (task?.status === 'cancelling') {
    return '取消中';
  }

  if (task?.status === 'succeeded' && results.length > 0) {
    return '归档成功';
  }

  if (task?.status === 'running' || task?.status === 'queued') {
    return task?.latestEvent
      ? deriveOverallStatusFromEvent(task.latestEvent)
      : mapTaskStatus(task.status);
  }

  return '未开始';
}

function isPendingResult(item) {
  return !item?.failure && ![
    '已归档',
    '已跳过：视频过短'
  ].includes(item?.archiveState);
}

function renderProgress(event) {
  const current = Number(event.progress?.current ?? 0);
  const total = Number(event.progress?.total ?? 0);
  const percent = total > 0
    ? Math.max(0, Math.min(100, Math.round((current / total) * 100)))
    : 0;
  const parts = [total > 0 ? `${current} / ${total} · ${percent}%` : '处理中'];
  const speed = event.details?.downloadSpeed;
  const eta = event.details?.downloadEta;

  if (typeof speed === 'string' && speed.length > 0) {
    parts.push(speed);
  }

  if (typeof eta === 'string' && eta.length > 0) {
    parts.push(`ETA ${eta}`);
  }

  refs.statusProgress.textContent = parts.join(' · ');
  refs.statusProgressTrack.hidden = total <= 0;
  refs.statusProgressBar.style.width = `${percent}%`;
  refs.statusProgressTrack.setAttribute('aria-valuenow', String(percent));
}

function clearProgress() {
  refs.statusProgress.textContent = '';
  refs.statusProgressTrack.hidden = true;
  refs.statusProgressBar.style.width = '0%';
  refs.statusProgressTrack.setAttribute('aria-valuenow', '0');
}
