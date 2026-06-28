# 01_PROJECT_CHARTER.md

## Status

- Project: `LabourCompressor`
- Product Version: `v0.5`
- Runtime: `Node.js 22+`
- Product Shape: local-first, single-user media workflow
- Architecture Direction: hexagonal boundaries with explicit composition roots
- Primary Goal: stability and safety before feature breadth

---

## Charter Authority

本章程固定产品范围、当前架构事实、目标架构和不可突破的系统边界。

治理文档按以下顺序解释：

1. `01_PROJECT_CHARTER.md`：产品与架构边界。
2. `03_STRICT_RULES.md`：当前可执行的合并门禁。
3. `04_STATE_AND_DATA.md`：状态、SSOT 与敏感数据规则。
4. `02_AGENTS_WORKFLOW.md`：实施和交接方式。
5. `05_STEP_BY_STEP_PLAN.md`：技术债与迁移顺序。

发生冲突时，必须先以仓库当前可验证事实为准，再按 `05_STEP_BY_STEP_PLAN.md` 推进目标架构；禁止把目标状态描述成已经完成。

---

## Product Identity

`LabourCompressor` 是本地优先、状态敏感、规则约束型的媒体资产工作流系统。核心价值是把下载、分割、视频打标、回表和归档压缩为可重复、可追踪、可中断、可继续的本地流程。

核心资产：

- 标签库与提示词库
- 用户表格与程序内结果表
- 下载缓存、`AfterEdit`、`ProblemClips` 和归档媒体
- 任务状态、失败分类和 checkpoint
- 平台凭证引用与模型配置引用

外部可替换能力：

- 平台下载器
- ffmpeg / ffprobe / PySceneDetect
- 模型 provider
- 表格读写器
- 文件系统执行器

---

## V0.5 Product Goal

V0.5 默认主线由 Web UI 驱动：

1. 配置模型与平台凭证。
2. 导入表格并执行 Preflight。
3. 下载源视频。
4. 自动分割为 `3-30s` 片段。
5. 合法片段进入 `AfterEdit`，异常片段进入 `ProblemClips`。
6. 对合法片段执行视频级打标。
7. 多分支回表，按唯一 `内容题材` 归档。
8. 展示结果并导出失败 CSV。

V0.2 人工 `AfterEdit` 只作为高级兼容路径：关闭自动分割并启用人工剪辑闸门后，系统才在下载后暂停。

V0.5 不包含：

- 云端账号、多租户或多人权限
- 远程素材传输
- 自动浏览器登录或自动抓取 cookies
- 自动绕过平台风控
- 自动去水印承诺
- 全平台稳定下载承诺
- 复杂 BI、训练数据交付平台或云端检索服务

---

## Supported Download Boundary

当前支持的平台范围：

- `Bilibili`
- `YouTube`
- `抖音`
- `TikTok`
- `小红书`

小红书 V0.5 只支持：

- `/explore/<note-id>`
- `/discovery/item/<note-id>`
- 单笔记、单视频下载
- `yt-dlp` 优先，明确无格式时使用本地页面解析回退

不支持小红书图文下载、主页批量采集、短链接、自动登录或批量账号采集。

所有平台下载均受账号状态、cookies 新鲜度、平台策略、下载器版本和网络环境影响。失败必须分类，不得宣称绕过风控。

---

## Current Architecture Facts

当前仓库的实际边界：

```text
apps/
  cli/                 CLI composition root 与当前流水线编排
  cli/pipeline/        当前阶段编排实现
  web/                 本地 HTTP、Web composition root 与任务服务
packages/
  core/contracts/      核心任务与决策契约
  features/*/domain/   领域规则
  orchestrator/        阶段计划、checkpoint 与运行任务生命周期
  adapters/            外部工具、模型、表格、存储实现
  testing/             unit / integration / governance tests
```

`packages/orchestrator` 已负责 `download -> segment -> compress -> tag -> archive` 执行计划和 Web 运行任务生命周期。任务状态默认持久化到 `.runtime-state/tasks.json`；显式设置 `LABOUR_COMPRESSOR_TASK_STORE=sqlite` 时使用可选 SQLite adapter。JSON 仍是默认 SSOT，不自动迁移用户数据。

`apps/cli` 和 `apps/web` 可以作为 composition root 导入 adapter 并完成依赖组装；但 HTTP 路由、UI 展示逻辑和领域规则不得自行实现第三方协议、下载解析、模型调用或媒体处理细节。

---

## Target Architecture

目标依赖方向：

```text
apps -> application/orchestrator -> contracts/ports -> domain
adapters -> contracts/ports
shared -> no business rules
```

`packages/orchestrator` 只负责状态推进、checkpoint、transition hook 和跨能力编排，不承载下载、分割、打标、归档或存储协议细节。后续扩展必须保持该依赖方向。

---

## Candidate, Record, Execution

自动化数据分三层：

- `Candidate`：下载格式、媒体直链、模型标签、迁移映射等尚未接受的数据。
- `Accepted Record`：通过规则和 schema 校验的正式记录。
- `Execution Output`：文件、表格、归档目录等副作用结果。

规则：

- Candidate 不得直接驱动归档、索引或正式回表。
- Execution 必须消费已接受记录或经过明确验证的执行计划。
- 媒体直链、认证头和带 token URL 始终是临时 Candidate，不得持久化为业务事实。
- 回表保留多分支标签，归档只消费唯一 `内容题材`。

---

## Decision Fingerprint Scope

当前强制范围：

- 正式标签接受结果
- 训练级或对外交付结果
- 已接入 fingerprint 契约的归档和本地记录

目标覆盖范围：

- 下载与合并结果
- 分割接受结果
- 表格回填结果
- 报告与导出结果

未覆盖项必须登记在 `05_STEP_BY_STEP_PLAN.md`，不得伪造 fingerprint 或阻断与本任务无关的修复。

---

## Credential Boundary

平台凭证按平台维护，优先级为：

1. 平台级 `cookiesFilePath`
2. 平台级 `cookiesFromBrowser`
3. 请求级 cookies
4. 全局 cookies 兼容回退

允许保存凭证引用、来源类型、校验时间和状态。禁止在日志、API 响应、报告、测试输出、快照或文档中保存真实 API key、cookies、token、认证头或签名媒体 URL。

---

## Incremental Governance

治理规则必须可验证，并采用增量收敛：

- 新文件不得超过 500 行，新函数不得超过 60 行。
- 历史超限文件不得无理由继续增长。
- 修改历史超限文件时，必须同步缩减职责，或在 `05_STEP_BY_STEP_PLAN.md` 登记有退出条件的拆分任务。
- 目标能力尚未落地时，必须标记为迁移项，不得写成当前硬门禁。
- 任何例外都必须有范围、原因、验证方式和退出条件；不得创建永久例外。

---

## Acceptance Standard

V0.5 验收要求：

- Web UI 能驱动完整主线，Preflight 失败不创建任务。
- 自动分割默认生效，人工剪辑只在兼容模式暂停。
- 正式打标使用视频输入，不静默降级为抽帧。
- 下载、分割、打标、回表和归档失败均可分类。
- 平台和模型凭证不进入日志、报告、API 响应或测试输出。
- 小红书支持范围和失败边界对用户明确。
- 当前事实、目标架构和迁移计划保持一致。
- 新增代码和文档遵守增量行数门禁及对应测试要求。
