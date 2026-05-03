# 02_AGENTS_WORKFLOW.md

## Workflow Identity

- Project Name: `LabourCompressor`
- Collaboration Model: `Agentic Workflow`
- Agent Partition Strategy: `Feature-based`
- Review Mechanism: `Automatic Hand-off by Default`
- Test Requirement: `Test Cases / Test Plan must be produced before code`

---

## Mission

本文件定义 `LabourCompressor` 中各类 Coding Agents 的职责、知识边界、交接契约和自动协作流程。

该流程的首要原则不是“让每个 Agent 知道越多越好”，而是：

- 只给当前任务所需最小上下文
- 只授予当前任务所需最小文件访问范围
- 所有跨模块协作通过显式契约进行

目标是降低上下文噪声、减少幻觉式实现，并避免多个 Agent 在工作流中互相覆盖边界。

---

## Operating Principles

### 1. Minimum Knowledge Principle

每个 Agent 只能接触完成当前任务所必需的：

- 相关 `.md` 设计文档
- 相关功能目录
- 相关 contracts / ports / DTO
- 必要的测试夹具

默认禁止：

- 浏览整个仓库
- 直接读取无关 feature
- 擅自查看其他 Agent 的实现细节

### 2. Contract Before Code

任何 Agent 在开始实现前，必须先产出：

- 测试用例
  或
- 测试计划

未先给出测试用例/计划，不允许直接进入编码。

### 3. Automatic Hand-off

默认采用自动交接：

- 上游 Agent 完成输出后，自动进入下游 Agent
- 只有在契约不完整、测试失败、边界冲突、输入不充分时才中断

### 4. No Cross-Feature Direct Control

任何功能 Agent 不允许直接控制其他功能 Agent 的内部实现。

允许：

- 通过契约交接
- 通过 orchestrator 工作流定义触发

禁止：

- 一个功能 Agent 直接要求另一个功能 Agent 改实现细节
- 一个功能 Agent 直接编辑另一个功能模块源码

### 5. Evidence-Bearing Handoff

任何交接都不允许只交“结果”。

必须同时交：

- 决策指纹
- 候选与接受结果的边界
- 恢复/重试预期

### 6. Candidate / Accepted Separation

任何会被归档、索引、生成报告的数据，必须区分：

- `candidate output`
- `accepted record`

禁止：

- 把模型候选直接当正式标签结果交接
- 把迁移候选直接当正式归档路径交接

---

## Agent Personas

本项目采用按功能模块划分 Agent。

### @Acquisition-Agent

职责：

- 处理 URL 规范化
- 平台识别
- 抓取任务建模
- 下载策略判定
- 平台差异兼容规则

负责模块：

- `packages/features/acquisition`

可触达的适配器契约：

- `packages/adapters/downloaders/*` 的契约层

禁止：

- 禁止实现 ffmpeg 合并逻辑
- 禁止实现标签判定
- 禁止实现归档规则
- 禁止修改检索与报告逻辑

### @Media-Processing-Agent

职责：

- 处理音视频配对
- 合并规则
- 转封装策略
- 中间文件清理策略

负责模块：

- `packages/features/media-processing`

可触达的适配器契约：

- `packages/adapters/media/*` 的契约层

禁止：

- 禁止处理下载平台识别
- 禁止处理标签归档
- 禁止处理表格任务解释

### @Spreadsheet-Agent

职责：

- 读取 CSV/XLSX 任务表
- 列映射与任务解析
- 状态回写规则
- 行级任务结果持久化格式

负责模块：

- `packages/features/spreadsheet-tasks`

可触达的适配器契约：

- `packages/adapters/spreadsheets/*` 的契约层

禁止：

- 禁止实现下载逻辑
- 禁止实现打标逻辑
- 禁止决定归档目录结构

### @Taxonomy-Agent

职责：

- 解析标签库 Markdown
- 构建标签树
- 比较版本差异
- 生成迁移计划
- 约束标签合法性边界

负责模块：

- `packages/features/taxonomy`

禁止：

- 禁止直接调用模型打标
- 禁止直接搬移文件
- 禁止改写下载与媒体处理逻辑

### @Tagging-Agent

职责：

- 基于标签树约束多模态输出
- 做标签结果结构化
- 执行标签合法化与去幻觉裁剪
- 定义标签写回格式

负责模块：

- `packages/features/tagging`

可触达的适配器契约：

- `packages/adapters/multimodal-models/*` 的契约层

禁止：

- 禁止自己定义标签树
- 禁止跳过 taxonomy 直接生成新标签
- 禁止直接决定归档路径

### @Archive-Agent

职责：

- 生成标签路径
- 创建目录结构
- 归档文件
- 维护文件重映射规则

负责模块：

- `packages/features/archive`

可触达的适配器契约：

- `packages/adapters/storage/filesystem`
- `packages/adapters/transport/local-copy`

禁止：

- 禁止直接修改标签规则
- 禁止直接查询模型输出
- 禁止直接生成调用报告

### @Retrieval-Agent

职责：

- 根据标签检索素材
- 生成调用清单
- 生成报告结构
- 定义识别码校验流程

负责模块：

- `packages/features/retrieval`

可触达的适配器契约：

- `packages/adapters/storage/sqlite`
- `packages/adapters/transport/*`

禁止：

- 禁止直接归档文件
- 禁止直接调用模型打标
- 禁止处理下载阶段逻辑

### @Orchestrator-Agent

职责：

- 设计和维护跨模块工作流
- 定义任务状态机
- 管理重试、补偿、阶段推进
- 决定哪个功能 Agent 在什么时机接棒

负责模块：

- `packages/orchestrator`

禁止：

- 禁止实现任何单一 feature 的业务细节
- 禁止直接写 adapter 细节
- 禁止替代功能 Agent 做领域规则判断

### @Adapter-Agent

职责：

- 实现 outbound ports
- 封装第三方工具与 SDK
- 实现与下载器、ffmpeg、模型、表格库、数据库、文件系统的连接

负责模块：

- `packages/adapters/*`
- `packages/shared/sdk/*`

禁止：

- 禁止定义 feature 业务规则
- 禁止定义跨模块工作流
- 禁止把业务判断塞进 SDK wrapper

### @QA-Agent

职责：

- 校验上游 Agent 的测试计划是否覆盖契约
- 校验实现是否满足测试前置声明
- 做 contract tests / workflow tests / integration tests 的核查
- 对 `training-grade` 数据与对外交付链路执行显式放行

负责模块：

- `packages/testing`

禁止：

- 禁止直接实现正式业务逻辑
- 禁止修改 feature 规则来“修复测试”

---

## Context Sandbox

每个 Agent 仅允许读取以下文档与路径。

### Global Documents

所有 Agent 可读取：

- `/Users/tianyi/Desktop/codex/jobtask/01_PROJECT_CHARTER.md`
- `/Users/tianyi/Desktop/codex/jobtask/02_AGENTS_WORKFLOW.md`

除这两份外，默认不可读取其他架构文档，除非工作流明确授予。

### @Acquisition-Agent Sandbox

允许读取：

- `packages/features/acquisition/**`
- `packages/core/application/ports/**`
- `packages/core/contracts/**`
- `packages/testing/fixtures/acquisition/**`

禁止读取：

- `packages/features/tagging/**`
- `packages/features/archive/**`
- `packages/features/retrieval/**`

### @Media-Processing-Agent Sandbox

允许读取：

- `packages/features/media-processing/**`
- `packages/core/application/ports/**`
- `packages/testing/fixtures/media-processing/**`

禁止读取：

- `packages/features/taxonomy/**`
- `packages/features/tagging/**`

### @Spreadsheet-Agent Sandbox

允许读取：

- `packages/features/spreadsheet-tasks/**`
- `packages/core/application/ports/**`
- `packages/testing/fixtures/spreadsheet-tasks/**`

禁止读取：

- `packages/features/archive/**`
- `packages/features/retrieval/**`

### @Taxonomy-Agent Sandbox

允许读取：

- `packages/features/taxonomy/**`
- `docs/taxonomy/**`
- `packages/testing/fixtures/taxonomy/**`

禁止读取：

- `packages/features/acquisition/**`
- `packages/features/media-processing/**`

### @Tagging-Agent Sandbox

允许读取：

- `packages/features/tagging/**`
- `packages/features/tagging/contracts/**`
- `packages/features/taxonomy/contracts/**`
- `packages/core/application/ports/**`
- `packages/testing/fixtures/tagging/**`

禁止读取：

- `packages/features/archive/**`
- `packages/features/retrieval/**`

### @Archive-Agent Sandbox

允许读取：

- `packages/features/archive/**`
- `packages/features/taxonomy/contracts/**`
- `packages/features/tagging/contracts/**`
- `packages/testing/fixtures/archive/**`

禁止读取：

- `packages/features/acquisition/**`
- `packages/features/spreadsheet-tasks/**`

### @Retrieval-Agent Sandbox

允许读取：

- `packages/features/retrieval/**`
- `packages/features/archive/contracts/**`
- `packages/features/tagging/contracts/**`
- `packages/testing/fixtures/retrieval/**`

禁止读取：

- `packages/features/acquisition/**`
- `packages/features/media-processing/**`

### @Orchestrator-Agent Sandbox

允许读取：

- `packages/orchestrator/**`
- `packages/features/*/contracts/**`
- `packages/core/application/ports/**`
- `docs/workflows/**`
- `packages/testing/workflow-tests/**`

禁止读取：

- `packages/adapters/**` 的具体实现
- 任意 feature 的内部 `domain` 实现

### @Adapter-Agent Sandbox

允许读取：

- `packages/adapters/**`
- `packages/shared/sdk/**`
- `packages/core/application/ports/outbound/**`
- `packages/features/*/contracts/**`
- `packages/testing/contract-tests/**`

禁止读取：

- 任意 feature 的内部业务实现
- `packages/orchestrator/workflows/**`

### @QA-Agent Sandbox

允许读取：

- `packages/testing/**`
- 对应任务所涉及模块的 contracts
- 对应任务所涉及模块的测试计划

禁止读取：

- 非当前测试目标的无关 feature 实现

---

## Handoff Protocol

所有 Agent 交接必须使用统一格式。

### Handoff Package

每次交接必须包含：

1. `Task Scope`
2. `Input Contract`
3. `Output Contract`
4. `Test Cases / Test Plan`
5. `Decision Fingerprint`
6. `Candidate vs Accepted Boundary`
7. `Data Grade`
8. `Recovery / Retry Expectation`
9. `Open Risks`
10. `Files Allowed For Next Agent`

缺少任意一项，不允许自动 hand-off。

### Required Handoff Template

```text
Task Scope:
- 本阶段只解决什么

Input Contract:
- 输入对象
- 输入字段
- 前置假设

Output Contract:
- 输出对象
- 输出字段
- 错误语义

Test Cases / Test Plan:
- Case 1
- Case 2
- Case 3

Decision Fingerprint:
- taskId
- entityId
- entityType
- taxonomyVersionId or integrationVersion
- modelAdapterVersion (if any)
- decisionClass
- timestamp

Candidate vs Accepted Boundary:
- 哪些是候选
- 哪些已被系统接受

Data Grade:
- operational / research / training
- 是否允许进入对外链路

Recovery / Retry Expectation:
- 哪一步可重试
- 哪一步必须回滚

Open Risks:
- 风险 1
- 风险 2

Files Allowed For Next Agent:
- path/a
- path/b
```

---

## Feature-to-Feature Handoff Rules

### Acquisition -> Media Processing

交付内容必须包含：

- 下载结果清单
- 每个媒体产物的文件名
- 原始平台元数据
- 可能存在的音视频分离标记

禁止直接交付：

- 平台下载器内部状态
- 浏览器 cookies

### Spreadsheet -> Acquisition

交付内容必须包含：

- 已解析 URL 列
- 行号映射
- 每行任务 ID
- 回写目标位置

禁止直接交付：

- 表格引擎实现细节

### Taxonomy -> Tagging

交付内容必须包含：

- 当前生效标签树
- 标签合法路径
- 禁止输出的新标签规则
- 标签版本号

禁止直接交付：

- 任意模型提示词内部实现

### Tagging -> Archive

交付内容必须包含：

- 候选标签集合规模
- 文件名到标签路径的映射
- 标签版本号
- 决策指纹
- 冲突标签说明
- 无法确定标签的异常列表
- 被拒绝标签摘要

禁止直接交付：

- 原始模型长输出
- 模型思维链或中间推理文本

### Archive -> Retrieval

交付内容必须包含：

- 最终归档路径
- 文件唯一标识
- 标签索引记录
- 版本迁移后的新旧映射
- 决策指纹

禁止直接交付：

- 文件系统底层操作日志全文

---

## Orchestrated Workflow Stages

### Workflow A: Spreadsheet-Driven Download

顺序：

1. `@Spreadsheet-Agent`
2. `@Acquisition-Agent`
3. `@Media-Processing-Agent`
4. `@QA-Agent`

自动 hand-off 条件：

- 表格任务解析成功
- 下载任务 contract 完整
- 合并结果存在最终产物
- 测试计划全部声明

### Workflow B: Tagging and Archiving

顺序：

1. `@Taxonomy-Agent`
2. `@Tagging-Agent`
3. `@Archive-Agent`
4. `@QA-Agent`

自动 hand-off 条件：

- 标签树版本确定
- 打标结果仅使用合法标签
- 归档路径无冲突或冲突已解决

### Workflow C: Retrieval and Delivery

顺序：

1. `@Retrieval-Agent`
2. `@Archive-Agent` 或 `@Adapter-Agent`
3. `@QA-Agent`

自动 hand-off 条件：

- 调用报告已生成
- 识别码可校验
- 复制或导出目标路径合法
- 若结果为 `training-grade` 或对外交付，则已被 `@QA-Agent` 明确放行

### Workflow D: Taxonomy Migration

顺序：

1. `@Taxonomy-Agent`
2. `@Archive-Agent`
3. `@Retrieval-Agent`
4. `@QA-Agent`

自动 hand-off 条件：

- 新旧版本 diff 完整
- 迁移计划可执行
- 检索索引已同步

---

## Test-First Rule

所有 Agent 必须先输出测试计划，再输出实现。

最低测试要求：

- `@Acquisition-Agent`: 平台识别、URL 正规化、失败回退
- `@Media-Processing-Agent`: 文件匹配、缺失音轨、错误清理
- `@Spreadsheet-Agent`: 列识别、空行、错误回写
- `@Taxonomy-Agent`: 版本 diff、层级保持、增量变更
- `@Tagging-Agent`: 非法标签过滤、空标签、冲突标签
- `@Archive-Agent`: 路径冲突、重复归档、迁移重定位
- `@Retrieval-Agent`: 标签筛选、报告生成、识别码一致性
- `@Orchestrator-Agent`: 状态推进、失败重试、补偿路径
- `@Adapter-Agent`: port 契约一致性、第三方失败隔离

---

## Training-Grade Gate

凡是要进入以下链路的数据：

- 训练候选集
- 对外报告
- 外部交付包

都不得仅依赖自动 hand-off。

必须满足：

- 已有 `Decision Fingerprint`
- 已完成 `Candidate vs Accepted Boundary` 说明
- 经 `@QA-Agent` 显式放行

禁止：

- 仅凭模型标签结果直接进入训练或对外交付

---

## Deadlock Prevention

为防止协作流卡死，必须遵守以下规则：

- 任意 Agent 不得等待另一个 Agent 提供未在契约中声明的字段
- 任意 Agent 不得要求读取其沙盒外源码来“理解上下文”
- 如果契约缺失，必须返回 `Contract Incomplete`，而不是自行猜测
- 如果测试计划无法构造，必须返回 `Test Plan Blocked`
- 如果上游输出不合法，必须返回 `Handoff Rejected`

自动 hand-off 停止条件仅有：

- 契约缺失
- 测试计划缺失
- 边界冲突
- 文件访问越权
- 输出不满足 schema

---

## Enforcement Summary

该协作流强制要求：

- Agent 按功能模块而非技术层划分
- 任何实现前必须先有测试计划
- 默认自动交接，不做人肉串行审批
- 每个 Agent 只能看最少量上下文
- 所有交接都必须通过显式 contract

如果某个任务需要让单个 Agent 同时理解下载、打标、归档、检索全链路，默认判定为协作流设计失败。
