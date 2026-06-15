# 03_STRICT_RULES.md

## Status

本文件是 `LabourCompressor` 的强制工程红线。任何违反本文件的实现，默认视为不合格实现，即使代码“能跑”也不得合入。

---

## Baseline

- Runtime: `Node.js`
- Repository Shape: `Monorepo`
- Architecture: `Hexagonal`
- Current Product Version: `v0.3`
- Primary Goal: `Stability First`
- Secondary Goal: `Safety First`

---

## V0.3 Non-Negotiables

V0.3 的产品化目标是 Web UI 驱动的自动分割本地工作流：

1. 表格导入、平台凭证和模型 API 配置、Preflight、下载。
2. 下载后自动按场景检测和时长治理分割，合法片段进入 `AfterEdit`。
3. 问题片段进入 `ProblemClips`，表中标记 `自动分割待处理`。
4. 对分割后片段做视频级打标、多分支回表、唯一 `内容题材` 归档和总表同步。

不得用 CLI-only 流程、单阶段原片打标、只处理原下载文件等方式冒充 V0.3 完成。V0.2 人工 `AfterEdit` 闸门作为兼容模式保留，不再是 V0.3 主线。

---

## Code Style Standard

- Indent: `2 spaces`
- Quotes: `single`
- Semicolons: `required`
- File Naming: `kebab-case`
- Variable / Function Naming: `camelCase`
- Type / Interface / Class Naming: `PascalCase`
- Constant Naming: `UPPER_SNAKE_CASE`
- Exports: named exports only

禁止：

- tab 缩进
- double quotes
- 省略分号
- 非 `kebab-case` 文件名
- `export default`
- 匿名默认实现入口

---

## Dependency Deny List

禁止引入或使用：

- `moment`
- `axios`
- full `lodash`
- TypeScript `enum`
- 业务代码主动返回 `null`

要求：

- 时间处理优先使用标准库或轻量明确依赖。
- HTTP 调用统一使用标准 `fetch`，由 `shared/sdk/http` 或 adapter 层封装。
- 缺省使用 `undefined`，不存在状态必须显式建模。
- 枚举使用 `as const` 对象和联合字面量类型。

---

## TypeScript Rules

必须开启：

- `strict: true`
- `noImplicitAny: true`
- `strictNullChecks: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`

禁止：

- 隐式 `any`
- 宽泛未收缩输入类型
- 用异常替代可预期业务失败

业务失败必须使用 `Result<T, E>` 或等价显式失败模型。

---

## Input and Config Rules

所有外部输入必须用 `Zod` 或等价 schema 校验，包括：

- CLI 参数
- Web UI 请求
- 环境变量
- 用户表格行
- HTTP 响应
- 模型输出
- 文件系统扫描结果
- 平台凭证配置
- provider 配置

配置必须在启动或 Preflight 阶段集中读取和校验。禁止运行到一半才读取关键配置。

---

## Credential Safety Rules

禁止在日志、报告、错误信息、测试输出、快照和文档中打印真实：

- API key
- cookies 内容
- token
- OAuth secret
- 本地浏览器敏感 profile 内容

平台凭证必须按平台维护，支持：

- 平台级 `cookiesFilePath`
- 平台级 `cookiesFromBrowser`
- 全局 cookies 兼容回退

V0.3 下载平台边界为 `Bilibili / YouTube / 抖音 / TikTok`。系统不承诺自动浏览器登录、自动绕过风控、自动去水印或全平台稳定下载。

---

## Video Tagging Rules

正式视频打标必须使用模型原生视频理解能力。

禁止：

- 默认抽帧后按图片理解
- provider 不支持视频输入时静默降级
- 压缩超限后静默改用抽帧
- 模型候选未经合法化直接回表或归档

允许：

- 抽帧用于调试、实验或显式降级
- 显式降级必须写入任务记录和失败/降级原因

送模前必须创建标准压缩缓存：

- `360p`
- 保持原始帧率
- `H.264 650 kbps`
- `AAC 64 kbps`
- `mp4`
- 按源文件哈希复用

---

## Auto Segmentation and AfterEdit Rules

自动分割开启时，下载任务完成后必须先进入自动分割，不得把完整原片直接送入打标。

分割要求：

- 入库片段必须在 `3-30s`。
- 首选片段长度为 `5-30s`。
- 超过 `30s` 的长段必须继续判断或强制切分。
- 强制切分只要满足时长规则即可正常入库。
- 原始下载文件保留在下载缓存，但不进入打标归档。
- 有效内容覆盖目标约为 `80%`。

问题片段要求：

- 问题片段写入 `下载缓存目录/ProblemClips`。
- 问题分类只能是 `无法满足 3-30s`、`导出失败`、`检测结果异常`。
- 问题片段在表中标记 `自动分割待处理`。
- 问题片段不得阻断合法片段继续打标归档。

`AfterEdit` 要求：

- 自动分割输出的合法片段写入 `下载缓存目录/AfterEdit`。
- 系统生成 `AfterEdit_归档记录表.xlsx`。
- 手动兼容模式下，启动打标前仍必须校验文件名、重复项和文件存在性。

剪辑后文件名标准：

```text
原视频标题_视频下载分辨率_下载年月日_视频时长秒数.mp4
```

自动分割片段文件名必须在标准文件名后加入片段序号，例如：

```text
原视频标题_720P_260512_000023_01.mp4
```

不合规文件必须阻断进入打标，并回填失败状态与 `失败信息`。

---

## Architecture Red Lines

禁止：

- `apps/*` 直接访问数据库。
- `apps/*` 直接调用模型 SDK、`yt-dlp`、`ffmpeg`。
- `orchestrator` import adapter 具体实现。
- feature 直接 import 其他 feature 的内部实现。
- core import shared、adapters、orchestrator 或 apps。
- shared 承载下载、打标、归档、迁移等业务规则。
- adapter 决定标签是否合法、归档路径结构或下载优先级。
- feature/domain 直接调用 `child_process`、`spawn`、`exec`、文件系统、网络、数据库、时间或随机数副作用。

所有副作用必须隔离在 adapter 或 shared/sdk 边界中。

---

## Candidate / Record / Execution Rules

自动化结果必须分层：

- `Candidate`: 模型候选标签、迁移候选映射、下载候选格式
- `Accepted Record`: 合法标签、归档、索引、报告记录
- `Execution Output`: 文件系统、数据库、导出包等副作用结果

禁止：

- Candidate 直接写入表格、归档目录、报告或训练集。
- 模型输出未经 schema 和 taxonomy 校验直接进入正式记录。
- 自动决策缺少 `DecisionFingerprint`。

要求：

- 多分支标签必须回表。
- 归档路径只能来自唯一 `内容题材`。
- 非 `内容题材` 分支不得参与目录生成。
- 无法确定唯一 `内容题材` 时停在失败或待处理状态，不猜测目录。

---

## File Safety Rules

禁止：

- 未校验输出成功就删除源文件或中间文件。
- 无 checkpoint 执行 destructive action。
- 删除用户数据。
- 改动与当前任务无关文件。

要求：

- 删除中间文件前必须写入成功检查点。
- 更新归档路径前必须写入前置验证结果。
- 归档写入失败不得污染索引或用户表。

---

## File Size Rule

强制限制：

- 单函数不超过 `60` 行。
- 单文件不超过 `500` 行。

超过限制时必须按顺序处理：

1. 删除重复逻辑、无效注释、冗余类型、过期说明。
2. 在当前文件内优化结构和职责。
3. 优化后仍超过 `500` 行，且存在明确职责边界时才拆分。

禁止为了压低行数机械拆分，禁止复制代码代替结构优化。

---

## Logging and Error Rules

日志必须结构化，至少包含：

- `event`
- `module`
- `taskId`
- `status`
- `errorCode`

错误必须分类：

- `ValidationError`
- `ConfigurationError`
- `IntegrationError`
- `WorkflowError`
- `PolicyViolationError`
- `ConsistencyError`

禁止空 `catch`、吞错、只打印错误但返回成功。

---

## Test Enforcement

最低测试要求：

- `packages/core`: unit tests
- `packages/features/*`: unit tests + contract tests
- `packages/adapters/*`: contract tests + integration tests
- `packages/orchestrator`: workflow tests + integration tests
- `apps/*`: smoke tests

新增 port 必须有 contract test；新增 workflow 必须有 workflow test；新增 adapter 必须覆盖失败路径。

---

## Merge Rejection Conditions

以下任一情况成立，必须拒绝：

- 出现禁用依赖或禁用语法。
- 外部输入未 schema 校验。
- 业务失败未显式建模。
- 自动决策没有 `DecisionFingerprint`。
- 候选输出和正式记录未分层。
- 正式视频打标默认抽帧。
- 跳过 `AfterEdit` 两阶段流程。
- 平台或模型凭证泄露到日志、报告或测试输出。
- 无 checkpoint 执行破坏性副作用。
- 新增或修改文件超过 500 行且未先优化结构。
- 无对应测试即交付业务代码、workflow 或 adapter。

---

## Final Position

本项目的工程基线是出错可定位、失败可恢复、模块可替换、工作流可验证。任何破坏稳定性、安全性、凭证边界或 V0.3 自动分割主线的捷径一律禁止。
