# TagVision 检视列表按文件名排序实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让不同归档目录中的同名视频在检视列表中连续显示。

**Architecture:** 排序仍在后端扫描阶段完成，前端继续按接口顺序渲染。配对项改用“完整视频文件名优先、相对路径兜底”的比较器；诊断列表保留原有相对路径排序。

**Tech Stack:** TypeScript、Node.js `node:test`、macOS Bash 打包脚本

---

### Task 1：用测试固定新排序规则

**Files:**
- Modify: `packages/testing/unit/web/tag-review.test.ts`

- [ ] **Step 1：添加失败测试**

在扫描测试之后添加一个用例，创建 `烹饪制作/同名.mp4`、`清洁整理/同名.mp4` 和 `烹饪制作/另一条.mp4` 及其同名 JSON，并断言顺序为：

```typescript
assert.deepEqual(
  result.pairedItems.map((item) => item.videoRelativePath),
  ['烹饪制作/另一条.mp4', '烹饪制作/同名.mp4', '清洁整理/同名.mp4']
);
```

- [ ] **Step 2：运行测试并确认失败原因正确**

Run: `npm test -- --test-name-pattern="sorts paired review items by filename"`

Expected: FAIL；旧实现先比较目录，实际顺序把两个 `烹饪制作` 文件排在一起。

### Task 2：实现文件名优先排序

**Files:**
- Modify: `apps/web/tag-review.ts:180`
- Modify: `apps/web/tag-review.ts:940-944`
- Test: `packages/testing/unit/web/tag-review.test.ts`

- [ ] **Step 1：添加最小实现**

为配对视频使用专用比较器：

```typescript
function sortReviewVideos(items: readonly ScannedVideoFile[]): readonly ScannedVideoFile[] {
  return [...items].sort((left, right) => {
    const fileNameOrder = left.fileName.localeCompare(right.fileName, 'zh-Hans-CN');
    return fileNameOrder === 0
      ? left.relativePath.localeCompare(right.relativePath, 'zh-Hans-CN')
      : fileNameOrder;
  });
}
```

将配对循环改为 `for (const video of sortReviewVideos(videos))`，保留 `sortByRelativePath` 给诊断列表使用。

- [ ] **Step 2：运行目标测试**

Run: `npm test -- --test-name-pattern="sorts paired review items by filename"`

Expected: PASS。

- [ ] **Step 3：运行完整测试与类型检查**

Run: `npm test && npm run typecheck`

Expected: 所有测试通过，TypeScript 无错误。

### Task 3：重新打包并核对运行产物

**Files:**
- Rebuild: `dist/TagVision-macOS-V0.1/`
- Rebuild: `dist/TagVision-macOS-V0.1.zip`

- [ ] **Step 1：生成 macOS 包**

Run: `npm run pack:macos:v0.1`

Expected: 输出 `Wrote .../dist/TagVision-macOS-V0.1.zip`。

- [ ] **Step 2：验证源码与包内实现一致**

Run: `cmp apps/web/tag-review.ts dist/TagVision-macOS-V0.1/apps/web/tag-review.ts`

Expected: 返回码 0，无差异。

- [ ] **Step 3：重启 TagVision 并验证页面使用新包**

停止当前从旧 `dist/TagVision-macOS-V0.1` 启动的服务，重新运行 `dist/TagVision-macOS-V0.1/Start TagVision macOS.command`。重新扫描当前目录后，确认同名视频卡片连续显示。

### Task 4：提交实现

**Files:**
- Modify: `apps/web/tag-review.ts`
- Modify: `packages/testing/unit/web/tag-review.test.ts`
- Modify: `dist/TagVision-macOS-V0.1/`
- Modify: `dist/TagVision-macOS-V0.1.zip`

- [ ] **Step 1：检查差异范围**

Run: `git status --short && git diff --check`

Expected: 仅包含本计划、排序实现、测试和重新生成的 macOS 产物，无空白错误。

- [ ] **Step 2：提交**

```bash
git add TagVision/apps/web/tag-review.ts \
  TagVision/packages/testing/unit/web/tag-review.test.ts \
  TagVision/docs/superpowers/plans/2026-06-30-review-filename-sorting.md
git commit -m "fix: sort TagVision reviews by filename"
```
