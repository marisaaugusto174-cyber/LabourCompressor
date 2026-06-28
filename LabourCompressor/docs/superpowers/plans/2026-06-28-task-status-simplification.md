# Task Status Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized task-status area with a responsive two-layer workbench that keeps status, progress, current item, and actionable exceptions visible while folding routine detail.

**Architecture:** Keep the existing task and event API unchanged. Reshape the static HTML into a compact workbench, let `task-status-view.js` own presentation state and control visibility, let `results-view.js` split actionable rows from the complete result list, and keep Preflight/timeline rendering isolated in `task-list-view.js`.

**Tech Stack:** Static HTML/CSS, browser-native `<details>`, ES modules, Node test runner, in-app browser responsive verification.

---

## File Map

- Modify `apps/web/public/index.html`: task workbench markup, foldable sections, stable element IDs.
- Modify `apps/web/public/styles.css`: compact two-layer layout, state colors, truncation, responsive result rows.
- Modify `apps/web/public/task-status-view.js`: status presentation, context fields, progress meter, control visibility policy.
- Modify `apps/web/public/app.js`: wire new references and apply the control visibility policy.
- Modify `apps/web/public/results-view.js`: render summary, automatically open actionable items, keep all results closed.
- Modify `apps/web/public/task-list-view.js`: remove empty placeholder rows and preserve concise Preflight/timeline summaries.
- Modify `packages/testing/unit/web/v04-stage-ui.test.ts`: assert the static information hierarchy and fold structure.
- Modify `packages/testing/unit/web/task-status-view.test.ts`: assert idle/running/paused/completed presentation and control policy.
- Modify `packages/testing/unit/web/task-list-view.test.ts`: assert concise Preflight and timeline behavior.
- Create `packages/testing/unit/web/results-view.test.ts`: assert result counts, actionable split, and default open state.

## Dirty Worktree Rule

The target files already contain user-owned uncommitted changes. Before editing each file, inspect `git diff -- <file>`. Do not restore or overwrite existing changes. For each commit step, use `git add -p` and inspect `git diff --cached`; if a hunk mixes prior work with this task, leave it unstaged and skip that commit rather than capturing unrelated changes.

### Task 1: Build the Compact Workbench Markup

**Files:**
- Modify: `apps/web/public/index.html:250-326`
- Modify: `packages/testing/unit/web/v04-stage-ui.test.ts:125-155`

- [ ] **Step 1: Write the failing structure test**

Replace the four-card assertion with contracts for the two-layer workbench and three folded sections:

```ts
test('web ui uses a compact two-layer task status workbench', () => {
  const statusIndex = html.indexOf('<h2>任务状态</h2>');

  assert.notEqual(statusIndex, -1);
  for (const id of [
    'task-idle-state',
    'task-active-state',
    'status-overall',
    'status-phase',
    'status-progress',
    'status-progress-bar',
    'status-item',
    'status-model',
    'status-source',
    'status-platform',
    'status-next-action'
  ]) {
    assert.equal(html.indexOf(`id="${id}"`) > statusIndex, true, id);
  }

  for (const summary of ['运行检查与阶段', '调试与恢复']) {
    assert.equal(html.includes(`<summary>${summary}</summary>`), true, summary);
  }
  assert.equal(html.includes('id="results-list"'), true);
  assert.equal((html.match(/class="status-card"/gu) ?? []).length, 0);
  assert.equal(html.includes('<summary>故障处理</summary>'), false);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
node --test packages/testing/unit/web/v04-stage-ui.test.ts
```

Expected: FAIL because the new workbench IDs and summaries do not exist and four `.status-card` elements remain.

- [ ] **Step 3: Replace the status markup while preserving behavior IDs**

Use this structure in `index.html`; retain existing action IDs so current handlers continue to bind:

```html
<section class="panel task-status-panel">
  <div class="panel-header task-status-header">
    <h2>任务状态</h2>
    <div id="task-control-actions" class="actions compact task-control-actions" hidden>
      <button id="pause-task" type="button" class="secondary-button" hidden>暂停</button>
      <button id="resume-task" type="button" hidden>恢复</button>
      <button id="stop-task" type="button" class="danger-button" hidden>强制停止</button>
    </div>
  </div>

  <div id="task-idle-state" class="task-idle-state">尚未运行任务</div>

  <div id="task-active-state" class="task-active-state" hidden>
    <div id="task-summary" class="status-workbench">
      <div class="status-primary-block">
        <span class="status-label">当前状态</span>
        <strong id="status-overall">未开始</strong>
        <span id="status-phase" class="status-secondary">待机</span>
      </div>
      <div class="status-primary-block">
        <span class="status-label">处理进度</span>
        <strong id="status-progress">0 / 0</strong>
        <div id="status-progress-track" class="status-progress-track" hidden>
          <span id="status-progress-bar" class="status-progress-bar"></span>
        </div>
      </div>
    </div>

    <div id="status-current" class="status-current" hidden>
      <span class="status-label">当前文件</span>
      <strong id="status-item"></strong>
    </div>

    <div id="status-context" class="status-context" hidden>
      <span id="status-model"></span>
      <span id="status-source"></span>
      <span id="status-platform" hidden></span>
    </div>
    <div id="status-next-action" class="status-next-action" hidden></div>
  </div>

  <details id="runtime-details-panel" class="status-details-panel" hidden>
    <summary>运行检查与阶段</summary>
    <div class="runtime-detail-grid">
      <div><h3>Preflight 检查</h3><div id="preflight-list" class="task-list empty-state"></div></div>
      <div><h3>阶段进度</h3><div id="timeline-list" class="task-list empty-state"></div></div>
    </div>
  </details>

  <div id="results-list" class="results-list empty-state"></div>

  <details class="status-details-panel debug-panel">
    <summary>调试与恢复</summary>
    <div class="actions compact debug-actions">
      <button id="export-failures" type="button" hidden>导出失败 CSV</button>
      <button id="partial-writeback" type="button" class="secondary-button" hidden>部分回表</button>
    </div>
    <div class="dual-output">
      <div><h3>Preflight</h3><pre id="preflight-output" class="output"></pre></div>
      <div><h3>原始任务日志</h3><pre id="event-log" class="output log"></pre></div>
    </div>
  </details>
</section>
```

- [ ] **Step 4: Run the focused test and verify pass**

Run `node --test packages/testing/unit/web/v04-stage-ui.test.ts`.

Expected: PASS; existing input, taxonomy, archive-path, and control-ID assertions also remain green.

- [ ] **Step 5: Create a guarded checkpoint commit**

```bash
git add -p apps/web/public/index.html packages/testing/unit/web/v04-stage-ui.test.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "refactor: compact task status structure"
```

Expected staged names: only the two files above. Skip the commit if prior user work cannot be separated by hunk.

### Task 2: Drive Status, Progress, Context, and Controls from State

**Files:**
- Modify: `apps/web/public/task-status-view.js:1-204`
- Modify: `apps/web/public/app.js:33-60, 100-130, 535-559`
- Modify: `packages/testing/unit/web/task-status-view.test.ts`

- [ ] **Step 1: Write failing tests for presentation and control policy**

Extend test refs with `hidden`, `style`, and `title`, then add:

```ts
test('task status hides empty presentation before a task starts', () => {
  const refs = createRefs();
  initTaskStatusView(createOptions(refs));
  resetStatusShell();

  assert.equal(refs.taskIdleState.hidden, false);
  assert.equal(refs.taskActiveState.hidden, true);
  assert.equal(refs.statusCurrent.hidden, true);
  assert.equal(refs.statusNextAction.hidden, true);
});

test('task status renders structured running progress and context', () => {
  const refs = createRefs();
  initTaskStatusView(createOptions(refs));
  renderLiveEvent({
    phase: 'download',
    status: 'running',
    currentItem: 'very-long-video-name.mp4',
    progress: { current: 53, total: 55 }
  });

  assert.equal(refs.taskActiveState.hidden, false);
  assert.equal(refs.statusItem.title, 'very-long-video-name.mp4');
  assert.equal(refs.statusProgress.textContent, '53 / 55 · 96%');
  assert.equal(refs.statusProgressBar.style.width, '96%');
});

test('task control policy only exposes valid actions', () => {
  assert.deepEqual(deriveTaskControlState({ id: '1', status: 'running' }), {
    pause: true, resume: false, stop: true
  });
  assert.deepEqual(deriveTaskControlState({ id: '1', status: 'paused' }), {
    pause: false, resume: true, stop: true
  });
  assert.deepEqual(deriveTaskControlState({ id: '1', status: 'succeeded' }), {
    pause: false, resume: false, stop: false
  });
});

function createOptions(refs) {
  return {
    refs,
    getDefaults: () => ({ modelProfiles: [] }),
    getFieldValue: () => '',
    getSelectedModelLabel: () => '测试模型'
  };
}

function createRefs() {
  return Object.fromEntries([
    'taskIdleState', 'taskActiveState', 'statusOverall', 'statusPhase',
    'statusProgress', 'statusProgressTrack', 'statusProgressBar',
    'statusCurrent', 'statusItem', 'statusContext', 'statusModel',
    'statusSource', 'statusPlatform', 'statusNextAction'
  ].map((key) => [key, {
    textContent: '', hidden: false, title: '', style: { width: '' }
  }]));
}
```

- [ ] **Step 2: Run tests and verify failure**

Run `node --test packages/testing/unit/web/task-status-view.test.ts`.

Expected: FAIL because structured refs and `deriveTaskControlState` do not exist.

- [ ] **Step 3: Implement structured presentation**

Add exported helpers and render separate context nodes instead of one joined sentence:

```js
export function deriveTaskControlState(task) {
  const status = task?.status;
  const hasTask = Boolean(task?.id);
  return {
    pause: hasTask && (status === 'queued' || status === 'running'),
    resume: hasTask && (status === 'paused' || status === 'pausing'),
    stop: hasTask && ['queued', 'running', 'pausing', 'paused'].includes(status)
  };
}

function renderProgress(progress) {
  const current = Number(progress?.current ?? 0);
  const total = Number(progress?.total ?? 0);
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  refs.statusProgress.textContent = total > 0 ? `${current} / ${total} · ${percent}%` : '处理中';
  refs.statusProgressTrack.hidden = total <= 0;
  refs.statusProgressBar.style.width = `${percent}%`;
}

function renderStatusContext() {
  setOptionalText(refs.statusModel, contextState.model);
  setOptionalText(refs.statusSource, contextState.source);
  setOptionalText(refs.statusPlatform, contextState.platform, '—');
  const nextAction = isActionableNextAction(contextState.nextAction) ? contextState.nextAction : '';
  setOptionalText(refs.statusNextAction, nextAction);
  refs.statusContext.hidden = refs.statusModel.hidden && refs.statusSource.hidden && refs.statusPlatform.hidden;
}

function isActionableNextAction(value) {
  return ![
    '', '无', '等待当前任务完成', '正在取消任务', '运行 Preflight 或启动任务'
  ].includes(String(value ?? '').trim());
}

function setOptionalText(node, value, emptyValue = '') {
  const text = String(value ?? '').trim();
  node.textContent = text;
  node.hidden = text.length === 0 || text === emptyValue;
}
```

`renderLiveEvent` must show `taskActiveState`, hide `taskIdleState`, set `statusItem.title`, and call `renderProgress(event.progress)`. `resetStatusShell` must show only `taskIdleState` and clear optional presentation without writing `—` placeholders.

- [ ] **Step 4: Wire refs and control visibility in `app.js`**

Import `deriveTaskControlState`, query the new IDs, and replace disabled-only behavior:

```js
function updateTaskControls(task) {
  const controls = deriveTaskControlState(task);
  setActionVisibility(pauseTaskButton, controls.pause);
  setActionVisibility(resumeTaskButton, controls.resume);
  setActionVisibility(stopTaskButton, controls.stop);
  taskControlActions.hidden = !controls.pause && !controls.resume && !controls.stop;

  const canWriteBack = Boolean(task?.id || fieldValue('spreadsheet'));
  setActionVisibility(partialWritebackButton, canWriteBack);
}

function setActionVisibility(button, visible) {
  button.hidden = !visible;
  button.disabled = !visible;
}
```

Keep every existing click handler unchanged.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test packages/testing/unit/web/task-status-view.test.ts packages/testing/unit/web/v04-stage-ui.test.ts
```

Expected: PASS.

- [ ] **Step 6: Create a guarded checkpoint commit**

Use `git add -p` for the four files, inspect staged hunks, and commit only separable task-owned changes with message `feat: drive compact task status presentation`.

### Task 3: Split Actionable Results from the Complete List

**Files:**
- Modify: `apps/web/public/results-view.js`
- Create: `packages/testing/unit/web/results-view.test.ts`
- Modify: `apps/web/public/app.js:535-545`

- [ ] **Step 1: Write failing result-rendering tests**

Export a pure `buildResultWorkbenchHtml` and test exact disclosure behavior:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildResultWorkbenchHtml } from '../../../../apps/web/public/results-view.js';

test('result workbench keeps successful complete results collapsed', () => {
  const html = buildResultWorkbenchHtml([
    { archiveFileName: 'done.mp4', archiveState: '已归档', archivePath: '/archive/done.mp4' }
  ]);

  assert.match(html, /总数 1/u);
  assert.match(html, /成功 1/u);
  assert.doesNotMatch(html, /class="result-problems" open/u);
  assert.match(html, /<details class="result-all">/u);
  assert.doesNotMatch(html, /<details class="result-all" open>/u);
  assert.doesNotMatch(html, />无</u);
});

test('result workbench automatically opens failures and manual items', () => {
  const html = buildResultWorkbenchHtml([
    { archiveFileName: 'failed.mp4', failure: { phase: 'download', errorCode: 'missing-credentials' } },
    { archiveFileName: 'review.mp4', archiveState: '自动分割待处理' },
    { archiveFileName: 'done.mp4', archiveState: '已归档' }
  ]);

  assert.match(html, /失败 1/u);
  assert.match(html, /待处理 1/u);
  assert.match(html, /<details class="result-problems" open>/u);
  assert.match(html, /failed\.mp4/u);
  assert.match(html, /review\.mp4/u);
});
```

- [ ] **Step 2: Run the new test and verify failure**

Run `node --test packages/testing/unit/web/results-view.test.ts`.

Expected: FAIL because the test file imports a missing export.

- [ ] **Step 3: Implement result classification and disclosure**

Use one classifier for counts and row selection:

```js
export function classifyResult(item) {
  if (item.failure) return 'failed';
  if (['已下载待剪辑', '自动分割待处理', '已下载未归档', '待归档'].includes(item.archiveState)) {
    return 'pending';
  }
  if (item.archiveState === '已归档' || item.archiveState === '已跳过：视频过短') {
    return 'succeeded';
  }
  return 'pending';
}

export function buildResultWorkbenchHtml(results, currentRunSpreadsheetPath = '') {
  if (!results.length) return '';
  const failed = results.filter((item) => classifyResult(item) === 'failed');
  const pending = results.filter((item) => classifyResult(item) === 'pending');
  const succeeded = results.filter((item) => classifyResult(item) === 'succeeded');
  const actionable = [...failed, ...pending];
  const sheetInfo = currentRunSpreadsheetPath
    ? `<div class="result-sheet-path">本次结果表：${escapeHtml(currentRunSpreadsheetPath)}</div>`
    : '';

  return `
    <div class="result-summary-row">
      <strong>结果</strong>
      <span>总数 ${results.length}</span><span>成功 ${succeeded.length}</span>
      <span>失败 ${failed.length}</span><span>待处理 ${pending.length}</span>
    </div>
    ${actionable.length === 0 ? '' : `
      <details class="result-problems" open>
        <summary>失败与待处理（${actionable.length}）</summary>
        ${renderResultTable(actionable)}
      </details>`}
    <details class="result-all">
      <summary>完整结果（${results.length}）</summary>
      ${sheetInfo}
      ${renderResultTable(results)}
    </details>
  `;
}

function renderResultTable(items) {
  return `
    <div class="result-table">
      <div class="task-list-header">
        <span>文件</span><span>当前环节</span><span>归档路径</span><span>失败 / 下一步</span>
      </div>
      ${items.map((item) => renderResultRow(item)).join('')}
    </div>
  `;
}
```

For successful rows, render an empty next-step cell with `aria-hidden="true"` rather than the text “无”. Keep failure hints and pending next actions unchanged.

- [ ] **Step 4: Keep `renderResultCards` as the DOM adapter**

```js
export function renderResultCards(results, resultsList, currentRunSpreadsheetPath = '') {
  const html = buildResultWorkbenchHtml(results, currentRunSpreadsheetPath);
  resultsList.innerHTML = html;
  resultsList.classList.toggle('empty-state', html.length === 0);
  resultsList.scrollTop = 0;
}
```

In `app.js`, show `export-failures` only when `failedRows > 0` by calling `setActionVisibility`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test packages/testing/unit/web/results-view.test.ts packages/testing/unit/web/task-status-view.test.ts
```

Expected: PASS.

- [ ] **Step 6: Create a guarded checkpoint commit**

Stage only task-owned hunks from `results-view.js`, `results-view.test.ts`, and `app.js`; commit with message `feat: prioritize actionable task results` when cleanly separable.

### Task 4: Consolidate Runtime Details and Remove Empty Rows

**Files:**
- Modify: `apps/web/public/task-list-view.js`
- Modify: `apps/web/public/app.js:360-401, 514-523`
- Modify: `packages/testing/unit/web/task-list-view.test.ts`

- [ ] **Step 1: Add failing tests for empty and concise states**

```ts
test('empty runtime views render no placeholder rows', () => {
  assert.equal(buildPreflightChecklistHtml([]), '');
  assert.equal(buildEventTimelineHtml([]), '');
});

test('successful preflight renders one visible summary row', () => {
  const html = buildPreflightChecklistHtml([
    { key: 'spreadsheet', ok: true },
    { key: 'provider', ok: true }
  ]);

  assert.equal((html.match(/task-list-row task-list-row-compact/gu) ?? []).length, 1);
  assert.match(html, /Preflight 通过/u);
  assert.doesNotMatch(html, />—</u);
});
```

- [ ] **Step 2: Run and verify failure**

Run `node --test packages/testing/unit/web/task-list-view.test.ts`.

Expected: FAIL because empty builders return `<p>—</p>` and successful summaries contain placeholder cells.

- [ ] **Step 3: Remove placeholder output and use compact summaries**

Return an empty string for empty builders. Render success with meaningful two-column content only:

```js
if (failedChecks.length === 0) {
  return `
    <div class="task-list-row task-list-row-compact runtime-summary-row">
      <span class="stage-pill stage-succeeded">已通过</span>
      <strong>Preflight 通过，可以启动任务</strong>
    </div>
    <details class="debug-details">
      <summary>查看完整检查</summary>
      ${renderRawPreflightDetails(checks, false)}
    </details>
  `;
}
```

Keep failed checks expanded and keep the event timeline's latest-event summary plus folded history.

- [ ] **Step 4: Toggle the combined runtime panel in `app.js`**

Add a small adapter:

```js
function syncRuntimeDetailsVisibility() {
  const hasPreflight = preflightList.innerHTML.trim().length > 0;
  const hasTimeline = timelineList.innerHTML.trim().length > 0;
  runtimeDetailsPanel.hidden = !hasPreflight && !hasTimeline;
}
```

Call it after every Preflight or timeline render. Do not auto-open the panel after successful checks; set `runtimeDetailsPanel.open = true` only when Preflight has failures.

- [ ] **Step 5: Run focused Web tests**

Run:

```bash
node --test packages/testing/unit/web/task-list-view.test.ts packages/testing/unit/web/v04-stage-ui.test.ts
```

Expected: PASS.

- [ ] **Step 6: Create a guarded checkpoint commit**

Stage only task-owned hunks and commit with message `refactor: fold runtime checks and stage detail` when safe.

### Task 5: Apply Responsive Styling and Complete Regression Verification

**Files:**
- Modify: `apps/web/public/styles.css:457-607, 1080-1140`
- Modify: `packages/testing/unit/web/v04-stage-ui.test.ts`

- [ ] **Step 1: Add a failing CSS contract test**

Read `styles.css` in `v04-stage-ui.test.ts` and assert required responsive contracts:

```ts
test('task status workbench has bounded responsive tracks', () => {
  assert.match(styles, /\.status-workbench\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/su);
  assert.match(styles, /\.status-current strong\s*\{[^}]*text-overflow:\s*ellipsis/su);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.status-workbench[\s\S]*grid-template-columns:\s*1fr/su);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.task-list-row[\s\S]*grid-template-columns:\s*1fr/su);
});
```

- [ ] **Step 2: Run the CSS contract test and verify failure**

Run `node --test packages/testing/unit/web/v04-stage-ui.test.ts`.

Expected: FAIL because the new selectors are not styled.

- [ ] **Step 3: Implement the compact visual hierarchy**

Replace obsolete `.status-shell` and `.status-card` styles with:

```css
.status-workbench {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.status-primary-block,
.status-current,
.result-summary-row {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
}

.status-current strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-progress-track {
  height: 6px;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 3px;
  background: #e5e7eb;
}

.status-progress-bar {
  display: block;
  width: 0;
  height: 100%;
  background: #2563eb;
  transition: width 160ms ease;
}

.status-details-panel {
  margin-top: 10px;
  min-width: 0;
  max-width: 100%;
}

.results-list {
  max-height: none;
  overflow: visible;
}

.result-table {
  max-height: 360px;
  overflow-y: auto;
  overflow-x: hidden;
}
```

Use restrained success/failure borders rather than filling the entire module with color.

- [ ] **Step 4: Add narrow-screen result blocks**

```css
@media (max-width: 640px) {
  .status-workbench,
  .runtime-detail-grid,
  .task-list-header,
  .task-list-row {
    grid-template-columns: 1fr;
  }

  .task-list-header { display: none; }
  .task-list-row { gap: 5px; }
  .status-current strong { white-space: normal; overflow-wrap: anywhere; }
  .task-control-actions { width: 100%; }
}
```

Confirm all children of grid/flex containers use `min-width: 0`; do not introduce fixed minimum widths.

- [ ] **Step 5: Run all focused tests**

Run:

```bash
node --test \
  packages/testing/unit/web/v04-stage-ui.test.ts \
  packages/testing/unit/web/task-status-view.test.ts \
  packages/testing/unit/web/task-list-view.test.ts \
  packages/testing/unit/web/results-view.test.ts \
  packages/testing/unit/web/form-state-boundary.test.ts \
  packages/testing/unit/web/source-intake.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Run the full project regression suite**

Run `npm run test:taxonomy-domain`.

Expected: all tests PASS with zero failures.

- [ ] **Step 7: Verify the live page at four widths**

Start or reuse the local server, reload `http://127.0.0.1:4311`, and use the in-app browser at 390px, 768px, 1024px, and 1440px widths. At each width verify:

```js
({
  innerWidth,
  documentWidth: document.documentElement.scrollWidth,
  bodyWidth: document.body.scrollWidth,
  overflowFree: document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth
})
```

Expected: `overflowFree: true` at every width. Also verify the idle state, a running state, a completed state, and a failure state; full results remain closed while failure details open automatically.

- [ ] **Step 8: Create the final guarded implementation commit**

Run `git diff --check`, inspect every changed hunk, and stage only this module's remaining separable changes. Commit with message `feat: simplify responsive task status workbench`. If target-file ownership remains mixed, leave implementation uncommitted and report that explicitly.
