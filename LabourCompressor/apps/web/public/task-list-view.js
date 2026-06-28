import { escapeHtml } from './form-state.js';

const CHECK_LABELS = {
  spreadsheet: '用户表',
  taxonomy: '标签库',
  'prompt-library': '提示词库',
  'download-dir': '下载缓存目录',
  'archive-root': '归档根目录',
  'yt-dlp': '下载器',
  ffmpeg: '视频处理',
  provider: '模型 API'
};

const PHASE_LABELS = {
  spreadsheet: '读取表格',
  fixtures: '准备配置',
  download: '下载中',
  segmentation: '自动分割中',
  'segmentation-item': '自动分割中',
  archive: '归档中',
  taxonomy: '加载标签库',
  tagging: '等待打标',
  'tagging-item': '打标中',
  'video-preprocess': '视频预处理',
  writeback: '回填中',
  audit: '校验中',
  task: '任务完成'
};

const STATUS_LABELS = {
  pending: '等待',
  running: '进行中',
  succeeded: '已通过',
  failed: '未通过'
};

const CHECK_HINTS = {
  spreadsheet: '请确认用户表路径存在，并且文件没有被其他软件锁定。',
  taxonomy: '请检查标签库 preset 与本地文件是否存在。',
  'prompt-library': '请确认当前标签库对应的提示词库文件存在。',
  'download-dir': '请检查下载缓存目录是否可写。',
  'archive-root': '请检查归档根目录是否可写。',
  'yt-dlp': '请确认 yt-dlp 已安装并可执行。',
  ffmpeg: '请确认 ffmpeg 已安装并可执行。',
  provider: '检查模型 API Key、额度和网络连通性。'
};

export function renderPreflightChecklist(checks, targetNode) {
  const html = buildPreflightChecklistHtml(checks);
  targetNode.innerHTML = html;
  targetNode.classList.toggle('empty-state', html.length === 0);
}

export function renderPreflightMessage(message, targetNode, state = 'running') {
  targetNode.classList.remove('empty-state');
  targetNode.innerHTML = `
    <div class="task-list-row">
      <span class="stage-pill stage-${escapeHtml(state)}">${state === 'failed' ? '需要处理' : '进行中'}</span>
      <strong>${escapeHtml(message)}</strong>
      <span>—</span>
      <span>—</span>
    </div>
  `;
}

export function renderEventTimeline(events, targetNode) {
  if (!events.length) {
    targetNode.innerHTML = '';
    targetNode.classList.add('empty-state');
    return;
  }

  const detailsWasOpen = targetNode.querySelector?.('details')?.open === true;
  targetNode.classList.remove('empty-state');
  targetNode.innerHTML = buildEventTimelineHtml(events.slice(-120));
  const details = targetNode.querySelector?.('details');
  if (details) {
    details.open = detailsWasOpen;
  }
  targetNode.scrollTop = targetNode.scrollHeight;
}

export function buildPreflightChecklistHtml(checks) {
  if (!checks?.length) {
    return '';
  }

  const failedChecks = checks.filter((check) => !check.ok);

  if (failedChecks.length === 0) {
    return `
      <div class="task-list-row task-list-row-compact">
        <span class="stage-pill stage-succeeded">已通过</span>
        <strong>Preflight 通过，可以启动任务</strong>
        <span>—</span>
        <span>—</span>
      </div>
    `;
  }

  return `
    <div class="task-list-header">
      <span>检查项</span>
      <span>状态</span>
      <span>结果</span>
      <span>处理建议</span>
    </div>
    ${failedChecks.map((check) => renderCheckRow(check)).join('')}
    <details class="debug-details">
      <summary>查看完整检查详情</summary>
      ${renderRawPreflightDetails(checks, true)}
    </details>
  `;
}

export function buildEventTimelineHtml(events) {
  if (!events?.length) {
    return '';
  }

  const latest = events.at(-1);
  return `
    ${latest === undefined ? '' : renderEventSummary(latest)}
    <details class="debug-details">
      <summary>查看阶段详情</summary>
      <div class="task-list-header">
        <span>阶段</span>
        <span>状态</span>
        <span>当前对象</span>
        <span>进度 / 最新消息</span>
      </div>
      ${events.map((event) => renderEventRow(event)).join('')}
    </details>
  `;
}

function renderCheckRow(check) {
  const state = check.ok ? 'succeeded' : 'failed';
  const status = check.ok ? '已通过' : '未通过';
  const key = String(check.key ?? '');
  const hint = resolveCheckHint(check, key);
  return `
    <div class="task-list-row">
      <strong>${escapeHtml(CHECK_LABELS[key] ?? key)}</strong>
      <span class="stage-pill stage-${state}">${status}</span>
      <span>${escapeHtml(check.message ?? '')}</span>
      <span>${escapeHtml(hint)}</span>
    </div>
  `;
}

function resolveCheckHint(check, key) {
  if (check.ok) {
    return '无需处理';
  }

  if (key === 'yt-dlp' && check.details?.isStale === true) {
    return '更新 yt-dlp 到 90 天内版本，或仅处理抖音任务时确认 Douyin SSR 已启用。';
  }

  return CHECK_HINTS[key] ?? '请根据提示修正后重新运行 Preflight。';
}

function renderEventRow(event) {
  const phase = event.phase ?? event.stage ?? '';
  const status = event.status ?? 'running';
  return `
    <div class="task-list-row">
      <strong>${escapeHtml(PHASE_LABELS[phase] ?? phase)}</strong>
      <span class="stage-pill stage-${statusClassName(status)}">${escapeHtml(STATUS_LABELS[status] ?? status)}</span>
      <span>${escapeHtml(event.currentItem || '—')}</span>
      <span>${escapeHtml(formatEventProgress(event))}</span>
    </div>
  `;
}

function renderEventSummary(event) {
  const phase = event.phase ?? event.stage ?? '';
  return `
    <div class="task-list-row task-list-row-compact">
      <strong>${escapeHtml(PHASE_LABELS[phase] ?? phase)}</strong>
      <span class="stage-pill stage-${statusClassName(event.status ?? 'running')}">${escapeHtml(STATUS_LABELS[event.status ?? 'running'] ?? event.status ?? 'running')}</span>
      <span>${escapeHtml(event.currentItem || '—')}</span>
      <span>${escapeHtml(formatEventProgress(event))}</span>
    </div>
  `;
}

function statusClassName(status) {
  if (status === 'succeeded') {
    return 'succeeded';
  }
  if (status === 'failed') {
    return 'failed';
  }
  return 'running';
}

function formatEventProgress(event) {
  if (event.progress) {
    return `${event.progress.current}/${event.progress.total} · ${event.message ?? ''}`;
  }

  return event.message ?? '—';
}

function renderRawPreflightDetails(checks, includeMessages) {
  const payload = includeMessages
    ? checks
    : checks.map((check) => ({ key: check.key, ok: check.ok }));
  return `<pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
}
