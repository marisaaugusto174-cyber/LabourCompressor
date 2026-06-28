import { escapeHtml } from './form-state.js';

export function renderAfterEditFiles(files, resultsList) {
  if (!files.length) {
    resultsList.innerHTML = '';
    resultsList.classList.add('empty-state');
    return;
  }

  resultsList.classList.remove('empty-state');
  const renamed = files.filter((file) => file.renamed);
  resultsList.innerHTML = `
    <div class="result-summary">已载入 ${files.length} 个剪辑文件 · 文件名修正 ${renamed.length}</div>
    ${renamed.length > 0 ? `
      <details class="result-problems" open>
        <summary>需要留意 (${renamed.length})</summary>
        <div class="result-table">${renamed.map((file) => renderAfterEditRow(file)).join('')}</div>
      </details>
    ` : ''}
    <details class="result-all">
      <summary>完整文件 (${files.length})</summary>
      <div class="result-table">${files.map((file) => renderAfterEditRow(file)).join('')}</div>
    </details>
  `;
}

export function renderResultCards(results, resultsList, currentRunSpreadsheetPath = '') {
  if (!results.length) {
    resultsList.innerHTML = '';
    resultsList.classList.add('empty-state');
    return;
  }

  resultsList.classList.remove('empty-state');
  resultsList.innerHTML = buildResultWorkbenchHtml(results, currentRunSpreadsheetPath);
  resultsList.scrollTop = 0;
}

export function classifyResult(item) {
  if (item.failure || item.archiveState === '下载失败') {
    return 'failed';
  }
  if (item.archiveState === '已归档' || item.archiveState === '已跳过：视频过短') {
    return 'succeeded';
  }
  return 'pending';
}

export function buildResultWorkbenchHtml(results, currentRunSpreadsheetPath = '') {
  if (!results?.length) {
    return '';
  }

  const groups = {
    succeeded: results.filter((item) => classifyResult(item) === 'succeeded'),
    failed: results.filter((item) => classifyResult(item) === 'failed'),
    pending: results.filter((item) => classifyResult(item) === 'pending')
  };
  const problems = [...groups.failed, ...groups.pending];

  return `
    <div class="result-summary">
      <span>总数 ${results.length}</span>
      <span>成功 ${groups.succeeded.length}</span>
      <span>失败 ${groups.failed.length}</span>
      <span>待处理 ${groups.pending.length}</span>
    </div>
    ${problems.length > 0 ? `
      <details class="result-problems" open>
        <summary>异常与人工处理 (${problems.length})</summary>
        <div class="result-table">${renderResultTable(problems)}</div>
      </details>
    ` : ''}
    <details class="result-all">
      <summary>完整结果 (${results.length})</summary>
      ${currentRunSpreadsheetPath ? `<p class="result-sheet-path">本次结果表：${escapeHtml(currentRunSpreadsheetPath)}</p>` : ''}
      <div class="result-table">${renderResultTable(results)}</div>
    </details>
  `;
}

function renderResultTable(results) {
  return `
    <div class="task-list-header">
      <span>文件</span><span>当前环节</span><span>归档路径</span><span>失败 / 下一步</span>
    </div>
    ${results.map((item) => renderResultRow(item)).join('')}
  `;
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
      <span>${escapeHtml(item.archivePath || '')}</span>
      <span>${escapeHtml(failureText)}</span>
    </div>
  `;
}

function deriveNextStepText(item) {
  if (item.archiveState === '已下载待剪辑') {
    return '等待你把剪辑后的导出文件放进 AfterEdit 目录。';
  }
  if (item.archiveState === '已归档') {
    return '';
  }
  if (item.archiveState === '已下载未归档') {
    return '等待人工确认归档类目。';
  }
  return '继续等待当前任务处理。';
}

function renderAfterEditRow(file) {
  return `
    <div class="task-list-row">
      <strong>${escapeHtml(file.fileName ?? '剪辑文件')}</strong>
      <span class="stage-pill stage-running">等待打标</span>
      <span>${escapeHtml(file.relativePath ?? '')}</span>
      <span>${file.renamed ? '文件名已修正' : ''}</span>
    </div>
  `;
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
    'douyin-detail-api-blocked': '抖音详情接口被阻断',
    'douyin-ssr-unavailable': '抖音页面解析失败',
    'douyin-play-url-expired': '抖音播放地址失效',
    'xiaohongshu-no-formats': '小红书解析未返回格式',
    'xiaohongshu-note-not-video': '小红书笔记不是视频',
    'xiaohongshu-page-unavailable': '小红书页面不可用',
    'xiaohongshu-video-data-unavailable': '小红书视频数据不可用',
    'xiaohongshu-play-url-expired': '小红书播放地址失效',
    'xiaohongshu-media-type-invalid': '小红书媒体类型异常',
    'xiaohongshu-media-truncated': '小红书视频内容不完整',
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
      'missing-credentials': '请打开“配置下载凭证”，为当前平台重新导入 cookies.txt。',
      'needs-fresh-cookies': '当前 cookies 不够新鲜，请重新导出后再运行。',
      'cookies-expired': '当前 cookies 已失效，请重新登录并更新凭证。',
      'blocked-by-bilibili-412': '平台当前触发了风控。优先检查该平台的登录态，必要时稍后重试。',
      'douyin-detail-api-blocked': '抖音详情接口返回空数据。程序会优先尝试页面 SSR 解析；若仍失败，请刷新 URL 或更新 cookies。',
      'douyin-ssr-unavailable': '抖音页面中没有可用视频信息。请确认链接当前可访问，必要时重新导出 cookies。',
      'douyin-play-url-expired': '抖音播放地址已失效。请刷新测试 URL 或重新运行任务获取新的播放地址。',
      'xiaohongshu-no-formats': 'yt-dlp 未解析到视频格式，程序会自动尝试小红书页面回退解析。',
      'xiaohongshu-note-not-video': '该链接对应图文笔记，当前版本只支持单视频笔记。',
      'xiaohongshu-page-unavailable': '小红书笔记页面暂时不可用。请检查链接、cookies 或稍后重试。',
      'xiaohongshu-video-data-unavailable': '页面中没有可用视频流。请确认笔记仍可访问并更新 cookies。',
      'xiaohongshu-play-url-expired': '小红书播放地址已失效。请重新运行任务获取新的播放地址。',
      'xiaohongshu-media-type-invalid': '媒体地址返回了页面或 JSON，请更新 cookies 或稍后重试。',
      'xiaohongshu-media-truncated': '视频下载字节数与服务端声明不一致，请检查网络后重试。',
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
