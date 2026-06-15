import { escapeHtml } from './form-state.js';

export function renderAfterEditFiles(files, resultsList) {
  if (!files.length) {
    return;
  }

  resultsList.classList.remove('empty-state');
  resultsList.innerHTML = files
    .map((file) => `
      <div class="task-list-row">
        <strong>${escapeHtml(file.fileName ?? '剪辑文件')}</strong>
        <span class="stage-pill stage-running">等待打标</span>
        <span>${escapeHtml(file.relativePath ?? '—')}</span>
        <span>${file.renamed ? '文件名已修正' : '无需修正'}</span>
      </div>
    `)
    .join('');
}

export function renderResultCards(results, resultsList, currentRunSpreadsheetPath = '') {
  if (!results.length) {
    resultsList.innerHTML = '<p>当前没有可显示的结果。</p>';
    resultsList.classList.add('empty-state');
    return;
  }

  resultsList.classList.remove('empty-state');
  resultsList.innerHTML = `
    <div class="result-summary">${renderResultSummary(results, currentRunSpreadsheetPath)}</div>
    <div class="task-list-header">
      <span>文件</span>
      <span>当前环节</span>
      <span>归档路径</span>
      <span>失败 / 下一步</span>
    </div>
    ${results.map((item) => renderResultRow(item)).join('')}
  `;
  resultsList.scrollTop = 0;
}

function renderResultSummary(results, currentRunSpreadsheetPath) {
  const succeeded = results.filter((item) => item.archiveState === '已归档').length;
  const failed = results.filter((item) => item.failure).length;
  const waitingEdit = results.filter((item) => item.archiveState === '已下载待剪辑').length;
  const sheetText = currentRunSpreadsheetPath
    ? ` · 本次结果表：${currentRunSpreadsheetPath}`
    : '';
  return `共 ${results.length} 条 · 归档成功 ${succeeded} · 失败 ${failed} · 等待剪辑 ${waitingEdit}${sheetText}`;
}

function renderResultRow(item) {
  const phaseLabel = deriveResultStage(item);
  const failureText = item.failure
    ? `${humanizeFailureCode(item.failure.errorCode, item.failure.phase)}：${humanizeFailureHint(item.failure.errorCode, item.failure.phase)}`
    : deriveNextStepText(item);

  return `
    <div class="task-list-row">
      <strong>${escapeHtml(deriveResultFileName(item))}</strong>
      <span class="stage-pill stage-${stageClassName(item)}">${escapeHtml(phaseLabel)}</span>
      <span>${escapeHtml(item.archivePath || '—')}</span>
      <span>${escapeHtml(failureText)}</span>
    </div>
  `;
}

function deriveNextStepText(item) {
  if (item.archiveState === '已下载待剪辑') {
    return '等待你把剪辑后的导出文件放进 AfterEdit 目录。';
  }
  if (item.archiveState === '已归档') {
    return '无';
  }
  if (item.archiveState === '已下载未归档') {
    return '等待人工确认归档类目。';
  }
  return '继续等待当前任务处理。';
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
    'missing-content-topic': '缺少内容题材',
    'archive-failed': '归档失败',
    'edited-file-missing': '未找到剪辑后文件',
    'edited-file-invalid-name': '剪辑文件名不符合规范',
    'edited-file-duplicate-name': '剪辑文件名重复',
    'local-file-missing': '未找到剪辑后文件'
  };

  return mapping[errorCode] ?? phase ?? '失败';
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
