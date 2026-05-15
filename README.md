# LabourCompressor

LabourCompressor 是一个本地优先的短视频数据采集、打标和归档工作流。V0.3 以自动分割为主线：导入表格，下载受支持平台的视频，把长视频切成 `3-30s` 片段，对合格片段使用原生视频理解模型打标，回写表格，并按唯一 `内容题材` 路径归档文件。

本仓库按私有 GitHub 托管准备。不要提交真实 API key、cookies、下载视频、用户表格、运行状态或本地缓存文件。

## 快速开始

macOS 先安装 Node.js 22+ 和 Homebrew，然后执行：

```bash
git clone https://github.com/marisaaugusto174-cyber/LabourCompressor.git
cd LabourCompressor
npm run setup:mac
npm run web
```

Windows 10/11 先安装 Node.js 22+，然后在项目根目录打开 PowerShell 执行：

```powershell
npm run setup:windows
npm run web
```

启动后打开：

```text
http://127.0.0.1:4311/
```

macOS setup 会做这些事：

- 检查 Node.js 版本；
- 检查 Homebrew；
- 缺少 `yt-dlp` 时安装它；
- 缺少 `ffmpeg` 时安装它；
- 缺少 PySceneDetect 时安装到项目本地 `.tools/`；
- 运行 `npm install`；
- 本地配置文件不存在时，从模板创建；
- 创建可双击启动的 `dist/LabourCompressor.app`。

如果 setup 因 Node.js 或 Homebrew 停止，先安装缺失依赖：

- Node.js 22+：`https://nodejs.org/`
- Homebrew：`https://brew.sh/`

Windows setup 会做这些事：

- 检查 Node.js 22+ 和 npm；
- 优先使用 `winget` 安装 `yt-dlp`、`ffmpeg` 和 Python；
- 把 PySceneDetect 安装到项目本地 `.tools/scenedetect-venv/`；
- 运行 `npm install`；
- 本地配置文件不存在时，从模板创建；
- 创建可双击打开的 Windows 启动入口 `dist/LabourCompressor.vbs`，并同时创建排错用的 `dist/LabourCompressor.cmd` 和底层 PowerShell 启动脚本 `dist/LabourCompressor.ps1`。

如果没有 `winget`，请手动安装缺失依赖后重新运行 setup。当前仓库已用可模拟的平台分支测试覆盖 Windows 行为；在真实 Windows 部署前，仍应在 Windows 机器上做一次手工验收。

## 首次本地配置

`npm run setup:mac` 和 `npm run setup:windows` 会在这些本地配置文件不存在时自动创建：

- `config/model-providers/providers.local.json`
- `config/download-platform-credentials.local.json`

macOS 可以打开 Web UI app：

```bash
open dist/LabourCompressor.app
```

该 app 会启动或复用本地 Web UI 服务，把日志写到 `~/Library/Logs/LabourCompressor/web-ui.log`，并自动打开浏览器。

Windows 可以双击 `dist/LabourCompressor.vbs`。它会像本地应用入口一样启动或复用 Web UI 服务，把日志写到 `%LOCALAPPDATA%\\LabourCompressor\\logs\\web-ui.log`，并自动打开浏览器。若双击后没有反应，请改用 `dist/LabourCompressor.cmd` 启动，它会保留命令行窗口，方便查看错误信息。

命令行兜底方式：

```bash
npm run web
```

在 Web UI 中：

- 用模型 API 配置入口填写所选 provider 的 API key；
- 用平台凭证配置入口按需选择平台 cookies；
- 开始任务前先运行 Preflight。

不要提交 `*.local.json`、cookies、视频、表格、缓存文件或运行状态。

## V0.3 能力

- 本地 Web UI：选择任务输入、运行 preflight、启动任务、查看任务状态。
- 表格驱动工作流：`xlsx` 是完整标准格式，`numbers` 是兼容路径。
- 平台下载流程基于 `yt-dlp` 和 `ffmpeg`，支持平台级凭证引用。
- 打标前自动分割：场景检测、`3-30s` 时长治理，长段没有安全切点时强制切分。
- 有效内容覆盖目标约为 `80%`；纯片头片尾、黑屏、海报画面和少量切分损耗可以接受。
- 原始完整下载视频保留在下载缓存，只有合格分割片段进入打标和归档。
- `AfterEdit` 接收生成片段，例如 `原名_720P_260512_000023_01.mp4`。
- `ProblemClips` 接收异常片段，问题分类只允许 `无法满足 3-30s`、`导出失败`、`检测结果异常`。
- 关闭自动分割后，仍可使用 V0.2 的人工 `AfterEdit` 流程。
- 使用 Qwen 和 Gemini provider profile 做原生视频级多模态打标。
- 送模前创建标准视频打标缓存：`360p`、原帧率、`650 kbps` 视频、`AAC 64 kbps` 音频，并按 hash 复用。
- 多分支标签回表，同时只用唯一 `内容题材` 终端路径做归档。
- 每次任务会在 `<downloadDir>/本次打标结果/` 下生成结果表。
- 本地归档库根路径为 `视频数据归档库/内容题材`。

## 运行要求

- Node.js 22 或更新版本。
- macOS：Apple Silicon Mac，用于生成 `LabourCompressor.app` 启动器。
- macOS：Xcode Command Line Tools，用于构建原生 arm64 启动器：`xcode-select --install`。
- Windows：Windows 10/11 和 PowerShell；推荐使用 `winget` 安装依赖。
- `yt-dlp` 可在 `PATH` 中找到，或通过 UI/CLI 显式配置。
- `ffmpeg` 和 `ffprobe` 可在 `PATH` 中找到。
- PySceneDetect 由 `npm run setup:mac` 或 `npm run setup:windows` 安装到 `.tools/`。
- 所选视频模型需要对应的模型 provider API 凭证。
- 当目标平台需要登录态、更高码率或反滥用验证时，需要平台 cookies。

只安装 Node 依赖：

```bash
npm install
```

安装 macOS 依赖和 Node 依赖：

```bash
npm run setup:mac
```

安装 Windows 依赖和 Node 依赖：

```powershell
npm run setup:windows
```

运行本地 Web UI：

```bash
npm run web
```

运行完整测试：

```bash
npm run test:taxonomy-domain
```

## 本地配置

模板文件只用于参考结构。真实凭证文件会被 Git 忽略。

- 复制 `config/model-providers/providers.template.json` 到 `config/model-providers/providers.local.json`。
- 复制 `config/download-platform-credentials.template.json` 到 `config/download-platform-credentials.local.json`。
- 只填写本地测试需要的 provider 和平台。
- 不要把真实 `apiKey`、cookies、浏览器 session 或 OAuth 值提交到仓库，也不要放进截图。

V0.3 内置视频模型 profile：

- `Qwen 3.6 Flash` -> `qwen3.6-flash`
- `Qwen 3.6 Plus` -> `qwen3.6-plus`
- `Qwen 3.5 Plus` -> `qwen3.5-plus`
- `Gemini 3 Flash Thinking` -> `gemini-3-flash-preview`
- `Gemini 3.1 Pro` -> `gemini-3.1-pro-preview`

Qwen profile 默认使用较高打标并发。Gemini profile 默认使用较低并发，因为 preview 模型限流取决于 Google AI Studio 项目额度。

## 工作流

1. 用 `npm run web` 启动 Web UI。
2. 配置模型 API 凭证和下载平台凭证。
3. 导入包含源 URL 的用户表格。
4. 运行 Preflight，并修复阻断项。
5. 开启 `自动分割长视频` 后启动任务。
6. 系统下载源视频，把合格分割片段写入 `AfterEdit`，把问题片段写入 `ProblemClips`，并对合格片段打标。
7. 检查回写结果、归档结果、`AfterEdit_归档记录表.xlsx` 和本次任务结果表。

V0.2 保留为本地 tag `v0.2.0` 和 GitHub baseline。若要使用旧的人工剪辑流程，请关闭自动分割，并开启人工剪辑闸门。

正式表格规则见 `CSV格式要求.md`、`NUMBERS格式要求.md` 和项目 PRD。

## 数据安全

以下内容必须只保存在本地：

- `*.local.json`
- `.cache/`
- `.runtime-state/`
- `.runtime-uploads/`
- `.web-ui.log`
- `视频数据下载缓存/`
- `视频数据采集总表.xlsx`
- 下载或剪辑后的视频
- 用户表格和导出的结果文件
- cookies、API key、OAuth secret、token

仓库已在 `.gitignore` 中忽略这些本地文件。提交前务必检查 staged files。

## V0.3 已知限制

- 这是本地单用户工作流，不是云服务。
- 系统不会自动浏览器登录，也不保证绕过平台风控。
- 下载成功率取决于平台策略、账号状态、cookies 新鲜度、`yt-dlp` 支持状态和本地网络。
- V0.3 自动分割是规则驱动，不做完整语义故事分析。
- `Numbers` 支持以兼容为目标，不保证本地文件超链接或自动样式完整可用。
- 模型质量、速度和限流取决于 provider 账号、额度和所选模型。
- OpenAI GPT 模型不在 V0.3 视频模型候选池中，因为该工作流要求原生视频输入。

## 发布基线

V0.3.1 发布说明在 `docs/release/V0.3.1_RELEASE_NOTES.md`。
V0.3 发布说明在 `docs/release/V0.3_RELEASE_NOTES.md`。
V0.2 发布说明保留在 `docs/release/V0.2_RELEASE_NOTES.md`。

当前私有基线应打 tag：

```bash
v0.3.1
```
