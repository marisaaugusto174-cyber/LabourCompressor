# LabourCompressor Project Audit Report

审计日期：2026-05-01  
审计范围：当前工作目录 `/Users/tianyi/Desktop/codex/jobtask`  
审计目标：确认 V0.2 前项目的工程状态、风险、已完成功能与下一步治理优先级。

## 1. Executive Summary

当前项目已经具备可运行的核心链路：

- 表格驱动任务入口
- Bilibili 下载链
- 视频级模型打标链
- 视频压缩缓存
- 多分支标签回填
- 唯一 `内容题材` 归档
- `AfterEdit` 人工剪辑闸门
- 本地 Web UI 基础壳

本次审计确认本地测试套件通过，Web UI 服务可启动并响应默认配置接口。主要风险不在核心链路是否成立，而在工程治理层：当前目录不是 Git 仓库、存在本地密钥配置、多个文件超过 500 行规则、运行产物与本地配置混在项目目录中。这些问题会影响后续回溯、交付、多人协作和安全性。

## 2. Audit Evidence

已执行的本地检查：

- `npm run test:taxonomy-domain`
- `git status --short`
- `rg --files`
- `wc -l`
- `rg "TODO|FIXME|console.log|apiKey|secret|token|password|cookies"`
- `curl http://127.0.0.1:4311/api/defaults`

结果摘要：

- 测试结果：`120/120` 通过。
- Git 状态：当前目录不是 Git 仓库。
- Web UI：`http://127.0.0.1:4311/` 可由本地服务响应。
- PRD：已更新为 V0.2 口径，当前 `448` 行，符合 500 行规则。

## 3. Confirmed Capabilities

### 3.1 Core Pipeline

当前已实现并可测试的主链：

- 用户表读取。
- 下载任务启动。
- 下载文件名标准化。
- 已下载 / 已归档行跳过逻辑。
- 视频级模型打标，不以抽帧作为正式链路。
- 打标前视频压缩缓存。
- 多分支标签回填。
- `内容题材` 唯一路径归档。
- `归档文件名` 字段可作为标准表能力的一部分。

### 3.2 Web UI

当前 Web UI 已具备：

- 用户表拖拽 / 选择。
- 供应商与模型下拉选择。
- 平台凭证配置入口。
- Preflight 检查入口。
- 任务启动入口。
- 简化状态壳层。
- `AfterEdit` 表生成并自动载入能力。

### 3.3 AfterEdit Workflow

当前已具备两阶段流程基础：

- 第一阶段下载后中断。
- 自动创建 `AfterEdit` 文件夹。
- 人工剪辑后扫描 `AfterEdit` 文件。
- 自动生成标准归档记录表。
- 第二阶段前校验剪辑后文件名规范。

## 4. Key Findings

### F1. 当前项目目录不是 Git 仓库

严重级别：High

证据：

- `git status --short` 返回 `fatal: not a git repository`。

影响：

- 无法可靠查看变更差异。
- 无法用提交点追踪 V0.1 / V0.2 演进。
- 无法安全回滚单个文件。
- 当前的 `LCompressor Clone` 是手工快照，不等价于版本控制。

建议：

- 在当前项目根目录初始化 Git。
- 添加 `.gitignore`。
- 先提交一个 `v0.2-baseline`。
- 保留 `/Users/tianyi/Desktop/LCompressor Clone` 作为历史快照，但后续以 Git tag 作为主回溯机制。

### F2. 本地密钥配置位于项目目录内

严重级别：High

证据：

- `config/model-providers/providers.local.json` 中存在非空 API key。
- `config/download-platform-credentials.local.json` 也属于本地敏感配置入口。

影响：

- 后续打包、复制、备份、压缩、共享项目时，容易把密钥一起带走。
- 如果未来初始化 Git 而未配置忽略规则，存在误提交风险。

建议：

- 不在报告和日志中打印任何真实 key。
- 立即将 `*.local.json` 加入 `.gitignore`。
- 增加 `*.template.json` 作为可提交模板。
- 中长期把 provider key 移出项目目录，放到用户级配置目录或系统安全存储。
- 如果该 key 已经被复制到外部位置，应考虑轮换。

### F3. 多个文件违反 500 行规则

严重级别：High

证据：

- `04_STATE_AND_DATA.md`：889 行。
- `packages/adapters/spreadsheets/local-spreadsheet.ts`：797 行。
- `02_AGENTS_WORKFLOW.md`：761 行。
- `apps/web/runtime-support.ts`：732 行。
- `apps/cli/local-pipeline-command.ts`：681 行。
- `03_STRICT_RULES.md`：647 行。
- `05_STEP_BY_STEP_PLAN.md`：641 行。
- `01_PROJECT_CHARTER.md`：591 行。
- `TASKLIST.md`：544 行。

影响：

- 违反项目已确认的工程红线。
- 大文件会降低后续 Agent 修改准确率。
- 文档和代码职责边界开始变模糊。

建议：

- 优先治理代码文件，再治理文档文件。
- 不做机械拆分。
- 先对每个超限文件压缩重复内容、删除过期说明、抽出明确职责模块。
- 优先顺序：`local-spreadsheet.ts`、`runtime-support.ts`、`local-pipeline-command.ts`、`TASKLIST.md`。

### F4. 项目目录包含运行产物和系统噪声文件

严重级别：Medium

证据：

- `.cache`
- `.web-ui.log`
- `.web-ui.pid`
- `packages/adapters/.DS_Store`
- `packages/core/.DS_Store`
- `packages/testing/.DS_Store`

影响：

- 快照和后续版本归档会混入非源码内容。
- 日志文件可能包含本地路径、错误信息或配置片段。
- `.pid` 文件可能造成误判服务状态。

建议：

- 增加 `.gitignore`。
- 将运行期内容统一放到 `.runtime/` 或用户级缓存目录。
- 清理 `.DS_Store`。
- 清理或轮转 `.web-ui.log`。

### F5. Web 服务存在调试日志泄露风险

严重级别：Medium

证据：

- `apps/web/server.ts` 中存在 `console.log`，会打印 Preflight 请求体。

影响：

- 请求体可能包含用户本地路径、provider 选择、配置文件路径。
- 后续如果 UI 扩展到更多配置项，日志泄露范围会扩大。

建议：

- 删除该调试日志。
- 如需保留，必须加显式 debug 开关。
- 日志中禁止输出 key、cookies 路径完整内容、用户敏感本地路径。

### F6. 测试脚本命名不准确

严重级别：Low

证据：

- `test:taxonomy-domain` 实际运行了大量 unit 与 integration 测试，不只是 taxonomy domain。

影响：

- 后续维护者会误判测试覆盖范围。
- 自动化 CI 接入时脚本语义不清。

建议：

- 新增 `npm test` 或 `npm run test:all`。
- 保留 `test:taxonomy-domain` 作为兼容别名。

### F7. 任务状态仍偏内存态，缺少可靠任务日志

严重级别：Medium

证据：

- 当前 Web UI 可查询任务状态，但尚未确认有持久化任务 journal。

影响：

- 服务重启后可能丢失任务过程。
- 长任务失败后难以复盘。
- 未来做前端体验优化时缺少结构化样本。

建议：

- 增加任务级 `run.jsonl` 或 SQLite journal。
- 每条事件记录 `taskId`、`phase`、`status`、`currentItem`、`message`、`timestamp`。
- UI 继续展示简化状态，调试页读取结构化事件。

### F8. 多平台下载尚未完成真实回归

严重级别：Medium

证据：

- 已规划 `bilibili / youtube / douyin / tiktok` 平台凭证层。
- 当前真实下载链主要围绕 Bilibili 验证。

影响：

- 现在不能承诺所有平台都可稳定最高码率下载。
- 小站兜底方案还没有被真实样本验证。

建议：

- 下一阶段按平台建立最小真实样本集。
- 每个平台至少验证公开下载、登录态下载、命名标准化、后链接入。
- 失败必须进入分类错误，不直接暴露 `yt-dlp` 原始长日志。

### F9. 多模型候选池尚未完成全量真实视频验证

严重级别：Medium

证据：

- UI 和配置层已经纳入多个模型候选。
- 已有 Qwen 链路基础，但 Gemini 与新增 Qwen 档位仍需要逐个视频级验证。

影响：

- 不能仅凭配置项存在就判断模型可用于生产链路。
- 不同模型的视频输入限制、费用、速度和返回格式可能不同。

建议：

- 对 `Qwen 3.6 Flash`、`Qwen 3.6 Plus`、`Qwen 3.5 Plus`、`Gemini 3 Flash Thinking`、`Gemini 3 Pro` 各跑一条 5-30 秒视频。
- 记录速度、成本、失败原因、标签质量。
- 固化默认模型排序前，应以实测结果为准。

## 5. Positive Findings

本次审计也确认了几个稳定进展：

- 本地完整测试套件通过。
- PRD 已按 V0.2 方向重写，且符合 500 行规则。
- Web UI 已经从技术表单向用户流程页收敛。
- `AfterEdit` 第二阶段的文件名规范校验已有测试覆盖。
- 下载后人工剪辑中断点已进入正式流程设计。
- 正式链路已明确不以抽帧作为默认视频打标方案。

## 6. Recommended Action Order

### Immediate

1. 添加 `.gitignore`。
2. 清理或隔离运行产物。
3. 删除 Web 服务中的 Preflight 请求体调试日志。
4. 将真实密钥从项目可复制区域隔离。

### Next

1. 初始化 Git 并提交 V0.2 baseline。
2. 治理超过 500 行的代码文件。
3. 建立任务 journal。
4. 完成平台凭证真实 probe。

### V0.2 Acceptance

1. Bilibili / YouTube / Douyin / TikTok 至少各一条真实下载回归。
2. 五个视频模型候选各一条真实视频打标回归。
3. AfterEdit 两阶段流程完成一次人工验收。
4. Web UI 用户默认路径不暴露底层技术参数。
5. 所有失败进入用户可理解的分类错误。

## 7. Audit Conclusion

项目当前已经越过“原型是否可行”的阶段，进入“能否稳定交付给真实用户操作”的阶段。最大短板不是功能想法，而是工程治理和运行稳定性。

如果只选三件事优先做，应按以下顺序：

1. 建立 Git baseline 与敏感文件隔离。
2. 清理超过 500 行规则的关键代码文件。
3. 做多平台下载与多模型视频输入的真实回归矩阵。

完成这三项后，项目才适合继续向 V0.2 可交付版本推进。
