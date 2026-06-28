import { apiGet, apiPost, buildDebugJson } from './api-client.js';
import { escapeHtml } from './form-state.js';

const INITIAL_RENDER_COUNT = 36;
const RENDER_BATCH_SIZE = 24;

const refs = {
  fileProtocolWarning: document.querySelector('#file-protocol-warning'),
  reviewDirectory: document.querySelector('#review-directory'),
  chooseReviewDirectory: document.querySelector('#choose-review-directory'),
  scanButton: document.querySelector('#scan-button'),
  downloadLabelStudioPackage: document.querySelector('#download-ls-package'),
  labelStudioUrl: document.querySelector('#ls-url'),
  labelStudioToken: document.querySelector('#ls-token'),
  labelStudioProjectId: document.querySelector('#ls-project-id'),
  labelStudioProjectTitle: document.querySelector('#ls-project-title'),
  importLabelStudio: document.querySelector('#import-ls'),
  syncLabelStudio: document.querySelector('#sync-ls'),
  labelStudioProjectLink: document.querySelector('#ls-project-link'),
  summaryPaired: document.querySelector('#summary-paired'),
  summaryUnpairedVideos: document.querySelector('#summary-unpaired-videos'),
  summaryOrphanJson: document.querySelector('#summary-orphan-json'),
  summaryInvalidJson: document.querySelector('#summary-invalid-json'),
  reviewGrid: document.querySelector('#review-grid'),
  loadMore: document.querySelector('#load-more'),
  detailView: document.querySelector('#detail-view'),
  detailTitle: document.querySelector('#detail-title'),
  detailSubtitle: document.querySelector('#detail-subtitle'),
  detailVideo: document.querySelector('#detail-video'),
  detailTags: document.querySelector('#detail-tags'),
  acceptedPathList: document.querySelector('#accepted-path-list'),
  acceptedPathSelect: document.querySelector('#accepted-path-select'),
  addAcceptedPath: document.querySelector('#add-accepted-path'),
  saveAcceptedResult: document.querySelector('#save-accepted-result'),
  detailPosition: document.querySelector('#detail-position'),
  previousDetail: document.querySelector('#previous-detail'),
  nextDetail: document.querySelector('#next-detail'),
  closeDetail: document.querySelector('#close-detail'),
  openCurrentLabelStudioTask: document.querySelector('#open-current-ls-task'),
  diagnosticsList: document.querySelector('#diagnostics-list'),
  reviewOutput: document.querySelector('#review-output')
};

let currentScan = null;
let currentItems = [];
let renderedCount = 0;
let selectedIndex = -1;
let thumbnailObserver = null;
let selectedAcceptedPaths = [];

boot().catch((error) => {
  showDiagnostics([{ severity: 'error', message: error.message }]);
});

async function boot() {
  if (location.protocol === 'file:') {
    refs.fileProtocolWarning.classList.remove('hidden');
    return;
  }

  const defaultsPayload = await apiGet('/api/defaults');
  refs.reviewDirectory.value = defaultsPayload.defaults?.reviewDirectory ?? '';
  refs.labelStudioUrl.value = localStorage.getItem('tagReviewLabelStudioUrl') ?? 'http://127.0.0.1:8080';
  refs.labelStudioProjectTitle.value = 'Tag Review AfterEdit';
  bindActions();
}

function bindActions() {
  refs.chooseReviewDirectory.addEventListener('click', () => wrapAction(chooseReviewDirectory));
  refs.scanButton.addEventListener('click', () => wrapAction(scanDirectory));
  refs.downloadLabelStudioPackage.addEventListener('click', () => wrapAction(downloadLabelStudioPackage));
  refs.importLabelStudio.addEventListener('click', () => wrapAction(importIntoLabelStudio));
  refs.syncLabelStudio.addEventListener('click', () => wrapAction(syncLabelStudio));
  refs.loadMore.addEventListener('click', () => renderMoreItems());
  refs.previousDetail.addEventListener('click', () => openDetail(selectedIndex - 1));
  refs.nextDetail.addEventListener('click', () => openDetail(selectedIndex + 1));
  refs.closeDetail.addEventListener('click', closeDetail);
  refs.addAcceptedPath.addEventListener('click', addAcceptedPath);
  refs.saveAcceptedResult.addEventListener('click', () => wrapAction(saveAcceptedResult));
  refs.detailView.addEventListener('click', (event) => {
    if (event.target === refs.detailView) {
      closeDetail();
    }
  });
  refs.openCurrentLabelStudioTask.addEventListener('click', openCurrentLabelStudioTask);
  refs.labelStudioProjectId.addEventListener('input', updateActionState);
  refs.labelStudioUrl.addEventListener('input', updateActionState);
  refs.labelStudioToken.addEventListener('input', updateActionState);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isDetailOpen()) {
      closeDetail();
    }
  });
  window.addEventListener('scroll', maybeAutoLoadMore, { passive: true });
}

async function chooseReviewDirectory() {
  const payload = await apiPost('/api/dialog/open-folder', {
    prompt: '选择待质检文件夹',
    defaultPath: refs.reviewDirectory.value.trim() || undefined
  });

  if (!payload.cancelled && typeof payload.path === 'string' && payload.path.length > 0) {
    refs.reviewDirectory.value = payload.path;
    refs.reviewOutput.textContent = `已选择目录：${payload.path}`;
    return;
  }

  if (payload.cancelled) {
    refs.reviewOutput.textContent = '已取消目录选择。';
  }
}

async function scanDirectory() {
  const directoryPath = requireDirectoryPath();

  refs.reviewOutput.textContent = '正在扫描...';
  const payload = await apiPost('/api/tag-review/scan', { directoryPath });
  currentScan = payload;
  currentItems = payload.pairedItems ?? [];
  renderedCount = 0;
  selectedIndex = -1;

  renderSummary(payload);
  renderDiagnostics(payload);
  resetGrid();
  renderMoreItems(INITIAL_RENDER_COUNT);
  updateActionState();
  refs.reviewOutput.textContent = buildDebugJson({
    directoryPath: payload.directoryPath,
    pairedItems: payload.pairedItems?.length ?? 0,
    unpairedVideos: payload.unpairedVideos?.length ?? 0,
    orphanJsonFiles: payload.orphanJsonFiles?.length ?? 0,
    invalidJsonFiles: payload.invalidJsonFiles?.length ?? 0,
    stateItems: payload.state?.items ? Object.keys(payload.state.items).length : 0
  });
}

function renderSummary(payload) {
  refs.summaryPaired.textContent = String(payload.pairedItems?.length ?? 0);
  refs.summaryUnpairedVideos.textContent = String(payload.unpairedVideos?.length ?? 0);
  refs.summaryOrphanJson.textContent = String(payload.orphanJsonFiles?.length ?? 0);
  refs.summaryInvalidJson.textContent = String(payload.invalidJsonFiles?.length ?? 0);
}

function renderDiagnostics(payload) {
  const rows = [
    ...(payload.unpairedVideos ?? []).map((item) => ({
      kind: '无 JSON 视频',
      path: item.relativePath,
      detail: '当前不会进入 Label Studio 质检任务'
    })),
    ...(payload.orphanJsonFiles ?? []).map((item) => ({
      kind: '孤儿 JSON',
      path: item.relativePath,
      detail: '未找到同目录同 stem 视频'
    })),
    ...(payload.invalidJsonFiles ?? []).map((item) => ({
      kind: '无效 JSON',
      path: item.relativePath,
      detail: item.errorMessage ?? 'JSON 解析失败'
    }))
  ];

  if (rows.length === 0) {
    refs.diagnosticsList.classList.add('empty-state');
    refs.diagnosticsList.innerHTML = '<p>未发现未配对或无效文件。</p>';
    return;
  }

  refs.diagnosticsList.classList.remove('empty-state');
  refs.diagnosticsList.innerHTML = `
    <div class="task-list-header review-diagnostics-header">
      <span>类型</span>
      <span>文件</span>
      <span>说明</span>
    </div>
    ${rows.map((row) => `
      <div class="task-list-row review-diagnostics-row">
        <strong>${escapeHtml(row.kind)}</strong>
        <span>${escapeHtml(row.path)}</span>
        <span>${escapeHtml(row.detail)}</span>
      </div>
    `).join('')}
  `;
}

function resetGrid() {
  disconnectThumbnailObserver();
  refs.reviewGrid.classList.toggle('empty-state', currentItems.length === 0);
  refs.reviewGrid.innerHTML = currentItems.length === 0
    ? '<p>没有可质检的同名视频 / JSON 配对。</p>'
    : '';
  thumbnailObserver = new IntersectionObserver(handleThumbnailIntersection, {
    rootMargin: '360px 0px'
  });
}

function renderMoreItems(count = RENDER_BATCH_SIZE) {
  if (currentItems.length === 0) {
    updateActionState();
    return;
  }

  const end = Math.min(renderedCount + count, currentItems.length);
  const fragment = document.createDocumentFragment();

  for (let index = renderedCount; index < end; index += 1) {
    fragment.appendChild(buildCard(currentItems[index], index));
  }

  refs.reviewGrid.appendChild(fragment);
  renderedCount = end;
  updateActionState();
}

function buildCard(item, index) {
  const card = document.createElement('article');
  const tags = item.tagging?.tags ?? [];
  const visibleTags = tags.slice(0, 3);
  const remainingTagCount = Math.max(0, tags.length - visibleTags.length);
  card.className = 'review-card';
  card.dataset.index = String(index);
  card.innerHTML = `
    <div class="review-card-video">
      <img alt="" loading="lazy" data-src="${escapeHtml(thumbnailUrl(item))}" />
      <div class="review-card-cover-bar">
        <span>#${index + 1}</span>
        ${renderReviewStatus(item)}
      </div>
      <span class="review-card-media-type">${escapeHtml(item.videoFileName.split('.').pop()?.toUpperCase() ?? 'VIDEO')}</span>
    </div>
    <div class="review-card-body">
      <div class="review-card-title">
        <strong>${escapeHtml(item.videoFileName)}</strong>
      </div>
      <div class="review-card-meta">${escapeHtml(item.videoRelativePath)}</div>
      <div class="review-card-tags">
        ${visibleTags.map((tag) => `
          <span>${escapeHtml((tag.labelPath ?? []).join(' > ') || tag.dimension || '未命名标签')}</span>
        `).join('')}
        ${remainingTagCount === 0 ? '' : `<span class="review-card-tag-more">+${remainingTagCount}</span>`}
        ${tags.length === 0 ? '<span class="review-card-tag-empty">无模型标签</span>' : ''}
      </div>
    </div>
  `;
  card.addEventListener('click', () => {
    openDetail(index);
  });
  const thumbnail = card.querySelector('img');
  if (thumbnail) {
    thumbnail.addEventListener('error', () => {
      thumbnail.classList.add('is-thumbnail-missing');
      thumbnail.removeAttribute('src');
    });
    thumbnailObserver?.observe(thumbnail);
  }
  return card;
}

function renderReviewStatus(item) {
  const status = item.reviewStatus;
  if (!status) {
    return '<span class="stage-pill stage-running">未同步</span>';
  }
  if (status === '通过') {
    return '<span class="stage-pill stage-succeeded">通过</span>';
  }
  if (status === '需修改') {
    return '<span class="stage-pill stage-failed">需修改</span>';
  }
  return `<span class="stage-pill stage-running">${escapeHtml(status)}</span>`;
}

function handleThumbnailIntersection(entries) {
  for (const entry of entries) {
    const image = entry.target;

    if (!(image instanceof HTMLImageElement)) {
      continue;
    }

    if (entry.isIntersecting && !image.src && image.dataset.src) {
      image.src = image.dataset.src;
      thumbnailObserver?.unobserve(image);
    }
  }
}

function maybeAutoLoadMore() {
  if (isDetailOpen()) {
    return;
  }

  if (renderedCount >= currentItems.length) {
    return;
  }

  const remaining = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;

  if (remaining < 900) {
    renderMoreItems();
  }
}

function openDetail(index) {
  if (index < 0 || index >= currentItems.length) {
    return;
  }

  selectedIndex = index;
  const item = currentItems[index];

  document.body.classList.add('is-review-modal-open');
  refs.detailView.classList.remove('hidden');
  refs.detailTitle.textContent = item.videoFileName;
  refs.detailSubtitle.textContent = `${item.videoRelativePath} · JSON ${item.jsonRelativePath}`;
  refs.detailVideo.src = mediaUrl(item);
  selectedAcceptedPaths = [...(item.acceptedResult?.acceptedPaths ?? item.tagging?.tags?.map((tag) => (tag.labelPath ?? []).join(' > ')).filter(Boolean) ?? [])];
  renderAcceptedPathOptions();
  renderAcceptedPaths();
  refs.detailTags.innerHTML = renderDetailTags(item);
  refs.detailPosition.textContent = `${index + 1} / ${currentItems.length}`;
  refs.previousDetail.disabled = index === 0;
  refs.nextDetail.disabled = index === currentItems.length - 1;
  refs.openCurrentLabelStudioTask.disabled = !canOpenLabelStudioTask(item);
  refs.saveAcceptedResult.disabled = !(currentScan?.taxonomySnapshot?.paths?.length > 0);
  refs.closeDetail.focus();
}

function closeDetail() {
  refs.detailVideo.pause();
  refs.detailVideo.removeAttribute('src');
  refs.detailVideo.load();
  refs.detailView.classList.add('hidden');
  document.body.classList.remove('is-review-modal-open');
}

function isDetailOpen() {
  return !refs.detailView.classList.contains('hidden');
}

function renderDetailTags(item) {
  const tagging = item.tagging ?? {};
  const tags = tagging.tags ?? [];
  return `
    <div class="review-state-box">
      <div>
        <span class="status-label">LS 同步状态</span>
        <strong>${escapeHtml(item.reviewStatus ?? '未同步')}</strong>
      </div>
      <div>
        <span class="status-label">备注</span>
        <p>${escapeHtml(item.reviewNote ?? '—')}</p>
      </div>
    </div>
    <div class="review-state-box">
      <div><span class="status-label">Taxonomy</span><strong>${escapeHtml(tagging.taxonomyVersion ?? '—')}</strong></div>
      <div><span class="status-label">模型复核</span><strong>${tagging.reviewRequired ? '需要' : '不需要'}</strong></div>
      <div><span class="status-label">复核原因</span><p>${escapeHtml(tagging.reviewReason ?? '—')}</p></div>
    </div>
    <div class="review-tag-list">
      ${tags.length === 0 ? '<p>JSON 中没有 tags。</p>' : tags.map((tag, index) => `
        <section class="review-tag-item">
          <h3>${index + 1}. ${escapeHtml(tag.dimension || '未命名维度')}</h3>
          <p><strong>路径</strong> ${escapeHtml((tag.labelPath ?? []).join(' > ') || '—')}</p>
          <p><strong>角色</strong> ${escapeHtml(tag.tagRole || '—')} · <strong>层级</strong> ${escapeHtml(tag.selectedLevel || '—')}</p>
          <p><strong>证据</strong> ${escapeHtml(tag.evidenceType || '—')} · <strong>置信度</strong> ${escapeHtml(tag.confidenceScore ?? '—')}</p>
          <p>${escapeHtml(tag.evidenceNote || '—')}</p>
        </section>
      `).join('')}
    </div>
  `;
}

function renderAcceptedPathOptions() {
  const paths = currentScan?.taxonomySnapshot?.paths ?? [];

  refs.acceptedPathSelect.innerHTML = paths.length === 0
    ? '<option value="">未找到 taxonomy 快照</option>'
    : paths.map((pathValue) => `
      <option value="${escapeHtml(pathValue)}">${escapeHtml(pathValue)}</option>
    `).join('');
  refs.acceptedPathSelect.disabled = paths.length === 0;
  refs.addAcceptedPath.disabled = paths.length === 0;
}

function renderAcceptedPaths() {
  if (selectedAcceptedPaths.length === 0) {
    refs.acceptedPathList.classList.add('empty-state');
    refs.acceptedPathList.innerHTML = '<p>未选择 accepted 路径。</p>';
    return;
  }

  refs.acceptedPathList.classList.remove('empty-state');
  refs.acceptedPathList.innerHTML = selectedAcceptedPaths.map((pathValue, index) => `
    <div class="accepted-path-row">
      <span>${escapeHtml(pathValue)}</span>
      <button class="secondary-button" type="button" data-accepted-path-index="${index}">移除</button>
    </div>
  `).join('');
  for (const button of refs.acceptedPathList.querySelectorAll('[data-accepted-path-index]')) {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.acceptedPathIndex);
      selectedAcceptedPaths = selectedAcceptedPaths.filter((_, itemIndex) => itemIndex !== index);
      renderAcceptedPaths();
    });
  }
}

function addAcceptedPath() {
  const pathValue = refs.acceptedPathSelect.value.trim();

  if (!pathValue || selectedAcceptedPaths.includes(pathValue)) {
    return;
  }

  selectedAcceptedPaths = [...selectedAcceptedPaths, pathValue];
  renderAcceptedPaths();
}

async function saveAcceptedResult() {
  const item = currentItems[selectedIndex];

  if (!item) {
    throw new Error('请先打开一个片段详情。');
  }

  if (selectedAcceptedPaths.length === 0) {
    throw new Error('请至少选择一个 accepted 路径。');
  }

  const acceptedResult = await apiPost('/api/tag-review/accepted', {
    directoryPath: requireDirectoryPath(),
    reviewItemId: item.reviewItemId,
    acceptedPaths: selectedAcceptedPaths
  });
  currentItems[selectedIndex] = {
    ...item,
    reviewStatus: acceptedResult.status,
    acceptedResult
  };
  renderAcceptedPaths();
  refs.reviewOutput.textContent = buildDebugJson(acceptedResult);
}

async function downloadLabelStudioPackage() {
  const payload = await buildLabelStudioPackage();
  downloadText('label-studio-tag-review-tasks.json', JSON.stringify(payload.tasks, null, 2));
  downloadText('label-studio-tag-review-config.xml', payload.labelConfig);
  refs.reviewOutput.textContent = [
    `已生成 Label Studio 导入包：${payload.taskCount} 个任务。`,
    '',
    'Label config:',
    payload.labelConfig
  ].join('\n');
}

async function importIntoLabelStudio() {
  const body = buildLabelStudioRequestBody();
  refs.reviewOutput.textContent = '正在导入 Label Studio...';
  const payload = await apiPost('/api/tag-review/label-studio/import', body);
  refs.labelStudioProjectId.value = String(payload.projectId ?? refs.labelStudioProjectId.value);
  localStorage.setItem('tagReviewLabelStudioUrl', refs.labelStudioUrl.value.trim());
  renderLabelStudioLink(payload.projectUrl);
  updateActionState();
  refs.reviewOutput.textContent = buildDebugJson(payload);
}

async function syncLabelStudio() {
  const body = buildLabelStudioRequestBody({ requireProjectId: true });
  refs.reviewOutput.textContent = '正在同步 Label Studio 审核结论...';
  const payload = await apiPost('/api/tag-review/label-studio/sync', body);
  refs.reviewOutput.textContent = buildDebugJson(payload);
  await scanDirectory();
}

async function buildLabelStudioPackage() {
  return apiPost('/api/tag-review/label-studio/package', {
    directoryPath: requireDirectoryPath()
  });
}

function buildLabelStudioRequestBody(options = {}) {
  const labelStudioUrl = refs.labelStudioUrl.value.trim();
  const token = refs.labelStudioToken.value.trim();
  const projectId = refs.labelStudioProjectId.value.trim();

  if (!labelStudioUrl || !token) {
    throw new Error('请先填写 Label Studio 地址和 Token。');
  }

  if (options.requireProjectId && !projectId) {
    throw new Error('同步前请填写 Label Studio Project ID。');
  }

  return {
    directoryPath: requireDirectoryPath(),
    labelStudioUrl,
    token,
    projectId,
    projectTitle: refs.labelStudioProjectTitle.value.trim() || undefined
  };
}

function openCurrentLabelStudioTask() {
  const item = currentItems[selectedIndex];
  if (!item || !canOpenLabelStudioTask(item)) {
    return;
  }

  const baseUrl = refs.labelStudioUrl.value.trim().replace(/\/+$/u, '');
  const projectId = refs.labelStudioProjectId.value.trim();
  window.open(`${baseUrl}/projects/${encodeURIComponent(projectId)}/data?task=${encodeURIComponent(item.labelStudioTaskId)}`, '_blank');
}

function canOpenLabelStudioTask(item) {
  return Boolean(
    item?.labelStudioTaskId &&
    refs.labelStudioUrl.value.trim() &&
    refs.labelStudioProjectId.value.trim()
  );
}

function renderLabelStudioLink(projectUrl) {
  if (!projectUrl) {
    refs.labelStudioProjectLink.classList.add('hidden');
    return;
  }

  refs.labelStudioProjectLink.href = projectUrl;
  refs.labelStudioProjectLink.classList.remove('hidden');
}

function mediaUrl(item) {
  const url = new URL('/api/tag-review/media', location.origin);
  url.searchParams.set('directoryPath', currentScan?.directoryPath ?? requireDirectoryPath());
  url.searchParams.set('relativePath', item.videoRelativePath);
  return url.toString();
}

function thumbnailUrl(item) {
  const url = new URL('/api/tag-review/thumbnail', location.origin);
  url.searchParams.set('directoryPath', currentScan?.directoryPath ?? requireDirectoryPath());
  url.searchParams.set('relativePath', item.videoRelativePath);
  return url.toString();
}

function updateActionState() {
  const hasItems = currentItems.length > 0;
  const hasProjectId = refs.labelStudioProjectId.value.trim().length > 0;
  refs.downloadLabelStudioPackage.disabled = !hasItems;
  refs.importLabelStudio.disabled = !hasItems;
  refs.syncLabelStudio.disabled = !hasItems || !hasProjectId;
  refs.loadMore.disabled = renderedCount >= currentItems.length;
}

function requireDirectoryPath() {
  const directoryPath = refs.reviewDirectory.value.trim();
  if (!directoryPath) {
    throw new Error('请先选择待检文件夹。');
  }
  return directoryPath;
}

function downloadText(fileName, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function disconnectThumbnailObserver() {
  if (thumbnailObserver) {
    thumbnailObserver.disconnect();
    thumbnailObserver = null;
  }
}

async function wrapAction(action) {
  try {
    await action();
  } catch (error) {
    refs.reviewOutput.textContent = error instanceof Error ? error.message : String(error);
  }
}
