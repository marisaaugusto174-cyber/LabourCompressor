# TagVision Label Studio 剥离设计

## 目标

将 Label Studio 从 TagVision V0.1 的产品流程和代码路径中完整剥离，使界面聚焦本地视频标签检视与人工 accepted 结果写入。改造后不再展示不可用的外部审核配置，也不再维护未使用的导入、同步和任务状态逻辑。

## 产品边界

改造后保留以下核心流程：

1. 选择包含视频、模型 JSON 和 taxonomy 快照的本地目录；
2. 扫描并配对视频与同名 JSON；
3. 按现有排序规则浏览卡片和详情；
4. 使用 Plyr 播放器、键盘快捷键和标签证据进行检查；
5. 编辑人工 accepted 路径并写入同名 `.accepted.json`；
6. 查看未配对、孤儿和无效文件诊断。

Label Studio 的项目创建、任务导入、审核结果导出、同步状态和任务跳转全部移出本版本。旧 `_tag-review-state.json` 文件不会被删除，但扫描过程不再读取它。

## 界面设计

首页移除 Label Studio 芯片、配置表单、下载导入包、导入、同步和项目跳转控件。页头只表达“本地检视”和“人工 accepted 结果”两个能力。

“检视来源”改为单个紧凑面板。目录输入框占据主要宽度，“选择目录”和“扫描目录”位于同一操作行，减少首屏高度。扫描摘要和多视频预览保持现有结构。

详情页移除“在 LS 打开”按钮和 LS 状态摘要。详情页继续显示文件信息、播放器、taxonomy、模型复核、标签数量、完整标签卡片、accepted 编辑器和居中序号。

## 代码与数据流

前端删除所有 Label Studio DOM 引用、事件监听、请求构造、本地存储、按钮状态、项目链接和任务跳转逻辑。

后端删除 Label Studio API 路由和 `services/label-studio.ts`。扫描和 accepted 写入接口保持不变。

数据层删除 Label Studio 导入包构建、导出解析、`_tag-review-state.json` 读写，以及 `labelStudioTaskId`、同步时间、审核备注和 `source: 'label-studio'` 等专属状态。卡片的“未同步”徽标和详情的 LS 状态一并删除。现有 accepted sidecar 结构和模型 JSON 结构不变。

## 错误处理

删除外部服务连接后，界面不再出现地址、Token、Project ID 或外部 API 错误。目录扫描、媒体加载、taxonomy 校验和 accepted 保存继续沿用现有错误处理。

## 测试与验收

采用测试先行方式：先增加会失败的断言，确认页面、前端脚本、后端路由和数据模型不再暴露 Label Studio，再删除实现使测试通过。

验收包括：

- 页面和详情中不出现 Label Studio、LS、Token 或 Project ID；
- 代码中不存在 Label Studio 服务、路由和状态文件读写；
- 目录扫描、卡片渲染、详情播放、快捷键、accepted 增删与保存正常；
- 旧 `_tag-review-state.json` 存在时不会影响扫描；
- 完整单元测试、类型检查和 macOS 打包通过；
- 在实际 `4312` 页面验证精简布局和核心检视流程。

## 非目标

本次不迁移历史 Label Studio 审核结果，不删除用户已有的 `_tag-review-state.json`，也不提供隐藏开关或未来集成占位入口。若后续重新引入外部协作审核，应作为独立可选模块重新设计。
