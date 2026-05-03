# LabourCompressor V0.2 Engineering Execution Audit

审计日期：2026-05-04  
项目路径：`/Users/tianyi/Desktop/codex/jobtask`  
审计类型：工程执行版 / 分组修复审计  
目标：为后续多 Codex 对话框并行推进 V0.2 提供可执行的风险分组、任务边界和提示词。

## 1. 审计结论

项目已经具备继续推进 V0.2 的工程基础，但不建议在当前状态下直接进入“功能继续堆叠”。当前主链功能已经成立，测试套件通过，Web UI 和平台化能力也已开始收口；真正影响 V0.2 质量的是版本基线、安全隔离、文件体量、真实平台回归和真实模型回归。

当前结论：

- 可以继续开发 V0.2。
- 必须先固定 Git baseline，否则多对话框并行会失去可回溯能力。
- 必须继续隔离本地密钥、cookies、运行缓存和日志。
- 必须优先治理超 500 行文件，尤其是 `apps/web/public/app.js`。
- 必须用真实样本验证多平台下载和多模型视频输入，不能只依赖配置项和单元测试。

## 2. 当前已成立能力

### 2.1 主流程能力

- 表格驱动任务入口已成立。
- 下载链已支持 `yt-dlp + ffmpeg`。
- 下载文件名标准化已进入流程。
- 已归档 / 已下载未归档跳过逻辑已有测试覆盖。
- 视频级打标是正式链路，不以抽帧作为默认实现。
- 视频进入模型前有压缩缓存链。
- 多分支标签回填已成立。
- `内容题材` 唯一路径归档已成立。
- `AfterEdit` 人工剪辑闸门已成立。

### 2.2 Web UI 能力

- 本地 Web UI 可启动。
- 用户表选择、拖拽、provider 选择、模型配置、下载凭证配置已具备基础能力。
- Preflight 已作为统一前置检查入口。
- 任务状态已从硬核日志向用户状态壳层收口。
- `AfterEdit` 一键生成表并自动载入能力已进入当前实现。

### 2.3 测试状态

最新测试命令：

```bash
npm run test:taxonomy-domain
```

结果：

- `150/150` 通过。
- 覆盖范围包括下载、归档、表格、模型配置、平台凭证、AfterEdit、运行状态、视频缓存、治理检查。

## 3. 分组风险与修复任务

## A. 工程治理与版本基线

风险等级：High

当前证据：

- 当前 Git 状态显示大量未提交文件。
- `.gitignore` 已存在，但项目还没有形成清晰的 V0.2 baseline。
- 当前工作目录包含源码、文档、测试、运行产物、下载缓存、总表文件。

影响：

- 多对话框并行时难以判断谁改了什么。
- 无法稳定回滚单个任务。
- 审计报告、PRD、TASKLIST 和代码之间容易产生漂移。

修复目标：

- 固定一个可回溯的 V0.2 baseline。
- 明确哪些文件属于源码，哪些属于本地运行态。
- 所有后续功能对话框都基于同一 baseline 开工。

建议任务：

- 检查 `.gitignore` 是否覆盖 `.cache`、`.runtime-state`、`.runtime-uploads`、`.web-ui.log`、`.web-ui.pid`、`.DS_Store`、`*.local.json`、`node_modules`。
- 清点未提交文件，区分源码、文档、测试、运行产物、用户数据。
- 建立 V0.2 baseline commit 或至少生成 baseline manifest。

可复制提示词：

```text
你在 /Users/tianyi/Desktop/codex/jobtask 工作。请处理 V0.2 工程治理与版本基线。先读取 PROJECT_AUDIT_EXECUTION_REPORT.md、PROJECT_AUDIT_REPORT.md、PRD.md、TASKLIST.md。目标是确认 .gitignore、清点未提交文件、区分源码/文档/测试/运行产物/用户数据，并准备一个安全的 V0.2 baseline。不要提交真实密钥、cookies、本地运行缓存、用户下载视频。完成后运行 npm run test:taxonomy-domain，并汇报可提交文件清单与应排除文件清单。
```

## B. 安全配置与密钥隔离

风险等级：High

当前证据：

- `config/model-providers/providers.local.json` 存在本地 provider 配置。
- `config/download-platform-credentials.local.json` 存在本地平台下载凭证配置。
- Web UI 支持写入 API key 和 cookies 路径。
- `.gitignore` 已包含 `*.local.json`，但仍需确认快照、日志和导出物不会带出敏感配置。

影响：

- 复制项目、打包快照或未来提交代码时可能泄漏密钥。
- 日志和调试输出如果包含请求体，会扩大泄漏面。

修复目标：

- 本地密钥永远不进入版本。
- UI、CLI、测试和日志都不打印真实 key。
- provider 和 platform credential 只展示“是否配置”，不展示敏感值。

建议任务：

- 检查所有日志输出，确认不打印请求体中的 key 或 cookies 路径细节。
- 确认 provider summary 只输出 `apiKeyPresent`。
- 检查 template 与 local 配置的分离。
- 建议长期迁移到用户级配置目录或系统安全存储。

可复制提示词：

```text
请审计并加固安全配置与密钥隔离。重点检查 config/model-providers、config/download-platform-credentials、apps/web/server.ts、apps/web/public/app.js、provider preflight、platform credential probe。要求：不输出真实 API key；不输出 cookies 内容；local 配置不得被 Git 跟踪；UI 只显示是否已配置；测试覆盖“不泄漏 key”的分支。不要删除用户现有 local 配置。完成后运行 npm run test:taxonomy-domain。
```

## C. 500 行规则治理

风险等级：High

当前证据：

当前超过 500 行的关键文件：

- `apps/web/public/app.js`：1020 行。
- `02_AGENTS_WORKFLOW.md`：761 行。
- `packages/testing/integration/phase4/phase4-cli.test.ts`：728 行。
- `config/taxonomies/video-data-collection-taxonomy-v0-260415.md`：721 行。

接近上限的文件：

- `apps/cli/local-pipeline-command.ts`：498 行。
- `packages/adapters/downloaders/ytdlp-downloader.ts`：470 行。
- `PRD.md`：460 行。
- `apps/web/server.ts`：439 行。

影响：

- 明确违反项目“单文件不超过 500 行”的工程红线。
- `app.js` 过大，会影响 Web UI 后续可维护性。
- phase4 测试过大，会影响测试失败定位。
- taxonomy 文档可能属于业务标签库，是否适用 500 行规则需要单独定义边界。

修复目标：

- 所有工程代码文件不超过 500 行。
- 文档文件优先压缩重复内容，标签库如必须超过 500 行，需要在规则中明确豁免或改为数据资产格式。
- 不做机械拆分，按职责边界优化。

建议任务：

- 优先治理 `apps/web/public/app.js`。
- 将 UI 状态、provider 配置、platform credential、AfterEdit、task rendering 分为清晰模块。
- phase4 测试按行为域拆成多个测试文件。
- `02_AGENTS_WORKFLOW.md` 压缩为当前仍有效的流程规则。

可复制提示词：

```text
请治理 500 行规则。优先处理 apps/web/public/app.js 和 packages/testing/integration/phase4/phase4-cli.test.ts。要求：所有工程代码文件低于 500 行；不要机械拆分；按职责边界拆出 UI 状态、provider 配置、平台凭证、AfterEdit、任务渲染等模块；保持行为不变；补充或保留测试。完成后报告每个文件改造前后行数，并运行 npm run test:taxonomy-domain。
```

## D. 下载链幂等与多平台能力

风险等级：High

当前证据：

- 平台 credential 结构已经存在。
- `bilibili / youtube / douyin / tiktok` 已进入平台凭证配置方向。
- 下载错误分类已有部分实现，例如缺登录态、cookies 过期、Bilibili 412。
- 下载幂等已有测试覆盖，例如复用标准化下载产物。

影响：

- 当前不能仅凭结构判断所有平台都能稳定下载最高码率。
- 小站下载能力还没有真实验证。
- 不同平台的 cookies、风控、合并格式、文件名产物差异会影响后续打标链。

修复目标：

- URL 自动识别平台。
- 按平台选择 credentials。
- 标准化错误分类。
- 已存在标准化产物复用，不误报失败。
- 多平台真实样本最小回归成立。

建议任务：

- 建立平台真实样本清单。
- 对 Bilibili、YouTube、Douyin、TikTok 各跑公开内容和需要登录态内容。
- 记录 credential source、download layer、output artifact、standardized filename。
- 小站兜底先设计接口，不急于重型浏览器自动化。

可复制提示词：

```text
请推进 V0.2 下载链幂等与多平台能力。先读取 PROJECT_AUDIT_EXECUTION_REPORT.md 和 TASKLIST.md。重点：URL 自动识别平台；按平台选择 cookiesFilePath/cookiesFromBrowser/global fallback；下载错误分类；标准化产物复用；避免重复下载已归档或已下载未归档行。不要引入重型浏览器自动化。完成后补下载单元测试与至少一个集成测试，并运行 npm run test:taxonomy-domain。
```

## E. 模型候选池真实验证

风险等级：High

当前证据：

- 模型候选池已有测试覆盖。
- 测试中包含 Gemini thinking profile、model-no-video、auth/quota failure、connectivity branch。
- Qwen 与 Gemini adapter 文件存在。
- 真实视频级全模型回归仍需要人工或联网额度支持。

影响：

- UI 下拉项存在不等于生产可用。
- 不同模型的视频输入大小、时长、费用、返回格式可能不同。
- Gemini 与 Qwen 的失败语义需要统一到前端可理解错误。

修复目标：

- 每个候选模型至少跑一条 5-30 秒真实视频。
- 记录速度、成本、失败率、标签质量。
- 固化默认模型顺序。
- provider preflight 能明确区分未启用、key/额度问题、模型不支持视频、连接失败。

建议任务：

- 验证 `Qwen 3.6 Flash`。
- 验证 `Qwen 3.6 Plus`。
- 验证 `Qwen 3.5 Plus`。
- 验证 `Gemini 3 Flash Thinking`。
- 验证 `Gemini 3 Pro`。

可复制提示词：

```text
请推进模型候选池真实验证。目标模型：Qwen 3.6 Flash、Qwen 3.6 Plus、Qwen 3.5 Plus、Gemini 3 Flash Thinking、Gemini 3 Pro。要求：UI 显示产品名，内部映射 provider/model id；preflight 明确失败类型；不打印 key；每个模型至少用一条 5-30 秒视频验证视频级输入、标签合法化、回表兼容。若缺少真实 key 或额度，不要伪造成功，记录阻塞原因。完成后运行相关测试。
```

## F. Web UI 产品化收口

风险等级：Medium

当前证据：

- `apps/web/public/app.js` 达到 1020 行。
- Web UI 已从技术表单向用户状态壳层收敛。
- 页面已有 provider 配置和下载凭证配置入口。
- 结果状态、失败分类、AfterEdit 操作仍在继续产品化中。

影响：

- 当前 UI 逻辑集中在一个大文件，不利于后续迭代。
- 用户仍可能看到偏工程化的信息。
- 任务状态与调试日志需要更清晰分层。

修复目标：

- 用户默认只看到必要输入。
- 技术参数后台固化或放到高级区。
- 状态显示为用户语言。
- 结果页显示文件名、当前环节、归档路径、失败类型。
- 原始日志只放调试区。

建议任务：

- 拆分 `app.js`。
- 固化 UI 状态模型。
- 优化任务卡片和失败卡片。
- 将 provider / platform credential 配置做成独立 UI 模块。

可复制提示词：

```text
请继续 Web UI 产品化收口。重点处理 apps/web/public/app.js 超 500 行问题，并保持用户默认页简洁。要求：用户只看到用户表、模型选择、配置模型 API、配置下载凭证、Preflight、启动任务、AfterEdit 操作、结果总览；技术日志进入调试区；状态显示为下载中、等待剪辑、等待打标、归档成功、失败。完成后启动 Web UI 并说明人工测试路径，运行 npm run test:taxonomy-domain。
```

## G. AfterEdit 两阶段流程

风险等级：Medium

当前证据：

- 第一阶段下载后中断已有测试。
- `AfterEdit` 文件夹自动创建已有测试。
- 第二阶段从 `AfterEdit` 表继续跑后链已有测试。
- 文件名规范、重复命名、递归扫描、自动重命名已有测试覆盖。

影响：

- 这是当前产品工作流的关键闸门。
- 若 UI 提示不清楚，用户会不知道何时剪辑、剪辑后放哪里、何时继续。
- 若映射规则不稳，后续打标和归档会错位。

修复目标：

- 第一阶段明确显示“等待人工剪辑”。
- 一键从 `AfterEdit` 生成表并自动载入。
- 第二阶段启动前校验文件名、重复、批次映射。
- 阻断异常，不让错误文件进入打标。

建议任务：

- 强化 UI 文案。
- 保留当前测试覆盖。
- 做一次人工验收。

可复制提示词：

```text
请完善 AfterEdit 两阶段流程。要求：第一阶段下载完成后明确进入“等待人工剪辑”；自动创建 AfterEdit；页面提供一键生成 AfterEdit 归档记录表并自动载入；生成表第一列第一行是“文件名”，后续逐行回填；第二阶段启动前校验文件名规范、重复文件名、批次映射；异常时阻断打标。完成后运行 npm run test:taxonomy-domain，并列出人工验收步骤。
```

## H. 表格与归档能力

风险等级：Medium

当前证据：

- 程序内总表存在：`视频数据采集总表.xlsx`。
- 用户表 / 总表 / both 的方向已经写入产品规则。
- `归档文件名` 和本地文件超链接是正式需求。
- Numbers 兼容边界已明确：不承诺超链接和自动着色。

影响：

- 表格是用户可见的最终结果之一。
- 若格式、列位或超链接错误，会直接破坏用户信任。
- xlsx 与 Numbers 的能力边界必须持续明确。

修复目标：

- 总表始终按标准模板输出。
- 用户表尽量保持原格式。
- both 模式按 URL upsert。
- `归档文件名` 写入可点击本地文件超链接。
- Numbers 只作为兼容输入输出。

建议任务：

- 增加标准表模板回归。
- 增加 hyperlink 回归。
- 增加 both upsert 回归。

可复制提示词：

```text
请收口表格与归档能力。要求：程序内总表模板包含 URL、采集人、归档状态、一级标签、二级标签、三级标签、四级标签、归档路径、归档文件名；xlsx 的归档文件名列必须写成本地文件超链接；both 双写按 URL upsert；用户表尽量保持原格式；Numbers 只承诺兼容读取和可视回填，不承诺超链接和自动着色。完成后补 spreadsheet 测试并运行 npm run test:taxonomy-domain。
```

## I. 文档一致性

风险等级：Medium

当前证据：

- `PRD.md` 当前 460 行，接近 500 行上限。
- `TASKLIST.md` 当前 199 行。
- `02_AGENTS_WORKFLOW.md` 当前 761 行，超过上限。
- 旧架构文档已有部分压缩，但仍需与 V0.2 实现保持一致。

影响：

- 文档如果落后于实现，会误导后续 Codex 对话框。
- 文档超限会违反项目规则。
- 多模型、多平台、AfterEdit、视频级打标规则需要统一口径。

修复目标：

- 所有主文档低于 500 行，或对标签库等数据资产明确豁免。
- PRD、TASKLIST、架构文档和当前代码一致。
- 删除已废弃的旧规则，尤其是直接下载后打标、抽帧默认链路、单平台假设。

建议任务：

- 压缩 `02_AGENTS_WORKFLOW.md`。
- 检查 `PRD.md` 是否需要继续瘦身。
- 同步多平台凭证、AfterEdit、模型候选池、视频级打标、500 行规则。

可复制提示词：

```text
请同步 V0.2 文档一致性。重点文件：PRD.md、TASKLIST.md、01_PROJECT_CHARTER.md、02_AGENTS_WORKFLOW.md、03_STRICT_RULES.md、04_STATE_AND_DATA.md、05_STEP_BY_STEP_PLAN.md。要求：明确视频级打标、不默认抽帧；明确 AfterEdit 两阶段；明确平台凭证和多平台下载边界；明确模型候选池；明确 500 行规则；每份文档低于 500 行，标签库如需豁免必须写清原因。完成后报告每份文档行数。
```

## 4. 推荐执行顺序

### 第一批：必须先做

1. A 工程治理与版本基线。
2. B 安全配置与密钥隔离。

原因：

- 这两组决定后续多对话框并行是否安全。
- 如果没有 baseline 和敏感文件隔离，后续改动越多，回溯成本越高。

### 第二批：可并行

1. C 500 行规则治理。
2. D 下载链幂等与多平台能力。
3. E 模型候选池真实验证。
4. F Web UI 产品化收口。

并行注意：

- C 和 F 都可能改 `apps/web/public/app.js`，不能同时改同一文件。
- D 和 H 都可能影响表格状态字段，需要同步字段契约。
- E 需要真实 key 和额度支持，缺条件时只做测试和错误分类，不伪造成功。

### 第三批：依赖前置结果

1. G AfterEdit 两阶段流程。
2. H 表格与归档能力。
3. I 文档一致性。

原因：

- G 依赖 Web UI 状态壳和表格字段。
- H 依赖归档字段稳定。
- I 必须最后做，用实际实现反向同步文档。

## 5. V0.2 准入标准

V0.2 可交付前必须满足：

- Git baseline 清晰。
- 本地密钥和 cookies 配置不进入版本。
- 工程代码文件不超过 500 行。
- `npm run test:taxonomy-domain` 通过。
- Bilibili 至少完成一轮真实下载回归。
- YouTube / Douyin / TikTok 至少完成最小真实探测或明确阻塞原因。
- Qwen 与 Gemini 候选模型完成真实视频输入验证，或明确阻塞原因。
- Web UI 默认页不暴露底层技术参数。
- AfterEdit 两阶段完成一次人工验收。
- xlsx 总表的 `归档文件名` 超链接完成验收。
- 所有失败进入用户可理解的分类错误。

## 6. 当前最高优先级

如果只能开三个 Codex 对话框，建议顺序是：

1. 工程治理与安全基线。
2. Web UI 拆分与 500 行治理。
3. 下载链多平台真实回归。

如果可以开五个 Codex 对话框，增加：

1. 模型候选池真实验证。
2. 表格与归档能力回归。

## 7. 审计结语

当前项目已经不是“能不能做”的阶段，而是“能不能稳定让用户自助跑完”的阶段。V0.2 的关键不是继续扩展更多想法，而是把现有链路做成可回溯、可解释、可验收、可复跑的工程产品。

下一步应停止无边界功能扩张，按本报告的分组推进治理和验证。
