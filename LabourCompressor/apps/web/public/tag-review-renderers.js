import { escapeHtml } from './form-state.js';

export function renderReviewStatus(item, mode) {
  if (mode === 'problem-review') {
    if (item.decision === 'discard') return '<span class="stage-pill stage-failed">丢弃</span>';
    if (item.decision === 'keep-afteredit') return '<span class="stage-pill stage-succeeded">AfterEdit</span>';
    if (item.decision) return `<span class="stage-pill stage-running">${escapeHtml(renderDecisionLabel(item.decision))}</span>`;
    return '<span class="stage-pill stage-running">待复查</span>';
  }
  if (!item.reviewStatus) return '<span class="stage-pill stage-running">未同步</span>';
  if (item.reviewStatus === '通过') return '<span class="stage-pill stage-succeeded">通过</span>';
  if (item.reviewStatus === '需修改') return '<span class="stage-pill stage-failed">需修改</span>';
  return `<span class="stage-pill stage-running">${escapeHtml(item.reviewStatus)}</span>`;
}

export function renderCardTags(item, mode) {
  if (mode === 'problem-review') {
    return [item.phase, item.errorCode, item.nextStage].filter(Boolean)
      .map((value) => `<span>${escapeHtml(value)}</span>`).join('');
  }
  return (item.tagging?.tags ?? []).slice(0, 3).map((tag) =>
    `<span>${escapeHtml((tag.labelPath ?? []).join(' > ') || tag.dimension || '未命名标签')}</span>`
  ).join('');
}

export function renderDetailTags(item, mode) {
  if (mode === 'problem-review') return renderProblemDetail(item);
  const tagging = item.tagging ?? {};
  const tags = tagging.tags ?? [];
  return `
    <div class="review-state-box">
      <div><span class="status-label">LS 同步状态</span><strong>${escapeHtml(item.reviewStatus ?? '未同步')}</strong></div>
      <div><span class="status-label">备注</span><p>${escapeHtml(item.reviewNote ?? '—')}</p></div>
    </div>
    <div class="review-state-box">
      <div><span class="status-label">Taxonomy</span><strong>${escapeHtml(tagging.taxonomyVersion ?? '—')}</strong></div>
      <div><span class="status-label">模型复核</span><strong>${tagging.reviewRequired ? '需要' : '不需要'}</strong></div>
      <div><span class="status-label">复核原因</span><p>${escapeHtml(tagging.reviewReason ?? '—')}</p></div>
    </div>
    <div class="review-tag-list">
      ${tags.length === 0 ? '<p>JSON 中没有 tags。</p>' : tags.map((tag, index) => `
        <section class="review-tag-item"><h3>${index + 1}. ${escapeHtml(tag.dimension || '未命名维度')}</h3>
          <p><strong>路径</strong> ${escapeHtml((tag.labelPath ?? []).join(' > ') || '—')}</p>
          <p><strong>角色</strong> ${escapeHtml(tag.tagRole || '—')} · <strong>层级</strong> ${escapeHtml(tag.selectedLevel || '—')}</p>
          <p><strong>证据</strong> ${escapeHtml(tag.evidenceType || '—')} · <strong>置信度</strong> ${escapeHtml(tag.confidenceScore ?? '—')}</p>
          <p>${escapeHtml(tag.evidenceNote || '—')}</p></section>`).join('')}
    </div>`;
}

function renderProblemDetail(item) {
  return `
    <div class="review-state-box">
      <div><span class="status-label">阶段</span><strong>${escapeHtml(item.phase ?? '—')}</strong></div>
      <div><span class="status-label">错误码</span><strong>${escapeHtml(item.errorCode ?? '—')}</strong></div>
      <div><span class="status-label">原因</span><p>${escapeHtml(item.reason ?? '—')}</p></div>
    </div>
    <div class="review-state-box">
      <div><span class="status-label">决策</span><strong>${escapeHtml(renderDecisionLabel(item.decision))}</strong></div>
      <div><span class="status-label">目标池</span><strong>${escapeHtml(item.targetPool ?? '—')}</strong></div>
      <div><span class="status-label">下一环节</span><strong>${escapeHtml(item.nextStage ?? '—')}</strong></div>
      <div><span class="status-label">复查时间</span><p>${escapeHtml(item.reviewedAt ?? '—')}</p></div>
    </div>
    <div class="review-state-box">
      <div><span class="status-label">源路径</span><p>${escapeHtml(item.sourcePath ?? '—')}</p></div>
      <div><span class="status-label">当前路径</span><p>${escapeHtml(item.currentPath ?? '—')}</p></div>
    </div>`;
}

export function getItemTitle(item, mode) {
  return mode === 'problem-review'
    ? item.fileName ?? pathBaseName(item.relativePath ?? '问题片段')
    : item.videoFileName;
}
export function getItemRelativePath(item, mode) {
  return mode === 'problem-review' ? item.relativePath : item.videoRelativePath;
}
export function renderDecisionLabel(decision) {
  return ({
    discard: '丢弃', 'keep-afteredit': '保留到 AfterEdit',
    'keep-problem': '保留到 ProblemClips', 'manual-retry': '转人工命名'
  })[decision] ?? '待复查';
}
function pathBaseName(value) { return String(value).split(/[\\/]/u).filter(Boolean).pop() ?? String(value); }
