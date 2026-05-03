# 05_STEP_BY_STEP_PLAN.md

## Planning Status

- Project Name: `LabourCompressor`
- Product Version: `v0.2`
- Planning Mode: `Web UI Productization Plan`
- Primary Workflow: `Two-stage AfterEdit workflow`
- Verification Standard: `Relevant tests + document line-count check`

---

## V0.2 Target

V0.2 的目标是把已跑通的本地引擎收敛为 Web UI 可操作产品。

用户应能完成：

1. 配置模型 API 和平台下载凭证。
2. 导入用户表并运行 Preflight。
3. 启动第一阶段下载。
4. 下载后在 `AfterEdit` 进行人工剪辑。
5. 生成 `AfterEdit_归档记录表.xlsx` 并自动载入。
6. 启动第二阶段视频级打标、回表、归档。
7. 查看成功结果、失败原因和失败 CSV。

---

## Execution Policy

### Product Proof Rule

不得用以下结果冒充 V0.2 完成：

- CLI-only 流程
- 单阶段下载后直接打标
- 只处理原下载文件
- 跳过 `AfterEdit` 表生成
- 抽帧图片理解替代正式视频级打标
- 多分支标签只写回 `内容题材`
- 凭证配置只支持全局 cookies

### File Size Rule

单文件不得超过 500 行。超限时先压缩重复、过期和职责混杂内容；优化后仍超限且有明确职责边界时才拆分。

### Safety Rule

不得删除用户数据；不得改动与当前任务无关文件；不得在日志、报告、测试输出或文档中打印真实 API key、cookies、token。

---

## Milestone 1: Documentation and Governance Sync

目标：让核心文档统一 V0.2 口径。

范围：

- `PRD.md`
- `TASKLIST.md`
- `01_PROJECT_CHARTER.md`
- `03_STRICT_RULES.md`
- `04_STATE_AND_DATA.md`
- `05_STEP_BY_STEP_PLAN.md`

交付：

- V0.2 目标明确。
- AfterEdit 两阶段流程明确。
- 视频级打标、不默认抽帧明确。
- 平台凭证和多平台下载边界明确。
- 500 行规则明确。
- 每份文档不超过 500 行。

验证：

- `wc -l` 检查目标文档。
- `rg` 检查关键术语。
- 运行相关测试套件。

---

## Milestone 2: Web UI Configuration

目标：用户能在 Web UI 中完成运行前配置。

任务：

- 模型 provider 和 model profile 下拉。
- Provider API key 配置入口。
- 平台下载凭证配置入口。
- 平台级 `cookiesFilePath` 与 `cookiesFromBrowser`。
- 全局 cookies 兼容回退。
- 配置保存和 Preflight 校验。

边界：

- 覆盖 `Bilibili / YouTube / 抖音 / TikTok`。
- 不承诺自动登录、自动绕过风控、自动去水印或全平台稳定下载。
- 凭证明文不得进入日志、报告或测试输出。

退出条件：

- 缺失、过期、不可读或不适配的平台凭证能被用户理解。
- 当前模型可连通且支持视频输入。

---

## Milestone 3: First Stage Download

目标：表格驱动 URL 下载并暂停等待人工剪辑。

任务：

- 读取用户表 URL 行。
- 跳过 `已归档 / 已下载未归档 / 已下载待剪辑` 行。
- 识别 URL 平台。
- 按平台选择凭证。
- 调用 `yt-dlp` 与 `ffmpeg`。
- 标准化下载文件名。
- 创建 `下载缓存目录/AfterEdit`。
- 回写 `已下载待剪辑`。

退出条件：

- 下载成功项不会自动进入打标。
- 任务状态显示下一步为人工剪辑。
- 常见下载失败有分类和下一步建议。

---

## Milestone 4: AfterEdit Gate

目标：把人工剪辑结果转换为第二阶段标准输入。

任务：

- 扫描 `AfterEdit`。
- 校验支持的视频文件。
- 生成 `AfterEdit_归档记录表.xlsx`。
- 第一行第一列固定为 `文件名`。
- 自动把该表载入用户表路径。
- 第二阶段启动前校验文件名、重复项和文件存在性。

文件名标准：

```text
原视频标题_视频下载分辨率_下载年月日_视频时长秒数.mp4
```

退出条件：

- 不合规文件不会进入打标。
- 异常项回填失败状态和 `失败信息`。

---

## Milestone 5: Video-Level Tagging

目标：对剪辑后视频做正式视频级打标。

任务：

- 生成标准压缩缓存。
- 调用模型原生视频理解能力。
- 记录 provider、model、video cache profile。
- 生成候选标签。
- schema 校验模型输出。
- taxonomy 合法化候选标签。

压缩 profile：

```text
360p + 原帧率保持 + H.264 650 kbps + AAC 64 kbps + mp4 + 源文件哈希复用
```

边界：

- 不默认抽帧。
- 抽帧仅用于调试、实验或显式降级。
- provider 不支持视频输入时阻断或显式降级并记录原因。

退出条件：

- Candidate 不直接回表或归档。
- Accepted Record 带标签库版本和 `DecisionFingerprint`。

---

## Milestone 6: Writeback and Archive

目标：把正式标签写回表格并按唯一 `内容题材` 归档。

任务：

- 多分支标签写回 `一级标签 / 二级标签 / 三级标签 / 四级标签`。
- 同步写回用户表与程序内 `xlsx` 总表。
- 生成唯一 `内容题材` 归档路径。
- 写入 `归档路径` 和 `归档文件名`。
- 失败项写入 `失败信息`。
- 支持失败 CSV 导出。

规则：

- 回表保留多分支标签。
- 归档只消费唯一 `内容题材`。
- 非 `内容题材` 分支不参与目录生成。
- 归档根固定为 `视频数据归档库/内容题材`。

退出条件：

- 每个成功视频只落入一个最终目录。
- `xlsx` 总表同步更新。
- 失败项可定位、可导出、可重试。

---

## Milestone 7: End-to-End Acceptance

验收链路：

```text
Web UI 配置
-> Preflight
-> 下载
-> 暂停等待人工剪辑
-> AfterEdit 表生成
-> 第二阶段校验
-> 视频压缩缓存
-> 视频级打标
-> 标签合法化
-> 多分支回表
-> 唯一内容题材归档
-> 总表同步
-> 失败导出
```

验收标准：

- 非工程用户无需 CLI 参数即可完成主流程。
- 关键失败原因对用户可读。
- 所有关键自动结果可追溯。
- 凭证不泄露。
- 目标文档和新增文件遵守 500 行规则。

---

## Deferred Scope

V0.2 延后：

- 云端账号系统
- 多人协作权限
- 远程素材传输
- 自动浏览器登录抓取 cookies
- 自动绕过风控
- 自动去水印承诺
- 完整训练数据交付平台
- 复杂 BI 报表
- 全平台下载稳定性承诺
- 标签检索和训练级数据交付增强

---

## Current Conclusion

V0.2 的执行顺序是先同步文档和治理口径，再产品化 Web UI 配置与两阶段工作流，最后做端到端验收。所有实现都必须围绕 `AfterEdit` 闸门、视频级打标、凭证安全和 500 行规则收敛。
