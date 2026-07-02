# 03_STRICT_RULES.md

## Status

- Project: `LabourCompressor`
- Product Version: `v0.5.1`
- Enforcement Model: current gates + ratcheted legacy debt
- Primary Goal: stability first
- Secondary Goal: safety first

本文件只定义当前可执行的强制规则。尚未建立工具或尚未完成迁移的目标，必须进入 `05_STEP_BY_STEP_PLAN.md`，不得伪装成已经执行的门禁。

---

## Product Non-Negotiables

V0.5.1 默认主线必须由 Web UI 驱动：

```text
表格 -> Preflight -> 下载 -> 自动分割 -> 片段级视频打标 -> 回表 -> 归档
```

禁止：

- 用 CLI-only 流程冒充 V0.5.1 主线。
- 默认把完整原片直接送入打标。
- 用抽帧图片理解静默替代正式视频理解。
- 跳过 taxonomy 合法化直接回表或归档。
- 只支持全局 cookies 而破坏平台级凭证优先级。

人工 `AfterEdit` 只在用户关闭自动分割并启用人工闸门时生效。

---

## Code Style Gate

新增或修改代码必须遵守：

- 2 空格缩进。
- 单引号。
- 分号。
- 文件名使用 `kebab-case`。
- 变量和函数使用 `camelCase`。
- 类型使用 `PascalCase`。
- 常量使用 `UPPER_SNAKE_CASE`。
- 只使用 named export。

禁止新增：

- TypeScript `enum`
- `export default`
- `moment`
- `axios`
- full `lodash`
- 用 `null` 表达普通缺省值

外部 HTTP 使用标准 `fetch`，协议细节必须位于 adapter 或明确的 SDK 边界。

---

## TypeScript Gate

`tsconfig.json` 必须保留：

- `strict`
- `noImplicitAny`
- `strictNullChecks`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`

`typescript@6.0.3` 与 `@types/node@22.20.0` 已固定为开发依赖。`apps/**/*.ts` 和生产 `packages/**/*.ts` 必须通过：

```bash
npm run typecheck
```

`npm run test:taxonomy-domain` 与 `npm run verify` 必须先执行该检查。以下情况属于即时拒绝条件：

- 新增显式 `any` 逃避收缩。
- 对外部输入直接断言为内部类型。
- 使用 `@ts-ignore`、关闭 strict 选项或扩大 `skipLibCheck` 逃避诊断。
- 为消除错误而使用无解释的类型强制转换。
- 提交无法通过 `npm run typecheck`。

---

## Input Validation Gate

以下外部输入必须在边界处验证：

- CLI 参数
- HTTP 请求体和查询参数
- 环境变量
- 用户表格行
- 平台或模型响应
- 配置文件
- 文件系统扫描结果

允许的验证方式：

- Zod 等 schema 库；或
- 显式 parser/validator，返回收缩后的类型并具备失败测试。

当前项目未依赖 Zod，不得把“必须使用 Zod”写成已执行事实。禁止仅靠 TypeScript 类型声明验证运行时数据。

---

## Error Model Gate

可预期业务失败必须显式分类，允许：

- `Result<T, E>`；
- 带稳定 `errorCode` 的结构化失败对象；
- adapter 边界抛出已翻译、可提取 `errorCode` 的错误。

禁止：

- 用错误消息文本作为唯一机器判断依据。
- 吞掉操作失败后返回成功。
- 把第三方完整日志直接展示给用户。
- 在错误中包含真实凭证、认证头、token 或签名媒体 URL。

用于“文件不存在即采用缺省值”的 catch 必须有明确返回语义；操作性失败不得使用空 catch。

---

## Credential and Sensitive Data Gate

平台凭证按以下优先级解析：

1. 平台级 `cookiesFilePath`
2. 平台级 `cookiesFromBrowser`
3. 请求级 cookies
4. 全局 cookies 兼容回退

当前平台范围：

- Bilibili
- YouTube
- 抖音
- TikTok
- 小红书单笔记单视频

禁止在日志、任务状态、API 响应、报告、测试输出、快照和文档中写入真实：

- API key
- cookies 内容
- token 或 OAuth secret
- Cookie/Authorization header
- 浏览器 profile 敏感内容
- 签名媒体直链

带访问参数的请求 URL 可以在单次网络调用内存中存在；持久化、显示、失败详情和任务事件必须使用脱敏 URL。

---

## Download Adapter Gate

新增或修改下载 adapter 时必须覆盖：

- 平台 URL 与 ID 校验。
- 候选格式排序和备用 URL 轮换。
- 明确的超时、取消和有限重试。
- HTTP 状态、响应类型和已知长度校验。
- 写入 `<target>.part`，验证成功后原子重命名。
- 失败或取消后清理临时文件。
- 不在错误或日志中输出认证头、token 和媒体签名。
- 成功、无凭证、过期地址、截断响应、取消和清理测试。

平台特定回退不得吞掉限流、认证失败或不可重试错误。小红书只允许在 `yt-dlp` 明确返回无格式时进入页面解析回退。

---

## Video Tagging Gate

正式打标输入必须是视频文件或标准缓存：

```text
360p + 原帧率 + H.264 650 kbps + AAC 64 kbps + mp4
```

标准缓存按源文件哈希复用。provider 不支持视频、压缩超限或上传失败时必须明确失败；抽帧只允许用于调试、实验或显式降级，并记录模式和原因。

---

## Segmentation and AfterEdit Gate

自动分割开启时：

- 原下载文件不得直接进入正式打标。
- 合法计算区间必须在 `5-60s`，首选长度为 `5-30s`。
- 连续性优先于推荐长度；强连续的 `30-60s` 片段允许保留。
- 超过 `60s` 必须优先沿最弱候选边界切分，无内部边界时才允许数学等分。
- 合法片段进入 `AfterEdit`。
- 异常片段进入 `ProblemClips`。
- 问题分类只允许 `无法满足 5-60s`、`导出失败`、`检测结果异常`。

问题片段不得阻断其他合法片段继续处理。

---

## Architecture Gate

当前允许：

- `apps/cli` 和 `apps/web` 作为 composition root 导入 adapter 并组装依赖。
- `apps/cli/pipeline/**` 承担当前阶段编排。

禁止：

- HTTP route 或 UI 模块直接实现下载、模型、表格或媒体协议。
- feature/domain 调用文件系统、网络、数据库、时间、随机数或 `child_process`。
- adapter 决定标签合法性、归档路径或跨阶段工作流。
- feature 直接导入其他 feature 的内部 domain。
- core 导入 apps、adapters 或 feature 实现。
- shared 承载业务规则。

当前应用层仍存在较重的集成模块，按 `05_STEP_BY_STEP_PLAN.md` 增量迁移；不得以一次性重写作为普通功能开发的前置条件。

---

## Candidate and Record Gate

- 下载格式、媒体 URL 和模型输出首先是 Candidate。
- 正式标签必须经过 schema 和 taxonomy 校验。
- 回表保留所有正式分支。
- 新 V0.3 任务归档只消费唯一合法 `核心动作/主动作`；V0.1、V0.2 和已持久化历史显式内容路径继续兼容。
- 无法确定唯一归档路径时停在失败或待处理状态。
- 训练级或对外交付数据必须具备 DecisionFingerprint 和 QA 放行。

DecisionFingerprint 的当前和目标覆盖范围以 `01_PROJECT_CHARTER.md` 为准。

---

## File and Side-Effect Gate

禁止：

- 未验证输出即删除源文件。
- 无 checkpoint 执行破坏性动作。
- 修改与任务无关的用户文件。
- 归档失败后写入成功索引或成功状态。

关键副作用必须满足：

1. 输入和目标路径已验证。
2. 临时产物与最终产物分离。
3. 成功后再推进 checkpoint。
4. 失败后保留可恢复信息并清理本次临时产物。

---

## Runtime Task Storage Gate

- 默认任务存储必须保持 JSON，不得静默切换 SQLite 或自动迁移用户状态。
- JSON 快照必须通过同目录临时文件和原子 rename 写入；解析失败不得覆盖原文件。
- SQLite 只能显式启用，快照写入必须位于 `BEGIN IMMEDIATE` 事务内并在失败时回滚。
- JSON 到 SQLite 迁移默认 dry-run；写入前备份 JSON，并校验数量、ID 集合和 payload SHA-256。
- store 和迁移错误必须分类，不得把 payload、cookies、token 或签名 URL写入日志。

---

## Size Ratchet

新文件不得超过 500 行，新函数不得超过 60 行。

对治理规则生效前已经超限的文件：

- 不得无理由增加净行数或职责。
- 修改时优先删除重复逻辑、提取纯函数或拆出明确边界。
- 本任务无法安全拆分时，必须在 `05_STEP_BY_STEP_PLAN.md` 登记文件、风险、目标边界、验证命令和退出条件。
- 债务记录不是永久豁免；完成拆分后立即删除记录。

禁止为压低行数机械拆分强相关逻辑或复制代码。

---

## Logging Gate

任务生命周期和失败日志必须至少能关联：

- event/module
- taskId 或 workflowSessionId
- stage/status
- errorCode（失败时）

普通 CLI 人类可读输出不要求全部转换为 JSON，但不得输出请求体、凭证明文或未脱敏第三方日志。

---

## Test Gate

- domain 行为：unit tests。
- adapter：成功和失败 contract、取消与清理测试。
- workflow：阶段集成或端到端测试。
- apps：route/input/UI 状态 smoke tests。
- 架构与安全规则：governance tests。

新增业务行为必须先观察对应测试失败，再实现最小修复。纯文档和配置改动必须先声明验证命令。

---

## Merge Rejection Conditions

以下任一情况必须拒绝合并：

- 泄露真实凭证、token、认证头或签名 URL。
- 新增外部输入但没有运行时验证和失败测试。
- 新增业务失败但没有稳定错误码或显式失败模型。
- Candidate 未经接受直接驱动正式回表、归档或训练数据。
- 跳过默认自动分割主线或静默改为抽帧打标。
- 新增破坏性副作用但没有验证、checkpoint 或失败清理。
- 新文件/函数超过行数门禁，或历史超限文件继续恶化且未登记退出计划。
- 新增 adapter/workflow 没有对应失败路径测试。
- 把目标架构或未启用工具描述为当前事实。

迁移债务本身不阻断无关修复；违反已登记的增量约束必须阻断。
