# 01_PROJECT_CHARTER.md

## Project Identity

- Project Name: `LabourCompressor`
- Current Product Version: `v0.2`
- Tech Stack: `Node.js`
- Architecture Pattern: `Hexagonal Architecture`
- Repository Shape: `Monorepo`
- Dependency Gravity: `Strict Inward Dependency Only`
- Coordination Center: `Dedicated Orchestrator Module`

---

## Charter Goal

本宪章固定 `LabourCompressor` 的物理结构、依赖方向、职责边界和 V0.2 产品化目标，避免下载、打标、归档、检索、标签迁移等能力互相直连。

项目不是按页面拆分，而是按可替换能力和工作流边界拆分。

---

## System Identity

`LabourCompressor` 是本地优先、状态敏感、规则约束型的媒体资产工作流系统。

它不是单一下载器，也不是单一模型打标器。系统核心价值是把高人工密度流程压缩为可重复、可追踪、可中断、可继续的本地工作流。

核心资产：

- `V0 标签库`
- 提示词库
- 结构化表格记录
- 视频归档库
- 任务状态与失败原因
- 平台凭证与模型配置

可替换边缘能力：

- 平台下载器
- 模型 provider
- 表格读取器
- 文件系统执行器

---

## V0.2 Product Goal

V0.2 的目标是把已跑通的本地引擎产品化，让用户通过 Web UI 自助完成：

1. 平台下载凭证配置
2. 模型 API 配置
3. 下载任务启动
4. 下载后人工剪辑暂停
5. `AfterEdit` 表生成
6. 第二阶段视频级打标归档
7. 结果查看和失败处理

V0.2 不追求功能扩散，不承诺全平台下载稳定性，不做云端账号系统、多人协作、远程素材传输、自动浏览器登录抓取 cookies、自动去水印或训练数据交付平台。

---

## AfterEdit Two-Stage Workflow

V0.2 主工作流必须分为两阶段。

第一阶段：采集下载。

- Web UI 导入用户表。
- Preflight 校验用户表、目录、平台凭证、模型配置和本地依赖。
- 系统按 URL 平台选择下载凭证。
- 下载并合并视频，标准化文件名。
- 创建 `下载缓存目录/AfterEdit`。
- 回写 `已下载待剪辑`。
- 流程暂停，等待人工剪辑。

人工剪辑阶段：

- 用户在本地剪辑下载后视频。
- 导出文件放入 `AfterEdit`。
- 文件名遵守 `原视频标题_视频下载分辨率_下载年月日_视频时长秒数.mp4`。

第二阶段：打标归档。

- 用户点击生成 `AfterEdit_归档记录表.xlsx`。
- 系统自动载入该表。
- 第二阶段启动前校验文件名、重复项和文件存在性。
- 系统对剪辑后视频做压缩缓存、视频级打标、标签合法化、多分支回表、唯一 `内容题材` 归档和总表同步。

---

## Architecture Position

系统稳定核心：

- `Domain`: 业务规则与领域对象
- `Application`: 用例与端口定义
- `Adapters`: 外部能力接入实现
- `Orchestrator`: 唯一跨能力编排中心

高波动能力必须通过端口接入：

- 内容抓取与下载
- 音视频合并与转封装
- 表格任务读取与回写
- 多模态视频打标
- 文件归档、索引与检索

---

## Execution Semantics

所有自动化动作分三层：

- `Candidate`: 模型候选标签、迁移候选映射、下载候选格式
- `Record`: 合法标签结果、归档记录、索引记录等被规则接受的结构化记录
- `Execution`: 真正对文件系统、数据库、导出包产生副作用的动作

强制规则：

- `Candidate` 不得直接驱动文件系统副作用。
- `Record` 必须可追溯到版本与来源。
- `Execution` 只能消费 `Record`。
- 正式标签记录允许多分支并存。
- 归档执行只能消费唯一 `内容题材` 路径。
- 表格回填必须保留其他正式分支，不能被归档唯一化裁剪。

---

## Video Tagging Boundary

正式视频打标必须使用模型原生视频理解能力。

禁止把抽帧图片理解作为正式默认链路。抽帧只允许用于调试、实验或显式降级，并必须写入任务记录。

送模前必须创建标准压缩缓存：

- `360p`
- 保持原始帧率
- 视频 `H.264 650 kbps`
- 音频 `AAC 64 kbps`
- 容器 `mp4`
- 按源文件哈希复用

若压缩后仍超过模型上传安全阈值，必须明确失败，不静默改为抽帧。

---

## Download Credential Boundary

V0.2 下载凭证按平台维护，覆盖：

- `Bilibili`
- `YouTube`
- `抖音`
- `TikTok`

每个平台支持：

- `cookies.txt`
- `cookies-from-browser`

凭证优先级：

1. 平台级 `cookiesFilePath`
2. 平台级 `cookiesFromBrowser`
3. 全局 cookies 兼容回退

系统不得输出、记录或测试打印真实 API key、cookies 内容、token 或其他敏感凭证。

V0.2 不承诺自动登录、自动绕过风控、自动去水印或全平台稳定下载；失败必须分类并提示用户下一步。

---

## Monorepo Boundary

```text
apps/
  web/                 Web UI 与本地 HTTP 入口
  cli/                 兼容命令入口
packages/
  core/                领域规则、端口、共享契约
  orchestrator/        工作流编排与状态推进
  features/            acquisition / media-processing / spreadsheet-tasks / taxonomy / tagging / archive
  adapters/            yt-dlp / ffmpeg / xlsx / provider router / filesystem / storage
  shared/              无业务规则的 SDK、类型、工具
  testing/             fixtures、fakes、contract、integration、workflow tests
```

---

## Dependency Gravity

依赖方向只能向内：

```text
apps -> orchestrator -> core/application ports -> features/contracts -> domain
adapters -> ports/contracts
shared -> no business rules
```

禁止：

- `apps/*` 直接访问数据库、模型 SDK、`yt-dlp` 或 `ffmpeg`。
- `orchestrator` 依赖 adapter 具体实现。
- feature 直接 import 其他 feature 的内部实现。
- core 依赖 shared、adapters、orchestrator 或 apps。
- shared 承载下载、打标、归档、迁移等业务规则。

---

## Decision Fingerprint Standard

关键自动结果必须携带 `DecisionFingerprint`：

- 标签接受结果
- 归档结果
- 下载合并结果
- 表格回填结果
- 报告或导出结果

最小字段：

- `taskId`
- `sourceId`
- `assetId`
- `taxonomyVersion`
- `provider`
- `model`
- `videoCacheProfile`
- `promptVersion`
- `createdAt`
- `decisionType`

---

## File Size Rule

单文件不得超过 500 行。超过时按顺序处理：

1. 删除重复说明、过期内容和无效注释。
2. 在当前文件内优化结构与职责。
3. 优化后仍超过 500 行，且存在清晰职责边界时才拆分。

禁止为了压低行数机械拆分，禁止把强相关内容拆散制造跳转成本。

---

## Acceptance Standard

V0.2 架构验收不以功能堆叠为准，而以以下事实成立为准：

- Web UI 能驱动两阶段工作流。
- 第一阶段下载后明确暂停等待人工剪辑。
- 第二阶段只处理 `AfterEdit` 中的剪辑后视频。
- 视频打标默认是视频级，不默认抽帧。
- 多分支标签可回表，归档只消费唯一 `内容题材`。
- 平台凭证和模型凭证不泄露到日志、报告或测试输出。
- 常见失败可分类、可恢复或可解释。
- 目标文档和后续代码文件遵守 500 行规则。
