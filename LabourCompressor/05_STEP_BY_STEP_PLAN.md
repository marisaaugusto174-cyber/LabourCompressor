# 05_STEP_BY_STEP_PLAN.md

## Status

- Project: `LabourCompressor`
- Product Version: `v0.5`
- Current Priority: core governance document alignment
- Planning Rule: current facts first, incremental gates, no hidden debt

---

## Purpose

本文件只记录尚未完成的治理和迁移工作。已经稳定运行的 V0.5 功能不在此重复描述。

每项治理债务必须包含：

- 当前事实
- 进入条件
- 施工边界
- 退出条件
- 验证命令

债务记录不是永久例外。达到退出条件后必须删除记录，并把新约束升级到 `03_STRICT_RULES.md`。

---

## Current Product Baseline

当前主线：

```text
Web UI
-> 表格与 Preflight
-> 平台下载
-> 自动分割
-> AfterEdit / ProblemClips
-> 视频级打标
-> 回表与归档
-> 失败导出
```

当前下载平台：

- Bilibili
- YouTube
- 抖音
- TikTok
- 小红书单笔记单视频

当前持久化：

- `.runtime-state/tasks.json`
- 文件系统媒体和归档产物
- 用户表和程序内 xlsx

当前编排：

- `apps/cli/pipeline/**`
- `apps/cli/local-pipeline-*.ts`
- `apps/web/task-service.ts`

---

## Phase 0: Core Document Alignment

### Scope

- `01_PROJECT_CHARTER.md`
- `02_AGENTS_WORKFLOW.md`
- `03_STRICT_RULES.md`
- `04_STATE_AND_DATA.md`
- `05_STEP_BY_STEP_PLAN.md`

### Exit Conditions

- 五份文档均少于 500 行。
- 不再存在失效绝对路径或虚构现有目录。
- SQLite 和独立 orchestrator 明确为目标，不描述为现状。
- 默认自动分割与人工兼容闸门不再冲突。
- 五份文档统一包含小红书有限支持范围。
- 当前门禁与迁移债务明确分区。

### Verification

```bash
wc -l 01_PROJECT_CHARTER.md 02_AGENTS_WORKFLOW.md 03_STRICT_RULES.md 04_STATE_AND_DATA.md 05_STEP_BY_STEP_PLAN.md
node --test packages/testing/unit/governance/*.test.ts
git diff --check
```

完成 Phase 0 前不启动以下代码治理阶段。

---

## GOV-001: Oversized Production Modules

### Current Facts

当前超过 500 行的生产文件至少包括：

- `apps/web/runtime-support-platform.ts`
- `apps/web/public/app.js`
- `packages/adapters/downloaders/ytdlp-downloader.ts`
- `apps/web/public/tag-review.js`
- `apps/web/tag-review.ts`
- `packages/adapters/spreadsheets/local-spreadsheet-helpers.ts`
- `apps/web/runtime-support-local.ts`

### Entry Condition

只有在相关功能需要修改该文件，或存在独立治理任务时进入拆分；普通无关修复不得被迫一次性重写全部模块。

### Construction Boundary

- 先删除重复和失效逻辑。
- 只按明确职责拆分。
- 不改变公开行为和状态语义。
- 每次只治理一个功能边界。

### Exit Condition

- 目标文件少于 500 行；或
- 文件净行数下降、职责不再增加，并留下下一次可执行边界。

### Verification

```bash
wc -l <target-files>
node --test <target-tests>
npm run test:taxonomy-domain
```

---

## GOV-002: Executable TypeScript Gate

### Current Facts

- `tsconfig.json` 启用了 strict 选项。
- `typescript` 未作为项目依赖安装。
- `apps/**` 不在当前 include 范围。
- 当前 Node 测试能执行 TypeScript，但不等于类型检查。

### Entry Condition

在独立治理分支中执行，不与业务功能捆绑。

### Construction Boundary

- 固定 TypeScript 版本并加入 dev dependency。
- 增加 `npm run typecheck`。
- 将 `apps/**/*.ts` 与 `packages/**/*.ts` 纳入检查。
- 分批修复真实类型错误，禁止用全局关闭 strict 或批量 `any` 过关。

### Exit Condition

```bash
npm run typecheck
```

稳定返回 0，并加入合并门禁。完成后把 typecheck 从迁移项升级为 `03_STRICT_RULES.md` 即时拒绝条件。

---

## GOV-003: Application Integration Boundaries

### Current Facts

apps 作为 composition root 合法导入 adapter，但部分 `runtime-support-*.ts` 同时承担配置、网络探测、文件写入和错误翻译。

### Entry Condition

优先从超过 500 行且频繁修改的 `apps/web/runtime-support-platform.ts` 开始。

### Construction Boundary

- HTTP route 只解析输入和返回 DTO。
- application service 负责用例协调。
- adapter 负责 yt-dlp、fetch、cookies 和平台协议。
- domain 负责纯规则和候选选择。
- 保持现有 API 路径与响应兼容。

### Exit Condition

- route 不直接调用第三方进程或平台协议。
- runtime-support 主文件少于 500 行。
- 平台凭证、探测和下载路径各有独立测试边界。

### Verification

```bash
node --test packages/testing/unit/cli/runtime-support.test.ts
node --test packages/testing/unit/web/*.test.ts
node --test packages/testing/unit/governance/*.test.ts
```

---

## GOV-004: Xiaohongshu Download Hardening

### Current Facts

小红书已支持 `yt-dlp` 优先和页面解析回退，具备 H.264 优先、有限重试、取消和 `.part` 清理测试。

### Entry Condition

Phase 0 完成后，作为第一个下载质量治理任务执行。

### Construction Boundary

- 同一页面内按顺序尝试 master 和 backup URL。
- 拒绝明确的 HTML/JSON 挑战响应。
- 已知 `Content-Length` 必须与实际写入一致。
- 清理 retry/abort listener。
- 不扩大到图文、主页、短链接或自动登录。

### Exit Condition

- 备用 URL 可在不重新获取页面时接棒。
- 截断和错误媒体类型不会生成成功产物。
- 失败和取消无 `.part` 残留。
- 真实凭证、token 和媒体签名不进入仓库或输出。

### Verification

```bash
node --test packages/testing/unit/download/xiaohongshu-downloader.test.ts
node --test packages/testing/unit/download/ytdlp-downloader.test.ts
npm run test:taxonomy-domain
```

---

## GOV-005: Dedicated Orchestration Boundary

### Current Facts

当前编排位于 apps，尚无 `packages/orchestrator`。

### Entry Condition

只有在 application integration 边界稳定、状态契约明确后启动。

### Construction Boundary

- 先定义 workflow port 和状态推进 contract。
- 逐阶段迁移，不做一次性目录搬家。
- orchestrator 不导入 adapter 具体实现。
- apps 保留 composition root 和输入输出边界。

### Exit Condition

- 跨阶段状态推进位于独立 application/orchestrator 边界。
- apps 不承载领域规则。
- 现有端到端结果和恢复语义不变。

### Verification

```bash
node --test packages/testing/integration/phase2/*.test.ts
node --test packages/testing/integration/phase3/*.test.ts
node --test packages/testing/integration/phase4/*.test.ts
node --test packages/testing/integration/phase5/*.test.ts
```

---

## GOV-006: Storage Port and Optional SQLite

### Current Facts

`.runtime-state/tasks.json` 是当前任务状态 SSOT；SQLite 未接入。

### Entry Condition

任务状态和 checkpoint contract 稳定，并完成 orchestrator 边界后再启动。

### Construction Boundary

- 先抽象 storage port。
- JSON adapter 保持兼容。
- SQLite 作为新增 adapter，不直接进入 domain。
- 提供 JSON 到 SQLite 的可回滚迁移工具。

### Exit Condition

- JSON 与 SQLite contract tests 一致。
- 重启恢复、幂等、并发写入和迁移回滚通过。
- 用户数据迁移有备份和验证报告。

### Verification

```bash
node --test packages/testing/unit/core/*.test.ts
node --test packages/testing/integration/**/*.test.ts
npm run test:taxonomy-domain
```

---

## Governance Order

执行顺序固定为：

1. Phase 0 文档现实对齐。
2. GOV-004 小红书下载完整性。
3. GOV-003 应用与 adapter 边界。
4. GOV-001 按触达范围收敛超大文件。
5. GOV-002 建立 typecheck 门禁。
6. GOV-005 迁移 orchestrator。
7. GOV-006 评估并接入 storage/SQLite。

如果前置条件不满足，不得跳级实施后续目标。

---

## Completion Rule

每次治理任务完成后必须：

- 更新对应债务状态。
- 运行目标测试和完整回归。
- 检查敏感信息与 diff 范围。
- 只有达到退出条件才删除债务记录。
- 将已经可执行的新门禁同步到 `03_STRICT_RULES.md`。
