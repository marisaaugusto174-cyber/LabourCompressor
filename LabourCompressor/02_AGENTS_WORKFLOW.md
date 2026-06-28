# 02_AGENTS_WORKFLOW.md

## Status

- Project: `LabourCompressor`
- Collaboration Model: single-agent or multi-agent, capability-dependent
- Partition Strategy: feature and contract boundaries
- Required Discipline: minimum context, tests before implementation, evidence before handoff

---

## Mission

本文件定义 Coding Agent 的工作边界和交接方式。它不假设运行环境一定支持子 Agent，也不把自动 hand-off 当作完成条件。

无论单 Agent 还是多 Agent，都必须做到：

- 只读取完成当前任务所需的文档和代码。
- 先明确契约、风险和验证，再修改实现。
- 跨模块修改由显式计划驱动。
- 不以修改业务规则的方式让测试通过。
- 交付结论必须附带可复现证据。

---

## Document Context

所有任务可以读取：

- `01_PROJECT_CHARTER.md`
- `03_STRICT_RULES.md`
- `04_STATE_AND_DATA.md`
- `05_STEP_BY_STEP_PLAN.md`
- 与当前任务直接相关的 README、spec 或 plan

路径一律相对仓库根目录书写，禁止把本机绝对路径写入文档、测试或运行时代码。

---

## Operating Rules

### Minimum Context

开始任务时先定位：

1. 当前功能的 domain 或 contract。
2. 对应 adapter 或 composition root。
3. 现有相似实现。
4. 对应 unit、integration 和 governance tests。

默认不做全仓库重构，不读取与任务无关的凭证、运行态文件或用户数据。

### Contract Before Code

实现前必须给出以下任一项：

- 一个会因缺少目标行为而失败的测试；或
- 对纯文档、配置和机械改动给出明确验证计划。

新增公开类型、port、状态或错误码时，必须先声明输入、输出和失败语义。

### Evidence Before Completion

完成声明必须基于本轮新鲜证据：

- 目标测试通过。
- 相关回归通过。
- `git diff --check` 通过。
- 敏感信息和改动范围检查通过。

不能用“应该可以”“看起来正确”代替验证。

### No Unapproved Scope Expansion

允许：

- 当前功能需要的局部重构。
- 为测试注入依赖或拆出纯函数。
- 修复由当前改动暴露出的同边界问题。

不允许：

- 顺手重写无关模块。
- 擅自改变产品范围、状态语义或数据保留规则。
- 为满足目录形式破坏稳定行为。

---

## Current Work Areas

### Download Work

主要路径：

- `packages/features/download/**`
- `packages/adapters/downloaders/**`
- `packages/testing/unit/download/**`

职责：平台识别、下载请求、凭证解析、下载候选、适配器和失败分类。

当前平台边界为 Bilibili、YouTube、抖音、TikTok，以及小红书单笔记单视频；小红书图文、主页、短链接和自动登录不在范围内。

禁止：修改标签合法性、归档目录或模型输出规则。

### Segmentation and Media Work

主要路径：

- `packages/features/segmentation/**`
- `packages/adapters/media/**`
- `apps/cli/local-pipeline-segmentation*.ts`
- `packages/testing/unit/segmentation/**`
- `packages/testing/unit/media/**`

职责：媒体探测、场景边界、时长治理、导出、合并和缓存预处理。

禁止：决定平台凭证优先级或标签归档规则。

### Spreadsheet Work

主要路径：

- `packages/features/spreadsheet-tasks/**`
- `packages/adapters/spreadsheets/**`
- `packages/testing/unit/spreadsheet/**`

职责：表格读取、列映射、行级状态和写回格式。

禁止：实现下载协议、模型请求或归档决策。

### Taxonomy and Tagging Work

主要路径：

- `packages/features/taxonomy/**`
- `packages/features/tagging/**`
- `packages/adapters/models/**`
- `packages/testing/unit/taxonomy/**`
- `packages/testing/unit/tagging/**`

职责：标签树、候选生成、schema 校验、合法化、DecisionFingerprint 和正式标签记录。

禁止：模型候选直接进入归档或训练级数据。

### Archive and Retrieval Work

主要路径：

- `packages/features/archive/**`
- `packages/features/retrieval/**`
- `packages/adapters/storage/**`
- `packages/testing/unit/archive/**`
- `packages/testing/unit/retrieval/**`

职责：归档计划、文件执行、索引记录和本地检索。

禁止：自行生成标签或读取原始模型长输出。

### Application and Runtime Work

主要路径：

- `apps/cli/pipeline/**`
- `apps/cli/local-pipeline-*.ts`
- `apps/web/api/**`
- `apps/web/task-service.ts`
- `apps/web/runtime-support-*.ts`
- `packages/testing/unit/cli/**`
- `packages/testing/unit/web/**`

职责：composition root、依赖组装、任务推进、HTTP 边界和用户可见状态。

apps 可以组装 adapter，但业务规则和第三方协议实现应留在 feature 或 adapter。当前尚无 `packages/orchestrator`；只有经批准的迁移计划可以创建并迁移职责。

### QA and Governance Work

主要路径：

- `packages/testing/**`
- 五份核心治理文档
- 与当前任务直接相关的 spec、plan 和 release 文档

职责：验证契约、失败路径、架构边界、安全规则和交付证据。

QA 可以指出业务规则矛盾，但不得修改业务规则来迎合测试；规则变更必须回到章程或设计评审。

---

## Single-Agent Workflow

单 Agent 依次执行：

1. 读取当前任务所需规则和实现。
2. 写测试或验证计划。
3. 观察预期失败。
4. 实现最小改动。
5. 运行目标测试和相关回归。
6. 审查 diff、安全和范围。
7. 记录未解决风险。

单 Agent 不等于可以跨越模块边界；跨模块工作仍须在计划中列明文件和契约。

---

## Multi-Agent Workflow

只有运行环境支持且用户允许时才使用子 Agent。适用条件：

- 存在两个以上相互独立的任务。
- 任务不写同一文件或共享可变状态。
- 主 Agent 能独立验证每个结果。

主 Agent 必须：

- 明确每个 Agent 的文件范围。
- 防止并行修改冲突。
- 不把规则解释和最终验收完全委托出去。
- 合并后重新运行测试，不直接相信 Agent 报告。

---

## Handoff Contract

交接只要求五组信息：

### Scope

- 本阶段解决的问题。
- 明确不处理的范围。
- 允许修改的文件。

### Input and Output

- 输入对象及前置条件。
- 输出对象、状态和错误语义。
- Candidate 与 Accepted Record 的边界。

### Verification

- 已执行的命令。
- 通过、失败和未运行项。
- 产物或状态的验证方式。

### Risks and Recovery

- 已知风险。
- 可重试与不可重试步骤。
- 中断后从哪个 checkpoint 恢复。

### Traceability

- task/issue/spec/plan 标识。
- 适用时的 DecisionFingerprint 或 integration version。
- 数据等级：operational、research 或 training。

缺少会改变实现决策的字段时，停止交接并报告 `Contract Incomplete`。测试无法构造时报告 `Test Plan Blocked`，不得自行猜测。

---

## Feature Handoffs

### Spreadsheet -> Download

交付任务 ID、行号、原始 URL、脱敏展示 URL、输出目录和回写目标。禁止交付表格引擎内部状态。

### Download -> Segmentation

交付已验证媒体产物、容器、媒体元数据和失败分类。禁止交付 cookies、认证头、签名媒体 URL 或下载器内部日志全文。

### Segmentation -> Tagging

交付合法 `AfterEdit` 片段、`ProblemClips` 记录、源资产关系和时长验证结果。

### Taxonomy -> Tagging

交付当前标签树、合法路径、版本和禁止输出规则。

### Tagging -> Archive

交付正式标签记录、唯一 `内容题材`、DecisionFingerprint 和被拒绝候选摘要；禁止交付模型思维链。

### Archive -> Retrieval

交付最终路径、文件标识、标签索引记录和迁移映射；禁止交付底层文件系统日志全文。

---

## Test Expectations

- download：平台识别、凭证优先级、格式选择、失败回退、取消与清理。
- segmentation/media：边界检测、时长治理、导出失败和问题片段。
- spreadsheet：列识别、空行、错误回写和格式兼容。
- taxonomy/tagging：schema、非法标签、冲突、fingerprint。
- archive/retrieval：路径冲突、幂等、迁移和识别码。
- application/runtime：状态推进、API 输入、恢复、取消和 UI 映射。
- adapter：第三方失败隔离、敏感信息脱敏和 contract 行为。

新增 adapter 必须覆盖成功、外部失败、取消/清理及敏感信息边界。新增 workflow 必须至少有一条端到端或阶段集成测试。

---

## Training and External Delivery Gate

进入训练候选、外部报告或交付包的数据必须满足：

- Candidate 与 Accepted Record 已分离。
- 具备适用的 DecisionFingerprint。
- 来源、版本和验证证据完整。
- QA 显式放行。

普通本地 operational 产物不自动升级为 training-grade。

---

## Completion Checklist

- 修改范围与计划一致。
- 测试或验证计划先于实现。
- 目标测试和相关回归有新鲜证据。
- 未输出真实凭证、token、认证头或签名 URL。
- 未把目标架构写成当前事实。
- 未新增永久治理例外。
- 交接包含范围、契约、验证、风险和追溯信息。
