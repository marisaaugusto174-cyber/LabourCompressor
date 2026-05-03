let refs = {};
let getDefaults = () => null;
let getFieldValue = () => '';
let getSelectedModelLabel = () => '—';

export function initTaskStatusView(options) {
  refs = options.refs;
  getDefaults = options.getDefaults;
  getFieldValue = options.getFieldValue;
  getSelectedModelLabel = options.getSelectedModelLabel;
}

export function updateSourceModeLabel() {
  const spreadsheetPath = getFieldValue('spreadsheet');

  if (spreadsheetPath.includes('AfterEdit')) {
    refs.statusSource.textContent = 'AfterEdit 二阶段继续处理';
    return;
  }

  refs.statusSource.textContent = getFieldValue('manualEditGate') === 'true' ? '下载后进入人工剪辑' : '平台自动识别';
}

export function updatePlatformLabel() {
  refs.statusPlatform.textContent = derivePlatformLabelFromText(getFieldValue('spreadsheet'));
}

export function updateNextActionLabel(task) {
  refs.statusNextAction.textContent = inferNextAction(task);
}

export function renderLiveEvent(event) {
  refs.statusOverall.textContent = deriveOverallStatusFromEvent(event);
  refs.statusPhase.textContent = humanizePhase(event.phase ?? event.stage, event.status);
  refs.statusItem.textContent = event.currentItem || '—';
  refs.statusProgress.textContent = event.progress
    ? `${event.progress.current}/${event.progress.total} (${Math.round((event.progress.current / Math.max(1, event.progress.total)) * 100)}%)`
    : '—';
}

export function renderTaskStatus(task) {
  refs.statusModel.textContent = resolveTaskModelLabel(task);
  refs.statusSource.textContent = inferTaskSourceLabel(task);
  refs.statusPlatform.textContent = inferTaskPlatformLabel(task);
  refs.statusNextAction.textContent = inferNextAction(task);
  if (task.latestEvent) {
    renderLiveEvent(task.latestEvent);
  }

  refs.statusOverall.textContent = deriveOverallStatusFromTask(task);
}

export function resetStatusShell() {
  refs.statusPhase.textContent = '待机';
  refs.statusItem.textContent = '—';
  refs.statusProgress.textContent = '—';
  refs.statusOverall.textContent = '未开始';
  refs.statusModel.textContent = getSelectedModelLabel();
  updateSourceModeLabel();
  updatePlatformLabel();
  updateNextActionLabel();
}

export function resolveTaskModelLabel(task) {
  const profileId = task?.options?.selectedModelProfileId;
  const profile = getDefaults()?.modelProfiles?.find((item) => item.id === profileId);
  return profile?.label ?? getSelectedModelLabel();
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
