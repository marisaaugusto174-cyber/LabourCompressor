import { apiGet, apiPost, buildDebugJson } from './api-client.js';
import { escapeHtml } from './form-state.js';
import { classifyVideoOrientation, fitVideoSize } from './review-layout.js';
import { createReviewPlayer } from './review-player.js';
import { handleReviewShortcut } from './review-shortcuts.js';

const INITIAL_RENDER_COUNT = 36;
const RENDER_BATCH_SIZE = 24;

const refs = {
  fileProtocolWarning: document.querySelector('#file-protocol-warning'),
  reviewDirectory: document.querySelector('#review-directory'),
  chooseReviewDirectory: document.querySelector('#choose-review-directory'),
  scanButton: document.querySelector('#scan-button'),
  summaryPaired: document.querySelector('#summary-paired'),
  summaryUnpairedVideos: document.querySelector('#summary-unpaired-videos'),
  summaryOrphanJson: document.querySelector('#summary-orphan-json'),
  summaryInvalidJson: document.querySelector('#summary-invalid-json'),
  reviewGrid: document.querySelector('#review-grid'),
  loadMore: document.querySelector('#load-more'),
  detailView: document.querySelector('#detail-view'),
  detailLayout: document.querySelector('#review-detail-layout'),
  playerStage: document.querySelector('#review-player-stage'),
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
  tagEvidenceOverlay: document.querySelector('#tag-evidence-overlay'),
  tagEvidenceContent: document.querySelector('#tag-evidence-content'),
  closeTagEvidence: document.querySelector('#close-tag-evidence'),
  diagnosticsPanel: document.querySelector('#review-diagnostics-panel'),
  diagnosticsList: document.querySelector('#diagnostics-list'),
  reviewOutput: document.querySelector('#review-output')
};

let currentScan = null;
let currentItems = [];
let renderedCount = 0;
let selectedIndex = -1;
let thumbnailObserver = null;
let selectedAcceptedPaths = [];
let reviewPlayer = null;
let playerResizeObserver = null;

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
  reviewPlayer = createReviewPlayer(refs.detailVideo, window.Plyr);
  reviewPlayer.onLoadedMetadata(updatePlayerLayout);
  playerResizeObserver = new ResizeObserver(updatePlayerLayout);
  playerResizeObserver.observe(refs.playerStage);
  bindActions();
}

function bindActions() {
  refs.chooseReviewDirectory.addEventListener('click', () => wrapAction(chooseReviewDirectory));
  refs.scanButton.addEventListener('click', () => wrapAction(scanDirectory));
  refs.loadMore.addEventListener('click', () => renderMoreItems());
  refs.previousDetail.addEventListener('click', () => openDetail(selectedIndex - 1));
  refs.nextDetail.addEventListener('click', () => openDetail(selectedIndex + 1));
  refs.closeDetail.addEventListener('click', closeDetail);
  refs.closeTagEvidence.addEventListener('click', closeTagEvidence);
  refs.addAcceptedPath.addEventListener('click', addAcceptedPath);
  refs.saveAcceptedResult.addEventListener('click', () => wrapAction(saveAcceptedResult));
  refs.detailView.addEventListener('click', (event) => {
    if (event.target === refs.detailView) {
      closeDetail();
    }
  });
  window.addEventListener('keydown', (event) => {
    handleReviewShortcut({
      event,
      detailOpen: isDetailOpen(),
      selectedIndex,
      itemCount: currentItems.length,
      video: reviewPlayer ?? refs.detailVideo,
      openDetail,
      closeDetail
    });
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
    invalidJsonFiles: payload.invalidJsonFiles?.length ?? 0
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
      detail: '未找到同目录同 stem JSON'
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
    hideDiagnosticsPanel();
    refs.diagnosticsList.classList.add('empty-state');
    refs.diagnosticsList.innerHTML = '<p>未发现未配对或无效文件。</p>';
    return;
  }

  showDiagnosticsPanel();
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

function hideDiagnosticsPanel() {
  refs.diagnosticsPanel.classList.add('hidden');
}

function showDiagnosticsPanel() {
  refs.diagnosticsPanel.classList.remove('hidden');
}

function showDiagnostics(items) {
  showDiagnosticsPanel();
  refs.diagnosticsList.classList.remove('empty-state');
  refs.diagnosticsList.innerHTML = items.map((item) => `
    <div class="task-list-row review-diagnostics-row">
      <strong>${escapeHtml(item.severity ?? 'error')}</strong>
      <span>${escapeHtml(item.message ?? String(item))}</span>
      <span>—</span>
    </div>
  `).join('');
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
  closeTagEvidence();
  reviewPlayer?.pause();
  reviewPlayer?.setSource({
    src: mediaUrl(item),
    type: mediaContentType(item.videoFileName),
    title: item.videoFileName
  });
  selectedAcceptedPaths = [...(item.acceptedResult?.acceptedPaths ?? item.tagging?.tags?.map((tag) => (tag.labelPath ?? []).join(' > ')).filter(Boolean) ?? [])];
  renderAcceptedPathOptions();
  renderAcceptedPaths();
  refs.detailTags.innerHTML = renderDetailTags(item);
  bindTagEvidenceButtons(item);
  refs.detailPosition.textContent = `${index + 1} / ${currentItems.length}`;
  refs.previousDetail.disabled = index === 0;
  refs.nextDetail.disabled = index === currentItems.length - 1;
  updateAcceptedSaveState();
  refs.closeDetail.focus();
}

function closeDetail() {
  reviewPlayer?.pause();
  reviewPlayer?.clearSource();
  closeTagEvidence();
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
    <div class="review-state-summary">
      <div><span class="status-label">Taxonomy</span><strong>${escapeHtml(tagging.taxonomyVersion ?? '—')}</strong></div>
      <div><span class="status-label">模型复核</span><strong>${tagging.reviewRequired ? '需要' : '不需要'}</strong></div>
      <div><span class="status-label">标签数</span><strong>${tags.length}</strong></div>
    </div>
    <div class="review-tag-list">
      ${tags.length === 0 ? '<p>JSON 中没有 tags。</p>' : tags.map((tag, index) => `
        <button class="review-tag-compact" type="button" data-tag-evidence-index="${index}">
          <strong>${index + 1}. ${escapeHtml((tag.labelPath ?? []).join(' > ') || tag.dimension || '未命名标签')}</strong>
          <span>${escapeHtml(tag.tagRole || '—')} · ${escapeHtml(tag.selectedLevel || '—')} · 置信度 ${escapeHtml(tag.confidenceScore ?? '—')}</span>
        </button>
      `).join('')}
    </div>
  `;
}

function bindTagEvidenceButtons(item) {
  const tags = item.tagging?.tags ?? [];
  for (const button of refs.detailTags.querySelectorAll('[data-tag-evidence-index]')) {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.tagEvidenceIndex);
      const tag = tags[index];
      if (tag) showTagEvidence(tag, index);
    });
  }
}

function showTagEvidence(tag, index) {
  refs.tagEvidenceContent.innerHTML = `
    <p><strong>${index + 1}. ${escapeHtml(tag.dimension || '未命名维度')}</strong></p>
    <p><span class="status-label">完整路径</span>${escapeHtml((tag.labelPath ?? []).join(' > ') || '—')}</p>
    <p><span class="status-label">角色／层级</span>${escapeHtml(tag.tagRole || '—')} · ${escapeHtml(tag.selectedLevel || '—')}</p>
    <p><span class="status-label">证据／置信度</span>${escapeHtml(tag.evidenceType || '—')} · ${escapeHtml(tag.confidenceScore ?? '—')}</p>
    <p><span class="status-label">证据说明</span>${escapeHtml(tag.evidenceNote || '—')}</p>
  `;
  refs.tagEvidenceOverlay.classList.remove('hidden');
  refs.closeTagEvidence.focus();
}

function closeTagEvidence() {
  refs.tagEvidenceOverlay.classList.add('hidden');
}

function updatePlayerLayout() {
  if (!refs.playerStage || refs.playerStage.clientWidth <= 0 || refs.playerStage.clientHeight <= 0) return;
  const media = reviewPlayer?.media ?? refs.detailVideo;
  const orientation = classifyVideoOrientation(media.videoWidth, media.videoHeight);
  refs.detailLayout.setAttribute('data-video-orientation', orientation);
  const fitted = fitVideoSize({
    videoWidth: media.videoWidth,
    videoHeight: media.videoHeight,
    availableWidth: refs.playerStage.clientWidth,
    availableHeight: refs.playerStage.clientHeight
  });
  refs.playerStage.style.setProperty('--review-player-width', `${fitted.width}px`);
  refs.playerStage.style.setProperty('--review-player-height', `${fitted.height}px`);
  refs.playerStage.style.setProperty('--review-player-ratio', fitted.ratio);
}

function mediaContentType(fileName) {
  const extension = fileName.split('.').pop()?.toLowerCase();
  return ({
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo'
  })[extension] ?? 'application/octet-stream';
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
    updateAcceptedSaveState();
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
      updateAcceptedSaveState();
    });
  }
  updateAcceptedSaveState();
}

function addAcceptedPath() {
  const pathValue = refs.acceptedPathSelect.value.trim();

  if (!pathValue || selectedAcceptedPaths.includes(pathValue)) {
    return;
  }

  selectedAcceptedPaths = [...selectedAcceptedPaths, pathValue];
  renderAcceptedPaths();
  updateAcceptedSaveState();
}

function updateAcceptedSaveState() {
  const hasTaxonomySnapshot = (currentScan?.taxonomySnapshot?.paths?.length ?? 0) > 0;
  refs.saveAcceptedResult.disabled = selectedAcceptedPaths.length === 0 || !hasTaxonomySnapshot;
  refs.saveAcceptedResult.title = hasTaxonomySnapshot
    ? ''
    : '缺少 taxonomy 快照，无法校验并写入 accepted result。';
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
    acceptedResult
  };
  renderAcceptedPaths();
  refs.reviewOutput.textContent = buildDebugJson(acceptedResult);
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
  refs.loadMore.disabled = renderedCount >= currentItems.length;
}

function requireDirectoryPath() {
  const directoryPath = refs.reviewDirectory.value.trim();
  if (!directoryPath) {
    throw new Error('请先选择待检文件夹。');
  }
  return directoryPath;
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
    const message = error instanceof Error ? error.message : String(error);
    refs.reviewOutput.textContent = message;
    showDiagnostics([{ severity: 'error', message }]);
  }
}
