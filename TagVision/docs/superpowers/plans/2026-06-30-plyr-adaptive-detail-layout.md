# TagVision Plyr 自适应详情页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用本地 Plyr 播放器重做详情弹窗，使横屏、竖屏和方形视频与紧凑标签在 1920×1080 下常态一屏显示。

**Architecture:** 后端增加 Plyr 三个精确静态资源路由；前端初始化一个 Plyr 实例并保留原生 video 回退。独立布局模块根据视频元数据和可用容器尺寸计算方向与播放器尺寸，标签改成紧凑网格，证据在覆盖层查看。

**Tech Stack:** TypeScript、浏览器原生 JavaScript、Plyr 3.8.4、Node.js `node:test`、CSS Grid

---

### Task 1：画幅分类与尺寸计算

**Files:**
- Create: `apps/web/public/review-layout.js`
- Create: `packages/testing/unit/web/review-layout.test.ts`

- [ ] 先测试 `classifyVideoOrientation(1920,1080) === 'landscape'`、`(1080,1920) === 'portrait'`、`(1000,1000) === 'square'`，以及 `fitVideoSize()` 返回不超过容器且保持比例的宽高。
- [ ] 运行 `npm test -- --test-name-pattern="review layout"`，确认因模块缺失失败。
- [ ] 实现纯函数：方向阈值为比例 `> 1.2` 横屏、`< 0.8` 竖屏，其余方形；尺寸取 `min(availableWidth / videoWidth, availableHeight / videoHeight)`。
- [ ] 重跑目标测试并确认通过。

### Task 2：离线 Plyr 资源

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `apps/web/server.ts`
- Modify: `packages/testing/unit/web/tag-review-ui.test.ts`

- [ ] 添加失败测试，要求 `plyr` 是运行时依赖，服务端精确映射 `/vendor/plyr.js`、`/vendor/plyr.css`、`/vendor/plyr.svg`，不得开放任意 `node_modules` 路径。
- [ ] 运行目标测试确认失败。
- [ ] 安装 `plyr@3.8.4`，用 `createRequire(import.meta.url).resolve('plyr')` 定位包目录；三个固定 URL 分别服务 `dist/plyr.min.js`、`dist/plyr.css`、`dist/plyr.svg`。
- [ ] 运行 UI 测试和类型检查。

### Task 3：Plyr 单实例与快捷键兼容

**Files:**
- Create: `apps/web/public/review-player.js`
- Modify: `apps/web/public/review.html`
- Modify: `apps/web/public/tag-review.js`
- Modify: `packages/testing/unit/web/tag-review-ui.test.ts`

- [ ] 添加失败测试，要求页面本地加载 Plyr CSS/JS、初始化配置包含 `keyboard: { focused: false, global: false }`、本地 `iconUrl`，并保留原生回退。
- [ ] 实现 `createReviewPlayer(video, PlyrConstructor)`；成功时返回 Plyr 适配器，失败时返回原生 video 适配器，两者提供 `paused/play/pause/setSource/clearSource/destroy`。
- [ ] `tag-review.js` 只初始化一次适配器；翻页前暂停并更新 source；关闭时清空 source；快捷键继续调用适配器。
- [ ] 运行播放器与快捷键测试。

### Task 4：一屏布局与紧凑标签

**Files:**
- Modify: `apps/web/public/review.html`
- Modify: `apps/web/public/tag-review.js`
- Modify: `apps/web/public/styles.css`
- Modify: `packages/testing/unit/web/tag-review-ui.test.ts`

- [ ] 添加失败测试，要求详情主体三行固定布局、播放器尺寸 CSS 变量、方向数据属性、标签网格、证据覆盖层和右侧唯一滚动区域。
- [ ] 元数据加载和 `ResizeObserver` 触发时调用画幅计算，将 `data-video-orientation`、`--review-player-width`、`--review-player-height` 写入详情布局。
- [ ] accepted 编辑器压缩为工具栏；状态信息改为横向摘要；每条标签只显示路径与角色/层级/置信度。
- [ ] 点击标签打开覆盖式证据详情，包含证据类型、说明和完整标签字段；关闭不改变播放器尺寸。
- [ ] CSS 在 1920×1080 下使页头、主体、导航固定；横/方/竖三种列宽分别为 `62/38`、`52/48`、`38/62`；仅 `.review-tag-panel` 可滚动。
- [ ] 运行完整测试和类型检查。

### Task 5：打包与实际验收

**Files:**
- Rebuild: `dist/TagVision-macOS-V0.1/`
- Rebuild: `dist/TagVision-macOS-V0.1.zip`

- [ ] 运行 `npm run pack:macos:v0.1`，确认包内依赖声明和前端代码完整。
- [ ] 在隔离端口创建 16:9、9:16、1:1 测试视频及 24/49 条标签样本。
- [ ] 浏览器设置 1920×1080，验证三种画幅完整显示、24 条常态一屏、49 条仅右侧滚动、证据覆盖层、Plyr 控件和现有快捷键。
- [ ] 运行 `npm test && npm run typecheck && git diff --check` 后提交。
