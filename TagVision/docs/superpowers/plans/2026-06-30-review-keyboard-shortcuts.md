# TagVision 检视快捷键实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在视频详情弹窗中增加方向键翻页、空格播放／暂停和快捷键提示。

**Architecture:** 新建一个无 DOM 初始化副作用的快捷键处理模块，由现有 `tag-review.js` 把弹窗状态、当前索引、视频元素和翻页回调传入。这样快捷键规则可用 Node 单元测试直接验证，页面仍保留一个集中式 `keydown` 入口。

**Tech Stack:** 浏览器原生 JavaScript、HTML、Node.js `node:test`

---

### Task 1：用单元测试固定快捷键行为

**Files:**
- Create: `packages/testing/unit/web/review-shortcuts.test.ts`
- Create: `apps/web/public/review-shortcuts.js`

- [ ] **Step 1：创建失败测试**

测试导入 `handleReviewShortcut`，使用假的事件、视频对象和回调验证：

```typescript
const handled = handleReviewShortcut({
  event: createKeyboardEvent('ArrowRight'),
  detailOpen: true,
  selectedIndex: 1,
  itemCount: 3,
  video: createVideoState(true),
  openDetail: (index) => openedIndexes.push(index),
  closeDetail: () => { closed = true; }
});

assert.equal(handled, true);
assert.deepEqual(openedIndexes, [2]);
```

分别覆盖 `ArrowLeft`、`ArrowRight`、空格、`Escape`、首尾边界、详情关闭、自动重复和可编辑控件焦点。

- [ ] **Step 2：运行测试并确认失败**

Run: `npm test -- --test-name-pattern="review shortcut"`

Expected: FAIL，原因是 `review-shortcuts.js` 或导出函数尚不存在。

- [ ] **Step 3：实现最小快捷键模块**

实现并导出：

```javascript
export function handleReviewShortcut(input) {
  const { event } = input;
  if (!input.detailOpen || event.repeat || isEditableTarget(event.target)) return false;

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    if (input.selectedIndex > 0) input.openDetail(input.selectedIndex - 1);
    return true;
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    if (input.selectedIndex < input.itemCount - 1) input.openDetail(input.selectedIndex + 1);
    return true;
  }
  if (event.key === ' ') {
    event.preventDefault();
    if (input.video.paused) void input.video.play();
    else input.video.pause();
    return true;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    input.closeDetail();
    return true;
  }
  return false;
}
```

`isEditableTarget` 识别 `INPUT`、`SELECT`、`TEXTAREA` 和 `isContentEditable`。

- [ ] **Step 4：运行目标测试**

Run: `npm test -- --test-name-pattern="review shortcut"`

Expected: PASS。

### Task 2：接入详情弹窗并展示提示

**Files:**
- Modify: `apps/web/public/tag-review.js:1,89-93`
- Modify: `apps/web/public/review.html:155-160`
- Modify: `packages/testing/unit/web/tag-review-ui.test.ts`

- [ ] **Step 1：添加失败的页面接入测试**

断言 `tag-review.js` 导入并调用 `handleReviewShortcut`，同时断言 HTML 包含：

```text
← 上一个　空格 播放/暂停　→ 下一个　Esc 关闭
```

- [ ] **Step 2：运行页面测试并确认失败**

Run: `npm test -- --test-name-pattern="review detail exposes keyboard shortcuts"`

Expected: FAIL，页面尚未接入模块和提示。

- [ ] **Step 3：接入统一键盘处理器**

在 `tag-review.js` 中导入 `handleReviewShortcut`，并将现有监听器改为：

```javascript
window.addEventListener('keydown', (event) => {
  handleReviewShortcut({
    event,
    detailOpen: isDetailOpen(),
    selectedIndex,
    itemCount: currentItems.length,
    video: refs.detailVideo,
    openDetail,
    closeDetail
  });
});
```

在详情底部导航中加入可见快捷键提示。

- [ ] **Step 4：运行页面测试和完整测试**

Run: `npm test && npm run typecheck`

Expected: 所有测试通过，TypeScript 无错误。

### Task 3：打包并实际验证

**Files:**
- Rebuild: `dist/TagVision-macOS-V0.1/`
- Rebuild: `dist/TagVision-macOS-V0.1.zip`

- [ ] **Step 1：重新生成 macOS 包**

Run: `npm run pack:macos:v0.1`

Expected: 输出新的 `dist/TagVision-macOS-V0.1.zip`。

- [ ] **Step 2：核对打包内容**

Run: `cmp apps/web/public/review-shortcuts.js dist/TagVision-macOS-V0.1/apps/web/public/review-shortcuts.js`

Expected: 返回码 0。

- [ ] **Step 3：重启服务并验证实际交互**

从新包启动 `4312` 服务，在详情弹窗中验证：空格播放／暂停、左右键翻页后保持暂停、首尾不越界、输入和下拉控件聚焦时快捷键不触发、`Esc` 关闭。

### Task 4：最终验证与提交

**Files:**
- Create: `apps/web/public/review-shortcuts.js`
- Create: `packages/testing/unit/web/review-shortcuts.test.ts`
- Modify: `apps/web/public/tag-review.js`
- Modify: `apps/web/public/review.html`
- Modify: `packages/testing/unit/web/tag-review-ui.test.ts`

- [ ] **Step 1：执行最终验证**

Run: `npm test && npm run typecheck && git diff --check`

Expected: 所有测试通过，类型检查及差异检查无错误。

- [ ] **Step 2：提交实现**

```bash
git add TagVision/apps/web/public/review-shortcuts.js \
  TagVision/apps/web/public/tag-review.js \
  TagVision/apps/web/public/review.html \
  TagVision/packages/testing/unit/web/review-shortcuts.test.ts \
  TagVision/packages/testing/unit/web/tag-review-ui.test.ts \
  TagVision/docs/superpowers/plans/2026-06-30-review-keyboard-shortcuts.md
git commit -m "feat: add TagVision review shortcuts"
```
