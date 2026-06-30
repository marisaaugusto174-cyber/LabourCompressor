# LabourCompressor

LabourCompressor is a local-first video collection, tagging, and archive workflow for short video datasets. V0.5 provides a simplified mainline and an advanced workspace for spreadsheet or local-media intake, automatic segmentation, native video tagging, review, writeback, and archive.

This repository is currently prepared for private GitHub hosting. Do not commit real API keys, cookies, downloaded videos, user spreadsheets, runtime state, or local cache files.

## Quick Start

The migration deliverable is a `源码包 + 一键启动器`. The source package does not include local credentials, videos, caches, `node_modules`, `.tools`, or a pre-generated `dist/LabourCompressor.app`.

For a cold start on another machine, install these manual prerequisites first:

- macOS Apple Silicon.
- Xcode Command Line Tools: `xcode-select --install`.
- Node.js 22+ with npm.
- Homebrew.
- Network access to npm、Homebrew、PyPI、模型 provider.

After extracting the source package, double-click:

```text
Start LabourCompressor.command
```

The launcher locates the project from its own folder, runs `npm run setup:mac` when local dependencies or config files are missing, generates `dist/LabourCompressor.app` for the current machine path, and opens the Web UI.

Command-line start on macOS:

```bash
cd LabourCompressor
npm run setup:mac
npm run web
```

Then open:

```text
http://127.0.0.1:4311/
```

What the setup command does:

- checks Node.js version;
- checks Homebrew;
- installs `yt-dlp` if missing;
- installs `ffmpeg` if missing;
- installs project-local PySceneDetect under `.tools/` if missing;
- runs `npm install`.
- creates local config files from templates when they do not exist.
- creates `dist/LabourCompressor.app` as a double-click macOS launcher.

If setup stops with a Node.js or Homebrew error, install the missing prerequisite first:

- Node.js 22+: `https://nodejs.org/`
- Homebrew: `https://brew.sh/`

Build a migration source package:

```bash
npm run package:migration -- --output ../LabourCompressor-migration-source.zip
```

## First Local Configuration

`npm run setup:mac` creates these local-only config files automatically when they do not exist:

- `config/model-providers/providers.local.json`
- `config/download-platform-credentials.local.json`

Then open the Web UI app:

```bash
open dist/LabourCompressor.app
```

The app starts or reuses the local Web UI service, writes logs to `~/Library/Logs/LabourCompressor/web-ui.log`, and opens the browser automatically.

Command-line fallback:

```bash
npm run web
```

In the Web UI:

- use model API configuration to paste the selected provider API key after first launch;
- use platform credential configuration to select platform cookies when needed after first launch;
- run Preflight before starting a task.
- choose `核心基座标签提示词 V0.3 戏核增强候选` in `标签库` when the drama-enhanced taxonomy is needed.
- choose a local Markdown file in `自定义标签文件` when a one-off taxonomy should override the selected preset for the current task.

模型 API key 和必要平台 cookies 由用户首次启动后在 Web UI 填入，不随包分发。Do not commit `*.local.json`, cookies, videos, spreadsheets, cache files, or runtime state.

## V0.5 Capabilities

- Local Web UI for selecting task inputs, running preflight, starting jobs, and viewing task state.
- Spreadsheet-driven workflow with `xlsx` as the complete standard format. `Numbers` files keep 读取兼容, while intermediate tables, writeback, and archive records remain `xlsx`.
- `csv` remains available for import and 失败导出 only; formal writeback and local hyperlinks stay on `xlsx`.
- Web user-sheet tasks create a writable copy and a task cache beside the selected sheet before launch. They are named `<原名>_任务副本_<时间>_<任务ID前8位>` and `<原名>_视频下载缓存_<任务ID前8位>`. The source sheet stays unchanged; downloads, segmentation output, `AfterEdit`, `ProblemClips`, and per-task result sheets use the task cache. The source directory must be writable, and task workspaces remain available after failure or cancellation.
- Platform download flow based on `yt-dlp` and `ffmpeg`, with platform-level credential references.
- Xiaohongshu single-video notes use `yt-dlp` first and automatically fall back to local note-page parsing when the extractor returns no formats.
- Continuity-first automatic segmentation before tagging: PySceneDetect proposes shots, then local visual, motion, and audio algorithms assemble `5-60s` ranges with `5-30s` preferred. No AI model or OCR participates in segmentation.
- Effective-content coverage target is about `80%`; pure heads/tails, blank screens, posters, and small cutting loss are acceptable.
- Original downloaded full videos remain in the download cache, but only accepted segmented clips enter tagging and archive.
- `AfterEdit` receives generated clips such as `原名_720P_260512_000023_01.mp4`.
- `ProblemClips` receives exceptional clips, with problem categories limited to `无法满足 5-60s`, `导出失败`, and `检测结果异常`.
- Strongly continuous `30-60s` groups remain intact. Segments over `60s` prefer the weakest detected boundary and use mathematical splitting only when no internal boundary exists.
- Continuity analysis failures use a mechanical scene-and-duration fallback and write a compact `.segmentation/<asset>/continuity.json` diagnostic without frames, audio, credentials, or media payloads.
- V0.2 manual `AfterEdit` flow remains available by disabling automatic segmentation.
- Native video-level multimodal tagging with Qwen and Gemini provider profiles.
- Qwen content-inspection rejections automatically retry once with configured Gemini. If Gemini is unavailable or also rejects the video, the item is copied to `<archiveRoot>/待人工复查/` with a JSON audit sidecar and an idempotent `待人工复查总表.xlsx`; transient Gemini failures remain retryable errors.
- Standardized video tagging cache before model delivery: `360p`, original frame rate, `650 kbps` video, `AAC 64 kbps` audio, hash-based reuse.
- Multi-branch tag writeback. New `core-v0.3-drama` tasks require exactly one legal `核心动作/主动作`; all secondary actions and unrelated accepted tags remain in the result and sidecar.
- Per-task result spreadsheet generation under `<downloadDir>/本次打标结果/`.
- New V0.3 archive layout uses the complete selected path, for example `视频数据归档库/核心动作/身体动作/位移动作/跑动`. If the unique main action is invalid, the model is repaired at most once; a second failure is left for review and no media is archived.
- V0.1, V0.2, explicit historical content-domain paths, and already archived files remain compatible and are not migrated.

## Requirements

- Node.js 22 or newer.
- Apple Silicon Mac for the generated `LabourCompressor.app` launcher.
- Xcode Command Line Tools for building the native arm64 launcher: `xcode-select --install`.
- `yt-dlp` available in `PATH` or configured through the UI/CLI.
- `ffmpeg` and `ffprobe` available in `PATH`.
- PySceneDetect installed by `npm run setup:mac` under `.tools/`.
- Model provider API credentials for the selected video model.
- Platform cookies when the target platform requires login, higher quality formats, or anti-abuse verification.

Xiaohongshu MVP support is limited to one video from one `/explore/<note-id>` or `/discovery/item/<note-id>` URL. Import a Netscape-format `cookies.txt` through `配置下载凭证`; image notes, profile feeds, short links, and automatic browser login are not supported. Access query parameters are used for the network request but removed from runtime summaries and persisted download metadata.

Install Node dependencies only:

```bash
npm install
```

Install macOS dependencies and Node dependencies:

```bash
npm run setup:mac
```

Run the local Web UI:

```bash
npm run web
```

Run the full test suite:

```bash
npm run test:taxonomy-domain
```

## Local Configuration

Use template files as structure references only. Real credential files are intentionally ignored by Git.

- Copy `config/model-providers/providers.template.json` to `config/model-providers/providers.local.json`.
- Copy `config/download-platform-credentials.template.json` to `config/download-platform-credentials.local.json`.
- Fill only the providers and platforms you need for local testing.
- Keep real `apiKey`, cookies, browser sessions, and OAuth values out of commits and screenshots.

Curated V0.5 video model profiles:

- `Qwen3.7Plus` -> `qwen3.7-plus`
- `Qwen3.6Flash` -> `qwen3.6-flash`
- `Gemini 3.5 Flash` -> `gemini-3.5-flash`

`Qwen3.7Plus` is the default profile. The Web UI exposes an `自动打标并发数` slider from `1` to `64`; defaults are `16` for Qwen3.7Plus, `24` for Qwen3.6Flash, and `4` for Gemini 3.5 Flash. Rate-limit retries remain finite and failures are exported as CSV instead of interrupting the whole batch.

## Workflow

1. Start the Web UI with `npm run web`.
2. Configure model API credentials and download platform credentials.
3. Import a user spreadsheet with source URLs.
4. Run preflight and fix any blocking issues.
5. Start the one-click full workflow with `自动分割长视频` enabled.
6. The system downloads full source videos, writes segmented clips into `AfterEdit`, writes problem clips into `ProblemClips`, and tags accepted clips.
7. Review writeback, archive results, `AfterEdit_归档记录表.xlsx`, and the per-task result spreadsheet.

Cache resume workflow:

1. If you already have `AfterEdit_归档记录表.xlsx`, select it as the user sheet.
2. If you only have a folder of videos, select that folder in `视频文件夹`.
2. Keep the archive root and model config current for this machine.
3. Open `高级工具` and click `从缓存继续` for an existing sheet, or `从视频文件夹继续` for a plain folder.
4. For a plain folder, the system first creates `AfterEdit_归档记录表.xlsx` inside that folder.
5. The system runs `compress -> tag -> archive` and does not run download or segmentation.

V0.2 is retained as the local tag `v0.2.0` and GitHub baseline. To use the old manual edit workflow as an advanced compatibility mode, turn off automatic segmentation and enable the manual edit gate.

For formal spreadsheet rules, see `CSV格式要求.md`, `NUMBERS格式要求.md`, and the project PRD.

## Data Safety

The following must remain local-only:

- `*.local.json`
- `.cache/`
- `.runtime-state/`
- `.runtime-uploads/`
- `.web-ui.log`
- `视频数据下载缓存/`
- `视频数据采集总表.xlsx`
- downloaded or edited videos
- user spreadsheets and exported result files
- cookies, API keys, OAuth secrets, tokens

The repository includes `.gitignore` entries for these local artifacts. Always inspect staged files before committing.

## Known V0.5 Limits

- This is a local single-user workflow, not a cloud service.
- The system does not perform automatic browser login or guarantee bypassing platform risk controls.
- Download success depends on platform policy, account state, cookies freshness, `yt-dlp` support, and local network conditions.
- Xiaohongshu image notes, profile feeds, short links, and multi-note collection are outside the V0.5 download scope.
- Automatic segmentation is rule-based in V0.5; it does not yet perform full semantic story analysis.
- `Numbers` support is compatibility-oriented and does not guarantee local file hyperlinks or automatic styling.
- Model quality, speed, and rate limits vary by provider account, quota, and selected model.
- OpenAI GPT models are not included in the V0.5 video model candidate pool because this workflow requires native video input.

## Release Baseline

V0.5 release notes are stored in `docs/release/V0.5_RELEASE_NOTES.md`.
V0.3 release notes remain stored in `docs/release/V0.3_RELEASE_NOTES.md`.
V0.2 release notes remain stored in `docs/release/V0.2_RELEASE_NOTES.md`.

The current private baseline should be tagged as:

```bash
v0.5.0
```
