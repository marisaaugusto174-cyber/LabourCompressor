# LabourCompressor

LabourCompressor is a local-first video collection, tagging, and archive workflow for short video datasets. V0.3 makes automatic segmentation the mainline: import a spreadsheet, download supported platform videos, split long videos into `3-30s` clips, tag each accepted clip with native video-level models, write results back to spreadsheets, and archive files by the unique `内容题材` path.

This repository is currently prepared for private GitHub hosting. Do not commit real API keys, cookies, downloaded videos, user spreadsheets, runtime state, or local cache files.

## Quick Start

Use these commands on macOS after installing Node.js 22+ and Homebrew.

```bash
git clone https://github.com/marisaaugusto174-cyber/LabourCompressor.git
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
- installs `scenedetect` if missing;
- runs `npm install`.
- creates local config files from templates when they do not exist.

If setup stops with a Node.js or Homebrew error, install the missing prerequisite first:

- Node.js 22+: `https://nodejs.org/`
- Homebrew: `https://brew.sh/`

## First Local Configuration

`npm run setup:mac` creates these local-only config files automatically when they do not exist:

- `config/model-providers/providers.local.json`
- `config/download-platform-credentials.local.json`

Then start the Web UI:

```bash
npm run web
```

In the Web UI:

- use model API configuration to paste the selected provider API key;
- use platform credential configuration to select platform cookies when needed;
- run Preflight before starting a task.

Do not commit `*.local.json`, cookies, videos, spreadsheets, cache files, or runtime state.

## V0.3 Capabilities

- Local Web UI for selecting task inputs, running preflight, starting jobs, and viewing task state.
- Spreadsheet-driven workflow with `xlsx` as the complete standard format and `numbers` as a compatibility path.
- Platform download flow based on `yt-dlp` and `ffmpeg`, with platform-level credential references.
- Automatic segmentation before tagging: scene detection, `3-30s` duration governance, and forced split when a long segment has no safe cut.
- Effective-content coverage target is about `80%`; pure heads/tails, blank screens, posters, and small cutting loss are acceptable.
- Original downloaded full videos remain in the download cache, but only accepted segmented clips enter tagging and archive.
- `AfterEdit` receives generated clips such as `原名_720P_260512_000023_01.mp4`.
- `ProblemClips` receives exceptional clips, with problem categories limited to `无法满足 3-30s`, `导出失败`, and `检测结果异常`.
- V0.2 manual `AfterEdit` flow remains available by disabling automatic segmentation.
- Native video-level multimodal tagging with Qwen and Gemini provider profiles.
- Standardized video tagging cache before model delivery: `360p`, original frame rate, `650 kbps` video, `AAC 64 kbps` audio, hash-based reuse.
- Multi-branch tag writeback plus exactly one unique `内容题材` terminal path for archive placement.
- Per-task result spreadsheet generation under `<downloadDir>/本次打标结果/`.
- Local archive layout rooted at `视频数据归档库/内容题材`.

## Requirements

- Node.js 22 or newer.
- `yt-dlp` available in `PATH` or configured through the UI/CLI.
- `ffmpeg` and `ffprobe` available in `PATH`.
- `scenedetect` available in `PATH`.
- Model provider API credentials for the selected video model.
- Platform cookies when the target platform requires login, higher quality formats, or anti-abuse verification.

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

Curated V0.3 video model profiles:

- `Qwen 3.6 Flash` -> `qwen3.6-flash`
- `Qwen 3.6 Plus` -> `qwen3.6-plus`
- `Qwen 3.5 Plus` -> `qwen3.5-plus`
- `Gemini 3 Flash Thinking` -> `gemini-3-flash-preview`
- `Gemini 3.1 Pro` -> `gemini-3.1-pro-preview`

Qwen profiles default to higher tagging concurrency. Gemini profiles default to lower concurrency because preview model rate limits depend on the Google AI Studio project tier.

## Workflow

1. Start the Web UI with `npm run web`.
2. Configure model API credentials and download platform credentials.
3. Import a user spreadsheet with source URLs.
4. Run preflight and fix any blocking issues.
5. Start the task with `自动分割长视频` enabled.
6. The system downloads full source videos, writes segmented clips into `AfterEdit`, writes problem clips into `ProblemClips`, and tags accepted clips.
7. Review writeback, archive results, `AfterEdit_归档记录表.xlsx`, and the per-task result spreadsheet.

V0.2 is retained as the local tag `v0.2.0` and GitHub baseline. To use the old manual edit workflow, turn off automatic segmentation and enable the manual edit gate.

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

## Known V0.3 Limits

- This is a local single-user workflow, not a cloud service.
- The system does not perform automatic browser login or guarantee bypassing platform risk controls.
- Download success depends on platform policy, account state, cookies freshness, `yt-dlp` support, and local network conditions.
- Automatic segmentation is rule-based in V0.3; it does not yet perform full semantic story analysis.
- `Numbers` support is compatibility-oriented and does not guarantee local file hyperlinks or automatic styling.
- Model quality, speed, and rate limits vary by provider account, quota, and selected model.
- OpenAI GPT models are not included in the V0.3 video model candidate pool because this workflow requires native video input.

## Release Baseline

V0.2 release notes are stored in `docs/release/V0.2_RELEASE_NOTES.md`.

The current private baseline should be tagged as:

```bash
v0.2.0
```
