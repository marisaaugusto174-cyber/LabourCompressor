import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const html = readFileSync(
  path.join(process.cwd(), 'apps/web/public/index.html'),
  'utf8'
);
const appJs = readFileSync(
  path.join(process.cwd(), 'apps/web/public/app.js'),
  'utf8'
);
const css = readFileSync(
  path.join(process.cwd(), 'apps/web/public/styles.css'),
  'utf8'
);

test('v0.5 web ui exposes full pipeline as primary entry and keeps stage buttons advanced', () => {
  for (const stage of ['download', 'segment', 'compress', 'tag', 'archive']) {
    assert.equal(
      html.includes(`data-pipeline-stage="${stage}"`),
      true,
      `missing stage button for ${stage}`
    );
  }

  assert.equal(html.includes('class="advanced-run-panel"'), true);
  assert.equal(html.includes('data-pipeline-stage="all"'), true);
  assert.equal(html.includes('id="run-button"'), true);
  assert.equal(html.includes('class="primary-run-button"'), true);
});

test('web ui keeps V0.3 primary surface minimal and moves compatibility tools into advanced panels', () => {
  assert.equal(html.includes('<h3>高级工具</h3>'), true);
  assert.equal(html.includes('<summary>诊断与恢复</summary>'), true);
  assert.equal(html.includes('<summary>更多设置</summary>'), true);
  assert.equal(html.includes('<summary>调试与恢复</summary>'), true);
  assert.equal(html.includes('片段输出目录'), true);

  assert.equal(
    html.indexOf('id="preflight-button"') > html.indexOf('<summary>诊断与恢复</summary>'),
    true
  );
  assert.equal(
    html.indexOf('data-pipeline-stage="resume-cache"') > html.indexOf('<summary>诊断与恢复</summary>'),
    true
  );
  assert.equal(
    html.indexOf('id="auto-segmentation"') > html.indexOf('<summary>更多设置</summary>'),
    true
  );
  assert.equal(
    html.indexOf('id="partial-writeback"') > html.indexOf('<summary>调试与恢复</summary>'),
    true
  );
});

test('web ui gives spreadsheet and local media source modes equal status in task input', () => {
  assert.equal(html.includes('id="source-mode-spreadsheet"'), true);
  assert.equal(html.includes('id="source-mode-local"'), true);
  assert.equal(html.includes('data-source-panel="spreadsheet"'), true);
  assert.equal(html.includes('data-source-panel="local"'), true);
  assert.equal(html.includes('id="sourceIntakeDirectory"'), true);
  assert.equal(html.includes('id="import-source-directory"'), true);
  assert.equal(
    html.indexOf('data-source-panel="spreadsheet"') < html.indexOf('data-source-panel="local"'),
    true
  );
  assert.equal(
    html.indexOf('id="sourceIntakeDirectory"') < html.indexOf('<h3>高级工具</h3>'),
    true
  );
  assert.equal(appJs.includes('syncSourceMode'), true);
  assert.equal(appJs.includes('/api/source-intake/import'), true);
});

test('web ui avoids introductory and explanatory copy on the main surface', () => {
  for (const text of [
    '一键全流程：导入表格、Preflight、下载、自动分割、打标归档。',
    'UI build:',
    '默认页只保留',
    '任务状态只显示',
    '格式边界',
    '拖拽 `.numbers / .xlsx / .csv`',
    '程序会在该目录下使用',
    '只在手动 AfterEdit 兼容路径中使用。',
    '为当前选中的视频模型写入本地 API key',
    '按平台维护 cookies.txt'
  ]) {
    assert.equal(html.includes(text), false, `unexpected explanatory copy: ${text}`);
  }
});

test('web ui exposes a taxonomy preset selector instead of a hidden fixed preset', () => {
  assert.equal(html.includes('id="taxonomy-preset"'), true);
  assert.equal(html.includes('<select id="taxonomy-preset" name="taxonomyPreset"'), true);
  assert.equal(html.includes('id="import-taxonomy-preset"'), true);
  assert.equal(html.includes('导入标签库'), true);
  assert.equal(html.includes('id="taxonomyPath"'), false);
  assert.equal(html.includes('name="taxonomyPath"'), false);
  assert.equal(html.includes('data-target="taxonomyPath"'), false);
  assert.equal(html.includes('自定义标签文件'), false);
  assert.equal(appJs.includes('/api/taxonomy-presets/import'), true);
  assert.equal(html.includes('type="hidden" name="taxonomyPreset"'), false);
});

test('model option values are escaped before insertion into HTML', () => {
  assert.equal(appJs.includes('value="${escapeHtml(item.id)}"'), true);
});

test('web ui moves generated path summary into a collapsed archive panel', () => {
  const archiveSectionIndex = html.indexOf('<h3>授权与归档</h3>');
  const pathPanelIndex = html.indexOf('class="archive-paths-panel"');

  assert.notEqual(archiveSectionIndex, -1);
  assert.notEqual(pathPanelIndex, -1);
  assert.equal(pathPanelIndex > archiveSectionIndex, true);
  assert.equal(html.includes('<summary>流程路径</summary>'), true);
  for (const id of ['master-spreadsheet-display', 'download-dir-display', 'afteredit-dir-display']) {
    assert.equal(html.indexOf(`id="${id}"`) > pathPanelIndex, true);
  }
});

test('web ui exposes runtime task control buttons', () => {
  for (const id of [
    'pause-task',
    'resume-task',
    'stop-task',
    'export-failures',
    'partial-writeback'
  ]) {
    assert.equal(html.includes(`id="${id}"`), true, id);
  }

  assert.equal(appJs.includes('bindTaskControlActions(taskControlButtonRefs'), true);
  for (const handler of ['pause', 'resume', 'stop', 'exportFailures', 'partialWriteback']) {
    assert.equal(appJs.includes(`${handler}:`), true, handler);
  }
});

test('web ui uses a compact two-layer task status workbench', () => {
  const statusIndex = html.indexOf('<h2>任务状态</h2>');

  assert.notEqual(statusIndex, -1);
  for (const id of [
    'task-idle-state',
    'task-active-state',
    'task-control-actions',
    'status-overall',
    'status-phase',
    'status-progress-track',
    'status-progress-bar',
    'status-progress',
    'status-current',
    'status-item',
    'status-model',
    'status-source',
    'status-platform',
    'status-next-action',
    'runtime-details-panel'
  ]) {
    assert.equal(html.indexOf(`id="${id}"`) > statusIndex, true, id);
  }

  for (const summary of ['运行检查与阶段', '调试与恢复']) {
    assert.equal(html.includes(`<summary>${summary}</summary>`), true, summary);
  }
  assert.equal(html.includes('id="results-list"'), true);
  assert.match(
    html,
    /id="task-active-state"[^>]*role="status"[^>]*aria-live="polite"/u
  );
  assert.match(
    html,
    /id="status-progress-track"[^>]*role="progressbar"[^>]*aria-label="任务处理进度"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"[^>]*aria-valuenow="0"/u
  );
  assert.match(html, /<details id="debug-recovery-panel"[^>]*hidden>/u);
  assert.equal((html.match(/class="status-card"/gu) ?? []).length, 0);
  assert.equal(html.includes('<summary>故障处理</summary>'), false);
});

test('web app routes startup status and action visibility through testable helpers', () => {
  assert.equal(appJs.includes("overall: '启动中'"), true);
  assert.equal(appJs.includes("overall: 'Preflight 未通过'"), true);
  assert.equal(appJs.includes('deriveActionVisibility(visible)'), true);
  assert.equal(appJs.includes('button.hidden = state.hidden'), true);
  assert.equal(appJs.includes('button.disabled = state.disabled'), true);
});

test('web app synchronizes runtime details after preflight and timeline renders', () => {
  assert.equal(appJs.includes('function syncRuntimeDetailsPanel'), true);
  assert.match(
    appJs,
    /runtimeDetailsPanel\.hidden\s*=\s*!hasPreflight\s*&&\s*!hasTimeline/u
  );
  assert.match(
    appJs,
    /if \(preflightFailed\) \{\s+runtimeDetailsPanel\.open = true;/u
  );

  const preflightRenders = appJs.match(/renderPreflight(?:Checklist|Message)\([^;]+;\s+syncRuntimeDetailsPanel\(/gu) ?? [];
  const timelineRenders = appJs.match(/renderEventTimeline\([^;]+;\s+syncRuntimeDetailsPanel\(/gu) ?? [];
  assert.equal(preflightRenders.length >= 5, true);
  assert.equal(timelineRenders.length >= 2, true);
});

test('renderTask synchronizes runtime details before an empty result returns', () => {
  const start = appJs.indexOf('function renderTask(task)');
  const end = appJs.indexOf('function updateTaskControls', start);
  const source = appJs.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(
    source,
    /renderTaskStatus\(task\);\s+updateTaskControls\(task\);\s+syncRuntimeDetailsPanel\(\);\s+if \(!task\.result\)/u
  );
});

test('AfterEdit sheet generation routes success and failure through the public status entry', () => {
  const start = appJs.indexOf('async function buildAfterEditSheet');
  const end = appJs.indexOf('async function importSourceDirectory', start);
  const source = appJs.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.equal(source.includes('renderStatusMessage({'), true);
  assert.equal(source.includes("overall: '待继续'"), true);
  assert.equal(source.includes("overall: 'AfterEdit 表格生成失败'"), true);
  assert.equal(source.includes('statusOverall.textContent'), false);
  assert.equal(source.includes('statusPhase.textContent'), false);
  assert.equal(source.includes('statusItem.textContent'), false);
  assert.equal(source.includes('statusProgress.textContent'), false);
});

test('web app preserves current task status when the model selection changes', () => {
  assert.match(
    appJs,
    /providerProfile\.addEventListener\('change', \(\) => \{\s+if \(!currentTaskId\) \{\s+resetStatusShell\(\);\s+\}/u
  );
});

test('task progress meter has a minimally visible track and bar', () => {
  assert.match(
    css,
    /\.status-progress-track\s*\{[^}]*height:\s*[^;]+;[^}]*background:\s*[^;]+;[^}]*overflow:\s*hidden;[^}]*border-radius:\s*[^;]+;/su
  );
  assert.match(
    css,
    /\.status-progress-bar\s*\{[^}]*display:\s*block;[^}]*height:\s*100%;[^}]*background:\s*[^;]+;/su
  );
});

test('web ui keeps batch sample import controls in more settings', () => {
  assert.equal(html.includes('id="afterEditBatchSampleFile"'), true);
  assert.equal(html.includes('name="afterEditBatchSampleFile"'), true);
  assert.equal(html.includes('id="build-afteredit-batch-sheet"'), true);
  assert.equal(
    html.indexOf('id="afterEditBatchSampleFile"') > html.indexOf('<summary>更多设置</summary>'),
    true
  );
});

test('web ui exposes managed source intake controls', () => {
  assert.equal(html.includes('id="sourceIntakeDirectory"'), true);
  assert.equal(html.includes('name="sourceIntakeDirectory"'), true);
  assert.equal(html.includes('id="import-source-directory"'), true);
  assert.equal(
    html.indexOf('id="import-source-directory"') < html.indexOf('<h3>高级工具</h3>'),
    true
  );
  assert.equal(appJs.includes('/api/source-intake/import'), true);
});

test('web ui exposes explicit cache resume entry without making it the primary flow', () => {
  assert.equal(html.includes('data-pipeline-stage="resume-cache"'), true);
  assert.equal(html.includes('从已整理表继续'), true);
  assert.equal(html.includes('id="resumeVideoDirectory"'), false);
  assert.equal(html.includes('id="resume-video-folder"'), false);
  assert.equal(html.includes('从视频文件夹继续'), false);
  assert.equal(html.includes('一键从 AfterEdit 生成表并载入'), false);
  assert.equal(
    html.indexOf('data-pipeline-stage="resume-cache"') > html.indexOf('<summary>诊断与恢复</summary>'),
    true
  );
  assert.equal(
    html.indexOf('data-pipeline-stage="resume-cache"') > html.indexOf('id="run-button"'),
    true
  );
});

test('web ui exposes manual tagging concurrency slider', () => {
  assert.equal(html.includes('id="tagging-concurrency"'), true);
  assert.equal(html.includes('name="taggingConcurrency"'), true);
  assert.equal(html.includes('type="range"'), true);
  assert.equal(html.includes('min="1"'), true);
  assert.equal(html.includes('max="64"'), true);
});

test('web ui uses compact dashboard styling and prevents horizontal overflow', () => {
  assert.match(css, /\*,\s*\*::before,\s*\*::after\s*\{[^}]*box-sizing:\s*border-box/su);
  assert.match(css, /html,\s*body\s*\{[^}]*overflow-x:\s*hidden/su);
  assert.match(css, /\.panel,\s*\.subpanel\s*\{[^}]*border-radius:\s*8px/su);
  assert.match(css, /\.layout\s*\{[^}]*minmax\(0,\s*1\.35fr\)[^}]*minmax\(300px,\s*0\.65fr\)/su);
  assert.match(css, /\.stage-launcher\s*\{[^}]*repeat\(auto-fit,\s*minmax\(92px,\s*1fr\)\)/su);
  assert.match(css, /\.segmented-control input\s*\{[^}]*width:\s*1px/su);
  assert.match(css, /button\s*\{[^}]*overflow-wrap:\s*anywhere/su);
  assert.match(css, /\.status-workbench\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/su);
  assert.match(css, /\.results-list\s*\{[^}]*overflow-x:\s*hidden/su);
  assert.match(css, /\.result-table\s*\{[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden/su);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*\.status-workbench[\s\S]*grid-template-columns:\s*1fr/su);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*\.task-list-header[\s\S]*display:\s*none/su);
  assert.doesNotMatch(css, /radial-gradient\(circle at top right/u);
});

test('runtime detail grid stays two-column until the 640px breakpoint', () => {
  const mediumStart = css.indexOf('@media (max-width: 860px)');
  const narrowStart = css.indexOf('@media (max-width: 640px)');
  const mediumRules = css.slice(mediumStart, narrowStart);
  const narrowRules = css.slice(narrowStart);

  assert.equal(mediumRules.includes('.runtime-detail-grid'), false);
  assert.match(narrowRules, /\.runtime-detail-grid,[\s\S]*grid-template-columns:\s*1fr/u);
});

test('web ui exposes mainline and advanced workbench modes with shared controls', () => {
  for (const id of [
    'workbench',
    'workbench-mode-mainline',
    'workbench-mode-advanced',
    'workbench-source',
    'workbench-readiness',
    'provider-readiness',
    'credential-readiness'
  ]) {
    assert.equal(html.includes(`id="${id}"`), true, id);
  }
  for (const summary of ['执行与恢复', '分割与打标', '授权与归档', '诊断与结果']) {
    assert.equal(html.includes(`<summary>${summary}</summary>`), true, summary);
  }
  assert.equal(html.includes('data-workbench-mode="mainline"'), true);
  assert.equal(appJs.includes("from './workbench-mode.js'"), true);
});

test('wide workbench uses a bounded 2200px responsive grid', () => {
  assert.match(css, /\.page\s*\{[^}]*width:\s*min\(2200px, 100%\)/su);
  assert.match(css, /@media \(min-width: 1440px\)[\s\S]*\.workbench-grid[\s\S]*grid-template-columns:\s*minmax\(0, [^)]+\) minmax\(0, [^)]+\) minmax\(0, [^)]+\)/su);
  assert.match(css, /@media \(min-width: 1024px\) and \(max-width: 1439px\)[\s\S]*\.workbench-status[\s\S]*grid-column:\s*1 \/ -1/su);
  assert.match(css, /@media \(max-width: 1023px\)[\s\S]*\.workbench-grid[\s\S]*grid-template-columns:\s*1fr/su);
});
