# V0.3 核心动作主动作归档路径设计

## Status

- Product: LabourCompressor V0.5
- Taxonomy preset: `core-v0.3-drama`
- Taxonomy version: `Core_Base_Prompt_V0.3_Drama_Core_Candidate`
- Design date: 2026-06-29
- Scope: 归档路径选择与强制校验

## Objective

V0.3 戏核增强候选继续输出完整结构化标签，但正式归档目录不再由“内容领域”决定。新任务必须从 `核心动作` 维度中取得恰好一个 `tag_role = 主动作` 的合法标签，并使用它的完整 `label_path` 生成归档路径。

本设计只改变归档路径的选择与校验，不改变标签树、维度定义、标签角色、标签数量规则、模型输出 schema 或其他标签的保留方式。

## Existing Contract

V0.3 标签规范已经规定：

- `核心动作` 是必填维度。
- 必须输出 1 个 `主动作`。
- 最多输出 2 个 `次动作`。
- 核心动作只能使用 `主动作` 或 `次动作`。
- 无显著动作但主体或空间清晰时可使用 `核心动作 > 状态变化 > 静态状态 > 静止呈现`。
- 核心必填维度确实无法判断时必须进入复核，不得伪造标签。

当前运行时只从结构化模型结果中提取 `label_path`，没有以 `dimension` 和 `tag_role` 验证主动作数量。因此提示词层已有规则，但程序尚未形成可执行门禁。

## Design Principles

1. 标签结果是事实集合，归档路径是从事实集合派生的投影。
2. 归档投影不得删除、重排或改写其他标签。
3. 主动作缺失或冲突时 fail closed，不得按路径深度任意选择。
4. 新策略只对显式配置的 preset 生效。
5. 历史归档路径不重算、不搬迁。
6. 表格字段、HTTP DTO 和归档文件副作用保持兼容。

## Preset Configuration

在 `core-v0.3-drama.json` 中增加可选归档策略：

```json
{
  "archivePathPolicy": {
    "dimension": "核心动作",
    "primaryRole": "主动作",
    "requiredCount": 1,
    "onInvalid": "retry-once-then-review"
  }
}
```

`archivePathPolicy` 是新增的路径投影配置。现有 `archiveDimension` 保留为兼容字段，不用于修改 V0.3 标签树。没有 `archivePathPolicy` 的 V0.1、V0.2、自定义和历史 preset 继续执行现有维度路径选择。

建议新增内部类型：

```ts
interface ArchivePathPolicy {
  readonly dimension: string;
  readonly primaryRole: string;
  readonly requiredCount: 1;
  readonly onInvalid: 'retry-once-then-review';
}
```

manifest parser 必须显式校验全部字段，不接受未知计数或失败策略。

## Structured Tag Boundary

结构化模型响应解析后需要保留归档选择所需字段：

```ts
interface StructuredTagCandidate {
  readonly dimension: string;
  readonly labelPath: readonly string[];
  readonly selectedLevel: string;
  readonly tagRole: string;
  readonly entityId: string;
  readonly targetEntityId: string;
  readonly confidenceScore: number;
}
```

现有 `candidatePaths` 和 `acceptedPaths` 继续输出，避免破坏现有 taxonomy 合法性检查、表格回写和 JSON sidecar。结构化标签只是新增的并行结果，不取代路径数组。

解析器需要拒绝归档相关字段类型异常，但不应因无关可选字段缺失而丢弃整个合法标签结果。

## Primary Action Selection

新增纯函数选择归档路径：

```ts
selectArchivePathFromStructuredTags({
  tags,
  policy,
  taxonomyTree
})
```

选择顺序固定为：

1. 筛选 `dimension === policy.dimension`。
2. 筛选 `tagRole === policy.primaryRole`。
3. 要求数量严格等于 `requiredCount`。
4. 要求 `labelPath[0] === policy.dimension`。
5. 将路径转换为 `核心动作 > ...` 并通过当前 taxonomy 合法性校验。
6. 校验 `selectedLevel` 与路径深度一致。
7. 返回唯一 `selectedArchivePath`。

`次动作`保留在标签结果和 sidecar 中，但不能成为归档路径候选。不得以“最深路径优先”或“首个核心动作”代替角色校验。

`target_entity_id` 继续遵循 V0.3 标签规范，但不作为归档选择条件或目录层级，因为规范允许不适用时为空。若顶层 `review_required=true` 且复核原因指向核心动作无法判断，归档门禁必须阻止归档。

## Tagging and Retry Flow

主打标请求继续要求输出完整 V0.3 JSON，同时追加机器可执行的约束：

```text
核心动作必须包含且仅包含一个 tag_role=主动作 的标签项。
```

处理流程：

1. 执行完整多维度打标。
2. 解析并验证全部路径。
3. 根据 `archivePathPolicy` 选择主动作。
4. 若主动作合法且唯一，继续归档。
5. 若缺失、重复、角色错误或路径非法，执行一次仅修复核心动作主动作的结构化重试。
6. 合并重试结果时只替换无效的核心动作候选，不修改其他已接受标签。
7. 重试后仍不满足约束时，将该行标记为待复核并阻止归档。

静态素材应优先根据已有 taxonomy 选择 `静止呈现`。只有证据确实不足时进入复核，不使用默认动作兜底。

## Archive Path Construction

模型结果：

```json
{
  "dimension": "核心动作",
  "tag_role": "主动作",
  "label_path": ["核心动作", "身体动作", "位移动作", "跑动"]
}
```

生成路径：

```text
<archiveRoot>/视频数据归档库/核心动作/身体动作/位移动作/跑动/<fileName>
```

规则：

- `主动作`不进入目录名称。
- 目录层级完全来自合法 `label_path`。
- 沿用现有路径片段和文件名安全清洗。
- 沿用 copy 模式、同名后缀和 JSON sidecar 行为。
- 仍通过现有“归档路径”和“归档文件名”字段回写，不新增表格列。

## Compatibility

### New V0.3 Tasks

启用 `core-v0.3-drama` 且存在 `archivePathPolicy` 时，使用核心动作主动作归档。

### Existing Tasks and Spreadsheets

- 已有“归档路径”视为已接受的执行输入，不重新推导。
- 已归档文件不移动、不复制到新目录。
- 历史“内容领域”或“内容题材”路径继续可解析和回写。
- archive stage 应从通用归档路径读取相对目录，不再只识别两个历史维度名称。

### Other Presets

- `core-v0.1`、`full-v0.2` 和无新配置的自定义 preset 行为不变。
- 旧 `archiveDimension` 路径选择继续作为兼容实现。
- 不修改公开 HTTP 路由、请求 DTO、任务快照或电子表格 schema。

## State and Error Model

新增内部错误分类：

- `archive-primary-tag-missing`
- `archive-primary-tag-conflict`
- `archive-primary-tag-role-invalid`
- `archive-primary-tag-path-invalid`
- `archive-primary-tag-review-required`

这些错误发生在打标完成与归档开始之间。失败行必须保留全部原始结构化标签 sidecar，便于人工复核；不得把未通过门禁的路径写成正式归档路径。

用户可见状态建议为：

```text
待复核：核心动作主动作缺失
待复核：存在多个核心动作主动作
待复核：核心动作路径不合法
```

## Components

预计涉及：

- taxonomy preset manifest contract：读取可选 `archivePathPolicy`。
- structured model response parser：保留角色与维度。
- archive path selector：纯函数执行唯一性和合法性校验。
- tagging application flow：一次定向重试并生成 `selectedArchivePath`。
- archive stage path resolver：兼容新旧通用归档路径。
- CLI/Web presentation：展示新的待复核原因。

归档文件 adapter、标签树 parser、taxonomy 节点、表格 schema 和 HTTP route 不应因本设计改变。

## Test Plan

### Preset and Parser

- V0.3 manifest 正确解析归档策略。
- 旧 manifest 不需要新字段。
- 结构化标签保留 `dimension`、`tag_role` 和 `label_path`。
- 不合法策略和字段类型被拒绝。

### Selection

- 唯一合法主动作成功。
- 次动作不参与归档选择。
- 缺少主动作失败。
- 多个主动作失败。
- 角色和维度不匹配失败。
- 非法 taxonomy 路径失败。
- `selected_level` 与路径深度不一致失败。
- `静止呈现`成功成为主动作路径。

### Workflow

- 首次缺失、定向重试成功后归档。
- 重试仍失败时进入待复核且没有归档文件。
- 其他标签在重试前后完全一致。
- JSON sidecar 保留主动作、次动作和其他维度。
- 新路径生成到 `视频数据归档库/核心动作/**`。

### Compatibility

- 历史内容领域路径继续归档。
- 已归档行不重新处理。
- V0.1、V0.2 行为不变。
- 表格列、HTTP DTO 和任务快照不变。
- 归档 copy、同名处理和 sidecar 行为不变。

## Non-goals

- 不修改 V0.3 标签树节点或动作分类。
- 不修改主动作、次动作的业务含义和数量规则。
- 不增加主体对象与动作的组合目录。
- 不以戏核维度归档。
- 不迁移或重排历史归档文件。
- 不新增数据库 schema 或表格字段。
- 不改变 ProblemClips 的处理策略；该问题应作为独立治理任务处理。

## Acceptance Criteria

1. V0.3 新任务只有在存在唯一合法主动作时才能进入归档。
2. 归档目录完整复用主动作 `label_path`。
3. 次动作和其他标签完整保留但不影响目录。
4. 主动作异常时最多定向重试一次，之后进入待复核。
5. 旧任务、旧 preset、表格和 HTTP 接口保持兼容。
6. 标签 Markdown 和 taxonomy 节点无行为性改写。
