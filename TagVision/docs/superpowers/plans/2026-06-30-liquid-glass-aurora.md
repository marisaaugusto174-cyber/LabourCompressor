# Liquid Glass Aurora Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 TagVision 检视首页和详情页改成白色 Liquid Glass + 静态蓝粉 Aurora 风格，并删除当前页面中过多的说明性文字。

**Architecture:** 保持现有后端、扫描、排序、Plyr、快捷键、accepted 保存和缩略图接口不变，只调整 `review.html` 的信息结构、`styles.css` 的视觉系统，以及 `tag-review.js` 中诊断区的显示状态。测试先锁定“少文字、静态 Aurora、玻璃材质、诊断区正常隐藏/异常显示”的行为，再实现最小改动。

**Tech Stack:** HTML/CSS/vanilla JavaScript、Node `node:test` 单元测试、现有 TagVision 本地服务与 macOS 打包脚本。

---

## File Structure

- Modify: `apps/web/public/review.html`
  - 删除首页副标题、版本、能力 chip、区块标题和解释段落。
  - 保留入口、目录输入、按钮、四个统计卡、加载更多、卡片网格、详情弹窗和隐藏诊断区。
  - 给诊断区容器增加稳定 id，便于 JS 正常隐藏和异常显示。
- Modify: `apps/web/public/styles.css`
  - 增加全局 Aurora 背景和 Liquid Glass 设计变量。
  - 统一 `.panel`、统计卡、卡片、详情弹窗、标签、accepted 编辑器、按钮、输入框的玻璃材质。
  - 增加 `backdrop-filter` fallback，保证不支持毛玻璃时仍可读。
- Modify: `apps/web/public/tag-review.js`
  - 增加 `diagnosticsPanel` 引用。
  - 正常扫描无异常时隐藏诊断区；存在未配对、孤儿 JSON、无效 JSON 或运行错误时显示。
  - 保持调试 JSON 输出生成逻辑不变，但正常状态不占据页面视觉空间。
- Modify: `packages/testing/unit/web/tag-review-ui.test.ts`
  - 更新旧 release/说明文字断言。
  - 新增 Liquid Glass/Aurora/CSS fallback 断言。
  - 新增诊断区隐藏/显示逻辑断言。

---

### Task 1: Lock the simplified review page contract

**Files:**
- Modify: `packages/testing/unit/web/tag-review-ui.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the old release metadata expectation inside `test('release metadata names the local tool as TagVision V0.1 macOS', ...)`:

```ts
  assert.equal(reviewHtml.includes('TagVision V0.1 macOS'), true);
  assert.equal(reviewHtml.includes('Release: TagVision V0.1 macOS'), true);
```

with:

```ts
  assert.equal(reviewHtml.includes('TagVision'), true);
  assert.equal(reviewHtml.includes('TagVision V0.1 macOS'), false);
  assert.equal(reviewHtml.includes('Release: TagVision V0.1 macOS'), false);
```

Add this new test after `review ui exposes a compact local-only scan workflow`:

```ts
test('review page removes descriptive marketing and section copy', () => {
  for (const removedText of [
    '扫描片段视频、模型 JSON 和 taxonomy 快照，回看并写出人工确认的 accepted sidecar。',
    '只读取并扫描目录，不会改名、不改原始 JSON。',
    '递归扫描视频、同名 JSON 和 taxonomy 快照。',
    '滚动时增量加载卡片，视频只在接近视口时挂载。',
    '诊断与日志',
    '检视来源',
    '多视频预览',
    '本地检视',
    '人工 accepted 结果'
  ]) {
    assert.equal(reviewHtml.includes(removedText), false, `unexpected descriptive copy: ${removedText}`);
  }

  assert.match(reviewHtml, /<h1>TagVision<\/h1>/u);
  assert.match(reviewHtml, /<a class="chip" href="\/">入口<\/a>/u);
  assert.match(reviewHtml, /<section id="review-diagnostics-panel" class="panel review-diagnostics-panel hidden"/u);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- packages/testing/unit/web/tag-review-ui.test.ts
```

Expected: FAIL because `review.html` still contains release/version text, descriptive copy, old section headings, extra chips, and no `#review-diagnostics-panel`.

- [ ] **Step 3: Implement minimal HTML cleanup**

In `apps/web/public/review.html`:

- Change `<h1>TagVision V0.1 macOS</h1>` to `<h1>TagVision</h1>`.
- Delete the header subtitle paragraph and `.build-version`.
- Keep only `<a class="chip" href="/">入口</a>` in `.header-chip-list`.
- Replace the source panel header with only the source bar.
- Change the visible label to an accessible-only label:

```html
<label class="sr-only" for="review-directory">待检文件夹</label>
```

- Remove the source meta helper span.
- Replace the preview panel header with only:

```html
<div class="review-toolbar">
  <button id="load-more" class="secondary-button" type="button" disabled>加载更多</button>
</div>
```

- Change the diagnostics section opener to:

```html
<section id="review-diagnostics-panel" class="panel review-diagnostics-panel hidden" aria-label="诊断">
```

and remove the diagnostics heading/paragraph.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- packages/testing/unit/web/tag-review-ui.test.ts
```

Expected: PASS for the new simplified page assertions; existing assertions should still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/review.html packages/testing/unit/web/tag-review-ui.test.ts
git commit -m "test: lock simplified review page"
```

---

### Task 2: Lock Liquid Glass and static Aurora CSS

**Files:**
- Modify: `packages/testing/unit/web/tag-review-ui.test.ts`
- Modify: `apps/web/public/styles.css`

- [ ] **Step 1: Write the failing test**

Add this test after the simplified page test:

```ts
test('review page uses static white Liquid Glass with blue pink aurora background', () => {
  assert.match(stylesCss, /--glass-surface:/u);
  assert.match(stylesCss, /--glass-border:/u);
  assert.match(stylesCss, /--aurora-blue:/u);
  assert.match(stylesCss, /--aurora-pink:/u);
  assert.match(stylesCss, /body\s*\{[\s\S]*radial-gradient\(circle at 16% 18%,\s*var\(--aurora-blue\)/u);
  assert.match(stylesCss, /body\s*\{[\s\S]*background-attachment:\s*fixed/su);
  assert.match(stylesCss, /\.panel,\s*\.subpanel,\s*\.status-card,\s*\.review-card\s*\{[\s\S]*backdrop-filter:\s*blur\(24px\) saturate\(1\.45\)/u);
  assert.match(stylesCss, /\.panel::before,\s*\.subpanel::before,\s*\.status-card::before,\s*\.review-card::before/u);
  assert.match(stylesCss, /@supports\s+not\s+\(\(backdrop-filter:\s*blur\(1px\)\)\)\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.96\)/u);
  assert.doesNotMatch(stylesCss, /animation:\s*aurora/u);
  assert.doesNotMatch(stylesCss, /canvas/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- packages/testing/unit/web/tag-review-ui.test.ts
```

Expected: FAIL because `styles.css` does not yet define the new design variables, static Aurora background, shared glass selector, or fallback block.

- [ ] **Step 3: Implement the CSS foundation**

At the top of `apps/web/public/styles.css`, insert:

```css
:root {
  --page-ink: #0f172a;
  --page-muted: #64748b;
  --glass-surface: linear-gradient(145deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.58));
  --glass-strong: linear-gradient(145deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.72));
  --glass-border: rgba(255, 255, 255, 0.72);
  --glass-shadow: 0 22px 70px rgba(59, 93, 148, 0.14), 0 6px 24px rgba(15, 23, 42, 0.08);
  --glass-inner: inset 0 1px 0 rgba(255, 255, 255, 0.82), inset 0 -1px 0 rgba(147, 197, 253, 0.14);
  --aurora-blue: rgba(96, 165, 250, 0.36);
  --aurora-pink: rgba(244, 114, 182, 0.30);
}
```

Replace the existing `body` background with a static multi-layer background:

```css
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;
  background:
    radial-gradient(circle at 16% 18%, var(--aurora-blue), transparent 32%),
    radial-gradient(circle at 82% 12%, var(--aurora-pink), transparent 34%),
    radial-gradient(circle at 62% 78%, rgba(125, 211, 252, 0.22), transparent 38%),
    linear-gradient(135deg, #f8fbff 0%, #ffffff 44%, #f7f9ff 100%);
  background-attachment: fixed;
  color: var(--page-ink);
}
```

Replace the shared `.panel, .subpanel` block with:

```css
.panel,
.subpanel,
.status-card,
.review-card {
  position: relative;
  overflow: hidden;
  background: var(--glass-surface);
  border: 1px solid var(--glass-border);
  border-radius: 22px;
  box-shadow: var(--glass-shadow), var(--glass-inner);
  backdrop-filter: blur(24px) saturate(1.45);
  -webkit-backdrop-filter: blur(24px) saturate(1.45);
}

.panel::before,
.subpanel::before,
.status-card::before,
.review-card::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.70), transparent 38%);
  opacity: 0.56;
}
```

Add the fallback near the shared glass block:

```css
@supports not ((backdrop-filter: blur(1px))) {
  .panel,
  .subpanel,
  .status-card,
  .review-card {
    background: rgba(255, 255, 255, 0.96);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- packages/testing/unit/web/tag-review-ui.test.ts
```

Expected: PASS for Liquid Glass/Aurora assertions.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/styles.css packages/testing/unit/web/tag-review-ui.test.ts
git commit -m "style: add liquid glass aurora foundation"
```

---

### Task 3: Make diagnostics hidden by default and visible only for anomalies

**Files:**
- Modify: `packages/testing/unit/web/tag-review-ui.test.ts`
- Modify: `apps/web/public/tag-review.js`

- [ ] **Step 1: Write the failing test**

Add this test after the Liquid Glass test:

```ts
test('review diagnostics panel is hidden until anomalies or action errors occur', () => {
  assert.match(reviewJs, /diagnosticsPanel:\s*document\.querySelector\('#review-diagnostics-panel'\)/u);
  assert.match(reviewJs, /function hideDiagnosticsPanel\(\)\s*\{[\s\S]*refs\.diagnosticsPanel\.classList\.add\('hidden'\)/u);
  assert.match(reviewJs, /function showDiagnosticsPanel\(\)\s*\{[\s\S]*refs\.diagnosticsPanel\.classList\.remove\('hidden'\)/u);
  assert.match(reviewJs, /if \(rows\.length === 0\)\s*\{[\s\S]*hideDiagnosticsPanel\(\);[\s\S]*return;/u);
  assert.match(reviewJs, /refs\.diagnosticsPanel\.classList\.remove\('hidden'\)/u);
  assert.match(reviewJs, /showDiagnostics\(\[\{ severity: 'error', message: error\.message \}\]\)/u);
  assert.match(reviewHtml, /id="review-diagnostics-panel"[^>]*hidden/u);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- packages/testing/unit/web/tag-review-ui.test.ts
```

Expected: FAIL because JS has no `diagnosticsPanel` ref and does not hide the diagnostics panel after normal scans.

- [ ] **Step 3: Implement diagnostics panel visibility**

In `apps/web/public/tag-review.js`, add the ref:

```js
  diagnosticsPanel: document.querySelector('#review-diagnostics-panel'),
```

Add helpers near `renderDiagnostics`:

```js
function hideDiagnosticsPanel() {
  refs.diagnosticsPanel.classList.add('hidden');
}

function showDiagnosticsPanel() {
  refs.diagnosticsPanel.classList.remove('hidden');
}
```

In `renderDiagnostics(payload)`, before the empty-state write, call:

```js
    hideDiagnosticsPanel();
```

Before rendering rows, call:

```js
  showDiagnosticsPanel();
```

In `showDiagnostics(items)`, call `showDiagnosticsPanel()` before writing diagnostics rows.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- packages/testing/unit/web/tag-review-ui.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/tag-review.js packages/testing/unit/web/tag-review-ui.test.ts
git commit -m "feat: hide review diagnostics when clean"
```

---

### Task 4: Polish Liquid Glass components without changing behavior

**Files:**
- Modify: `apps/web/public/styles.css`
- Modify: `packages/testing/unit/web/tag-review-ui.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test after the diagnostics test:

```ts
test('review controls and detail surfaces keep neutral glass without gradient button fills', () => {
  assert.match(stylesCss, /button\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.62\)/u);
  assert.match(stylesCss, /button\s*\{[\s\S]*backdrop-filter:\s*blur\(18px\) saturate\(1\.35\)/u);
  assert.match(stylesCss, /\.review-card-video\s*\{[\s\S]*background:\s*#0f172a/su);
  assert.match(stylesCss, /\.review-card-video\s+img\s*\{[\s\S]*object-fit:\s*cover/su);
  assert.match(stylesCss, /\.review-player\s*\{[\s\S]*background:\s*rgba\(15,\s*23,\s*42,\s*0\.94\)/u);
  assert.match(stylesCss, /\.review-tag-compact\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.74\)/u);
  assert.match(stylesCss, /\.accepted-path-row\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.72\)/u);
  assert.doesNotMatch(stylesCss, /button\s*\{[^}]*linear-gradient/su);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- packages/testing/unit/web/tag-review-ui.test.ts
```

Expected: FAIL because controls/cards/detail surfaces still use older solid fills.

- [ ] **Step 3: Implement component polish**

Update existing CSS rules without changing DOM or JS behavior:

- Buttons:

```css
button {
  border: 1px solid rgba(255, 255, 255, 0.68);
  background: rgba(255, 255, 255, 0.62);
  color: #1e3a8a;
  box-shadow: 0 10px 28px rgba(37, 99, 235, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.74);
  backdrop-filter: blur(18px) saturate(1.35);
  -webkit-backdrop-filter: blur(18px) saturate(1.35);
}
```

- Secondary buttons:

```css
.secondary-button {
  background: rgba(255, 255, 255, 0.50);
  color: #334155;
  border-color: rgba(148, 163, 184, 0.28);
}
```

- Video card media:

```css
.review-card-video { background: #0f172a; }
.review-card-video img { object-fit: cover; }
```

- Player stage:

```css
.review-player { background: rgba(15, 23, 42, 0.94); }
```

- Detail tag and accepted rows:

```css
.review-tag-compact { background: rgba(255, 255, 255, 0.74); }
.accepted-path-row { background: rgba(255, 255, 255, 0.72); }
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- packages/testing/unit/web/tag-review-ui.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/styles.css packages/testing/unit/web/tag-review-ui.test.ts
git commit -m "style: polish review glass components"
```

---

### Task 5: Full verification and browser acceptance

**Files:**
- Modify only if verification exposes defects in files above.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
npm test -- packages/testing/unit/web/tag-review-ui.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run type check**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run macOS package verification**

Run:

```bash
npm run pack:macos:v0.1
```

Expected: PASS and package artifact generated by the existing script.

- [ ] **Step 5: Browser acceptance on the actual app**

Start or reuse the TagVision web server, open `http://127.0.0.1:4312/review.html`, and verify:

- The homepage shows only `TagVision` and `入口` in the header.
- No old descriptive paragraphs, old chips, release text, or visible diagnostics panel in normal state.
- Background is static blue/pink Aurora on white.
- Panels/cards/buttons use Liquid Glass; video thumbnail colors are not tinted.
- Scan works, cards render, load more still works.
- Detail opens; Plyr playback, direction-key navigation, space play/pause, Esc close still work.
- Horizontal, vertical, and square videos keep the existing adaptive layout.
- Tags and accepted paths remain readable and are not ellipsized.
- Accepted result save still writes via the existing endpoint.

- [ ] **Step 6: Final commit**

If any verification fixes were needed:

```bash
git add apps/web/public/review.html apps/web/public/styles.css apps/web/public/tag-review.js packages/testing/unit/web/tag-review-ui.test.ts
git commit -m "fix: verify liquid glass review ui"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: The plan covers simplified homepage copy, static Aurora, unified Liquid Glass surfaces, video color preservation, neutral glass buttons, diagnostics hidden unless abnormal, detail surface continuity, tests, typecheck, macOS pack, and browser acceptance.
- Placeholder scan: No TBD/TODO/fill-later placeholders remain.
- Type consistency: Test names, ids, helper names, CSS variables, and DOM ids match the planned implementation files.
