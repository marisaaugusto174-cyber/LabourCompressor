# 04_STATE_AND_DATA.md

## Status

- Project: `LabourCompressor`
- Product Version: `v0.5.1`
- Current Persistence: JSON-default storage port + optional SQLite + filesystem + xlsx
- Storage Selection: `LABOUR_COMPRESSOR_TASK_STORE=json|sqlite`
- Primary Goal: state discipline and sensitive-data containment

---

## Mission

本文件定义当前真相来源、状态语义、数据分区和一致性规则。可选 SQLite 只覆盖运行任务快照；尚未接入的媒体、标签和归档索引不得描述为已持久化。

---

## Data Layers

系统数据分四层：

- `Raw Input`：用户 URL、本地媒体、表格、标签库和配置引用。
- `Candidate`：下载格式、媒体直链、模型标签和迁移映射。
- `Accepted Record`：通过验证并允许进入正式流程的记录。
- `Execution Output`：文件、表格、归档目录和导出包。

规则：

- Candidate 不是事实。
- Accepted Record 必须记录来源和适用版本。
- Execution Output 只能由已验证输入、Accepted Record 或显式执行计划驱动。
- 凭证明文、认证头、token 和签名媒体 URL 不属于任何业务记录层。

---

## Current Sources of Truth

### Runtime Task State

默认 Web 任务状态保存在：

```text
.runtime-state/tasks.json
```

显式设置 `LABOUR_COMPRESSOR_TASK_STORE=sqlite` 时，任务状态保存在 `.runtime-state/tasks.sqlite` 或 `LABOUR_COMPRESSOR_TASK_DB_PATH` 指定路径。当前选中的 store 是 Web 任务恢复、控制和状态展示的 SSOT；UI 内存状态不是事实。系统不自动迁移 JSON。

### Filesystem

文件系统是以下产物是否存在的 SSOT：

- 下载视频
- `.part` 临时文件
- `AfterEdit` 合法片段
- `ProblemClips` 异常片段
- 视频压缩缓存
- 归档媒体
- 导出报告

状态记录宣称成功但文件不存在时，视为一致性失败，不得仅凭 JSON 或 UI 判定成功。

### Spreadsheet

- 用户输入表是行级输入来源。
- 用户表和程序内 xlsx 总表是面向用户的结果载体。
- xlsx 不替代运行时任务控制状态。
- CSV 只用于导入兼容和失败导出。
- Numbers 只提供读取兼容，不作为完整写回标准。

### Taxonomy Markdown

标签库 Markdown 是标签树原文和版本差异计算输入。解析缓存不是标签事实来源。

---

## Storage Port and Remaining Direction

运行任务 store port、JSON adapter、可选 SQLite adapter 和显式迁移工具已经接入。JSON 使用原子 rename；SQLite 使用 WAL、busy timeout 和 `BEGIN IMMEDIATE` 快照事务。

尚未完成的扩展目标是通过独立 storage contracts 持久化：

- 任务和 checkpoint
- 媒体、分割和归档索引
- 标签版本与 DecisionFingerprint
- 正式标签赋值和调用报告标识

这些索引不得复用运行任务 payload 表冒充正式领域存储；进入施工前必须另行定义 schema、冲突策略和迁移门禁。

---

## Task Status Model

核心 `TaskRecord` 当前状态：

```text
queued
running
partially_succeeded
succeeded
failed
cancelled
```

Web 任务控制可以出现 `pausing`、`paused`、`cancelling` 等控制态；它们是运行控制状态，不替代阶段 checkpoint。

阶段进度通过以下字段表达：

- `checkpoint.stage`
- `checkpoint.status`
- `lastVerifiedStep`
- `resumeState`
- `errorCode`
- `errorMessage`

阶段名可以包括下载、分割、缓存、打标、回写和归档，但不得伪造一个与当前 contract 不一致的第二套顶层状态机。

状态推进规则：

- 顶层状态和 checkpoint 必须单调推进。
- 重试增加 attempt，并从已验证 checkpoint 恢复。
- 成功必须有可验证产物或已验证 checkpoint。
- 失败必须有稳定 errorCode 和用户可读下一步。

---

## V0.5.1 Workflow State

默认自动分割路径：

```text
queued
-> running/preflight
-> running/download
-> running/segment
-> running/tag
-> running/writeback
-> running/archive
-> succeeded | partially_succeeded | failed | cancelled
```

下载后默认进入自动分割，不暂停等待人工剪辑。

只有满足以下条件时才进入人工兼容闸门：

- `autoSegmentation = false`
- `manualEditGate = true`

此时下载产物保留，任务明确进入等待用户提供 `AfterEdit` 输入的状态，不得伪装成完整工作流成功。

---

## Core Records

当前存在或已落地的核心契约包括：

- `TaskRecord`
- `TaskCheckpoint`
- `TaskResumeState`
- 下载请求和媒体产物
- 分割结果与问题片段状态
- 标签候选与正式标签记录
- `DecisionFingerprint`
- 归档和表格结果记录

目标记录包括：

- 独立 `PlatformCredentialRef`
- 持久化 `MediaAsset` / `SegmentRecord` / `ProblemClipRecord`
- storage-backed `ArchiveRecord` 和查询索引

目标记录尚未形成统一持久层时，应描述为迁移目标；当前 SQLite 只能查询运行任务快照。

---

## Credential Data Policy

允许持久化：

- provider 和 model profile 名称
- 平台名称
- 凭证文件引用路径
- cookies-from-browser 的浏览器/profile 标识
- 校验时间、状态和失败分类

禁止持久化或输出：

- API key 明文
- cookies 文件内容
- token、secret 或认证头
- 浏览器 cookies 原始值
- 可复用的签名媒体 URL

凭证文件只能位于被 `.gitignore` 覆盖的本地运行目录或用户明确选择的外部路径。

---

## URL and Media Candidate Policy

URL 分为：

- `requestUrl`：单次网络请求使用，可临时包含访问参数。
- `displayUrl`：日志、UI、API 响应和任务事件使用，必须脱敏。
- `persistedSourceUrl`：写入任务、结果和恢复状态，必须移除敏感查询参数。

小红书规则：

- `xsec_token` 只允许存在于内存请求 URL。
- 页面 HTML 不持久化。
- `masterUrl`、`backupUrls` 和认证头属于临时 Candidate。
- 错误详情只能记录稳定错误码和脱敏技术摘要。

普通公开视频 ID 可以保留；认证 token、签名值和可复用媒体地址必须删除或替换为 `[REDACTED]`。

---

## Download Output Integrity

下载输出从 Candidate 转为可接受产物前必须验证：

- HTTP 状态可接受。
- 响应不是明确的 HTML/JSON 挑战页。
- 已知 `Content-Length` 与实际字节数一致。
- 文件写入 `.part`，完成后原子重命名。
- 失败或取消清理本次临时文件。
- 产物能被后续媒体探测读取。

仅获取到媒体 URL 不代表下载成功。

---

## Segmentation Records

- 合法计算区间必须为 `5-60s`，推荐区间为 `5-30s`；stream copy 产物不做二次时长校正。
- 合法片段进入 `AfterEdit`。
- 异常片段进入 `ProblemClips`。
- 问题类型只允许 `无法满足 5-60s`、`导出失败`、`检测结果异常`。
- `.segmentation/<asset>/continuity.json` 是可重建诊断产物，不是任务 SSOT；不得包含帧、PCM、凭证或媒体载荷。
- 原下载文件保留在缓存，但自动分割开启时不进入正式打标。

`AfterEdit` 文件存在性和表格记录必须一致；任何一方缺失都需要一致性失败记录。

---

## Tagging and Decision Fingerprint

正式标签必须绑定 taxonomy version。训练级或对外交付记录必须绑定 DecisionFingerprint。

当前强制覆盖：

- 标签接受结果
- training-grade 放行
- 已接入 fingerprint 的本地记录

目标覆盖：

- 下载、分割、回填和报告

未覆盖项进入迁移计划，不得填充虚假 provider、model 或版本字段。

---

## Cache Policy

可缓存：

- taxonomy 和 prompt 解析结果
- 视频压缩缓存
- Preflight 摘要
- 可重建查询视图

不可缓存为事实：

- 模型原始回答
- 真实凭证
- UI 临时输入
- 未接受候选标签
- 签名媒体 URL

缓存必须在 taxonomy、prompt、源文件哈希、模型 profile 或平台凭证配置变化时失效。

---

## Recovery and Consistency

恢复顺序：

1. 根据 `LABOUR_COMPRESSOR_TASK_STORE` 读取 JSON 或 SQLite 运行任务 store。
2. 验证 checkpoint 声称的文件产物。
3. 读取相关表格行状态。
4. 比对任务、文件和表格。
5. 冲突时以文件实际存在性和最近已验证 checkpoint 为准。

UI 摘要和 Agent 上下文只作提示，不能覆盖持久状态和文件事实。

---

## Integrity Constraints

- Preflight 失败不得创建正式运行任务。
- 状态成功必须能定位验证证据。
- 自动分割开启时不得跳过分割。
- 人工暂停只适用于显式兼容模式。
- 凭证明文、token、认证头和签名 URL 不得进入 SSOT。
- Candidate 不得直接成为正式标签或归档路径。
- 新 V0.3 任务的归档路径由唯一合法 `核心动作/主动作` 产生，持久化为 `视频数据归档库/<完整核心动作路径>`。次动作与其他标签保留在回表和 sidecar，不参与目录选择。
- 主动作缺失、冲突或路径非法时最多修复一次；再次失败的任务进入待复核，归档路径为空，不产生归档媒体。
- V0.1、V0.2 和已持久化的历史显式内容路径继续可读可执行；系统不自动迁移旧目录或已有文件。
- 关键副作用失败不得推进成功 checkpoint。
- 当前事实、目标存储和迁移状态必须在文档中保持分离。
