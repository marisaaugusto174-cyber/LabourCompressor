# 05_STEP_BY_STEP_PLAN.md

## Status

- Project: `LabourCompressor`
- Product Version: `v0.5`
- Current Priority: GOV-003 application integration boundaries
- Completed Gates: Phase 0, GOV-004
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

## Completed Governance Evidence

### GOV-004: Xiaohongshu Download Hardening

Completed on 2026-06-28:

- 同页 master/backup URL 按序轮换，全部失败后最多刷新页面一次。
- 拒绝 HTML/JSON 挑战响应，校验 `Content-Length` 与实际字节数。
- 候选切换重置进度，失败和取消清理 `.part` 与 abort listener。
- CLI、结果页和任务状态页共享结构化中文错误语义。
- 针对性测试 89/89、治理测试 19/19、完整回归 399/399 通过。
- 外部真实验收连续两次产出 1080×1440 H.264/AAC MP4，无 `.part` 残留；真实凭证、token 和媒体地址未持久化。

### GOV-003: Application Integration Boundaries

Completed on 2026-06-28:

- 建立 platform credential application service、filesystem repository 与 connectivity probe adapter。
- Web runtime support 保留兼容 facade，平台协议和网络探测移出 route/composition facade。
- 针对性测试与完整回归通过，HTTP 路径和响应 DTO 保持兼容。

### GOV-001: Oversized Production Modules

Completed on 2026-06-28:

- 七个历史超限生产模块全部拆至 500 行以内并保留旧入口。
- 新增全局生产模块 500 行尺寸门禁。
- 完整回归 402/402 通过。

### GOV-002: Executable TypeScript Gate

Completed on 2026-06-28:

- 固定 `typescript@6.0.3` 与 `@types/node@22.20.0`。
- `apps/**/*.ts` 与生产 `packages/**/*.ts` 纳入 strict typecheck。
- `npm run typecheck` 与 `npm run verify` 返回 0，完整回归 402/402 通过。

---

## GOV-001: Oversized Production Modules [completed]

### Current Facts

生产文件尺寸门禁已覆盖 `apps/**` 与 `packages/**`；历史超限文件已完成职责拆分。

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

## GOV-002: Executable TypeScript Gate [completed]

### Current Facts

- `tsconfig.json` 启用了 strict 选项。
- TypeScript 与 Node 类型版本已固定。
- `apps/**` 与生产 `packages/**` 已纳入 strict typecheck。
- typecheck 已进入 `test:taxonomy-domain` 和 `verify` 门禁。

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

## GOV-003: Application Integration Boundaries [completed]

### Current Facts

apps 作为 composition root 合法导入 adapter；平台凭证协调、文件 repository 与协议 probe 已分层，旧 runtime-support 导出由 facade 兼容。

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

1. [completed] Phase 0 文档现实对齐。
2. [completed] GOV-004 小红书下载完整性。
3. [completed] GOV-003 应用与 adapter 边界。
4. [completed] GOV-001 全量收敛超大文件。
5. [completed] GOV-002 建立 typecheck 门禁。
6. [current] GOV-005 迁移 orchestrator。
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
